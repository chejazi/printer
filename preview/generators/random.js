(function randomModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReceiptRandom = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function hashSeed(seed) {
    let hash = 2166136261;
    for (const character of String(seed)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createRandom(seed) {
    let state = hashSeed(seed) || 0x6d2b79f5;
    return function random() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(random, values) {
    return values[Math.floor(random() * values.length)];
  }

  return { createRandom, hashSeed, pick };
}));
