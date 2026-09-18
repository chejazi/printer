const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const horse = require("../preview/sequences/higher-zip-horse/manifest");
const palettes = require("../preview/sequences/palettes");
const {
  composeTemplate,
  createSequenceCursor,
  exportSequence,
  importSequence,
  mapGrayscaleFrames,
  naturalCompare,
  resolveTemplate,
} = require("../preview/sequences/sequence-core");
const { SequenceCursorStore } = require("../lib/sequence-controller");
const { createSequenceRegistry } = require("../lib/sequence-registry");

test("all 162 higher.zip frames load in order with stable 48x14 ASCII geometry", () => {
  assert.equal(horse.manifest.frameCount, 162);
  assert.equal(horse.frames.length, 162);
  assert.equal(horse.manifest.fps, 8);
  assert.equal(horse.manifest.width, 48);
  assert.equal(horse.manifest.height, 14);
  for (const frame of horse.frames) {
    const lines = frame.split("\n");
    assert.equal(lines.length, 14);
    assert.ok(lines.every((line) => line.length === 48));
    assert.match(frame, /^[\x20-\x7e\n]+$/);
    assert.ok([...frame].every((character) => character === "\n" || horse.manifest.palette.includes(character)));
  }
  assert.notEqual(horse.frames[0], horse.frames[80]);
  assert.notEqual(horse.frames[80], horse.frames[161]);
});

test("Thermal Safe palette preserves its intentional trailing space", () => {
  assert.equal(palettes.getPalette("thermal-safe").value, "@%#*+=-:. ");
  assert.equal(palettes.getPalette("thermal-safe").value.at(-1), " ");
  assert.equal(palettes.getPalette("vii-legacy").printerSafe, false);
});

test("sequence cursor advances, wraps, resets, and sets frames", () => {
  const cursor = createSequenceCursor(162);
  assert.equal(cursor.currentFrame(), 0);
  assert.equal(cursor.advance(), 1);
  cursor.setFrame(161);
  assert.equal(cursor.advance(), 0);
  cursor.setFrame(80);
  assert.equal(cursor.reset(), 0);
});

test("a complete 162-frame preview cycle returns to frame 1", () => {
  const cursor = createSequenceCursor(162);
  for (let count = 0; count < 162; count += 1) cursor.advance();
  assert.equal(cursor.currentFrame(), 0);
});

test("template resolution leaves template, prefix, and suffix unchanged", () => {
  const prefix = "PREFIX\n";
  const suffix = "\nSUFFIX";
  const template = composeTemplate(prefix, horse.manifest.id, suffix);
  const original = template;
  const resolved = resolveTemplate(template, horse, 0);
  assert.equal(template, original);
  assert.ok(resolved.startsWith(prefix));
  assert.ok(resolved.endsWith(suffix));
  assert.ok(resolved.includes(horse.frames[0]));
});

test("preview resolution does not advance persisted print state", () => {
  const registry = createSequenceRegistry({ stateFile: null });
  const token = registry.token(horse.manifest.id);
  assert.equal(registry.currentFrame(horse.manifest.id), 0);
  registry.resolve(horse.manifest.id, `PREFIX\n${token}\nSUFFIX`);
  assert.equal(registry.currentFrame(horse.manifest.id), 0);
});

test("sequence export and import round-trip", () => {
  const imported = importSequence(exportSequence(horse));
  assert.deepEqual(imported.manifest, horse.manifest);
  assert.deepEqual(imported.frames, horse.frames);
});

test("natural filename sorting orders numbered frames", () => {
  assert.deepEqual(["frame_10.png", "frame_2.png", "frame_1.png"].sort(naturalCompare), [
    "frame_1.png", "frame_2.png", "frame_10.png",
  ]);
});

test("flat-image conversion is stable and finite", () => {
  const frames = mapGrayscaleFrames([{ width: 3, height: 2, values: [128, 128, 128, 128, 128, 128] }], {
    palette: "@ ", normalization: "sequence", brightness: 0, contrast: 1,
  });
  assert.equal(frames[0].split("\n").length, 2);
  assert.ok(frames[0].split("\n").every((line) => line.length === 3));
});

test("conversion cancellation stops before mapping", () => {
  assert.throws(() => mapGrayscaleFrames([{ width: 1, height: 1, values: [0] }], {
    palette: "@ ", normalization: "sequence",
  }, { cancelled: true }), /cancelled/);
});

test("cursor persistence survives restart and corrupt state recovers to frame 1", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-sequence-"));
  const filePath = path.join(directory, "state.json");
  const options = { filePath, frameCounts: { horse: 162 } };
  const first = new SequenceCursorStore(options);
  first.setFrame("horse", 161);
  assert.equal(new SequenceCursorStore(options).currentFrame("horse"), 161);
  fs.writeFileSync(filePath, "not json");
  assert.equal(new SequenceCursorStore(options).currentFrame("horse"), 0);
});
