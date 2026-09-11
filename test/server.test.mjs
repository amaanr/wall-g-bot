import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createApp, loadSettings } from "../server.js";

const SECRET = "test-only-key-that-must-never-reach-the-browser";
const ID = "54da293b-a791-4f5d-98ac-9dc5871dd572";
const DONE = "data: [DONE]\n\n";
const chunk = (text, finish = null) => `data: ${JSON.stringify({ id: "mock-chat", choices: [{ index: 0, delta: text ? { content: text } : {}, finish_reason: finish }] })}\n\n`;
const completion = chunk("Hello") + chunk("", "stop") + DONE;
let sharp;
try { ({ default: sharp } = await import("sharp")); } catch { /* Decoder-specific tests report a skip until installed. */ }
let hasPdf = false;
try { import.meta.resolve("pdf-parse"); hasPdf = true; } catch { /* No PDFs are fetched from the network. */ }

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  const stopped = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections();
  await stopped;
}

async function fixture(t, handler = (_req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(completion);
}, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wall-g-server-test-")));
  const dataDir = join(root, "data");
  const soulPath = join(root, "SOUL.md");
  await writeFile(soulPath, "Test WALL-G personality, first version.");
  const requests = [];
  const upstream = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks).toString("utf8");
      const record = { path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null, raw };
      requests.push(record);
      await handler(req, res, record);
    } catch { if (!res.destroyed) res.destroy(); }
  });
  const upstreamOrigin = await listen(upstream);
  const settings = { apiKey: SECRET, apiUrl: `${upstreamOrigin}/v1`, dataDir, soulPath, ...options };
  let server;
  const result = {
    root, dataDir, soulPath, requests, upstreamOrigin,
    async restart() {
      if (server) await close(server);
      server = createServer(await createApp(settings));
      result.origin = await listen(server);
    },
    request(path, options = {}) {
      return fetch(`${result.origin}${path}`, {
        ...options, signal: options.signal || AbortSignal.timeout(8000),
        headers: { Origin: result.origin, ...options.headers },
      });
    },
    chat(body = {}, options = {}) {
      return result.request("/api/chat", {
        method: "POST", ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
        body: JSON.stringify({ message: "Hello", conversationId: ID, attachments: [], ...body }),
      });
    },
    upload(name, body, headers = {}) {
      return result.request("/api/attachments", {
        method: "POST", body,
        headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(name), ...headers },
      });
    },
  };
  t.after(async () => {
    if (server) await close(server);
    await close(upstream);
    await rm(root, { recursive: true, force: true });
  });
  await result.restart();
  return result;
}

function rawRequest(origin, path, headers = {}, method = "GET", body = "") {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: url.port, path, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (data) => { text += data; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function uploaded(response) {
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

function localPaths(content) {
  const text = typeof content === "string" ? content : content[0].text;
  return [...text.matchAll(/Local file path: (.+)\n/g)].map((match) => JSON.parse(match[1]));
}

function pdfBuffer(text) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("stable Hermes sessions send a fresh SOUL and only the latest user on every turn", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  assert.equal(await (await f.chat({ message: "First turn", conversationId: ID.toUpperCase(), messages: [{ role: "system", content: "untrusted override" }] })).text(), completion);
  await writeFile(f.soulPath, "Changed WALL-G personality.");
  assert.equal(await (await f.chat({ message: "Second turn" })).text(), completion);
  await unlink(f.soulPath);
  await (await f.chat({ conversationId: randomUUID() })).text();
  assert.equal(f.requests.length, 3);
  for (const request of f.requests) {
    assert.equal(request.path, "/v1/chat/completions");
    assert.equal(request.headers.authorization, `Bearer ${SECRET}`);
    assert.equal(request.body.model, "hermes-agent");
    assert.equal(request.body.stream, true);
    assert.equal(request.body.messages.length, 2);
    assert.deepEqual(request.body.messages.map((item) => item.role), ["system", "user"]);
  }
  assert.equal(f.requests[0].headers["x-hermes-session-id"], `wall-g-${ID}`);
  assert.equal(f.requests[1].headers["x-hermes-session-id"], `wall-g-${ID}`);
  assert.notEqual(f.requests[2].headers["x-hermes-session-id"], `wall-g-${ID}`);
  assert.equal(f.requests[0].body.messages[0].content, "Test WALL-G personality, first version.");
  assert.deepEqual(f.requests[1].body.messages, [
    { role: "system", content: "Changed WALL-G personality." }, { role: "user", content: "Second turn" },
  ]);
  assert.match(f.requests[2].body.messages[0].content, /WALL-G/);
});

test("SSE is progressive and preserves native named events, UTF-8, finish and DONE", { timeout: 10_000 }, async (t) => {
  const proceed = deferred();
  t.after(() => proceed.resolve());
  const tool = 'event: hermes.tool.progress\r\nid: step-1\r\ndata: {"tool":"read_file","message":"working"}\r\n\r\n';
  const unicode = chunk("caf\u00e9 \ud83d\udca1");
  const f = await fixture(t, async (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(chunk("First token"));
    await proceed.promise;
    const rest = Buffer.from(tool + ": keepalive\n\n" + unicode + chunk("", "stop") + DONE);
    for (let i = 0; i < rest.length; i += 7) {
      res.write(rest.subarray(i, i + 7));
      await new Promise((resolve) => setImmediate(resolve));
    }
    res.end();
  });
  const response = await f.chat();
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  assert.match(response.headers.get("cache-control"), /no-transform/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = decoder.decode((await reader.read()).value, { stream: true });
  assert.equal(received, chunk("First token"), "The first token arrives while the mock is still waiting.");
  proceed.resolve();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  received += decoder.decode();
  assert.equal(received, chunk("First token") + tool + ": keepalive\n\n" + unicode + chunk("", "stop") + DONE);
});

test("disconnect aborts the upstream stream rather than leaving Hermes running", { timeout: 10_000 }, async (t) => {
  let upstreamResponse;
  const f = await fixture(t, (_req, res) => {
    upstreamResponse = res;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(chunk("Started"));
  });
  const controller = new AbortController();
  const response = await f.chat({}, { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  const closed = once(upstreamResponse, "close", { signal: AbortSignal.timeout(3000) });
  controller.abort();
  await closed;
  assert.equal(f.requests.length, 1);
});

test("truncated Hermes replies keep the length finish reason without internal error details", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(chunk("A useful partial answer") + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }], error: { message: SECRET }, hermes: { error: SECRET } })}\n\n` + DONE);
  });
  const text = await (await f.chat()).text();
  assert.match(text, /A useful partial answer/);
  assert.match(text, /"finish_reason":"length"/);
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes('"error"'));
  assert.ok(text.endsWith(DONE));
});

test("disconnect also aborts Hermes while waiting for its response headers", { timeout: 10_000 }, async (t) => {
  const connected = deferred();
  const f = await fixture(t, (_req, res) => { connected.resolve(res); });
  const controller = new AbortController();
  const pending = f.chat({}, { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  const upstreamResponse = await connected.promise;
  const closed = once(upstreamResponse, "close", { signal: AbortSignal.timeout(3000) });
  controller.abort();
  await rejected;
  await closed;
  assert.equal(f.requests.length, 1);
});

test("pre-stream HTTP failures are safe JSON and never retried", { timeout: 10_000 }, async (t) => {
  for (const [status, expected, code] of [[401, 502, "hermes_auth"], [403, 502, "hermes_auth"], [429, 503, "hermes_busy"], [503, 502, "hermes_unavailable"]]) {
    await t.test(String(status), async (t) => {
      const f = await fixture(t, (_req, res) => { res.writeHead(status); res.end(`Error includes ${SECRET}`); });
      const response = await f.chat();
      assert.equal(response.status, expected);
      const body = await response.json();
      assert.equal(body.error.code, code);
      assert.ok(!JSON.stringify(body).includes(SECRET));
      assert.equal(f.requests.length, 1);
    });
  }
});

test("native error frames are sanitized and terminate with DONE", { timeout: 10_000 }, async (t) => {
  for (const errorFrame of [`event: error\ndata: ${JSON.stringify({ message: SECRET })}\n\n`, `data: ${JSON.stringify({ error: { message: SECRET } })}\n\n`]) {
    await t.test(errorFrame.startsWith("event") ? "named" : "OpenAI error", async (t) => {
      const f = await fixture(t, (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(chunk("Partial") + errorFrame + DONE);
      });
      const text = await (await f.chat()).text();
      assert.ok(text.startsWith(chunk("Partial")));
      assert.match(text, /event: error\ndata: .*hermes_error/);
      assert.ok(text.endsWith(DONE));
      assert.equal(text.split(DONE).length, 2);
      assert.ok(!text.includes(SECRET));
    });
  }
});

test("unexpected EOF and invalid streaming content give clear errors", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, (_req, res, record) => {
    if (record.body.messages[1].content === "wrong type") { res.end(SECRET); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(chunk("Partial") + "data: unfinished");
  });
  const text = await (await f.chat()).text();
  assert.match(text, /stream_interrupted/);
  assert.ok(text.endsWith(DONE));
  assert.ok(!text.includes("data: unfinished"));
  const response = await f.chat({ message: "wrong type" });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "invalid_stream");
});

test("the bounded timeout works before and after streaming starts", { timeout: 10_000 }, async (t) => {
  for (const streaming of [false, true]) {
    await t.test(streaming ? "after headers" : "before headers", async (t) => {
      const closed = deferred();
      const f = await fixture(t, (_req, res) => {
        res.once("close", closed.resolve);
        if (streaming) { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(chunk("Partial")); }
      }, { chatTimeoutMs: 150 });
      const response = await f.chat();
      assert.equal(response.status, streaming ? 200 : 504);
      const text = await response.text();
      assert.match(text, /hermes_timeout/);
      if (streaming) assert.ok(text.endsWith(DONE));
      await closed.promise;
      assert.equal(f.requests.length, 1);
    });
  }
});

test("redirects cannot send credentials or messages to another upstream", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(307, { Location: "/stolen" }); res.end();
  });
  const response = await f.chat();
  assert.equal(response.status, 502);
  assert.equal(f.requests.length, 1);
  await response.text();
});

test("chat validates message size, UUIDs, attachment IDs, and empty requests", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  for (const body of [
    { message: null }, { message: 42 }, { message: "x".repeat(32_001) },
    { message: "   " }, { conversationId: "wall-g-not-a-uuid" }, { conversationId: undefined },
    { attachments: null }, { attachments: "file.txt" }, { attachments: [{ path: "/etc/passwd" }] },
    { attachments: ["https://example.com/image.png"] }, { attachments: ["../../.env"] },
    { attachments: Array.from({ length: 9 }, () => randomUUID()) }, { attachments: [ID, ID] },
  ]) {
    const response = await f.chat(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 150));
    assert.ok((await response.json()).error.message);
  }
  assert.equal(f.requests.length, 0);
  assert.equal((await f.chat({ message: "x".repeat(32_000) })).status, 200);
  const response = await f.request("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(response.status, 400);
  await response.text();
  const huge = await f.chat({ extra: "x".repeat(300_000) });
  assert.equal(huge.status, 413);
  await huge.text();
});

test("loopback Host and exact same Origin are enforced for API and assets", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const host = new URL(f.origin).host;
  const port = new URL(f.origin).port;
  for (const headers of [
    { Host: "attacker.example" }, { Host: "127.0.0.1.attacker.example" },
    { Host: "localhost@attacker.example" }, { Host: "localhost:99999" },
    { Origin: "https://attacker.example" }, { Origin: "null" },
    { Origin: `http://localhost:${port}` }, { Origin: `http://${host}/` },
    { Origin: "http://127.0.0.1:1" }, { Origin: `https://${host}` },
    { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" },
  ]) {
    const response = await rawRequest(f.origin, "/api/health", { Host: host, ...headers });
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  }
  const noOrigin = await rawRequest(f.origin, "/api/chat", { Host: host, "Content-Type": "application/json" }, "POST", "{}");
  assert.equal(noOrigin.status, 403);
  const assets = await rawRequest(f.origin, "/", { Host: `localhost:${port}`, "Sec-Fetch-Site": "none" });
  assert.equal(assets.status, 200);
  const denied = await rawRequest(f.origin, "/", { Host: host, "Sec-Fetch-Site": "cross-site" });
  assert.equal(denied.status, 403);
  assert.equal(f.requests.length, 0);
});

test("health reports reachability, never claims authentication", { timeout: 10_000 }, async (t) => {
  let up = true;
  const f = await fixture(t, (_req, res) => { res.writeHead(up ? 200 : 503); res.end("health"); });
  assert.deepEqual(await (await f.request("/api/health")).json(), { hermes: "up" });
  up = false;
  assert.deepEqual(await (await f.request("/api/health")).json(), { hermes: "down" });
  assert.equal(f.requests[0].path, "/health");
  assert.equal(f.requests[0].headers.authorization, undefined);
});

test("text uploads persist privately, enter chat as local context, and survive restart", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const text = "A local checklist, with caf\u00e9 notes.";
  const file = await uploaded(await f.upload("notes \u00e9.md", text));
  assert.deepEqual(Object.keys(file).sort(), ["id", "kind", "name", "size", "type", "url"]);
  assert.equal(file.name, "notes \u00e9.md");
  assert.equal(file.kind, "document");
  assert.equal(file.size, Buffer.byteLength(text));
  assert.equal(file.type, "text/markdown");
  assert.equal(file.url, `/api/attachments/${file.id}`);
  const folder = join(f.dataDir, "uploads", file.id);
  assert.deepEqual((await readdir(folder)).sort(), ["metadata.json", "source.md"]);
  assert.equal((await stat(folder)).mode & 0o777, 0o700);
  assert.equal((await stat(join(folder, "source.md"))).mode & 0o777, 0o600);
  const download = await f.request(file.url);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal(await download.text(), text);
  await (await f.chat({ message: "", attachments: [file.id] })).text();
  const content = f.requests[0].body.messages[1].content;
  assert.ok(content.includes(text));
  assert.deepEqual(localPaths(content), [join(folder, "source.md")]);
  await f.restart();
  assert.equal(await (await f.request(file.url)).text(), text);
  const deletion = await f.request(file.url, { method: "DELETE" });
  assert.equal(deletion.status, 409);
  assert.equal((await deletion.json()).error.code, "attachment_in_use");
  assert.equal(await readFile(join(folder, "source.md"), "utf8"), text);
});

test("only staged files can be deleted; stale IDs have actionable errors", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const file = await uploaded(await f.upload("staged.txt", "Remove me before sending"));
  await f.restart();
  assert.equal((await f.request(file.url, { method: "DELETE" })).status, 204);
  const missing = await f.request(file.url);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error.message, /upload it again/);
  const chat = await f.chat({ message: "", attachments: [file.id] });
  assert.equal(chat.status, 404);
  assert.equal((await chat.json()).error.code, "attachment_missing");
  assert.deepEqual(await readdir(join(f.dataDir, "uploads")), []);
  assert.equal(f.requests.length, 0);
});

test("uploads reject traversal, unsupported files, binary-as-text and oversized bodies", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  for (const [name, data, status, headers] of [
    ["../secret.txt", "secret", 400], ["folder\\file.txt", "secret", 400], ["bad\r\nname.txt", "secret", 400],
    ["valid.txt", "secret", 400, { "X-Filename": "%not-encoded" }],
    ["a".repeat(241) + ".txt", "secret", 400], ["blank.txt", "", 400],
    ["program.exe", "executable", 415], ["vector.svg", "<svg/>", 415],
    ["binary.txt", Buffer.from([0xff, 0xfe, 0]), 422], ["nul.txt", "a\u0000b", 422],
    ["fake.txt", "%PDF-1.4\n%%EOF", 422], ["fake.png", "not an image", 422],
    ["fake.pdf", "not a PDF", 422],
    ["big.txt", Buffer.alloc(10 * 1024 * 1024 + 1, 97), 413],
    ["big.png", Buffer.alloc(4 * 1024 * 1024 + 1), 413],
    ["bad.txt", "text", 415, { "Content-Type": "multipart/form-data" }],
    ["bad.txt", "text", 415, { "Content-Encoding": "gzip" }],
  ]) {
    const response = await f.upload(name, data, headers);
    assert.equal(response.status, status, name);
    const body = await response.json();
    assert.ok(body.error.message);
    assert.ok(!JSON.stringify(body).includes(f.root));
  }
  const missingName = await f.request("/api/attachments", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "test" });
  assert.equal(missingName.status, 400);
  await missingName.text();
  assert.deepEqual(await readdir(join(f.dataDir, "uploads")), []);
});

test("text context has one global 48000-character budget while retaining every local path", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const files = [];
  for (let i = 0; i < 8; i++) files.push(await uploaded(await f.upload(`part-${i}.txt`, String(i).repeat(60_000))));
  await (await f.chat({ message: "Review", attachments: files.map((file) => file.id) })).text();
  const content = f.requests[0].body.messages[1].content;
  assert.ok(content.length <= "Review\n\n".length + 48_000);
  assert.equal(localPaths(content).length, 8);
  assert.ok(localPaths(content).every((path) => path.startsWith(join(f.dataDir, "uploads") + sep)));
  assert.match(content, /Text shortened/);
  await (await f.chat({ message: "m".repeat(32_000), attachments: files.map((file) => file.id) })).text();
  const longContent = f.requests[1].body.messages[1].content;
  assert.ok(longContent.length <= 65_000, "Long user messages leave room for attachment text within Hermes's per-part limit");
  assert.equal(localPaths(longContent).length, 8);
});

test("known metadata cannot serve changed files or symlinks", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const file = await uploaded(await f.upload("original.txt", "Original text"));
  const path = join(f.dataDir, "uploads", file.id, "source.txt");
  await writeFile(path, "Changed text");
  assert.equal((await f.request(file.url)).status, 404);
  await unlink(path);
  await symlink(f.soulPath, path);
  assert.equal((await f.request(file.url)).status, 404);
});

test("missing optional decoders give helpful errors without saving an upload", { timeout: 10_000, skip: hasPdf && sharp && "All decoders are installed." }, async (t) => {
  const f = await fixture(t);
  if (!hasPdf) {
    const response = await f.upload("local.pdf", pdfBuffer("Offline test"));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "pdf_support_missing");
  }
  if (!sharp) {
    const response = await f.upload("local.png", Buffer.from("89504e470d0a1a0a", "hex"));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "image_support_missing");
  }
  assert.deepEqual(await readdir(join(f.dataDir, "uploads")), []);
});

test("PDFs are locally extracted with pdf-parse v2 and kept as downloadable originals", { timeout: 20_000, skip: !hasPdf && "Install pdf-parse v2 to run PDF decoding tests." }, async (t) => {
  const f = await fixture(t);
  const data = pdfBuffer("Hello from a local PDF");
  const file = await uploaded(await f.upload("brief.pdf", data));
  assert.equal(file.type, "application/pdf");
  const download = await f.request(file.url);
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), data);
  await (await f.chat({ attachments: [file.id] })).text();
  assert.match(f.requests[0].body.messages[1].content, /Hello from a local PDF/);
  assert.equal(localPaths(f.requests[0].body.messages[1].content)[0], join(f.dataDir, "uploads", file.id, "source.pdf"));
  const invalid = await f.upload("corrupt.pdf", "%PDF-1.4\nthis is not a PDF object\n%%EOF\n");
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).error.code, "invalid_pdf");
});

test("validated PNG/JPEG/WebP/GIF originals are inline and become data URLs plus local paths", { timeout: 20_000, skip: !sharp && "Install sharp to run image decoding tests." }, async (t) => {
  const f = await fixture(t);
  for (const [format, type, extension] of [["png", "image/png", "png"], ["jpeg", "image/jpeg", "jpg"], ["webp", "image/webp", "webp"], ["gif", "image/gif", "gif"]]) {
    const data = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#90a070" } }).toFormat(format).toBuffer();
    const file = await uploaded(await f.upload(`photo.${extension}`, data));
    assert.equal(file.kind, "image");
    assert.equal(file.type, type);
    const response = await f.request(file.url);
    assert.equal(response.headers.get("content-type"), type);
    assert.match(response.headers.get("content-disposition"), /^inline;/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), data);
    await (await f.chat({ message: "What is this?", attachments: [file.id] })).text();
    const content = f.requests.at(-1).body.messages[1].content;
    assert.equal(content[0].type, "text");
    assert.equal(localPaths(content)[0], join(f.dataDir, "uploads", file.id, `source.${extension}`));
    assert.deepEqual(content[1], { type: "image_url", image_url: { url: `data:${type};base64,${data.toString("base64")}` } });
    const corrupt = await f.upload(`broken.${extension}`, data.subarray(0, 16));
    assert.equal(corrupt.status, 422);
    await corrupt.text();
  }
});

test("the final upstream JSON stays below 10 MB including base64 images", { timeout: 20_000, skip: !sharp && "Install sharp to run the image budget test." }, async (t) => {
  const f = await fixture(t);
  const data = await sharp(Buffer.alloc(1150 * 1150 * 3, 120), { raw: { width: 1150, height: 1150, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(data.length > 3_750_000 && data.length < 4 * 1024 * 1024);
  const first = await uploaded(await f.upload("first.png", data));
  const second = await uploaded(await f.upload("second.png", data));
  const response = await f.chat({ attachments: [first.id, second.id] });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "context_too_large");
  assert.equal(f.requests.length, 0);
  assert.equal((await f.request(first.url, { method: "DELETE" })).status, 204, "A rejected request does not retain staging files.");
});

test("static serving never exposes .env, uploads, server code, or unlisted node_modules", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  for (const path of ["/.env", "/server.js", "/node_modules/dotenv/package.json", "/.local/uploads/metadata.json", "/vendor/marked/..%2f..%2fdotenv/package.json", "/vendor/marked/%2e%2e%2f%2e%2e%2f%2e%2f.env"]) {
    const response = await rawRequest(f.origin, path);
    assert.ok([403, 404].includes(response.status), `${path}: ${response.status}`);
    assert.ok(!response.text.includes(SECRET));
  }
  const publicPage = await f.request("/");
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.headers.get("content-type"), /text\/html/);
  await publicPage.text();
});

test("quoted dotenv keys, Hermes home fallback, and WALL_G_DATA_DIR remain supported", { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wall-g-settings-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hermesHome = join(root, "test-hermes");
  await mkdir(hermesHome);
  await writeFile(join(root, ".env"), 'API_SERVER_KEY="project key # quoted"\nPORT=4567\nWALL_G_DATA_DIR="private uploads"\n');
  await writeFile(join(hermesHome, ".env"), "API_SERVER_KEY='hermes key # quoted'\n");
  const params = { rootDir: root, userHome: root, env: { HERMES_HOME: hermesHome } };
  const project = loadSettings(params);
  assert.equal(project.apiKey, "project key # quoted");
  assert.equal(project.port, 4567);
  assert.equal(project.dataDir, join(root, "private uploads"));
  assert.equal(loadSettings({ ...params, env: { ...params.env, API_SERVER_KEY: "environment" } }).apiKey, "environment");
  await writeFile(join(root, ".env"), "");
  assert.equal(loadSettings(params).apiKey, "hermes key # quoted");
  await unlink(join(hermesHome, ".env"));
  assert.throws(() => loadSettings(params), /No API_SERVER_KEY found/);
  await assert.rejects(createApp({ apiKey: SECRET, apiUrl: "https://remote.example/v1", dataDir: join(root, "data") }), /loopback/);
  await assert.rejects(createApp({ apiKey: "", dataDir: join(root, "data") }), /No API_SERVER_KEY/);
});
