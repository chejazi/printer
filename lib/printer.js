const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ThermalPrinter, PrinterTypes } = require("node-thermal-printer");

const execFileAsync = promisify(execFile);

const DEFAULT_PRINTER = "USB_80Series2";
const CHARS_PER_LINE = 48;
const DEFAULT_FEED_LINES_NO_CUT = 10;
const MAX_FEED_LINES = 50;
const ESC_INIT = Buffer.from([0x1b, 0x40]);
const DEFAULT_JOB_TIMEOUT_MS = 30_000;
const DEFAULT_JOB_POLL_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveFeedLines({ noCut, feedLines }) {
  if (feedLines !== undefined) {
    return feedLines;
  }

  return noCut ? DEFAULT_FEED_LINES_NO_CUT : 0;
}

function joinMessages(texts) {
  return texts
    .flatMap((text) => text.split(/\r?\n/))
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
}

function buildEscPosBuffer(text, { noCut = false, feedLines } = {}) {
  const lines = resolveFeedLines({ noCut, feedLines });
  const contentLines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    width: CHARS_PER_LINE,
    interface: process.platform === "win32" ? "NUL" : "/dev/null",
  });

  printer.alignLeft();

  for (const line of contentLines) {
    printer.println(line);
  }

  for (let i = 0; i < lines; i += 1) {
    printer.newLine();
  }

  if (!noCut) {
    printer.cut();
  }

  return Buffer.concat([ESC_INIT, printer.getBuffer()]);
}

function sendRawJob(printerName, data) {
  return new Promise((resolve, reject) => {
    const lp = spawn("lp", ["-d", printerName, "-o", "raw"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    lp.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    lp.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    lp.on("error", reject);

    lp.on("close", (code) => {
      if (code === 0) {
        const match = stdout.match(/request id is (\S+)/);
        resolve(match?.[1] ?? null);
        return;
      }

      reject(
        new Error(stderr.trim() || stdout.trim() || `lp exited with status ${code}`),
      );
    });

    lp.stdin.write(data);
    lp.stdin.end();
  });
}

async function waitForJob(jobId, printerName, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_JOB_POLL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { stdout } = await execFileAsync("lpstat", ["-o", printerName]);

    if (jobId) {
      if (!stdout.includes(jobId)) {
        return;
      }
    } else if (!stdout.trim()) {
      return;
    }

    await sleep(pollMs);
  }

  if (jobId) {
    try {
      await execFileAsync("cancel", [jobId]);
    } catch {
      // Best effort — job may already be gone.
    }
  }

  throw new Error(
    jobId
      ? `Print job ${jobId} timed out after ${timeoutMs}ms`
      : `CUPS queue for ${printerName} did not clear after ${timeoutMs}ms`,
  );
}

async function waitForCupsIdle(printerName, options = {}) {
  await waitForJob(null, printerName, options);
}

async function listPrinters() {
  const { stdout } = await execFileAsync("lpstat", ["-p"]);
  return stdout
    .split("\n")
    .map((line) => line.match(/^printer\s+(\S+)/)?.[1])
    .filter(Boolean);
}

async function printBatchAndWait(text, { printer, noCut = false, feedLines, jobTimeoutMs } = {}) {
  const printerName = printer || process.env.PRINTER_NAME || DEFAULT_PRINTER;

  if (!text) {
    return {
      printer: printerName,
      jobId: null,
      text: "",
      noCut,
      feedLines: resolveFeedLines({ noCut, feedLines }),
      messageCount: 0,
    };
  }

  const buffer = buildEscPosBuffer(text, { noCut, feedLines });
  const jobId = await sendRawJob(printerName, buffer);
  await waitForJob(jobId, printerName, { timeoutMs: jobTimeoutMs });
  await waitForCupsIdle(printerName, { timeoutMs: jobTimeoutMs });

  return {
    printer: printerName,
    jobId,
    text,
    noCut,
    feedLines: resolveFeedLines({ noCut, feedLines }),
  };
}

async function printText(text, options = {}) {
  const result = await printBatchAndWait(text, options);
  return {
    printer: result.printer,
    text: result.text,
    noCut: result.noCut,
    feedLines: result.feedLines,
  };
}

module.exports = {
  DEFAULT_PRINTER,
  DEFAULT_FEED_LINES_NO_CUT,
  DEFAULT_JOB_POLL_MS,
  DEFAULT_JOB_TIMEOUT_MS,
  MAX_FEED_LINES,
  buildEscPosBuffer,
  joinMessages,
  sendRawJob,
  sleep,
  waitForJob,
  waitForCupsIdle,
  listPrinters,
  printBatchAndWait,
  printText,
  resolveFeedLines,
};
