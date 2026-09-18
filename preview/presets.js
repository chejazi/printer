(function presetDataModule(root, factory) {
  const generators = typeof module === "object" && module.exports
    ? require("./generators") : root.ReceiptGenerators;
  const example = typeof module === "object" && module.exports
    ? require("./example-receipt") : root.ExampleReceipt;
  const library = typeof module === "object" && module.exports
    ? require("./block-library") : root.BlockLibrary;
  const api = factory(generators, example, library);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReceiptPresets = api;
}(typeof globalThis !== "undefined" ? globalThis : this, (generatorApi, example, library) => {
  const procedural = (id, name, generatorId, options) => ({
    id, name, category: "procedural-patterns",
    description: `Fixed example generated with seed ${options.seed}.`,
    content: generatorApi.getGenerator(generatorId).generate(options), builtIn: true,
  });

  const rawPresets = [
    { id: "header-studio", name: "Studio Header", category: "headers", description: "Centered two-line workshop heading.", content: "             HIGHER ZIP SUPPLY CO.\n              RECEIPT LAB / 0017", builtIn: true },
    { id: "divider-heavy", name: "Heavy Divider", category: "dividers", description: "Full-width 48-column divider.", content: "================================================", builtIn: true },
    { id: "divider-light", name: "Light Divider", category: "dividers", description: "Full-width dashed divider.", content: "------------------------------------------------", builtIn: true },
    { id: "divider-dotted", name: "Dotted Divider", category: "dividers", description: "Full-width dotted divider.", content: "................................................", builtIn: true },
    { id: "frame-build", name: "Build Small Frame", category: "frames", description: "Single-line framed heading.", content: "+----------------------------------------------+\n|      BUILD SMALL / PRINT SOMETHING REAL      |\n+----------------------------------------------+", builtIn: true },
    { id: "frame-field-notes", name: "Field Notes Frame", category: "frames", description: "Compact centered title frame.", content: "+----------------------------------------------+\n|                 FIELD NOTES                  |\n+----------------------------------------------+", builtIn: true },
    { id: "frame-thank-you", name: "Thank You Frame", category: "frames", description: "Framed closing message.", content: "+----------------------------------------------+\n|                  THANK YOU                   |\n+----------------------------------------------+", builtIn: true },
    { id: "label-date-time", name: "Date & Time", category: "labels", description: "Left/right metadata pair.", content: "DATE                                   08.12.26\nTIME                                      20:13", builtIn: true },
    { id: "label-output", name: "Output Metadata", category: "labels", description: "Receipt format metadata.", content: "PAPER WIDTH                              80 MM\nTEXT GRID                             48 CHARS\nOUTPUT                               PLAIN TEXT", builtIn: true },
    { id: "footer-visible", name: "Make It Visible", category: "footers", description: "Centered two-line footer.", content: "      THANK YOU FOR MAKING THE INVISIBLE\n                    VISIBLE", builtIn: true },
    { id: "footer-thanks", name: "Simple Thanks", category: "footers", description: "Minimal centered footer.", content: "                   THANK YOU\n                 COME BACK SOON", builtIn: true },
    procedural("pattern-border", "Seeded Border", "borders", { seed: "BLOCK-01", width: 48, height: 5, complexity: 0.45, unicode: false }),
    procedural("pattern-wave", "Seeded Wave", "waves", { seed: "BLOCK-02", width: 48, height: 7, complexity: 0.45, unicode: false }),
    procedural("pattern-geometry", "Seeded Geometry", "geometry", { seed: "BLOCK-03", width: 48, height: 7, complexity: 0.45, unicode: false }),
    procedural("pattern-cellular", "Seeded Cellular", "cellular", { seed: "BLOCK-04", width: 48, height: 7, complexity: 0.38, unicode: false }),
    { id: "receipt-higher-zip", name: "Higher Zip Example", category: "complete-receipts", description: "Complete default simulator receipt.", content: example.text, builtIn: true },
  ];

  const presets = rawPresets.map((preset) => library.normalizePreset(preset, { builtIn: true }));
  return { presets };
}));
