import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CONTEXT_CHARS = 48_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEXT_EXTENSIONS = new Set((
  ".txt .text .md .markdown .csv .tsv .json .jsonl .log .yaml .yml .toml .ini .xml .html .css .scss " +
  ".js .mjs .cjs .jsx .ts .tsx .py .rb .go .rs .java .c .h .cpp .hpp .cs .sh .bash .zsh .sql .r " +
  ".tex .rst .ipynb .svelte .vue .swift .kt .conf .cfg"
).split(" "));
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function attachmentId(value, message = "Each attachment must have a valid UUID ID, not a path or URL.") {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError(400, "invalid_id", message);
  return value.toLowerCase();
}

function fileName(value) {
  if (typeof value !== "string" || !value.trim() || value === "." || value === ".." ||
      Buffer.byteLength(value) > 240 || /[/\\\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new ApiError(400, "invalid_filename", "Choose a file with a simple name of at most 240 UTF-8 bytes, without path separators.");
  }
  return value;
}

function fileType(name) {
  const extension = extname(name).toLowerCase() || (/^(readme|license|dockerfile|makefile)$/i.test(name) ? ".txt" : "");
  if (IMAGE_TYPES[extension]) return { extension, kind: "image", type: IMAGE_TYPES[extension] };
  if (extension === ".pdf") return { extension, kind: "document", type: "application/pdf" };
  if (TEXT_EXTENSIONS.has(extension)) {
    const type = ({ ".md": "text/markdown", ".markdown": "text/markdown", ".csv": "text/csv", ".json": "application/json" })[extension] || "text/plain";
    return { extension, kind: "document", type };
  }
  throw new ApiError(415, "unsupported_file", "Use a text/code file, PDF, PNG, JPEG, WebP or GIF. Other binary files and SVG are not supported.");
}

function imageMagic(data) {
  if (data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

async function validateImage(data, type) {
  if (data.length > MAX_IMAGE_BYTES) throw new ApiError(413, "image_too_large", "Images may be at most 4 MiB each.");
  if (imageMagic(data) !== type) throw new ApiError(422, "invalid_image", "The image contents do not match its filename. Export a PNG, JPEG, WebP or GIF and try again.");
  let sharp;
  try { ({ default: sharp } = await import("sharp")); } catch {
    throw new ApiError(503, "image_support_missing", "Image support needs the sharp package installed on this server.");
  }
  const image = sharp(data, { failOn: "warning", limitInputPixels: 40_000_000, animated: true });
  try {
    await image.stats(); // Decode pixels too: a valid header alone does not make a valid image.
  } catch {
    throw new ApiError(422, "invalid_image", "This image is corrupt or exceeds 40 million decoded pixels (including animation frames). Export a smaller image and try again.");
  } finally { image.destroy(); }
}

// A malformed PDF cannot tie up the chat server's event loop indefinitely.
async function extractPdf(data) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { pdf: new Uint8Array(data) }, resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  let timer;
  try {
    return await new Promise((resolveResult, reject) => {
      timer = setTimeout(() => reject(new ApiError(422, "pdf_timeout", "This PDF took too long to read. Export a smaller PDF or attach its text instead.")), 30_000);
      worker.once("message", (result) => {
        if (result.error === "missing_dependency") reject(new ApiError(503, "pdf_support_missing", "PDF support needs pdf-parse v2 installed on this server."));
        else if (result.error) reject(new ApiError(422, "invalid_pdf", "This PDF is corrupt, password-protected, or unreadable. Export an unlocked PDF and try again."));
        else resolveResult(result);
      });
      worker.once("error", () => reject(new ApiError(422, "invalid_pdf", "This PDF could not be read. Export a smaller, unlocked PDF and try again.")));
      worker.once("exit", (code) => {
        if (code !== 0) reject(new ApiError(422, "invalid_pdf", "This PDF exceeded the local reader's limits. Export a smaller PDF and try again."));
      });
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}

async function privateRead(path, maxBytes) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error("invalid_stored_file");
    return await file.readFile();
  } finally { await file.close(); }
}

export function publicAttachment(file) {
  return { id: file.id, name: file.name, size: file.size, type: file.type, kind: file.kind, url: `/api/attachments/${file.id}` };
}

export class AttachmentStore {
  constructor(dataDir) {
    this.root = join(resolve(dataDir), "uploads");
    this.ready = mkdir(this.root, { recursive: true, mode: 0o700 }).then(async () => { this.root = await realpath(this.root); });
    this.changes = Promise.resolve();
  }

  mutate(operation) {
    const result = this.changes.then(operation);
    this.changes = result.catch(() => {});
    return result;
  }

  async create(encodedName, data) {
    let name;
    try { name = decodeURIComponent(encodedName); } catch { throw new ApiError(400, "invalid_filename", "X-Filename must contain an encodeURIComponent-encoded filename."); }
    if (typeof encodedName !== "string") throw new ApiError(400, "invalid_filename", "Send the encoded filename in X-Filename.");
    name = fileName(name);
    const description = fileType(name);
    if (!Buffer.isBuffer(data) || !data.length) throw new ApiError(400, "empty_file", "This file is empty. Choose a file with content.");
    if (data.length > MAX_FILE_BYTES) throw new ApiError(413, "file_too_large", "Files may be at most 10 MiB each.");
    let text = "";
    let truncated = false;
    if (description.kind === "image") await validateImage(data, description.type);
    else if (description.extension === ".pdf") {
      if (!data.subarray(0, 8).toString("ascii").startsWith("%PDF-") || !data.subarray(-1024).includes(Buffer.from("%%EOF"))) {
        throw new ApiError(422, "invalid_pdf", "This file is not a complete PDF. Export it again and retry.");
      }
      ({ text, truncated } = await extractPdf(data));
    } else {
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch {
        throw new ApiError(422, "invalid_text", "Text files must use UTF-8. This file contains binary data or another encoding.");
      }
      if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/u.test(text) || imageMagic(data) || text.startsWith("%PDF-")) {
        throw new ApiError(422, "invalid_text", "This file contains binary data, not plain text. Use its original supported file type.");
      }
      truncated = text.length > MAX_CONTEXT_CHARS;
      text = text.slice(0, MAX_CONTEXT_CHARS);
    }
    await this.ready;
    const id = randomUUID();
    const folder = join(this.root, id);
    const record = { version: 1, id, name, size: data.length, ...description, text, truncated, used: false, sha256: createHash("sha256").update(data).digest("hex") };
    await mkdir(folder, { mode: 0o700 });
    try {
      await writeFile(join(folder, `source${record.extension}`), data, { flag: "wx", mode: 0o600 });
      await writeFile(join(folder, "metadata.json"), JSON.stringify(record), { flag: "wx", mode: 0o600 });
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
    return record;
  }

  async get(id) {
    attachmentId(id);
    await this.ready;
    try {
      const folder = join(this.root, id);
      if (await realpath(folder) !== folder) throw new Error("invalid_folder");
      const record = JSON.parse(await privateRead(join(folder, "metadata.json"), 400_000));
      const description = fileType(fileName(record.name));
      if (record.version !== 1 || record.id !== id || record.extension !== description.extension ||
          record.kind !== description.kind || record.type !== description.type ||
          typeof record.used !== "boolean" || typeof record.truncated !== "boolean" ||
          typeof record.text !== "string" || record.text.length > MAX_CONTEXT_CHARS ||
          !Number.isInteger(record.size) || record.size < 1 || record.size > MAX_FILE_BYTES) throw new Error("invalid_metadata");
      const path = join(folder, `source${description.extension}`);
      const data = await privateRead(path, description.kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES);
      if (data.length !== record.size || createHash("sha256").update(data).digest("hex") !== record.sha256) throw new Error("changed_file");
      return { ...record, path, data };
    } catch {
      throw new ApiError(404, "attachment_missing", "An attached file is missing or changed on disk. Remove it from the message and upload it again.");
    }
  }

  async retain(ids) {
    return this.mutate(async () => {
      for (const id of ids) {
        const { path: _path, data: _data, ...record } = await this.get(id);
        if (record.used) continue;
        record.used = true;
        const folder = join(this.root, id);
        await writeFile(join(folder, "metadata.next"), JSON.stringify(record), { mode: 0o600 });
        await rename(join(folder, "metadata.next"), join(folder, "metadata.json"));
      }
    });
  }

  async remove(id) {
    return this.mutate(async () => {
      const record = await this.get(id);
      if (record.used) throw new ApiError(409, "attachment_in_use", "This file has been submitted to chat and is kept for history and Hermes tools. Only unsent uploads can be removed here.");
      await rm(join(this.root, id), { recursive: true });
    });
  }
}

if (!isMainThread && workerData?.pdf) {
  let parser;
  let result;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: workerData.pdf, verbosity: 0, isEvalSupported: false });
    const parsed = await parser.getText({ first: 100 });
    const text = parsed.pages.map((page) => page.text).join("\n\n").replace(/[\u0000-\u0008\u000b\u000e-\u001f]/gu, "");
    result = { text: text.slice(0, MAX_CONTEXT_CHARS), truncated: parsed.total > 100 || text.length > MAX_CONTEXT_CHARS };
  } catch (error) {
    result = { error: error.code === "ERR_MODULE_NOT_FOUND" ? "missing_dependency" : "invalid_pdf" };
  } finally { if (parser) await parser.destroy().catch(() => {}); }
  parentPort.postMessage(result);
}
