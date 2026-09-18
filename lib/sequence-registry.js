const path = require("node:path");
const horse = require("../preview/sequences/higher-zip-horse/manifest");
const { resolveTemplate, sequenceToken } = require("../preview/sequences/sequence-core");
const { SequenceCursorStore } = require("./sequence-controller");

function createSequenceRegistry(options = {}) {
  const sequences = new Map([[horse.manifest.id, horse]]);
  const stateFile = options.stateFile === undefined
    ? path.join(__dirname, "..", ".runtime", "sequence-cursors.json")
    : options.stateFile;
  const cursors = options.cursors || new SequenceCursorStore({
    filePath: stateFile,
    frameCounts: Object.fromEntries([...sequences].map(([id, sequence]) => [id, sequence.frames.length])),
  });
  return {
    get(id) { return sequences.get(id); },
    token: sequenceToken,
    currentFrame(id) { return cursors.currentFrame(id); },
    advance(id) { return cursors.advance(id); },
    reset(id) { return cursors.reset(id); },
    resolve(id, template) {
      const sequence = sequences.get(id);
      if (!sequence) throw new Error(`Unknown sequence: ${id}`);
      if (!String(template).includes(sequenceToken(id))) throw new Error(`Template must contain ${sequenceToken(id)}.`);
      const index = cursors.currentFrame(id);
      return { text: resolveTemplate(template, sequence, index), frameIndex: index, sequenceId: id };
    },
  };
}

module.exports = { createSequenceRegistry };
