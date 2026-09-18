const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("preview, clipboard, and download all use currentText unchanged", () => {
  const source = fs.readFileSync(path.join(__dirname, "../preview/preview.js"), "utf8");
  assert.match(source, /receipt\.textContent = result\.text/);
  assert.match(source, /clipboard\.writeText\(currentText\(\)\)/);
  assert.match(source, /new Blob\(\[currentText\(\)\]/);
});

test("preview server does not import printer or queue modules", () => {
  const source = fs.readFileSync(path.join(__dirname, "../preview-server.js"), "utf8");
  assert.doesNotMatch(source, /lib\/(?:printer|print-queue)|lpstat|\blp\b|AUTH_TOKEN/);
});

test("default example fits the production receipt width", () => {
  require("../preview/example-receipt");
  const { validateReceipt } = require("../lib/receipt-format");
  assert.equal(validateReceipt(global.ExampleReceipt.text).valid, true);
});

test("receipt CSS derives both paper and text grid from exactly 48ch", () => {
  const source = fs.readFileSync(path.join(__dirname, "../preview/preview.css"), "utf8");
  assert.match(source, /\.receipt[^}]*width: 48ch/s);
  assert.match(source, /#receipt-text[^}]*width: 48ch/s);
  assert.match(source, /#receipt-text[^}]*white-space: pre/s);
  assert.match(source, /@media print[\s\S]*--receipt-font-size: 7pt[\s\S]*width: 48ch/);
  assert.match(source, /@media \(max-width: 560px\)/);
});

test("block library UI exposes the complete custom preset workflow", () => {
  const html = fs.readFileSync(path.join(__dirname, "../preview/index.html"), "utf8");
  for (const id of ["save-as-block", "block-insert", "block-replace", "block-edit", "block-duplicate", "block-delete", "export-library", "import-library"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  const source = fs.readFileSync(path.join(__dirname, "../preview/preview.js"), "utf8");
  assert.match(source, /localStorage\.setItem\(BlockLibrary\.STORAGE_KEY/);
  assert.match(source, /confirm\(`Delete custom block/);
  assert.match(source, /parseLibraryImport\(await file\.text\(\)\)/);
});

test("sequence workspace exposes playback, composition, conversion, and local import controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "../preview/index.html"), "utf8");
  for (const id of [
    "sequence-first", "sequence-previous", "sequence-play", "sequence-next-button", "sequence-last",
    "sequence-reset", "sequence-advance", "sequence-random", "sequence-timeline", "sequence-prefix",
    "sequence-suffix", "sequence-resolved", "sequence-export", "sequence-import-json",
    "sequence-image-files", "sequence-image-directory", "convert-start", "convert-cancel",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /sequences\/higher-zip-horse\/frames\.js/);
  assert.match(html, /sequences\/higher-zip-horse\/manifest\.js/);
});
