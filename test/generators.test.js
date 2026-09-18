const test = require("node:test");
const assert = require("node:assert/strict");
const { generators } = require("../preview/generators");

for (const generator of generators) {
  test(`${generator.id} is deterministic and respects requested width`, () => {
    const options = { seed: "receipt-42", width: 17, height: 7, complexity: 0.45, unicode: false };
    const first = generator.generate(options);
    assert.equal(first, generator.generate(options));
    assert.equal(first.split("\n").length, 7);
    assert.ok(first.split("\n").every((line) => Array.from(line).length <= 17));
    assert.match(first, /^[\x20-\x7e\n]*$/);
  });
}
