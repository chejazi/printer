(function sequenceCoreModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SequenceCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function naturalCompare(left, right) {
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  }

  function createSequenceCursor(frameCount, initialIndex = 0) {
    if (!Number.isInteger(frameCount) || frameCount < 1) throw new Error("frameCount must be a positive integer.");
    let index = 0;
    function setFrame(nextIndex) {
      if (!Number.isInteger(nextIndex)) throw new Error("Frame index must be an integer.");
      index = ((nextIndex % frameCount) + frameCount) % frameCount;
      return index;
    }
    setFrame(initialIndex);
    return {
      currentFrame: () => index,
      advance: () => setFrame(index + 1),
      reset: () => setFrame(0),
      setFrame,
      nextFrame: () => (index + 1) % frameCount,
    };
  }

  function sequenceToken(id) {
    return `{{sequence:${id}}}`;
  }

  function resolveTemplate(template, sequence, frameIndex) {
    const source = String(template);
    const token = sequenceToken(sequence.manifest.id);
    return source.split(token).join(sequence.frames[frameIndex]);
  }

  function composeTemplate(prefix, sequenceId, suffix) {
    return [String(prefix), sequenceToken(sequenceId), String(suffix)]
      .filter((part) => part !== "")
      .join("\n");
  }

  function validateSequence(value) {
    if (!value || typeof value !== "object") throw new Error("Sequence must be an object.");
    const { manifest, frames } = value;
    if (!manifest || typeof manifest !== "object") throw new Error("Sequence manifest is required.");
    if (!Array.isArray(frames) || frames.length === 0) throw new Error("Sequence frames must be a non-empty array.");
    if (manifest.frameCount !== frames.length) throw new Error("Manifest frameCount does not match the frame array.");
    const widths = new Set();
    const heights = new Set();
    frames.forEach((frame, index) => {
      if (typeof frame !== "string") throw new Error(`Frame ${index + 1} must be text.`);
      const lines = frame.split("\n");
      heights.add(lines.length);
      lines.forEach((line) => widths.add(Array.from(line).length));
    });
    if (widths.size !== 1 || !widths.has(manifest.width)) throw new Error("Frames do not share the manifest width.");
    if (heights.size !== 1 || !heights.has(manifest.height)) throw new Error("Frames do not share the manifest height.");
    return value;
  }

  function exportSequence(sequence) {
    validateSequence(sequence);
    return JSON.stringify({ version: 1, manifest: sequence.manifest, frames: sequence.frames }, null, 2);
  }

  function importSequence(json) {
    let parsed;
    try { parsed = JSON.parse(json); } catch (error) { throw new Error(`Invalid sequence JSON: ${error.message}`); }
    return validateSequence({ manifest: parsed.manifest, frames: parsed.frames });
  }

  function mapGrayscaleFrames(grayscaleFrames, options, cancellation = {}) {
    const palette = options.invert ? Array.from(options.palette).reverse().join("") : options.palette;
    if (!palette) throw new Error("Palette cannot be empty.");
    let globalMin = options.normalizationBounds?.min ?? Infinity;
    let globalMax = options.normalizationBounds?.max ?? -Infinity;
    if (!options.normalizationBounds) {
      grayscaleFrames.forEach((frame) => frame.values.forEach((value) => {
        if (value < globalMin) globalMin = value;
        if (value > globalMax) globalMax = value;
      }));
    }
    return grayscaleFrames.map((frame) => {
      if (cancellation.cancelled) throw new Error("Conversion cancelled.");
      const localMin = options.normalization === "frame" ? frame.values.reduce((minimum, value) => Math.min(minimum, value), Infinity) : globalMin;
      const localMax = options.normalization === "frame" ? frame.values.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : globalMax;
      const span = localMax - localMin;
      const characters = frame.values.map((raw) => {
        let value = span === 0 ? 0.5 : (raw - localMin) / span;
        value = ((value - 0.5) * (Number(options.contrast) || 1)) + 0.5 + (Number(options.brightness) || 0);
        value = Math.max(0, Math.min(1, value));
        if (options.threshold !== null && options.threshold !== undefined && value >= Number(options.threshold)) return options.backgroundCharacter ?? " ";
        return Array.from(palette)[Math.min(Array.from(palette).length - 1, Math.floor(value * Array.from(palette).length))];
      });
      const lines = [];
      for (let row = 0; row < frame.height; row += 1) lines.push(characters.slice(row * frame.width, (row + 1) * frame.width).join(""));
      return lines.join("\n");
    });
  }

  return { composeTemplate, createSequenceCursor, exportSequence, importSequence, mapGrayscaleFrames, naturalCompare, resolveTemplate, sequenceToken, validateSequence };
}));
