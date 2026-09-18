const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RECEIPT_WIDTH,
  getCursorLocation,
  trimLineEndings,
  validateReceipt,
} = require("../lib/receipt-format");

test("validates the shared 48-character width", () => {
  assert.equal(RECEIPT_WIDTH, 48);
  assert.equal(validateReceipt("x".repeat(47)).valid, true);
  assert.equal(validateReceipt("x".repeat(48)).valid, true);
  const result = validateReceipt("x".repeat(49));
  assert.equal(result.valid, false);
  assert.deepEqual(result.warnings[0], {
    type: "line-overflow", line: 1, width: 49, maxWidth: 48, excess: 1,
    message: "Line 1 is 49 characters (1 over).",
  });
});

test("cursor column is distinct from stored line width at the 48-column boundary", () => {
  const text = "x".repeat(48);
  assert.deepEqual(getCursorLocation(text, text.length), { line: 1, column: 49, lineWidth: 48 });
  assert.equal(validateReceipt(text).valid, true);
});

test("reports every overflowing line with its measured width", () => {
  const result = validateReceipt(["x".repeat(49), "valid", "y".repeat(51)].join("\n"));
  assert.deepEqual(result.warnings.map(({ line, width }) => ({ line, width })), [
    { line: 1, width: 49 },
    { line: 3, width: 51 },
  ]);
});

test("preserves intentional blank lines and leading spaces", () => {
  const text = "  heading\n\n    art";
  const result = validateReceipt(text);
  assert.equal(result.text, text);
  assert.deepEqual(result.lines, ["  heading", "", "    art"]);
});

test("trailing whitespace cleanup does not alter blank-line structure", () => {
  assert.equal(trimLineEndings("  art  \n   \nend\t"), "  art\n\nend");
});
