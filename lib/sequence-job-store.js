const crypto = require("node:crypto");

function now() {
  return new Date().toISOString();
}

function createSequenceJobStore() {
  const jobs = new Map();

  function create(details = {}) {
    const id = crypto.randomUUID();
    const job = {
      id,
      state: "queued",
      createdAt: now(),
      updatedAt: now(),
      ...details,
    };
    jobs.set(id, job);
    return job;
  }

  function get(id) {
    return jobs.get(id);
  }

  function update(id, patch) {
    const job = jobs.get(id);
    if (!job) return undefined;
    Object.assign(job, patch, { updatedAt: now() });
    return job;
  }

  function updateMany(ids, patch) {
    for (const id of ids || []) update(id, patch);
  }

  function publicJob(job) {
    if (!job) return undefined;
    const {
      id,
      state,
      sequence,
      frame,
      nextFrame,
      advanceOnSuccess,
      printer,
      createdAt,
      updatedAt,
      completedAt,
      failedAt,
      error,
      currentFrame,
    } = job;
    return {
      id,
      state,
      sequence,
      frame,
      nextFrame,
      advanceOnSuccess,
      printer,
      createdAt,
      updatedAt,
      completedAt,
      failedAt,
      error,
      currentFrame,
    };
  }

  return { create, get, update, updateMany, publicJob };
}

module.exports = { createSequenceJobStore };
