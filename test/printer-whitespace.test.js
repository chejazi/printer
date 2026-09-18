const test = require("node:test");
const assert = require("node:assert/strict");
const { buildEscPosBuffer, joinMessages } = require("../lib/printer");

test("queued messages retain blank lines and leading whitespace", () => {
  assert.equal(joinMessages(["  first\n\nsecond", "third"]), "  first\n\nsecond\nthird");
});

test("ESC/POS output retains blank lines and leading whitespace", () => {
  const buffer = buildEscPosBuffer("  first\n\nsecond", { noCut: true, feedLines: 0 });
  const content = buffer.toString("latin1");
  assert.ok(content.includes("  first\n\nsecond\n"));
});
