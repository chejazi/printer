const {
  DEFAULT_PRINTER,
  joinMessages,
  printBatchAndWait,
  sleep,
} = require("./printer");

const DEFAULT_COALESCE_MS = 500;
const DEFAULT_JOB_DELAY_MS = 500;
const DEFAULT_MAX_QUEUE_MESSAGES = 100;

function resolvePrinter(printer) {
  return printer || process.env.PRINTER_NAME || DEFAULT_PRINTER;
}

class PrinterBuffer {
  constructor() {
    this.messages = [];
    this.lastMessageAt = 0;
    this.noCut = false;
    this.feedLines = undefined;
  }

  add(message) {
    this.messages.push(message.text);
    this.lastMessageAt = Date.now();

    if (message.noCut) {
      this.noCut = true;
    }

    if (message.feedLines !== undefined) {
      this.feedLines = message.feedLines;
    }
  }

  get size() {
    return this.messages.length;
  }

  async waitForCoalesce(coalesceMs) {
    const remaining = coalesceMs - (Date.now() - this.lastMessageAt);
    if (remaining > 0) {
      await sleep(remaining);
    }
  }

  async waitUntilStable(coalesceMs) {
    while (this.size > 0) {
      await this.waitForCoalesce(coalesceMs);

      const idleFor = Date.now() - this.lastMessageAt;
      if (idleFor >= coalesceMs) {
        return;
      }
    }
  }

  take(printer) {
    const batch = {
      text: joinMessages(this.messages),
      printer,
      noCut: this.noCut,
      feedLines: this.feedLines,
      messageCount: this.messages.length,
    };

    this.messages = [];
    this.noCut = false;
    this.feedLines = undefined;
    this.lastMessageAt = 0;

    return batch;
  }
}

class PrintQueue {
  constructor(config = {}) {
    this.config = {
      coalesceMs: config.coalesceMs ?? DEFAULT_COALESCE_MS,
      jobDelayMs: config.jobDelayMs ?? DEFAULT_JOB_DELAY_MS,
      jobTimeoutMs: config.jobTimeoutMs,
      maxQueueMessages: config.maxQueueMessages ?? DEFAULT_MAX_QUEUE_MESSAGES,
    };
    this.buffers = new Map();
    this.workerTail = Promise.resolve();
    this.workerRunning = false;
  }

  getBuffer(printer) {
    let buffer = this.buffers.get(printer);
    if (!buffer) {
      buffer = new PrinterBuffer();
      this.buffers.set(printer, buffer);
    }
    return buffer;
  }

  pendingMessageCount() {
    let count = 0;
    for (const buffer of this.buffers.values()) {
      count += buffer.size;
    }
    return count;
  }

  pendingBatchCount() {
    const printersWithMessages = [...this.buffers.values()].filter((b) => b.size > 0).length;
    return printersWithMessages + (this.workerRunning ? 1 : 0);
  }

  enqueue(message) {
    if (this.pendingMessageCount() >= this.config.maxQueueMessages) {
      const error = new Error("Print queue is full");
      error.statusCode = 503;
      throw error;
    }

    const printer = resolvePrinter(message.printer);
    this.getBuffer(printer).add(message);
    this.kickWorker();

    return {
      queued: true,
      pendingMessages: this.pendingMessageCount(),
      pendingBatches: this.pendingBatchCount(),
      printer,
    };
  }

  flushAll() {
    for (const buffer of this.buffers.values()) {
      buffer.lastMessageAt = 0;
    }
    this.kickWorker();
  }

  kickWorker() {
    if (this.workerRunning) {
      return;
    }

    this.workerRunning = true;
    this.workerTail = this.workerTail
      .then(() => this.runWorker())
      .catch((error) => {
        console.error(`Print worker failed: ${error.message}`);
      })
      .finally(() => {
        this.workerRunning = false;
        if (this.pendingMessageCount() > 0) {
          this.kickWorker();
        }
      });
  }

  async runWorker() {
    while (this.pendingMessageCount() > 0) {
      for (const [printer, buffer] of this.buffers) {
        if (buffer.size === 0) {
          continue;
        }

        await buffer.waitUntilStable(this.config.coalesceMs);

        if (buffer.size === 0) {
          continue;
        }

        const batch = buffer.take(printer);

        if (!batch.text) {
          continue;
        }

        try {
          const result = await printBatchAndWait(batch.text, {
            printer: batch.printer,
            noCut: batch.noCut,
            feedLines: batch.feedLines,
            jobTimeoutMs: this.config.jobTimeoutMs,
          });
          console.log(
            `Printed batch (${batch.messageCount} message(s)) to ${result.printer}${result.jobId ? ` [${result.jobId}]` : ""}`,
          );
        } catch (error) {
          console.error(
            `Print batch failed (${batch.messageCount} message(s) on ${batch.printer}): ${error.message}`,
          );
        }

        if (this.pendingMessageCount() > 0) {
          await sleep(this.config.jobDelayMs);
        }
      }
    }
  }

  async flushAndWait() {
    for (const buffer of this.buffers.values()) {
      buffer.lastMessageAt = 0;
    }
    await this.kickWorkerAndWait();
  }

  kickWorkerAndWait() {
    this.kickWorker();
    return this.workerTail;
  }
}

let singleton;

function getPrintQueue(config) {
  if (!singleton) {
    singleton = new PrintQueue(config);
  }

  return singleton;
}

function createPrintQueueConfigFromEnv() {
  return {
    coalesceMs: Number(process.env.COALESCE_MS) || DEFAULT_COALESCE_MS,
    jobDelayMs: Number(process.env.JOB_DELAY_MS) || DEFAULT_JOB_DELAY_MS,
    jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS) || undefined,
    maxQueueMessages: Number(process.env.MAX_QUEUE_MESSAGES) || DEFAULT_MAX_QUEUE_MESSAGES,
  };
}

module.exports = {
  DEFAULT_COALESCE_MS,
  DEFAULT_JOB_DELAY_MS,
  DEFAULT_MAX_QUEUE_MESSAGES,
  PrintQueue,
  PrinterBuffer,
  createPrintQueueConfigFromEnv,
  getPrintQueue,
};
