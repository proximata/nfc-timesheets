// NFC TimeSheets API. One Node process serves REST, AASA/assetlinks/t and the static
// admin export (decision-16). Deps: pg only - no express, no ORM, no router.
import { createServer as createHttpServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireAdminSession, requireAppKey, requireWorkerSession } from "./lib/auth.js";
import { pool } from "./lib/db.js";
import { HttpError, readJson, sendJson } from "./lib/http.js";
import { adminRoutes } from "./routes/admin.js";
import { appRoutes } from "./routes/app.js";
import { authRoutes } from "./routes/auth.js";
import { wellknown } from "./routes/wellknown.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- config: env only, fail fast -------------------------------------------------
// ADMIN_PIN is deliberately absent (decision-20): admin credentials live in the
// `admins` table now, created with bin/create-admin.js. There is no admin secret in
// the environment to leak into a systemd unit file, a shell history or a log line.
const REQUIRED_ENV = ["DATABASE_URL", "APP_KEY", "PORT"];

export function assertEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter((k) => !env[k] || String(env[k]).trim() === "");
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Set them in the systemd EnvironmentFile (see server/README.md).",
    );
  }
}

// ---- routing ---------------------------------------------------------------------
// `auth` is one of:
//   null     - open (health, AASA)
//   "app"    - X-App-Key only. Sign-in itself, which cannot require a session yet.
//   "worker" - X-App-Key AND a ts_worker session (decision-22). Identity comes from
//              the session; handlers must never read a worker id from the request.
//   "admin"  - ts_session cookie (decision-20).
const routes = [
  { method: "GET", path: "/health", auth: null, handler: health },
  ...authRoutes,
  ...appRoutes,
  ...adminRoutes,
];

async function health() {
  await pool.query("SELECT 1");
  return { status: 200, body: { ok: true } };
}

/** Match "/shifts/:id/resolve" against a concrete pathname. Returns params or null. */
function matchPath(pattern, pathname) {
  const pat = pattern.split("/");
  const got = pathname.split("/");
  if (pat.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < pat.length; i++) {
    if (pat[i].startsWith(":")) {
      if (got[i] === "") return null;
      params[pat[i].slice(1)] = decodeURIComponent(got[i]);
    } else if (pat[i] !== got[i]) {
      return null;
    }
  }
  return params;
}

function findRoute(method, pathname) {
  let pathExists = false;
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (!params) continue;
    pathExists = true;
    if (route.method === method) return { route, params };
  }
  return pathExists ? { methodMismatch: true } : null;
}

// ---- static (admin export, AASA, /t landing) --------------------------------------
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR ?? path.join(HERE, "public"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// AASA / assetlinks / /t are owned by routes/wellknown.js and mounted before everything else.

async function resolveStatic(pathname) {
  const candidates =
    pathname.endsWith("/") ? [`${pathname}index.html`] : [pathname, `${pathname}.html`, `${pathname}/index.html`];

  for (const candidate of candidates) {
    const abs = path.resolve(PUBLIC_DIR, `.${path.posix.normalize(candidate)}`);
    if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + path.sep)) continue; // traversal guard
    try {
      const info = await stat(abs);
      if (info.isFile()) return { abs, size: info.size };
    } catch {
      // next candidate
    }
  }
  return null;
}

async function serveStatic(req, res, pathname) {
  const found = await resolveStatic(pathname === "/" ? "/index.html" : pathname);
  if (!found) return false;

  const type = MIME[path.extname(found.abs).toLowerCase()] ?? "application/octet-stream";

  res.writeHead(200, {
    "content-type": type,
    "content-length": found.size,
    "cache-control": pathname.startsWith("/_next/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(found.abs).pipe(res);
  return true;
}

// ---- dispatch --------------------------------------------------------------------
async function handle(req, res) {
  // Association files first, before any auth: iOS accepts no redirect and no 401 here (decision-4).
  if (wellknown(req, res)) return;

  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  const hit = findRoute(req.method, pathname);

  // A GET/HEAD on a path the API only answers for another verb is the admin panel asking
  // for its page, not a protocol error: `POST /shifts/close` (iOS) and `/shifts/` (the
  // admin screen) share a prefix. Try the static export before answering 405.
  if (!hit || hit.methodMismatch) {
    if ((req.method === "GET" || req.method === "HEAD") && (await serveStatic(req, res, pathname))) return;
    if (hit) sendJson(res, 405, { error: "method_not_allowed" });
    else sendJson(res, 404, { error: "not_found" });
    return;
  }

  const { route, params } = hit;
  // The app key gates both app-key-only and worker routes: it stays a coarse "this is
  // our build" check in front of the session, never a substitute for one.
  if (route.auth === "app" || route.auth === "worker") requireAppKey(req.headers);
  const session =
    route.auth === "admin" ? await requireAdminSession(req.headers)
    : route.auth === "worker" ? await requireWorkerSession(req.headers)
    : null;

  const body = route.method === "GET" || route.method === "DELETE" ? {} : await readJson(req);
  const result = await route.handler({
    params,
    query: url.searchParams,
    body,
    headers: req.headers,
    session,
    ip: clientIp(req),
  });
  sendJson(res, result.status, result.body, result.headers);
}

/**
 * Caller address, for the login rate limit only.
 *
 * We sit behind exactly one reverse proxy (exe.dev terminates TLS, decision-16), so
 * the RIGHTMOST X-Forwarded-For entry is the one that proxy appended and is the real
 * peer. Anything the client injected itself lands to the LEFT of it and is ignored —
 * taking the leftmost value, which is the common example, would let an attacker reset
 * their own rate-limit bucket on every request by making the header up.
 *
 * ponytail: hardcodes "one trusted hop". CEILING: put a second proxy or a CDN in
 * front and this silently starts bucketing every caller under that proxy's address.
 * UPGRADE PATH: a TRUSTED_PROXY_HOPS env var read here.
 */
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim() !== "") {
    const hops = xff.split(",");
    return hops[hops.length - 1].trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}

export function createServer() {
  return createHttpServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        // An over-sized body is still in flight: close the connection after answering.
        if (err.status === 413) res.setHeader("connection", "close");
        // Machine-readable code only. `detail` is a field name, never a value.
        sendJson(
          res,
          err.status,
          err.detail ? { error: err.code, field: err.detail } : { error: err.code },
          err.headers,
        );
        return;
      }
      // Log server-side, never leak internals (or secrets) to the client.
      console.error(`[500] ${req.method} ${req.url}:`, err?.message ?? err);
      sendJson(res, 500, { error: "internal_error" });
    });
  });
}

// ---- boot ------------------------------------------------------------------------
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  assertEnv();
  const server = createServer();
  server.listen(Number(process.env.PORT), () => {
    console.log(`timesheets api listening on :${process.env.PORT} (static root ${PUBLIC_DIR})`);
  });

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      server.close(() => pool.end().then(() => process.exit(0)));
    });
  }
}
