const fs = require("node:fs");
const path = require("node:path");
const { createSequenceCursor } = require("../preview/sequences/sequence-core");

class SequenceCursorStore {
  constructor(options = {}) {
    this.filePath = options.filePath;
    this.frameCounts = options.frameCounts || {};
    this.state = this.readState();
  }

  readState() {
    if (!this.filePath) return {};
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  getIndex(id) {
    const frameCount = this.frameCounts[id];
    if (!frameCount) throw new Error(`Unknown sequence: ${id}`);
    const stored = this.state[id];
    return Number.isInteger(stored) && stored >= 0 && stored < frameCount ? stored : 0;
  }

  currentFrame(id) {
    return this.getIndex(id);
  }

  setFrame(id, index) {
    const cursor = createSequenceCursor(this.frameCounts[id], this.getIndex(id));
    const value = cursor.setFrame(index);
    this.state[id] = value;
    this.persist();
    return value;
  }

  advance(id) {
    return this.setFrame(id, this.getIndex(id) + 1);
  }

  reset(id) {
    return this.setFrame(id, 0);
  }

  persist() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }
}

module.exports = { SequenceCursorStore };
