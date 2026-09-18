(function receiptFormatModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ReceiptFormat = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const RECEIPT_WIDTH = 48;

  function normalizeLineEndings(text) {
    return String(text ?? "").replace(/\r\n?/g, "\n");
  }

  function lineWidth(line) {
    return Array.from(line).length;
  }

  function getCursorLocation(text, selectionStart) {
    const normalizedText = normalizeLineEndings(text);
    const safeOffset = Math.max(0, Math.min(normalizedText.length, Number(selectionStart) || 0));
    const beforeCursor = normalizedText.slice(0, safeOffset).split("\n");
    const line = beforeCursor.length;
    const column = lineWidth(beforeCursor.at(-1)) + 1;
    const storedLine = normalizedText.split("\n")[line - 1] ?? "";
    return { line, column, lineWidth: lineWidth(storedLine) };
  }

  function validateReceipt(text, options = {}) {
    const maxWidth = options.maxWidth ?? RECEIPT_WIDTH;
    const normalizedText = normalizeLineEndings(text);
    const lines = normalizedText.split("\n");
    const warnings = [];

    lines.forEach((line, index) => {
      const width = lineWidth(line);
      if (width > maxWidth) {
        warnings.push({
          type: "line-overflow",
          line: index + 1,
          width,
          maxWidth,
          excess: width - maxWidth,
          message: `Line ${index + 1} is ${width} characters (${width - maxWidth} over).`,
        });
      }
    });

    return {
      valid: warnings.length === 0,
      text: normalizedText,
      lines,
      lineCount: lines.length,
      maxWidth,
      warnings,
    };
  }

  function trimLineEndings(text) {
    return normalizeLineEndings(text)
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n");
  }

  return {
    RECEIPT_WIDTH,
    getCursorLocation,
    lineWidth,
    normalizeLineEndings,
    trimLineEndings,
    validateReceipt,
  };
}));
