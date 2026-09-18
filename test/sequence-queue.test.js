const test = require("node:test");
const assert = require("node:assert/strict");
const { PrintQueue } = require("../lib/print-queue");
const { createSequenceRegistry } = require("../lib/sequence-registry");

function dynamicMessage(id = "horse") {
  return {
    sequenceId: id,
    advanceOnSuccess: true,
    resolveText: () => ({ text: "FRAME", sequenceId: id }),
  };
}

test("successful physical receipt advances exactly once", async () => {
  let advances = 0;
  const queue = new PrintQueue({
    coalesceMs: 0, jobDelayMs: 0,
    printBatch: async () => ({ printer: "test", jobId: "test-1" }),
    onBatchSuccess: (batch) => { advances += batch.sequenceIds.length; },
  });
  queue.enqueue(dynamicMessage());
  await queue.flushAndWait();
  assert.equal(advances, 1);
});

test("failed printing does not advance", async () => {
  let advances = 0;
  const queue = new PrintQueue({
    coalesceMs: 0, jobDelayMs: 0,
    printBatch: async () => { throw new Error("simulated CUPS failure"); },
    onBatchSuccess: () => { advances += 1; },
  });
  queue.enqueue(dynamicMessage());
  await queue.flushAndWait();
  assert.equal(advances, 0);
});

test("coalesced dynamic messages advance once per completed physical receipt", async () => {
  let advances = 0;
  let printedText;
  const queue = new PrintQueue({
    coalesceMs: 1000, jobDelayMs: 0,
    printBatch: async (text) => { printedText = text; return { printer: "test", jobId: "test-2" }; },
    onBatchSuccess: (batch) => { advances += batch.sequenceIds.length; },
  });
  queue.enqueue(dynamicMessage());
  queue.enqueue(dynamicMessage());
  await queue.flushAndWait();
  assert.equal(printedText, "FRAME\nFRAME");
  assert.equal(advances, 1);
});

test("ordinary plain-text messages remain unchanged and have no sequence advancement", async () => {
  let batch;
  const queue = new PrintQueue({
    coalesceMs: 0, jobDelayMs: 0,
    printBatch: async (text) => ({ printer: "test", text }),
    onBatchSuccess: (value) => { batch = value; },
  });
  queue.enqueue({ text: "ordinary receipt" });
  await queue.flushAndWait();
  assert.equal(batch.text, "ordinary receipt");
  assert.deepEqual(batch.sequenceIds, []);
});

test("production registry advances only from the successful batch callback", async () => {
  const registry = createSequenceRegistry({ stateFile: null });
  const sequenceId = "higher-zip-running-horse";
  const template = registry.token(sequenceId);
  const queue = new PrintQueue({
    coalesceMs: 0, jobDelayMs: 0,
    printBatch: async () => ({ printer: "test", jobId: "simulated" }),
    onBatchSuccess: (batch) => batch.sequenceIds.forEach((id) => registry.advance(id)),
  });
  registry.resolve(sequenceId, template);
  assert.equal(registry.currentFrame(sequenceId), 0);
  queue.enqueue({ sequenceId, advanceOnSuccess: true, resolveText: () => registry.resolve(sequenceId, template) });
  await queue.flushAndWait();
  assert.equal(registry.currentFrame(sequenceId), 1);
});
