// HTTP plumbing: machine-readable errors, JSON responses, bounded body reader.
// Kept framework-free on purpose (decision-16): handlers stay portable to Hono/Edge later.

export const MAX_BODY_BYTES = 64 * 1024;

// A webhook signature (routes/webhooks.js) has to be verified against the EXACT bytes
// Apple sent, not JSON.stringify(JSON.parse(raw)) - key order/whitespace are not guaranteed
// to round-trip. A Symbol keeps this invisible to every other handler: it never appears in
// Object.keys, a spread, or JSON.stringify, so `body` behaves exactly as before everywhere
// except the one route that explicitly imports this symbol to read it back.
export const RAW_BODY = Symbol("rawBody");

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
      Object.defineProperty(parsed, RAW_BODY, { value: raw, enumerable: false });
      settle(resolve, parsed);
    });

    req.on("error", () => settle(reject, new HttpError(400, "bad_request")));
  });
}
