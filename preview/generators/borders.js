(function bordersModule(root, factory) {
  const randomApi = typeof module === "object" && module.exports
    ? require("./random") : root.ReceiptRandom;
  const api = factory(randomApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReceiptBorders = api;
}(typeof globalThis !== "undefined" ? globalThis : this, ({ createRandom, pick }) => {
  function generate(options) {
    const width = Math.max(1, Math.min(48, Number(options.width) || 48));
    const height = Math.max(1, Number(options.height) || 5);
    const random = createRandom(options.seed);
    const asciiSets = [["+", "-", "|"], ["#", "=", "#"], ["*", ".", "*"]];
    const unicodeSets = [["┌", "─", "│", "┐", "└", "┘"], ["╔", "═", "║", "╗", "╚", "╝"]];
    const set = pick(random, options.unicode ? unicodeSets : asciiSets);
    if (height === 1) return set[1].repeat(width);
    if (width === 1) return Array(height).fill(set[2]).join("\n");
    const [left, horizontal, vertical, right = left, bottomLeft = left, bottomRight = right] = set;
    const top = left + horizontal.repeat(width - 2) + right;
    const middle = vertical + " ".repeat(width - 2) + vertical;
    const bottom = bottomLeft + horizontal.repeat(width - 2) + bottomRight;
    return [top, ...Array(Math.max(0, height - 2)).fill(middle), bottom].join("\n");
  }

  return { id: "borders", label: "Borders & dividers", generate };
}));
