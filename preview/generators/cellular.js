(function cellularModule(root, factory) {
  const randomApi = typeof module === "object" && module.exports
    ? require("./random") : root.ReceiptRandom;
  const api = factory(randomApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReceiptCellular = api;
}(typeof globalThis !== "undefined" ? globalThis : this, ({ createRandom }) => {
  function generate(options) {
    const width = Math.max(1, Math.min(48, Number(options.width) || 48));
    const height = Math.max(1, Number(options.height) || 10);
    const density = Math.max(0.05, Math.min(0.95, Number(options.complexity) || 0.38));
    const random = createRandom(options.seed);
    const live = options.unicode ? "█" : "#";
    let cells = Array.from({ length: width }, () => random() < density);
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      rows.push(cells.map((cell) => (cell ? live : " ")).join("").trimEnd());
      cells = cells.map((cell, x) => {
        const left = cells[(x - 1 + width) % width];
        const right = cells[(x + 1) % width];
        return Boolean(left) !== Boolean(cell || right);
      });
    }
    return rows.join("\n");
  }
  return { id: "cellular", label: "Cellular automata", generate };
}));
