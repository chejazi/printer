(function exampleReceiptModule(root) {
  const text = [
    "================================================",
    "             HIGHER ZIP SUPPLY CO.",
    "              RECEIPT LAB / 0017",
    "================================================",
    "",
    "FIELD NOTE                              08.12.26",
    "WORKSHOP                                   20:13",
    "",
    "+----------------------------------------------+",
    "|      BUILD SMALL / PRINT SOMETHING REAL      |",
    "+----------------------------------------------+",
    "",
    "SEEDED SIGNAL                          HZ-8048",
    "  #   #   #   #   #   #   #   #   #   #   #",
    " # # # # # # # # # # # # # # # # # # # # # ",
    "#   #   #   #   #   #   #   #   #   #   #   ",
    "",
    "PAPER WIDTH                              80 MM",
    "TEXT GRID                             48 CHARS",
    "OUTPUT                               PLAIN TEXT",
    "",
    "------------------------------------------------",
    "      THANK YOU FOR MAKING THE INVISIBLE",
    "                    VISIBLE",
    "------------------------------------------------",
  ].join("\n");
  root.ExampleReceipt = { text };
  if (typeof module === "object" && module.exports) module.exports = { text };
}(typeof globalThis !== "undefined" ? globalThis : this));
