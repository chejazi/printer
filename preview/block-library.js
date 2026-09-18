(function blockLibraryModule(root, factory) {
  const format = typeof module === "object" && module.exports
    ? require("../lib/receipt-format") : root.ReceiptFormat;
  const api = factory(format);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BlockLibrary = api;
}(typeof globalThis !== "undefined" ? globalThis : this, ({ normalizeLineEndings, validateReceipt }) => {
  const CATEGORIES = ["headers", "dividers", "frames", "labels", "footers", "procedural-patterns", "complete-receipts"];
  const STORAGE_KEY = "receipt-simulator-custom-blocks-v1";

  function measureContent(content) {
    const validation = validateReceipt(content);
    return {
      width: Math.max(...validation.lines.map((line) => Array.from(line).length)),
      lineCount: validation.lineCount,
      warnings: validation.warnings,
    };
  }

  function normalizePreset(value, options = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Each preset must be an object.");
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const category = typeof value.category === "string" ? value.category : "";
    if (!id) throw new Error("Each preset requires a non-empty string ID.");
    if (!name) throw new Error(`Preset ${id} requires a name.`);
    if (!CATEGORIES.includes(category)) throw new Error(`Preset ${id} has an unknown category: ${category || "(missing)"}.`);
    if (typeof value.content !== "string") throw new Error(`Preset ${id} requires string content.`);
    const content = normalizeLineEndings(value.content);
    const measurement = measureContent(content);
    return {
      id,
      name,
      category,
      description: typeof value.description === "string" ? value.description : "",
      content,
      width: measurement.width,
      lineCount: measurement.lineCount,
      builtIn: options.builtIn ?? Boolean(value.builtIn),
      warnings: measurement.warnings,
    };
  }

  function parseLibraryImport(json) {
    let parsed;
    try { parsed = JSON.parse(json); } catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
    const records = Array.isArray(parsed) ? parsed : parsed?.presets;
    if (!Array.isArray(records)) throw new Error('Imported JSON must be an array or an object with a "presets" array.');
    const seen = new Set();
    return records.map((record) => {
      const preset = normalizePreset(record, { builtIn: false });
      if (seen.has(preset.id)) throw new Error(`Duplicate preset ID: ${preset.id}.`);
      seen.add(preset.id);
      return preset;
    });
  }

  function exportLibrary(presets) {
    return JSON.stringify({ version: 1, presets: presets.map(({ warnings, ...preset }) => ({ ...preset, builtIn: false })) }, null, 2);
  }

  function insertWithBoundaries(source, start, end, content) {
    const text = normalizeLineEndings(source);
    const block = normalizeLineEndings(content);
    const before = text.slice(0, start);
    const after = text.slice(end);
    const prefix = before && !before.endsWith("\n") && block && !block.startsWith("\n") ? "\n" : "";
    const suffix = after && !after.startsWith("\n") && block && !block.endsWith("\n") ? "\n" : "";
    const inserted = prefix + block + suffix;
    return { text: before + inserted + after, selectionStart: before.length + inserted.length };
  }

  function createId(name, existingIds = []) {
    const base = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom-block";
    let id = `custom-${base}`;
    let number = 2;
    while (existingIds.includes(id)) { id = `custom-${base}-${number}`; number += 1; }
    return id;
  }

  function upsertCustomPreset(presets, preset) {
    const normalized = normalizePreset(preset, { builtIn: false });
    const exists = presets.some((item) => item.id === normalized.id);
    return exists
      ? presets.map((item) => item.id === normalized.id ? normalized : item)
      : [...presets, normalized];
  }

  function deleteCustomPreset(presets, id) {
    return presets.filter((preset) => preset.id !== id || preset.builtIn);
  }

  return { CATEGORIES, STORAGE_KEY, createId, deleteCustomPreset, exportLibrary, insertWithBoundaries, measureContent, normalizePreset, parseLibraryImport, upsertCustomPreset };
}));
