// NFC TimeSheets API. One Node process serves REST, AASA/assetlinks/t and the static
// admin export (decision-16). Deps: pg only - no express, no ORM, no router.
import { createServer as createHttpServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as Sentry from "@sentry/node";
import { requireAdminSession, requireAppKey, requireWorkerSession } from "./lib/auth.js";
import { pool } from "./lib/db.js";
import { HttpError, readJson, sendJson } from "./lib/http.js";
import { redactUrl } from "./lib/scrub.js";
import { adminRoutes } from "./routes/admin.js";
import { appRoutes } from "./routes/app.js";
import { authRoutes } from "./routes/auth.js";
import { portalRoutes } from "./routes/portal.js";
import { wellknown } from "./routes/wellknown.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- config: env only, fail fast -------------------------------------------------
// ADMIN_PIN is deliberately absent (decision-20): admin credentials live in the
// `admins` table now, created with bin/create-admin.js. There is no admin secret in
// the environment to leak into a systemd unit file, a shell history or a log line.
//
// SENTRY_DSN / SENTRY_ENVIRONMENT / SENTRY_RELEASE are deliberately NOT here either
// (decision-23). Telemetry is optional: the API must boot and serve with no Sentry
// credential at all, and it does — instrument.mjs disables the SDK when the DSN is unset.
// A required telemetry variable is an outage waiting for the day someone rotates it.
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
//
// portalRoutes is `auth: null` and is the only PUBLIC data route: the token in the URL is
// the credential (see routes/portal.js). It rate-limits itself and answers 404 for anything
// it does not recognise.
const routes = [
  { method: "GET", path: "/health", auth: null, handler: health },
  ...authRoutes,
  ...appRoutes,
  ...adminRoutes,
  ...portalRoutes,
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

// `status` exists for the 404 page below: the bytes are served the same way, but a miss must
// not answer 200 or a mistyped URL looks to a crawler (and to the browser's history) like a real
// page.
async function serveStatic(req, res, pathname, status = 200) {
  const found = await resolveStatic(pathname === "/" ? "/index.html" : pathname);
  if (!found) return false;

  const type = MIME[path.extname(found.abs).toLowerCase()] ?? "application/octet-stream";

  res.writeHead(status, {
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

// ---- access log ------------------------------------------------------------------
// decision-23. A real tag tap failed in production and this process had NOTHING to say
// about it: the only log line in the whole server was the 500 branch, so journalctl was
// empty and the diagnosis had to come from reading iOS source. One line per request fixes
// that, with no dependency on Sentry being configured — it is console.log, and systemd
// already routes stdout to journald, which already rotates.
//
//   [req] POST /shifts/open 201 34ms w=7
//   [req] POST /shifts/open 422 11ms w=7 err=unknown_location
//   [req] GET /nope 404 1ms
//
// EMISSION RULE — this is what keeps the log readable. Log iff the request FAILED, or it
// matched a route, or wellknown() answered it. A 200 for a static asset is silent: the
// admin panel is a Next.js export and `/_next/*` alone would bury every API line.
// A 404 for a missing asset still logs, because that is a real signal.
//
// PATH ONLY, redacted, never the query string (lib/scrub.js). `/portal/<token>` carries a
// live credential in the path itself. Never the app key, a cookie, an identity token or
// an email — the only identity that appears is `w=<worker id>`, which is meaningless
// outside our database.
function writeAccessLog(req, res, ctx, startedAt) {
  if (res.statusCode < 400 && !ctx.loggable) return;
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const parts = [`[req] ${req.method} ${redactUrl(req.url)} ${res.statusCode} ${ms.toFixed(0)}ms`];
  if (ctx.workerId !== null) parts.push(`w=${ctx.workerId}`);
  if (ctx.errorCode) parts.push(`err=${ctx.errorCode}`);
  console.log(parts.join(" "));
}

// ---- dispatch --------------------------------------------------------------------
async function handle(req, res, ctx) {
  // Association files first, before any auth: iOS accepts no redirect and no 401 here (decision-4).
  if (wellknown(req, res)) {
    ctx.loggable = true;
    return;
  }

  // A request line like `//` parses as a protocol-relative URL with an empty host and
  // THROWS, which reached the top-level handler as a 500. Scanners probe `//` constantly,
  // so that was a steady drip of 500s hiding real ones in the log. Malformed input from the
  // network is a client error, not a server fault.
  let url;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    return sendJson(res, 400, { error: "bad_request" });
  }
  const pathname = url.pathname;
  const hit = findRoute(req.method, pathname);

  // A GET/HEAD on a path the API only answers for another verb is the admin panel asking
  // for its page, not a protocol error: `POST /shifts/close` (iOS) and `/shifts/` (the
  // admin screen) share a prefix. Try the static export before answering 405.
  if (!hit || hit.methodMismatch) {
    const readOnly = req.method === "GET" || req.method === "HEAD";
    if (readOnly && (await serveStatic(req, res, pathname))) return;
    if (hit) {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    // A human who mistyped a URL gets the German 404 page; an API client gets JSON. Split on
    // Accept because the two audiences want different things from the same miss: browsers send
    // `text/html,...`, while URLSession and curl send `*/*` and would choke on a page. Without
    // this the director's typo answered a raw {"error":"not_found"}.
    const wantsHtml = (req.headers.accept ?? "").includes("text/html");
    if (readOnly && wantsHtml && (await serveStatic(req, res, "/404.html", 404))) return;

    sendJson(res, 404, { error: "not_found" });
    return;
  }

  const { route, params } = hit;
  ctx.loggable = true;

  // Group transactions by ROUTE PATTERN, not by concrete id: without this every
  // `POST /shifts/1234/resolve` is its own transaction and the Sentry view is unusable.
  // No-op when the SDK is disabled — there is no active span to rename.
  const active = Sentry.getActiveSpan();
  if (active) Sentry.updateSpanName(Sentry.getRootSpan(active), `${req.method} ${route.path}`);

  // The app key gates both app-key-only and worker routes: it stays a coarse "this is
  // our build" check in front of the session, never a substitute for one.
  if (route.auth === "app" || route.auth === "worker") requireAppKey(req.headers);
  const session =
    route.auth === "admin" ? await requireAdminSession(req.headers)
    : route.auth === "worker" ? await requireWorkerSession(req.headers)
    : null;

  // ID ONLY, and only for workers. Never the name, never the email, never the admin's
  // address — `setUser` writes to the isolation scope, which is forked per request above,
  // so this cannot bleed into another caller's events.
  if (session?.workerId !== undefined) {
    ctx.workerId = session.workerId;
    Sentry.setUser({ id: String(session.workerId) });
  }

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
    const startedAt = process.hrtime.bigint();
    const ctx = { loggable: false, workerId: null, errorCode: null };
    // `finish` and not `close`: a response that was actually written gets exactly one
    // line. ponytail: a client that hangs up mid-response leaves no line. CEILING: an
    // aborted upload is invisible here. UPGRADE PATH: also listen for `close` and
    // de-duplicate on a flag.
    res.on("finish", () => writeAccessLog(req, res, ctx, startedAt));

    // One isolation scope per request, so tags, the user and breadcrumbs set by one
    // caller cannot leak into a concurrent one. No-op with the SDK disabled.
    Sentry.withIsolationScope(() =>
      handle(req, res, ctx).catch((err) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (err instanceof HttpError) {
          ctx.errorCode = err.code;
          // An over-sized body is still in flight: close the connection after answering.
          if (err.status === 413) res.setHeader("connection", "close");
          // Machine-readable code only. `detail` is a field name, never a value.
          // NOT captured to Sentry: a 4xx is control flow — an unknown location, a bad
          // token, an expired session. Capturing them would bury the real faults.
          sendJson(
            res,
            err.status,
            err.detail ? { error: err.code, field: err.detail } : { error: err.code },
            err.headers,
          );
          return;
        }
        // This handler CATCHES and answers 500, so the error never reaches Sentry's
        // uncaughtException hook. Capture explicitly or it is invisible — "if you catch
        // an error and don't re-throw it, Sentry never sees it".
        ctx.errorCode = "internal_error";
        Sentry.captureException(err, { tags: { method: req.method } });
        // Log server-side too, never leak internals (or secrets) to the client. This line
        // has to survive with no DSN, because that is the state the API ships in.
        // A client-portal path carries a live credential (routes/portal.js), so it goes
        // through redactUrl: a token in a journald ring buffer is a token that has leaked.
        console.error(`[500] ${req.method} ${redactUrl(req.url)}:`, err?.message ?? err);
        sendJson(res, 500, { error: "internal_error" });
      }),
    );
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
      // Flush before exit or the last events — typically the ones explaining why the
      // process is going down — are lost. Returns immediately when the SDK is disabled;
      // systemd's default TimeoutStopSec (90s) leaves ample room for the 2s ceiling.
      server.close(() =>
        Sentry.close(2000)
          .catch(() => {})
          .then(() => pool.end())
          .then(() => process.exit(0)),
      );
    });
  }
}
