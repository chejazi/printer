const {
  DEFAULT_PRINTER,
  joinMessages,
  printBatchAndWait,
  sleep,
} = require("./printer");

const DEFAULT_COALESCE_MS = 150;
const DEFAULT_MAX_BATCH_WAIT_MS = 2000;
const DEFAULT_JOB_DELAY_MS = 500;
const DEFAULT_MAX_QUEUE_MESSAGES = 100;

function resolvePrinter(printer) {
  return printer || process.env.PRINTER_NAME || DEFAULT_PRINTER;
}

function batchKey(message) {
  return resolvePrinter(message.printer);
}

class BatchAccumulator {
  constructor(message, onReady, config) {
    this.messages = [message.text];
    this.options = {
      printer: resolvePrinter(message.printer),
      noCut: Boolean(message.noCut),
      feedLines: message.feedLines,
    };
    this.onReady = onReady;
    this.config = config;
    this.coalesceTimer = null;
    this.maxWaitTimer = null;
    this.scheduleCoalesce();
    this.maxWaitTimer = setTimeout(() => {
      this.flush();
    }, config.maxBatchWaitMs);
  }

  add(message) {
    this.messages.push(message.text);

    if (message.noCut) {
      this.options.noCut = true;
    }

    if (message.feedLines !== undefined) {
      this.options.feedLines = message.feedLines;
    }

    this.scheduleCoalesce();
  }

  scheduleCoalesce() {
    clearTimeout(this.coalesceTimer);
    this.coalesceTimer = setTimeout(() => {
      this.flush();
    }, this.config.coalesceMs);
  }

  flush() {
    clearTimeout(this.coalesceTimer);
    clearTimeout(this.maxWaitTimer);
    this.coalesceTimer = null;
    this.maxWaitTimer = null;
    this.onReady(this);
  }

  drain() {
    return {
      text: joinMessages(this.messages),
      printer: this.options.printer,
      noCut: this.options.noCut,
      feedLines: this.options.feedLines,
      messageCount: this.messages.length,
      jobTimeoutMs: this.config.jobTimeoutMs,
    };
  }
}

class PrintQueue {
  constructor(config = {}) {
    this.config = {
      coalesceMs: config.coalesceMs ?? DEFAULT_COALESCE_MS,
      maxBatchWaitMs: config.maxBatchWaitMs ?? DEFAULT_MAX_BATCH_WAIT_MS,
      jobDelayMs: config.jobDelayMs ?? DEFAULT_JOB_DELAY_MS,
      jobTimeoutMs: config.jobTimeoutMs,
      maxQueueMessages: config.maxQueueMessages ?? DEFAULT_MAX_QUEUE_MESSAGES,
    };
    this.accumulators = new Map();
    this.readyQueue = [];
    this.workerTail = Promise.resolve();
    this.workerRunning = false;
  }

  pendingMessageCount() {
    let count = this.readyQueue.reduce(
      (total, batch) => total + batch.messageCount,
      0,
    );

    for (const accumulator of this.accumulators.values()) {
      count += accumulator.messages.length;
    }

    return count;
  }

  pendingBatchCount() {
    return this.accumulators.size + this.readyQueue.length + (this.workerRunning ? 1 : 0);
  }

  enqueue(message) {
    if (this.pendingMessageCount() >= this.config.maxQueueMessages) {
      const error = new Error("Print queue is full");
      error.statusCode = 503;
      throw error;
    }

    const key = batchKey(message);
    let accumulator = this.accumulators.get(key);

    if (!accumulator) {
      accumulator = new BatchAccumulator(message, (readyAccumulator) => {
        this.accumulators.delete(key);
        this.readyQueue.push(readyAccumulator.drain());
        this.kickWorker();
      }, this.config);
      this.accumulators.set(key, accumulator);
    } else {
      accumulator.add(message);
    }

    return {
      queued: true,
      pendingMessages: this.pendingMessageCount(),
      pendingBatches: this.pendingBatchCount(),
      printer: resolvePrinter(message.printer),
    };
  }

  flushAll() {
    for (const accumulator of this.accumulators.values()) {
      accumulator.flush();
    }
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

        if (this.readyQueue.length > 0) {
          this.kickWorker();
        }
      });
  }

  async runWorker() {
    while (this.readyQueue.length > 0) {
      const batch = this.readyQueue.shift();

      try {
        const result = await printBatchAndWait(batch.text, batch);
        console.log(
          `Printed batch (${batch.messageCount} message(s)) to ${result.printer}${result.jobId ? ` [${result.jobId}]` : ""}`,
        );
      } catch (error) {
        console.error(
          `Print batch failed (${batch.messageCount} message(s) on ${batch.printer}): ${error.message}`,
        );
      }

      if (this.readyQueue.length > 0 || this.accumulators.size > 0) {
        await sleep(this.config.jobDelayMs);
      }
    }
  }

  async flushAndWait() {
    this.flushAll();
    await this.workerTail;
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
    maxBatchWaitMs: Number(process.env.MAX_BATCH_WAIT_MS) || DEFAULT_MAX_BATCH_WAIT_MS,
    jobDelayMs: Number(process.env.JOB_DELAY_MS) || DEFAULT_JOB_DELAY_MS,
    jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS) || undefined,
    maxQueueMessages: Number(process.env.MAX_QUEUE_MESSAGES) || DEFAULT_MAX_QUEUE_MESSAGES,
  };
}

module.exports = {
  BatchAccumulator,
  DEFAULT_COALESCE_MS,
  DEFAULT_JOB_DELAY_MS,
  DEFAULT_MAX_BATCH_WAIT_MS,
  DEFAULT_MAX_QUEUE_MESSAGES,
  PrintQueue,
  createPrintQueueConfigFromEnv,
  getPrintQueue,
};
