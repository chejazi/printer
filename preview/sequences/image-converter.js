(function imageSequenceConverterModule(root, factory) {
  const core = typeof module === "object" && module.exports ? require("./sequence-core") : root.SequenceCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImageSequenceConverter = api;
}(typeof globalThis !== "undefined" ? globalThis : this, ({ mapGrayscaleFrames, naturalCompare }) => {
  function outputHeight(sourceWidth, sourceHeight, outputWidth, characterAspectCorrection) {
    return Math.max(1, Math.floor(outputWidth * (sourceHeight / sourceWidth) * characterAspectCorrection));
  }

  async function filesToGrayscaleFrames(files, options, cancellation = {}, onProgress = () => {}) {
    const ordered = [...files].filter((file) => file.type.startsWith("image/")).sort((a, b) => naturalCompare(a.name, b.name));
    if (!ordered.length) throw new Error("Choose at least one image file.");
    const frames = [];
    for (let index = 0; index < ordered.length; index += 1) {
      if (cancellation.cancelled) throw new Error("Conversion cancelled.");
      const bitmap = await createImageBitmap(ordered[index]);
      const crop = options.crop || { left: 0, top: 0, right: bitmap.width, bottom: bitmap.height };
      const cropWidth = crop.right - crop.left;
      const cropHeight = crop.bottom - crop.top;
      if (cropWidth <= 0 || cropHeight <= 0) throw new Error("Crop bounds must describe a positive area.");
      const outputWidth = Math.max(1, Math.min(48, Number(options.width) || 48));
      const horizontalPadding = Math.max(0, Math.min(Math.floor((outputWidth - 1) / 2), Number(options.horizontalPadding) || 0));
      const width = outputWidth - (horizontalPadding * 2);
      const height = outputHeight(cropWidth, cropHeight, width, Number(options.characterAspectCorrection) || 0.5);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, crop.left, crop.top, cropWidth, cropHeight, 0, 0, width, height);
      bitmap.close();
      const rgba = context.getImageData(0, 0, width, height).data;
      const values = [];
      for (let offset = 0; offset < rgba.length; offset += 4) {
        values.push(Math.round((rgba[offset] * 0.2126) + (rgba[offset + 1] * 0.7152) + (rgba[offset + 2] * 0.0722)));
      }
      frames.push({ name: ordered[index].name, width, height, values });
      onProgress({ completed: index + 1, total: ordered.length, phase: "reading" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return frames;
  }

  async function convertFiles(files, options, cancellation = {}, onProgress = () => {}) {
    const grayscale = await filesToGrayscaleFrames(files, options, cancellation, onProgress);
    if (cancellation.cancelled) throw new Error("Conversion cancelled.");
    let minimum = Infinity;
    let maximum = -Infinity;
    grayscale.forEach((frame) => frame.values.forEach((value) => {
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }));
    let frames = [];
    for (let index = 0; index < grayscale.length; index += 1) {
      if (cancellation.cancelled) throw new Error("Conversion cancelled.");
      frames.push(mapGrayscaleFrames([grayscale[index]], {
        ...options,
        normalizationBounds: { min: minimum, max: maximum },
      }, cancellation)[0]);
      onProgress({ completed: index + 1, total: grayscale.length, phase: "mapping" });
      if (index % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const outputWidth = Math.max(1, Math.min(48, Number(options.width) || 48));
    const verticalPadding = Math.max(0, Number(options.verticalPadding) || 0);
    const background = options.backgroundCharacter ?? " ";
    frames = frames.map((frame) => {
      const lines = frame.split("\n").map((line) => {
        const room = outputWidth - line.length;
        const left = options.alignment === "right" ? room : options.alignment === "center" ? Math.floor(room / 2) : Math.max(0, Number(options.horizontalPadding) || 0);
        return background.repeat(left) + line + background.repeat(room - left);
      });
      const blank = background.repeat(outputWidth);
      return [...Array(verticalPadding).fill(blank), ...lines, ...Array(verticalPadding).fill(blank)].join("\n");
    });
    onProgress({ completed: frames.length, total: frames.length, phase: "complete" });
    return { frames, sourceFiles: grayscale.map((frame) => frame.name), width: outputWidth, height: frames[0].split("\n").length };
  }

  return { convertFiles, filesToGrayscaleFrames, outputHeight };
}));
