const test = require("node:test");
const assert = require("node:assert/strict");
const { PrintQueue } = require("../lib/print-queue");
const { createSequenceRegistry } = require("../lib/sequence-registry");

function dynamicMessage(id = "horse") {
  return {
    sequenceId: id,
    advanceOnSuccess: true,
    resolveText: () => ({ text: "FRAME", sequenceId: id, frameIndex: 0, frameCount: 162 }),
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
    onBatchSuccess: (batch) => batch.sequenceAdvancements.forEach((target) => registry.setFrame(target.sequenceId, target.nextFrameIndex)),
  });
  registry.resolve(sequenceId, template);
  assert.equal(registry.currentFrame(sequenceId), 0);
  queue.enqueue({ sequenceId, advanceOnSuccess: true, resolveText: () => registry.resolve(sequenceId, template) });
  assert.equal(registry.currentFrame(sequenceId), 0);
  await queue.flushAndWait();
  assert.equal(registry.currentFrame(sequenceId), 1);
});

test("queue acceptance does not advance before confirmed completion", async () => {
  const registry = createSequenceRegistry({ stateFile: null });
  let releasePrint;
  const printed = new Promise((resolve) => { releasePrint = resolve; });
  const queue = new PrintQueue({
    coalesceMs: 0, jobDelayMs: 0,
    printBatch: async () => {
      await printed;
      return { printer: "test", jobId: "held" };
    },
    onBatchSuccess: (batch) => batch.sequenceAdvancements.forEach((target) => registry.setFrame(target.sequenceId, target.nextFrameIndex)),
  });
  const sequenceId = "higher-zip-running-horse";
  queue.enqueue({
    sequenceId,
    advanceOnSuccess: true,
    resolveText: () => registry.resolve(sequenceId, registry.token(sequenceId), 4),
  });
  assert.equal(registry.currentFrame(sequenceId), 0);
  releasePrint();
  await queue.flushAndWait();
  assert.equal(registry.currentFrame(sequenceId), 5);
});

test("timeout-style print failure leaves cursor unchanged", async () => {
  const registry = createSequenceRegistry({ stateFile: null });
  let failures = 0;
  const queue = new PrintQueue({
    coalesceMs: 0, jobDelayMs: 0,
    printBatch: async () => { throw new Error("Print job timed out after 1ms"); },
    onBatchSuccess: (batch) => batch.sequenceAdvancements.forEach((target) => registry.setFrame(target.sequenceId, target.nextFrameIndex)),
    onBatchFailure: () => { failures += 1; },
  });
  const sequenceId = "higher-zip-running-horse";
  queue.enqueue({
    sequenceId,
    advanceOnSuccess: true,
    resolveText: () => registry.resolve(sequenceId, registry.token(sequenceId), 10),
  });
  await queue.flushAndWait();
  assert.equal(failures, 1);
  assert.equal(registry.currentFrame(sequenceId), 0);
});

test("coalesced sequence completions set a single final next frame", async () => {
  const registry = createSequenceRegistry({ stateFile: null });
  let advancementCalls = 0;
  const sequenceId = "higher-zip-running-horse";
  const queue = new PrintQueue({
    coalesceMs: 1000, jobDelayMs: 0,
    printBatch: async () => ({ printer: "test", jobId: "coalesced" }),
    onBatchSuccess: (batch) => batch.sequenceAdvancements.forEach((target) => {
      advancementCalls += 1;
      registry.setFrame(target.sequenceId, target.nextFrameIndex);
    }),
  });
  queue.enqueue({
    sequenceId,
    advanceOnSuccess: true,
    resolveText: () => registry.resolve(sequenceId, registry.token(sequenceId), 20),
  });
  queue.enqueue({
    sequenceId,
    advanceOnSuccess: true,
    resolveText: () => registry.resolve(sequenceId, registry.token(sequenceId), 20),
  });
  await queue.flushAndWait();
  assert.equal(advancementCalls, 1);
  assert.equal(registry.currentFrame(sequenceId), 21);
});
