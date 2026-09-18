(function sequencePalettesModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SequencePalettes = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const presets = [
    { id: "thermal-safe", name: "Thermal Safe", value: "@%#*+=-:. ", printerSafe: true },
    { id: "root-legacy", name: "Root Legacy", value: "!@#$%^^&", printerSafe: true },
    { id: "vii-legacy", name: "VII Legacy", value: "↑↑↑[]{}@#$%____↑", printerSafe: false, warning: "Contains Unicode and may not be supported by every ESC/POS code page." },
    { id: "ascii-py-legacy", name: "ascii.py Legacy", value: " _-=*%#@--", printerSafe: true },
  ];
  return { presets, getPalette(id) { return presets.find((preset) => preset.id === id); } };
}));
