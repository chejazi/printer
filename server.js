#!/usr/bin/env node
require("dotenv").config();

const express = require("express");
const { listPrinters, DEFAULT_PRINTER, MAX_FEED_LINES } = require("./lib/printer");
const {
  PrintQueue,
  createPrintQueueConfigFromEnv,
  getPrintQueue,
} = require("./lib/print-queue");
const { createSequenceRegistry } = require("./lib/sequence-registry");
const { createSequenceJobStore } = require("./lib/sequence-job-store");

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_AUTH_TOKEN = process.env.AUTH_TOKEN;

function createApp(options = {}) {
  const authToken = options.authToken ?? DEFAULT_AUTH_TOKEN;
  const sequenceRegistry = options.sequenceRegistry || createSequenceRegistry({ stateFile: process.env.SEQUENCE_STATE_FILE });
  const jobStore = options.jobStore || createSequenceJobStore();
  const printQueueConfig = {
    ...createPrintQueueConfigFromEnv(),
    ...(options.printQueueConfig || {}),
    onBatchStart(batch) {
      jobStore.updateMany(batch.printJobIds, { state: "printing" });
      jobStore.updateMany(batch.sequenceJobIds, { state: "printing" });
    },
    onBatchSuccess(batch, result) {
      jobStore.updateMany(batch.printJobIds, {
        state: "succeeded",
        completedAt: new Date().toISOString(),
        printer: result.printer,
      });
      for (const advancement of batch.sequenceAdvancements) {
        sequenceRegistry.setFrame(advancement.sequenceId, advancement.nextFrameIndex);
      }
      for (const jobId of batch.sequenceJobIds) {
        const job = jobStore.get(jobId);
        const sequence = job && sequenceRegistry.get(job.sequence);
        const currentIndex = job ? sequenceRegistry.currentFrame(job.sequence) : 0;
        jobStore.update(jobId, {
          state: "succeeded",
          completedAt: new Date().toISOString(),
          currentFrame: currentIndex + 1,
          nextFrame: sequence ? ((currentIndex + 1) % sequence.frames.length) + 1 : undefined,
          printer: result.printer,
        });
      }
    },
    onBatchFailure(batch, error) {
      jobStore.updateMany(batch.printJobIds, {
        state: "failed",
        failedAt: new Date().toISOString(),
        error: error.message,
      });
      jobStore.updateMany(batch.sequenceJobIds, {
        state: "failed",
        failedAt: new Date().toISOString(),
        error: error.message,
      });
    },
  };
  const printQueue = options.printQueue || (options.useSingleton === false
    ? new PrintQueue(printQueueConfig)
    : getPrintQueue(printQueueConfig));

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(express.text({ limit: "64kb", type: "text/plain" }));

  function requireAuth(req, res, next) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = header.slice("Bearer ".length);

    if (token !== authToken) {
      res.status(403).json({ error: "Invalid token" });
      return;
    }

    next();
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/printers", requireAuth, async (_req, res) => {
    try {
      const printers = await listPrinters();
      res.json({ printers });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/print", requireAuth, (req, res) => {
    let text;
    let noCut = false;
    let feedLines;
    let printer;
    let flush = false;
    let trackJob = false;

    if (typeof req.body === "string") {
      text = req.body;
    } else if (req.body && typeof req.body === "object") {
      text = typeof req.body.text === "string" ? req.body.text : "";
      noCut = Boolean(req.body.noCut);
      flush = Boolean(req.body.flush);
      trackJob = Boolean(req.body.trackJob);
      printer = req.body.printer;

      if (req.body.feedLines !== undefined) {
        feedLines = Number(req.body.feedLines);

        if (
          !Number.isInteger(feedLines)
          || feedLines < 0
          || feedLines > MAX_FEED_LINES
        ) {
          res.status(400).json({
            error: `feedLines must be an integer from 0 to ${MAX_FEED_LINES}`,
          });
          return;
        }
      }
    }

    if (!text || !text.trim()) {
      res.status(400).json({
        error: 'Provide text to print in JSON ({ "text": "..." }) or as text/plain body',
      });
      return;
    }

    try {
      const job = trackJob ? jobStore.create({ kind: "static", printer }) : null;
      const result = printQueue.enqueue({ text, printer, noCut, feedLines, printJobId: job?.id });

      if (flush) {
        printQueue.flushAll();
      }

      res.json({
        ok: true,
        queued: result.queued,
        jobId: job?.id,
        statusUrl: job ? `/print/jobs/${job.id}` : undefined,
        printer: result.printer,
        pendingMessages: result.pendingMessages,
        pendingBatches: result.pendingBatches,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/print/jobs/:id", requireAuth, (req, res) => {
    const job = jobStore.publicJob(jobStore.get(req.params.id));
    if (!job) {
      res.status(404).json({ error: "Unknown print job." });
      return;
    }
    res.json({ ok: true, job });
  });

  app.post("/print-sequence", requireAuth, (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Provide a JSON sequence print request." });
      return;
    }
    const sequenceId = typeof req.body.sequence === "string"
      ? req.body.sequence : "higher-zip-running-horse";
    const template = typeof req.body.template === "string" ? req.body.template : "";
    const sequence = sequenceRegistry.get(sequenceId);
    if (!sequence) {
      res.status(400).json({ error: `Unknown sequence: ${sequenceId}` });
      return;
    }
    if (!template.includes(sequenceRegistry.token(sequenceId))) {
      res.status(400).json({ error: `Template must contain ${sequenceRegistry.token(sequenceId)}.` });
      return;
    }
    const requestedFrame = req.body.frame === undefined
      ? sequenceRegistry.currentFrame(sequenceId) + 1
      : Number(req.body.frame);
    if (!Number.isInteger(requestedFrame) || requestedFrame < 1 || requestedFrame > sequence.frames.length) {
      res.status(400).json({ error: `frame must be an integer from 1 to ${sequence.frames.length}` });
      return;
    }
    const frameIndex = requestedFrame - 1;
    const advanceOnSuccess = req.body.advanceOnSuccess !== false;
    let feedLines;
    if (req.body.feedLines !== undefined) {
      feedLines = Number(req.body.feedLines);
      if (!Number.isInteger(feedLines) || feedLines < 0 || feedLines > MAX_FEED_LINES) {
        res.status(400).json({ error: `feedLines must be an integer from 0 to ${MAX_FEED_LINES}` });
        return;
      }
    }
    try {
      const job = jobStore.create({
        sequence: sequenceId,
        frame: requestedFrame,
        nextFrame: (frameIndex + 1) % sequence.frames.length + 1,
        advanceOnSuccess,
        printer: req.body.printer,
      });
      const result = printQueue.enqueue({
        printer: req.body.printer,
        noCut: Boolean(req.body.noCut),
        feedLines,
        sequenceJobId: job.id,
        sequenceId,
        advanceOnSuccess,
        resolveText: () => sequenceRegistry.resolve(sequenceId, template, frameIndex),
      });
      if (req.body.flush) printQueue.flushAll();
      res.json({
        ok: true,
        queued: result.queued,
        jobId: job.id,
        statusUrl: `/print-sequence/jobs/${job.id}`,
        printer: result.printer,
        sequence: sequenceId,
        frame: requestedFrame,
        nextFrame: job.nextFrame,
        advanceOnSuccess,
        pendingMessages: result.pendingMessages,
        pendingBatches: result.pendingBatches,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get("/print-sequence/jobs/:id", requireAuth, (req, res) => {
    const job = jobStore.publicJob(jobStore.get(req.params.id));
    if (!job) {
      res.status(404).json({ error: "Unknown sequence print job." });
      return;
    }
    res.json({ ok: true, job });
  });

  return app;
}

if (require.main === module) {
  if (!DEFAULT_AUTH_TOKEN) {
    console.error("Error: AUTH_TOKEN environment variable is required.");
    process.exit(1);
  }

  createApp().listen(PORT, "0.0.0.0", () => {
    console.log(`Print server listening on http://0.0.0.0:${PORT}`);
    console.log(`Default printer: ${process.env.PRINTER_NAME || DEFAULT_PRINTER}`);
  });
}

module.exports = { createApp };
