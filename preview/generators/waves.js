(function wavesModule(root, factory) {
  const randomApi = typeof module === "object" && module.exports
    ? require("./random") : root.ReceiptRandom;
  const api = factory(randomApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReceiptWaves = api;
}(typeof globalThis !== "undefined" ? globalThis : this, ({ createRandom }) => {
  function generate(options) {
    const width = Math.max(1, Math.min(48, Number(options.width) || 48));
    const height = Math.max(1, Number(options.height) || 8);
    const complexity = Math.max(0.05, Math.min(1, Number(options.complexity) || 0.5));
    const random = createRandom(options.seed);
    const characters = options.unicode ? " ·∙○◉" : " .oO@";
    const phase = random() * Math.PI * 2;
    const frequency = 0.08 + complexity * 0.34;
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        const wave = (Math.sin(x * frequency + y * 0.72 + phase) + 1) / 2;
        const noise = (random() - 0.5) * complexity;
        const value = Math.max(0, Math.min(0.999, wave * 0.8 + noise));
        row += characters[Math.floor(value * characters.length)];
      }
      rows.push(row.trimEnd());
    }
    return rows.join("\n");
  }
  return { id: "waves", label: "Noise & wave field", generate };
}));
