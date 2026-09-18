#!/usr/bin/env node
const path = require("node:path");
const express = require("express");
const { validateReceipt } = require("./lib/receipt-format");

const HOST = process.env.PREVIEW_HOST || "127.0.0.1";
const PORT = Number(process.env.PREVIEW_PORT) || 4173;
const DEFAULT_PRINT_TIMEOUT_MS = 45_000;
const DEFAULT_PRINT_POLL_MS = 500;
const DEFAULT_SEQUENCE_ID = "higher-zip-running-horse";
const DEFAULT_SEQUENCE_TOKEN = `{{sequence:${DEFAULT_SEQUENCE_ID}}}`;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function joinUrl(base, route) {
  return new URL(route, base.endsWith("/") ? base : `${base}/`).toString();
}

function createPreviewApp(options = {}) {
  const app = express();
  const printApiUrl = options.printApiUrl ?? process.env.PREVIEW_PRINT_API_URL;
  const printApiToken = options.printApiToken ?? process.env.PREVIEW_PRINT_AUTH_TOKEN;
  const printer = options.printer ?? process.env.PREVIEW_PRINT_PRINTER_NAME;
  const timeoutMs = Number(options.timeoutMs ?? process.env.PREVIEW_PRINT_TIMEOUT_MS) || DEFAULT_PRINT_TIMEOUT_MS;
  const pollMs = Number(options.pollMs ?? process.env.PREVIEW_PRINT_POLL_MS) || DEFAULT_PRINT_POLL_MS;
  const fetchImpl = options.fetch || globalThis.fetch;

  function printConfig() {
    const configured = Boolean(printApiUrl && printApiToken);
    return {
      configured,
      printer: printer || null,
      timeoutMs,
      pollMs,
      warning: configured
        ? null
        : "Printer proxy is not configured. Set PREVIEW_PRINT_API_URL and PREVIEW_PRINT_AUTH_TOKEN on the preview server.",
    };
  }

  async function callPrintApi(route, init = {}) {
    if (!printApiUrl || !printApiToken) {
      const error = new Error(printConfig().warning);
      error.statusCode = 503;
      throw error;
    }
    const response = await fetchImpl(joinUrl(printApiUrl, route), {
      ...init,
      headers: {
        Authorization: `Bearer ${printApiToken}`,
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(body.error || `Printer API returned ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return body;
  }

  async function waitForCompletion(jobId, statusRoute = `/print-sequence/jobs/${encodeURIComponent(jobId)}`) {
    const deadline = Date.now() + timeoutMs;
    let lastJob;
    while (Date.now() < deadline) {
      const body = await callPrintApi(statusRoute);
      lastJob = body.job;
      if (lastJob?.state === "succeeded") return lastJob;
      if (lastJob?.state === "failed") {
        const error = new Error(lastJob.error || "Print job failed.");
        error.job = lastJob;
        throw error;
      }
      await sleep(pollMs);
    }
    const error = new Error(`Timed out waiting for physical print completion after ${timeoutMs}ms.`);
    error.job = lastJob;
    error.statusCode = 504;
    throw error;
  }

  app.use(express.json({ limit: "64kb" }));

  app.get("/api/print-config", (_req, res) => {
    res.json(printConfig());
  });

  app.post("/api/print-receipt-preview", async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Provide a JSON print request." });
      return;
    }
    const visibleText = typeof req.body.text === "string" ? req.body.text : "";
    const template = typeof req.body.template === "string" ? req.body.template : visibleText;
    const sequence = typeof req.body.sequence === "string" ? req.body.sequence : DEFAULT_SEQUENCE_ID;
    const sequenceToken = `{{sequence:${sequence}}}`;
    const dynamic = template.includes(sequenceToken);
    const validation = validateReceipt(visibleText);
    if (!visibleText.trim()) {
      res.status(400).json({ error: "Receipt preview is empty." });
      return;
    }
    if (!validation.valid) {
      res.status(400).json({
        error: "Receipt preview has overflowing lines.",
        warnings: validation.warnings,
      });
      return;
    }

    try {
      if (dynamic) {
        const queued = await callPrintApi("/print-sequence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template,
            sequence,
            frame: req.body.frame,
            advanceOnSuccess: req.body.advanceOnSuccess !== false,
            flush: true,
            printer,
          }),
        });
        if (!queued.jobId) throw new Error("Printer API accepted the dynamic queue request but did not return a job id.");
        const job = await waitForCompletion(queued.jobId, `/print-sequence/jobs/${encodeURIComponent(queued.jobId)}`);
        res.json({ ok: true, route: "print-sequence", queued, job });
        return;
      }

      if (template.includes(DEFAULT_SEQUENCE_TOKEN)) {
        throw new Error("Unsupported sequence token in receipt preview.");
      }
      const queued = await callPrintApi("/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: visibleText,
          flush: true,
          trackJob: true,
          printer,
        }),
      });
      if (!queued.jobId) throw new Error("Printer API accepted the static queue request but did not return a job id.");
      const job = await waitForCompletion(queued.jobId, `/print/jobs/${encodeURIComponent(queued.jobId)}`);
      res.json({ ok: true, route: "print", queued, job });
    } catch (error) {
      res.status(error.statusCode || 502).json({
        error: error.message,
        job: error.job,
      });
    }
  });

  app.post("/api/print-current-frame", async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Provide a JSON print request." });
      return;
    }

    try {
      const queued = await callPrintApi("/print-sequence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: req.body.template,
          sequence: req.body.sequence,
          frame: req.body.frame,
          advanceOnSuccess: req.body.advanceOnSuccess !== false,
          flush: true,
          printer,
        }),
      });
      if (!queued.jobId) {
        throw new Error("Printer API accepted the queue request but did not return a job id.");
      }
      const job = await waitForCompletion(queued.jobId);
      res.json({ ok: true, queued, job });
    } catch (error) {
      res.status(error.statusCode || 502).json({
        error: error.message,
        job: error.job,
      });
    }
  });

  app.use("/lib", express.static(path.join(__dirname, "lib"), { index: false }));
  app.use(express.static(path.join(__dirname, "preview")));

  return app;
}

if (require.main === module) {
  createPreviewApp().listen(PORT, HOST, () => {
    console.log(`Receipt simulator listening on http://${HOST}:${PORT}`);
    if (!process.env.PREVIEW_PRINT_API_URL || !process.env.PREVIEW_PRINT_AUTH_TOKEN) {
      console.log("Print proxy disabled: set PREVIEW_PRINT_API_URL and PREVIEW_PRINT_AUTH_TOKEN to enable guarded printing.");
    }
  });
}

module.exports = { createPreviewApp, joinUrl };
