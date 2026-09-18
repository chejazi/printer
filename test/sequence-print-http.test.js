const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("../server");
const { createPreviewApp } = require("../preview-server");
const { createSequenceRegistry } = require("../lib/sequence-registry");
const horse = require("../preview/sequences/higher-zip-horse/manifest");

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function waitForJob(baseUrl, token, jobId, state) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/print-sequence/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    if (body.job?.state === state) return body.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job did not reach ${state}`);
}

async function waitForStaticJob(baseUrl, token, jobId, state) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/print/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    if (body.job?.state === state) return body.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Static job did not reach ${state}`);
}

test("production sequence status does not treat queue acceptance as print success", async () => {
  const token = "test-token";
  let releasePrint;
  const printReleased = new Promise((resolve) => { releasePrint = resolve; });
  const app = createApp({
    authToken: token,
    useSingleton: false,
    printQueueConfig: {
      coalesceMs: 0,
      jobDelayMs: 0,
      printBatch: async () => {
        await printReleased;
        return { printer: "test", jobId: "job-1" };
      },
    },
  });
  const { server, url } = await listen(app);
  try {
    const queued = await fetch(`${url}/print-sequence`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ template: "{{sequence:higher-zip-running-horse}}", sequence: "higher-zip-running-horse", frame: 7, flush: true }),
    });
    const queuedBody = await queued.json();
    assert.equal(queuedBody.queued, true);
    assert.ok(queuedBody.jobId);

    const status = await fetch(`${url}/print-sequence/jobs/${queuedBody.jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const statusBody = await status.json();
    assert.notEqual(statusBody.job.state, "succeeded");

    releasePrint();
    const completed = await waitForJob(url, token, queuedBody.jobId, "succeeded");
    assert.equal(completed.currentFrame, 8);
  } finally {
    await close(server);
  }
});

test("production sequence status records physical print failure without advancement", async () => {
  const token = "test-token";
  const app = createApp({
    authToken: token,
    useSingleton: false,
    printQueueConfig: {
      coalesceMs: 0,
      jobDelayMs: 0,
      printBatch: async () => { throw new Error("simulated failure"); },
    },
  });
  const { server, url } = await listen(app);
  try {
    const queued = await fetch(`${url}/print-sequence`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ template: "{{sequence:higher-zip-running-horse}}", sequence: "higher-zip-running-horse", frame: 9, flush: true }),
    });
    const queuedBody = await queued.json();
    const failed = await waitForJob(url, token, queuedBody.jobId, "failed");
    assert.match(failed.error, /simulated failure/);
    assert.equal(failed.currentFrame, undefined);
  } finally {
    await close(server);
  }
});

test("preview proxy uses configured destination and returns success only after job completion", async () => {
  const remoteToken = "remote-secret";
  const received = [];
  const remote = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${remoteToken}`);
    if (req.method === "POST" && req.url === "/print-sequence") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, queued: true, jobId: "remote-job-1" }));
      return;
    }
    if (req.method === "GET" && req.url === "/print-sequence/jobs/remote-job-1") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, job: { id: "remote-job-1", state: "succeeded", currentFrame: 12, nextFrame: 13 } }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const remoteUrl = `http://127.0.0.1:${remote.address().port}`;
  const proxy = createPreviewApp({
    printApiUrl: remoteUrl,
    printApiToken: remoteToken,
    printer: "configured-printer",
    timeoutMs: 200,
    pollMs: 5,
  });
  const { server, url } = await listen(proxy);
  try {
    const response = await fetch(`${url}/api/print-current-frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: "{{sequence:higher-zip-running-horse}}",
        sequence: "higher-zip-running-horse",
        frame: 11,
        advanceOnSuccess: true,
        printApiUrl: "http://attacker.invalid",
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.job.state, "succeeded");
    assert.equal(received.length, 1);
    assert.equal(received[0].printer, "configured-printer");
    assert.equal(received[0].frame, 11);
  } finally {
    await close(server);
    await close(remote);
  }
});

test("static receipt preview sends exact visible text through /print", async () => {
  const remoteToken = "remote-secret";
  const visibleText = "HEADER\n  aligned static line\nFOOTER";
  const received = [];
  const remote = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${remoteToken}`);
    if (req.method === "POST" && req.url === "/print") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, queued: true, jobId: "static-job" }));
      return;
    }
    if (req.method === "GET" && req.url === "/print/jobs/static-job") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, job: { id: "static-job", state: "succeeded" } }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const { server, url } = await listen(createPreviewApp({
    printApiUrl: `http://127.0.0.1:${remote.address().port}`,
    printApiToken: remoteToken,
    printer: "configured-printer",
    timeoutMs: 100,
    pollMs: 5,
  }));
  try {
    const response = await fetch(`${url}/api/print-receipt-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: visibleText, template: visibleText }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.route, "print");
    assert.equal(received.length, 1);
    assert.equal(received[0].body.text, visibleText);
    assert.equal(received[0].body.trackJob, true);
    assert.equal(received[0].body.printer, "configured-printer");
  } finally {
    await close(server);
    await close(remote);
  }
});

test("dynamic receipt preview uses /print-sequence and prints the resolved preview exactly once", async () => {
  const token = "test-token";
  const frame = horse.frames[4];
  const template = `PREFIX\n{{sequence:higher-zip-running-horse}}\nSUFFIX`;
  const visibleText = `PREFIX\n${frame}\nSUFFIX`;
  let printedText = "";
  const app = createApp({
    authToken: token,
    useSingleton: false,
    printQueueConfig: {
      coalesceMs: 0,
      jobDelayMs: 0,
      printBatch: async (text) => {
        printedText = text;
        return { printer: "test", jobId: "dynamic-preview" };
      },
    },
  });
  const production = await listen(app);
  const preview = await listen(createPreviewApp({
    printApiUrl: production.url,
    printApiToken: token,
    printer: "test",
    timeoutMs: 300,
    pollMs: 5,
  }));
  try {
    const response = await fetch(`${preview.url}/api/print-receipt-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: visibleText,
        template,
        sequence: "higher-zip-running-horse",
        frame: 5,
        advanceOnSuccess: true,
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.route, "print-sequence");
    assert.equal(printedText, visibleText);
    assert.equal((printedText.match(/PREFIX/g) || []).length, 1);
    assert.equal((printedText.match(/SUFFIX/g) || []).length, 1);
    assert.equal((printedText.match(new RegExp(frame.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1);
    assert.equal(body.job.currentFrame, 6);
  } finally {
    await close(preview.server);
    await close(production.server);
  }
});

test("static receipt preview completion never advances sequence state", async () => {
  const token = "test-token";
  const registry = createSequenceRegistry({ stateFile: null });
  const app = createApp({
    authToken: token,
    sequenceRegistry: registry,
    useSingleton: false,
    printQueueConfig: {
      coalesceMs: 0,
      jobDelayMs: 0,
      printBatch: async () => ({ printer: "test", jobId: "static-only" }),
    },
  });
  const { server, url } = await listen(app);
  try {
    const response = await fetch(`${url}/print`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "STATIC ONLY", flush: true, trackJob: true }),
    });
    const body = await response.json();
    await waitForStaticJob(url, token, body.jobId, "succeeded");
    assert.equal(registry.currentFrame("higher-zip-running-horse"), 0);
  } finally {
    await close(server);
  }
});

test("dynamic receipt preview failure does not advance sequence state", async () => {
  const token = "test-token";
  const registry = createSequenceRegistry({ stateFile: null });
  const frame = horse.frames[2];
  const template = `A\n{{sequence:higher-zip-running-horse}}\nZ`;
  const visibleText = `A\n${frame}\nZ`;
  const production = await listen(createApp({
    authToken: token,
    sequenceRegistry: registry,
    useSingleton: false,
    printQueueConfig: {
      coalesceMs: 0,
      jobDelayMs: 0,
      printBatch: async () => { throw new Error("simulated receipt preview failure"); },
    },
  }));
  const preview = await listen(createPreviewApp({
    printApiUrl: production.url,
    printApiToken: token,
    timeoutMs: 100,
    pollMs: 5,
  }));
  try {
    const response = await fetch(`${preview.url}/api/print-receipt-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: visibleText,
        template,
        sequence: "higher-zip-running-horse",
        frame: 3,
        advanceOnSuccess: true,
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.match(body.error, /simulated receipt preview failure/);
    assert.equal(registry.currentFrame("higher-zip-running-horse"), 0);
  } finally {
    await close(preview.server);
    await close(production.server);
  }
});

test("receipt preview overflow is blocked before contacting the printer API", async () => {
  let contacted = false;
  const remote = http.createServer((_req, res) => {
    contacted = true;
    res.end("{}");
  });
  await new Promise((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const { server, url } = await listen(createPreviewApp({
    printApiUrl: `http://127.0.0.1:${remote.address().port}`,
    printApiToken: "token",
  }));
  try {
    const response = await fetch(`${url}/api/print-receipt-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "X".repeat(49), template: "X".repeat(49) }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /overflowing/);
    assert.equal(contacted, false);
  } finally {
    await close(server);
    await close(remote);
  }
});

test("preview proxy surfaces failed remote jobs", async () => {
  const remote = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (_req.url === "/print-sequence") res.end(JSON.stringify({ ok: true, queued: true, jobId: "failed-job" }));
    else res.end(JSON.stringify({ ok: true, job: { id: "failed-job", state: "failed", error: "paper out" } }));
  });
  await new Promise((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const { server, url } = await listen(createPreviewApp({
    printApiUrl: `http://127.0.0.1:${remote.address().port}`,
    printApiToken: "token",
    timeoutMs: 100,
    pollMs: 5,
  }));
  try {
    const response = await fetch(`${url}/api/print-current-frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "{{sequence:higher-zip-running-horse}}", sequence: "higher-zip-running-horse", frame: 1 }),
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.match(body.error, /paper out/);
  } finally {
    await close(server);
    await close(remote);
  }
});

test("preview proxy times out without reporting success", async () => {
  const remote = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (_req.url === "/print-sequence") res.end(JSON.stringify({ ok: true, queued: true, jobId: "slow-job" }));
    else res.end(JSON.stringify({ ok: true, job: { id: "slow-job", state: "printing" } }));
  });
  await new Promise((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const { server, url } = await listen(createPreviewApp({
    printApiUrl: `http://127.0.0.1:${remote.address().port}`,
    printApiToken: "token",
    timeoutMs: 20,
    pollMs: 5,
  }));
  try {
    const response = await fetch(`${url}/api/print-current-frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "{{sequence:higher-zip-running-horse}}", sequence: "higher-zip-running-horse", frame: 1 }),
    });
    const body = await response.json();
    assert.equal(response.status, 504);
    assert.match(body.error, /Timed out/);
  } finally {
    await close(server);
    await close(remote);
  }
});
