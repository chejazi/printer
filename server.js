#!/usr/bin/env node
require("dotenv").config();

const express = require("express");
const { listPrinters, DEFAULT_PRINTER, MAX_FEED_LINES } = require("./lib/printer");
const {
  createPrintQueueConfigFromEnv,
  getPrintQueue,
} = require("./lib/print-queue");
const { createSequenceRegistry } = require("./lib/sequence-registry");

const PORT = Number(process.env.PORT) || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const sequenceRegistry = createSequenceRegistry({ stateFile: process.env.SEQUENCE_STATE_FILE });
const printQueue = getPrintQueue({
  ...createPrintQueueConfigFromEnv(),
  onBatchSuccess(batch) {
    for (const sequenceId of batch.sequenceIds) sequenceRegistry.advance(sequenceId);
  },
});

if (!AUTH_TOKEN) {
  console.error("Error: AUTH_TOKEN environment variable is required.");
  process.exit(1);
}

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

  if (token !== AUTH_TOKEN) {
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

  if (typeof req.body === "string") {
    text = req.body;
  } else if (req.body && typeof req.body === "object") {
    text = typeof req.body.text === "string" ? req.body.text : "";
    noCut = Boolean(req.body.noCut);
    flush = Boolean(req.body.flush);
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
    const result = printQueue.enqueue({ text, printer, noCut, feedLines });

    if (flush) {
      printQueue.flushAll();
    }

    res.json({
      ok: true,
      queued: result.queued,
      printer: result.printer,
      pendingMessages: result.pendingMessages,
      pendingBatches: result.pendingBatches,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
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
    const result = printQueue.enqueue({
      printer: req.body.printer,
      noCut: Boolean(req.body.noCut),
      feedLines,
      sequenceId,
      advanceOnSuccess,
      resolveText: () => sequenceRegistry.resolve(sequenceId, template),
    });
    if (req.body.flush) printQueue.flushAll();
    const frameIndex = sequenceRegistry.currentFrame(sequenceId);
    res.json({
      ok: true,
      queued: result.queued,
      printer: result.printer,
      sequence: sequenceId,
      frame: frameIndex + 1,
      nextFrame: ((frameIndex + 1) % sequence.frames.length) + 1,
      advanceOnSuccess,
      pendingMessages: result.pendingMessages,
      pendingBatches: result.pendingBatches,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Print server listening on http://0.0.0.0:${PORT}`);
  console.log(`Default printer: ${process.env.PRINTER_NAME || DEFAULT_PRINTER}`);
});
