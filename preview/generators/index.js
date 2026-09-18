(function generatorsModule(root, factory) {
  const sources = typeof module === "object" && module.exports
    ? [require("./borders"), require("./waves"), require("./geometry"), require("./cellular")]
    : [root.ReceiptBorders, root.ReceiptWaves, root.ReceiptGeometry, root.ReceiptCellular];
  const api = factory(sources);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReceiptGenerators = api;
}(typeof globalThis !== "undefined" ? globalThis : this, (generators) => ({
  generators,
  getGenerator(id) {
    return generators.find((generator) => generator.id === id);
  },
})));
