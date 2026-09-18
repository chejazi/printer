const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CATEGORIES,
  createId,
  deleteCustomPreset,
  exportLibrary,
  insertWithBoundaries,
  normalizePreset,
  parseLibraryImport,
  upsertCustomPreset,
} = require("../preview/block-library");
const { presets } = require("../preview/presets");

test("built-in library has required categories and preset counts", () => {
  for (const category of CATEGORIES) assert.ok(presets.some((preset) => preset.category === category));
  assert.ok(presets.filter((preset) => preset.category === "dividers").length >= 3);
  assert.ok(presets.filter((preset) => preset.category === "frames").length >= 3);
  assert.ok(presets.filter((preset) => preset.category === "labels").length >= 2);
  assert.ok(presets.filter((preset) => preset.category === "footers").length >= 2);
  assert.equal(presets.filter((preset) => preset.category === "procedural-patterns").length, 4);
  assert.ok(presets.every((preset) => preset.builtIn && Number.isInteger(preset.width)));
});

test("the three dividers are exactly 48 columns", () => {
  const dividers = presets.filter((preset) => preset.category === "dividers");
  assert.ok(dividers.every((preset) => preset.width === 48 && preset.warnings.length === 0));
});

test("block insertion adds only predictable newline boundaries", () => {
  assert.deepEqual(insertWithBoundaries("alphaomega", 5, 5, "BLOCK"), {
    text: "alpha\nBLOCK\nomega",
    selectionStart: 12,
  });
  assert.equal(insertWithBoundaries("alpha\nomega", 6, 6, "BLOCK\n").text, "alpha\nBLOCK\nomega");
  assert.equal(insertWithBoundaries("", 0, 0, "  BLOCK  ").text, "  BLOCK  ");
});

test("replacement uses the same explicit boundaries without changing block text", () => {
  const source = "before SELECT after";
  const result = insertWithBoundaries(source, 7, 13, "  X\n\nY  ");
  assert.equal(result.text, "before \n  X\n\nY  \n after");
});

test("custom library JSON round-trips and forces imported records to custom", () => {
  const custom = normalizePreset({ id: "custom-note", name: "Note", category: "labels", content: "  exact  " });
  const imported = parseLibraryImport(exportLibrary([custom]));
  assert.equal(imported.length, 1);
  assert.equal(imported[0].content, "  exact  ");
  assert.equal(imported[0].builtIn, false);
});

test("malformed imports produce useful errors", () => {
  assert.throws(() => parseLibraryImport("{"), /Invalid JSON/);
  assert.throws(() => parseLibraryImport('{"presets":{}}'), /must be an array/);
  assert.throws(() => parseLibraryImport('[{"id":"x"}]'), /requires a name/);
});

test("custom IDs are stable and avoid collisions", () => {
  assert.equal(createId("My Block", []), "custom-my-block");
  assert.equal(createId("My Block", ["custom-my-block"]), "custom-my-block-2");
});

test("custom records can be created, edited, and deleted without changing content", () => {
  const created = upsertCustomPreset([], { id: "custom-a", name: "A", category: "labels", content: "  A  " });
  assert.equal(created[0].content, "  A  ");
  const edited = upsertCustomPreset(created, { ...created[0], name: "Edited", content: "  B\n\nC  " });
  assert.equal(edited.length, 1);
  assert.equal(edited[0].name, "Edited");
  assert.equal(edited[0].content, "  B\n\nC  ");
  assert.deepEqual(deleteCustomPreset(edited, "custom-a"), []);
});

test("built-in records cannot be deleted by the custom deletion helper", () => {
  const builtIn = presets[0];
  assert.deepEqual(deleteCustomPreset([builtIn], builtIn.id), [builtIn]);
});
