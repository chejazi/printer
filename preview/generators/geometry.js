(function geometryModule(root, factory) {
  const randomApi = typeof module === "object" && module.exports
    ? require("./random") : root.ReceiptRandom;
  const api = factory(randomApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReceiptGeometry = api;
}(typeof globalThis !== "undefined" ? globalThis : this, ({ createRandom }) => {
  function generate(options) {
    const width = Math.max(1, Math.min(48, Number(options.width) || 48));
    const height = Math.max(1, Number(options.height) || 8);
    const complexity = Math.max(0.05, Math.min(1, Number(options.complexity) || 0.5));
    const random = createRandom(options.seed);
    const ink = options.unicode ? "◆" : "#";
    const spacing = Math.max(2, Math.round(8 - complexity * 5));
    const offset = Math.floor(random() * spacing);
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        const diagonal = (x + y + offset) % spacing === 0;
        const counter = (x - y + width + offset) % spacing === 0;
        row += diagonal || counter ? ink : " ";
      }
      rows.push(row.trimEnd());
    }
    return rows.join("\n");
  }
  return { id: "geometry", label: "Geometric pattern", generate };
}));
