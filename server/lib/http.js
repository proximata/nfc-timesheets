// HTTP plumbing: machine-readable errors, JSON responses, bounded body reader.
// Kept framework-free on purpose (decision-16): handlers stay portable to Hono/Edge later.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export const MAX_BODY_BYTES = 64 * 1024;

export class HttpError extends Error {
  /** @param headers extra response headers, e.g. `retry-after` on a 429. */
  constructor(status, code, detail, headers) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.headers = headers;
  }
}

/** Throw a client error. Never carries a stack trace to the wire. */
export function fail(status, code, detail, headers) {
  throw new HttpError(status, code, detail, headers);
}

/**
 * `extra` carries per-response headers (`set-cookie` on login/logout,
 * `retry-after` on a rate-limit rejection). `cache-control: no-store` is fixed:
 * a JSON body here may hold payroll data or a session, and must never be cached.
 */
export function sendJson(res, status, obj, extra) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    ...extra,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

/**
 * Stream a file from disk as the response body. Used by exactly one route today —
 * GET /app/download (the Android self-update path), where the payload is a multi-MB APK
 * and routing it through `sendJson` would mean buffering the whole thing into one Buffer
 * and JSON-quoting it for something that is already sitting on disk as raw bytes.
 *
 * `contentType` and `filename` are supplied by the CALLER, never sniffed from the file:
 * sniffing an attacker-writable directory's content type is how a served path becomes a
 * script. The caller's job is to have already resolved `absPath` against a trusted,
 * non-attacker-writable directory (see routes/release.js) — this function does no path
 * validation of its own, the same division of labour `sendJson` has with its callers.
 *
 * `cache-control: no-store`, matching `sendJson`: the manifest that names the current file
 * can change between two requests and a cached APK is a worker stuck on an old build.
 */
export async function sendFile(res, status, absPath, { contentType, filename } = {}, extra) {
  const info = await stat(absPath); // ENOENT propagates — the caller's job to 404 first
  res.writeHead(status, {
    ...extra,
    "content-type": contentType ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": "no-store",
    ...(filename ? { "content-disposition": `attachment; filename="${filename}"` } : {}),
  });
  await new Promise((resolve, reject) => {
    const stream = createReadStream(absPath);
    stream.on("error", reject);
    stream.pipe(res);
    res.on("finish", resolve);
  });
}

/**
 * Read + parse a JSON object body, bounded by `limit`.
 * Rejects with 413 before buffering more than the limit.
 */
export function readJson(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    // Stop reading, but leave the socket alive so the 413 response actually reaches the client.
    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > limit) {
      req.pause();
      reject(new HttpError(413, "body_too_large"));
      return;
    }

    let done = false;
    let size = 0;
    const chunks = [];

    const settle = (fn, value) => {
      if (done) return;
      done = true;
      fn(value);
    };

    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        req.pause();
        settle(reject, new HttpError(413, "body_too_large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (done) return;
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw === "") {
        settle(resolve, {});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        settle(reject, new HttpError(400, "bad_json"));
        return;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        settle(reject, new HttpError(400, "bad_json"));
        return;
      }
      settle(resolve, parsed);
    });

    req.on("error", () => settle(reject, new HttpError(400, "bad_request")));
  });
}
