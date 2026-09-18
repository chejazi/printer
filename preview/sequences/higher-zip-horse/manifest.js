(function higherZipHorseModule(root, factory) {
  const frameData = typeof module === "object" && module.exports ? require("./frames") : root.HigherZipHorseFrames;
  const api = factory(frameData.frames);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HigherZipHorseSequence = api;
}(typeof globalThis !== "undefined" ? globalThis : this, (frames) => ({
  manifest: {
    id: "higher-zip-running-horse",
    name: "higher.zip Running Horse",
    description: "A receipt-native running horse sequence and higher.zip brand decoration.",
    brand: "higher.zip",
    fps: 8,
    frameCount: 162,
    width: 48,
    height: 14,
    loop: true,
    palette: "@%#*+=-:. ",
    source: {
      type: "derived",
      originalDimensions: [1936, 1080],
      crop: { left: 64, top: 112, right: 1536, bottom: 1024 },
      characterAspectCorrection: 0.5,
      normalization: "sequence",
      threshold: 0.72,
      backgroundCharacter: " ",
      sourceFrameRate: 8,
      conversion: "grayscale crop, Lanczos resize, sequence min/max density mapping",
    },
  },
  frames,
})));
