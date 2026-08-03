// Runnable self-check for the API. assert-based, no test framework.
//   node check-api.js
// Skips cleanly (exit 0) when no database is reachable, so it is safe in any environment.
// Runs against a throwaway Postgres schema; it never touches the real tables.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as rsaSign } from "node:crypto";
import pg from "pg";
import { redactUrl, scrubBreadcrumb, scrubEvent, scrubLogAttributes } from "./lib/scrub.js";

// sessions.token / worker_sessions.token store SHA-256(token), never the raw value, so a
// leaked dump cannot be replayed as a live session. Any test reaching into either table
// by token must hash first.
const hashToken = (token) => createHash("sha256").update(token, "utf8").digest("hex");

// ---- forged Apple identity tokens (decision-22) -----------------------------------
// A locally generated RSA key stands in for Apple's. The check NEVER calls
// appleid.apple.com: a self-check that needs the internet is a self-check that fails on
// a train, and one that depends on a third party's uptime reports their outage as our
// bug. lib/apple.js exposes setKeyFetcherForTest so the JWKS can be injected instead.
//
// The ATTACKER key is the point of the exercise. Forging a well-formed token with a key
// Apple never saw is exactly what an attacker does, and it is the one case where "the
// token parses" and "the token is genuine" come apart.
const APPLE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ATTACKER_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "check-apple-key-1";
const BUNDLE_ID = "io.github.qwadratic.NFCTimeSheets";
const APPLE_ISS = "https://appleid.apple.com";

const APPLE_JWK = { ...APPLE_KEY.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

const b64url = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");

/** Mint an identity token. Defaults are a VALID one; every option makes it invalid in one specific way. */
function forgeToken(claims = {}, { key = APPLE_KEY.privateKey, kid = KID, alg = "RS256" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg, kid, typ: "JWT" });
  const payload = b64url({ iss: APPLE_ISS, aud: BUNDLE_ID, iat: now, exp: now + 600, ...claims });
  const signature = rsaSign("RSA-SHA256", Buffer.from(`${header}.${payload}`, "ascii"), key);
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

const BASE_URL = process.env.DATABASE_URL ?? "postgres://localhost:5432/postgres";
const SCHEMA = `check_api_${process.pid}`;

// ponytail: DDL duplicated from the canonical schema, on purpose - the check must be
// runnable standalone. Ceiling: drift. Upgrade path: read db/schema.sql once it lands.
const DDL = `
CREATE TABLE workers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  hourly_rate_cents INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  apple_sub TEXT UNIQUE,
  email TEXT UNIQUE CHECK (email = lower(email)),
  phone TEXT
);
CREATE TABLE clients (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE contacts (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  email TEXT CHECK (email = lower(email)),
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contacts_client_id_idx ON contacts (client_id);
CREATE TABLE inventory_items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('product', 'equipment')),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE worker_sessions (
  token TEXT PRIMARY KEY,
  worker_id BIGINT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX worker_sessions_expires_at_idx ON worker_sessions (expires_at);
CREATE INDEX worker_sessions_worker_id_idx ON worker_sessions (worker_id);
CREATE TABLE admins (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id BIGINT REFERENCES clients(id),
  contact_id BIGINT REFERENCES contacts(id),
  monthly_contract_cents INTEGER CHECK (monthly_contract_cents >= 0),
  target_minutes_per_month INTEGER CHECK (target_minutes_per_month >= 0)
);
CREATE INDEX locations_client_id_idx ON locations (client_id);
CREATE TABLE portal_grants (
  token_hash TEXT PRIMARY KEY,
  contact_id BIGINT NOT NULL REFERENCES contacts(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX portal_grants_one_live_idx
  ON portal_grants (contact_id, location_id) WHERE revoked_at IS NULL;
CREATE TABLE shifts (
  id BIGSERIAL PRIMARY KEY,
  worker_id BIGINT NOT NULL REFERENCES workers(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  auto_closed BOOLEAN NOT NULL DEFAULT false,
  corrected_at TIMESTAMPTZ,
  client_uuid TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shifts_one_open_per_worker_idx ON shifts (worker_id) WHERE end_time IS NULL;
`;

const APP_KEY = "check-app-key-aaaaaaaaaaaa";
const ADMIN_EMAIL = "check-admin@example.test";
const ADMIN_PASSWORD = "correct horse battery staple";
let server;
let failures = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}: ${err.message}`);
  }
};

// A SKIP must still fail the run if something already went wrong, or the telemetry cases
// below would be silently discarded on any machine without a database.
const skip = (why) => {
  console.log(`check-api: SKIP (${why})`);
  process.exit(failures === 0 ? 0 : 1);
};

const uuid = (n) => `11111111-2222-4333-8444-5555555555${String(n).padStart(2, "0")}`;

// ---- telemetry (decision-23) -----------------------------------------------------
// These run FIRST and need no database, no network and no Sentry credential — which is
// the whole point: they assert what must hold when nothing else is available. A leak
// here is a GDPR problem, not a bug, so it must not be gated behind `psql` being up.

// Every value that must never leave the process, in the shape it really arrives in.
const SECRETS = {
  identityToken:
    "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2Uta2lkIn0.eyJzdWIiOiJhcHBsZS1zdWItcmVhbCJ9.c2lnbmF0dXJl",
  appleSub: "001234.9f8e7d6c5b4a3928.1337",
  workerCookieValue: "c".repeat(64),
  appKey: "tsk_live_do_not_log_me_0123456789",
  email: "anna.mitarbeiterin@example.test",
  passwordHash: "scrypt$16384$8$1$0f1e2d3c4b5a69788796a5b4c3d2e1f0$deadbeef",
  rateCents: 1850,
  portalToken: "pT".repeat(20) + "abc", // 43 base64url chars, as routes/portal.js mints
  nonce: "a-raw-nonce-from-the-phone",
};

await test("the scrubber strips every forbidden field out of an event (decision-23)", () => {
  // Deliberately scattered: headers, parsed cookies, the request body, the user object,
  // a breadcrumb, a span attribute and the transaction NAME. A scrubber that only cleans
  // `event.request` passes a lazier test than this and still leaks.
  const event = {
    transaction: `GET /portal/${SECRETS.portalToken}`,
    request: {
      url: `https://timesheets.exe.xyz/portal/${SECRETS.portalToken}/summary?token=${SECRETS.portalToken}`,
      query_string: `token=${SECRETS.portalToken}`,
      headers: {
        cookie: `ts_worker=${SECRETS.workerCookieValue}`,
        "x-app-key": SECRETS.appKey,
        authorization: `Bearer ${SECRETS.identityToken}`,
        "user-agent": "NFCTimeSheets/2 CFNetwork",
      },
      cookies: { ts_worker: SECRETS.workerCookieValue },
      data: { identity_token: SECRETS.identityToken, nonce: SECRETS.nonce },
    },
    user: { id: "7", email: SECRETS.email, username: "Anna M.", ip_address: "81.223.0.1" },
    // The auto-instrumented `http.server` span, verbatim from a live boot. The query
    // appears TWICE: inside `http.url` AND on its own as `http.query`, which is not a URL
    // and has no `?` for redactUrl to split on. That second copy was going out in the
    // clear; `db.query.text` is here to prove the fix did not also delete parameterised
    // SQL, which is worth keeping and contains no values.
    contexts: {
      trace: {
        data: {
          "http.url": `https://x/portal/${SECRETS.portalToken}?token=${SECRETS.portalToken}`,
          "http.query": `token=${SECRETS.portalToken}&email=${SECRETS.email}`,
          "db.query.text": "SELECT id FROM shifts WHERE client_uuid = $1",
        },
      },
    },
    spans: [
      {
        description: "SELECT hourly_rate_cents FROM workers",
        data: { "url.full": `https://x/portal/${SECRETS.portalToken}`, hourly_rate_cents: SECRETS.rateCents },
      },
    ],
    breadcrumbs: {
      values: [{ type: "http", data: { url: `https://x/portal/${SECRETS.portalToken}` } }],
    },
    extra: { password_hash: SECRETS.passwordHash, apple_sub: SECRETS.appleSub },
  };

  // Assert on the SERIALISED event: a value that survived in a nested span attribute is
  // just as leaked as one in a header, and only this catches both.
  const out = JSON.stringify(scrubEvent(event));
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!out.includes(String(value)), `${name} survived scrubEvent: ${out}`);
  }
  assert.ok(out.includes("/portal/<redacted>"), "the portal path should still be readable");
  assert.equal(
    JSON.parse(out).contexts.trace.data["db.query.text"],
    "SELECT id FROM shifts WHERE client_uuid = $1",
    "parameterised SQL is diagnostics, not a secret - the query-key rule must be anchored",
  );
  assert.equal(JSON.parse(out).user.id, "7", "the worker id is the one identity we keep");
  assert.ok(out.includes("CFNetwork"), "scrubbing must not empty the event out entirely");
});

await test("the scrubber strips log attributes and drops portal breadcrumbs", () => {
  const attrs = scrubLogAttributes({
    "ts.shift.client_uuid": uuid(1),
    "ts.shift.outcome": "created",
    identity_token: SECRETS.identityToken,
    apple_sub: SECRETS.appleSub,
    "user.email": SECRETS.email,
    hourly_rate_cents: SECRETS.rateCents,
    "x-app-key": SECRETS.appKey,
    cookie: `ts_worker=${SECRETS.workerCookieValue}`,
    note: `see /portal/${SECRETS.portalToken}`,
  });
  const out = JSON.stringify(attrs);
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!out.includes(String(value)), `${name} survived scrubLogAttributes: ${out}`);
  }
  assert.equal(attrs["ts.shift.outcome"], "created", "useful attributes must survive");

  assert.equal(
    scrubBreadcrumb({ type: "http", data: { url: `https://x/portal/${SECRETS.portalToken}` } }),
    null,
    "a portal breadcrumb is dropped whole: its only content is the credential",
  );
  const kept = scrubBreadcrumb({
    type: "http",
    data: { url: "https://x/health?token=abc", cookie: "ts_worker=y" },
  });
  assert.equal(kept.data.url, "https://x/health", "a normal crumb survives, query dropped");
  assert.equal(kept.data.cookie, undefined, "...without its cookie");
});

await test("redactUrl drops the query string and the portal token", () => {
  assert.equal(redactUrl(`/portal/${SECRETS.portalToken}/summary`), "/portal/<redacted>/summary");
  assert.equal(redactUrl("/t?l=c3c37d4a-ca0a-42c5-b248-9704b9907ec7"), "/t");
  assert.equal(redactUrl("/admin/login?token=abc#frag"), "/admin/login");
  assert.equal(redactUrl(undefined), "");
  assert.ok(redactUrl(`/x${"y".repeat(9999)}`).length <= 300, "a hostile URL cannot flood the log");
});

await test("instrument.mjs cannot crash the boot, with or without a DSN", () => {
  // `Restart=always` + a throwing instrument file = a crash loop that takes the API down
  // for TELEMETRY. This is the gate ops/deploy.sh relies on. Child process on purpose:
  // calling Sentry.init() in here would instrument this check's own pg client.
  const env = { ...process.env };
  delete env.SENTRY_DSN;
  const run = (extra) =>
    execFileSync(process.execPath, ["--import", "./instrument.mjs", "-e", "0"], {
      cwd: import.meta.dirname,
      env: { ...env, ...extra },
      encoding: "utf8",
      timeout: 20_000,
    });
  assert.equal(run({}), "", "no DSN must be silent, not noisy and not fatal");
  assert.equal(run({ SENTRY_DSN: "https://check@o0.ingest.sentry.io/0" }), "", "a DSN must not print or throw");
});

await test("the REAL SDK payload leaks nothing and lands as ONE trace", () => {
  // The case above proves scrubEvent cleans an event WE wrote. This one proves it cleans
  // the event the SDK writes, which is where the leak actually was: `http.query` is a
  // field nobody here invented. Child process because instrument.mjs has to be the first
  // thing loaded (`--import`), and because a fake DSN must not touch this suite's client.
  // Needs no database and no network - nothing is ever transmitted.
  const out = execFileSync(
    process.execPath,
    ["--import", "./instrument.mjs", "check-telemetry-wire.mjs"],
    {
      cwd: import.meta.dirname,
      env: { ...process.env, SENTRY_DSN: "https://check@o4509000000000000.ingest.de.sentry.io/451" },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.ok(out.includes("check-telemetry-wire: PASS"), out);
});

let admin;
try {
  admin = new pg.Client({ connectionString: BASE_URL, connectionTimeoutMillis: 2000 });
  await admin.connect();
} catch (err) {
  skip(`no database reachable: ${err.message}`);
}

try {
  await admin.query(`CREATE SCHEMA ${pg.escapeIdentifier(SCHEMA)}`);
  await admin.query(`SET search_path TO ${pg.escapeIdentifier(SCHEMA)}`);
  await admin.query(DDL);
  const { rows: seedWorker } = await admin.query(
    "INSERT INTO workers (name, email, hourly_rate_cents) VALUES ('Check Worker', 'check.worker@example.test', 1500) RETURNING id",
  );
  const { rows: seedWorker2 } = await admin.query(
    "INSERT INTO workers (name, email, hourly_rate_cents) VALUES ('Other Worker', 'other.worker@example.test', 1600) RETURNING id",
  );
  // A worker who has been let go. Registered address, but not eligible — deactivating
  // in the admin panel has to be a lockout, not a label.
  const { rows: seedInactive } = await admin.query(
    "INSERT INTO workers (name, email, active) VALUES ('Gone Worker', 'gone.worker@example.test', false) RETURNING id",
  );
  const { rows: seedLocation } = await admin.query(
    "INSERT INTO locations (slug, name) VALUES ('checkhaus', 'Checkhaus') RETURNING id",
  );
  const workerId = Number(seedWorker[0].id);
  const otherWorkerId = Number(seedWorker2[0].id);
  const inactiveWorkerId = Number(seedInactive[0].id);
  const WORKER_SUB = "apple-sub-check-worker";
  const OTHER_SUB = "apple-sub-other-worker";
  const locationUuid = seedLocation[0].id;

  // Point the server's pool at the throwaway schema before it is imported.
  const sep = BASE_URL.includes("?") ? "&" : "?";
  process.env.DATABASE_URL = `${BASE_URL}${sep}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
  process.env.APP_KEY = APP_KEY;
  delete process.env.ADMIN_PIN; // decision-20: must not be required any more
  process.env.PORT = "0";

  const { hashPassword, resetLoginRate } = await import("./lib/auth.js");
  await admin.query("INSERT INTO admins (email, password_hash) VALUES ($1, $2)", [
    ADMIN_EMAIL,
    await hashPassword(ADMIN_PASSWORD),
  ]);

  // Inject the fake JWKS before the server can serve a single request.
  const { setKeyFetcherForTest } = await import("./lib/apple.js");
  setKeyFetcherForTest(async () => new Map([[KID, APPLE_JWK]]));

  const { createServer, assertEnv } = await import("./server.js");
  assertEnv();
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // `cookie` is passed explicitly: node's fetch has no cookie jar, which is a feature
  // here - every case states exactly which credential it is presenting.
  const call = (path, { method = "GET", body, key = APP_KEY, cookie, ip } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        ...(key === null ? {} : { "X-App-Key": key }),
        ...(cookie ? { Cookie: cookie } : {}),
        // The login rate limit buckets by caller address; every request from this
        // process would otherwise share one bucket and poison unrelated cases.
        ...(ip ? { "X-Forwarded-For": ip } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });

  const cookieFrom = (res) => {
    const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
    return raw ? raw.split(";")[0] : null;
  };

  const login = (password = ADMIN_PASSWORD, opts = {}) =>
    call("/admin/login", {
      method: "POST",
      key: null,
      body: { email: ADMIN_EMAIL, password },
      ...opts,
    });

  const appleLogin = (body, opts = {}) => call("/auth/apple", { method: "POST", body, ...opts });

  /** Sign a worker in and return the ts_worker cookie. */
  const workerCookieFor = async (sub, email, ip) => {
    const res = await appleLogin({ identity_token: forgeToken({ sub, email }) }, { ip });
    assert.equal(res.status, 200, `sign-in should succeed, got ${await res.text()}`);
    return cookieFrom(res);
  };

  const countShifts = async () => Number((await admin.query("SELECT count(*) AS n FROM shifts")).rows[0].n);

  console.log(`check-api: running against schema ${SCHEMA}`);

  // ---- env -----------------------------------------------------------------------
  await test("env check fails fast when a variable is missing", () => {
    assert.throws(() => assertEnv({ DATABASE_URL: "x", APP_KEY: "y" }), /PORT/);
  });

  await test("ADMIN_PIN is no longer a required variable (decision-20)", () => {
    assert.doesNotThrow(() => assertEnv({ DATABASE_URL: "x", APP_KEY: "y", PORT: "1" }));
  });

  // decision-23: telemetry is OPTIONAL. No Sentry credential exists yet, and the API has
  // to boot and serve without one — today, and on the day someone rotates the DSN and
  // fat-fingers it. Everything else in this file already runs with SENTRY_DSN unset, so
  // the whole run is the proof; this states the invariant so a future `REQUIRED_ENV.push`
  // fails here instead of on the VM.
  await test("SENTRY_DSN is not required to boot, and is not set for this run", async () => {
    assert.equal(process.env.SENTRY_DSN, undefined, "this check must run with no DSN");
    assert.doesNotThrow(() => assertEnv({ DATABASE_URL: "x", APP_KEY: "y", PORT: "1" }));
    assert.doesNotThrow(
      () => assertEnv({ DATABASE_URL: "x", APP_KEY: "y", PORT: "1", SENTRY_DSN: "" }),
      "an empty DSN is 'disabled', not 'missing'",
    );
    const res = await call("/health");
    assert.equal(res.status, 200, "the API must serve with no Sentry credential at all");
    assert.equal((await res.json()).ok, true);
  });

  // ---- app key -------------------------------------------------------------------
  await test("auth rejects a bad app key", async () => {
    const res = await call("/roster", { key: "wrong-key" });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  await test("auth rejects a missing app key", async () => {
    assert.equal((await call("/roster", { key: null })).status, 401);
  });

  // decision-22: the app key is a COARSE gate, never identity. Before this change it
  // was the whole story on /shifts/*, with the caller naming themselves in the body.
  await test("a good app key alone does not authorise a worker route", async () => {
    const res = await call("/roster");
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  // ---- Sign in with Apple (decision-22) -------------------------------------------
  // Every rejection below must be a 401 `invalid_token` and must mint NO session.
  let workerCookie = null;
  let otherCookie = null;

  const sessionRows = async () => Number((await admin.query("SELECT count(*) AS n FROM worker_sessions")).rows[0].n);

  await test("a token signed with a key Apple never had is rejected", async () => {
    const res = await appleLogin(
      { identity_token: forgeToken({ sub: WORKER_SUB, email: "check.worker@example.test" }, { key: ATTACKER_KEY.privateKey }) },
      { ip: "10.2.0.1" },
    );
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "invalid_token");
    assert.equal(cookieFrom(res), null, "a forged token must not mint a cookie");
    assert.equal(await sessionRows(), 0, "a forged token must not mint a session row");
  });

  await test("a well-formed token that is merely parseable is rejected", async () => {
    // alg:"none" plus a claim set that reads perfectly. This is the shape of the bug
    // where the payload is base64-decoded and trusted without a signature check.
    for (const token of [
      forgeToken({ sub: WORKER_SUB, email: "check.worker@example.test" }, { alg: "none" }),
      "not.a.jwt",
      "",
    ]) {
      const res = await appleLogin({ identity_token: token }, { ip: "10.2.0.2" });
      assert.equal(res.status, 401, `expected 401 for ${token.slice(0, 24)}`);
    }
  });

  await test("a genuine token minted for another app is rejected", async () => {
    const res = await appleLogin(
      { identity_token: forgeToken({ sub: WORKER_SUB, email: "check.worker@example.test", aud: "com.someone.else" }) },
      { ip: "10.2.0.3" },
    );
    assert.equal(res.status, 401);
  });

  await test("wrong issuer, expired and unknown-kid tokens are all rejected", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cases = [
      forgeToken({ sub: WORKER_SUB, iss: "https://evil.example" }),
      forgeToken({ sub: WORKER_SUB, iat: now - 7200, exp: now - 3600 }),
      forgeToken({ sub: WORKER_SUB }, { kid: "a-kid-apple-never-published" }),
    ];
    for (const token of cases) {
      assert.equal((await appleLogin({ identity_token: token }, { ip: "10.2.0.4" })).status, 401);
    }
    assert.equal(await sessionRows(), 0);
  });

  // The two halves of the nonce have to agree on one spelling or every sign-in 401s, and
  // nothing else in this file exercises the pair. iOS puts SHA-256(raw) in the Apple
  // request and posts the RAW value here; the server hashes before it compares.
  await test("the nonce claim is the SHA-256 of the posted raw nonce", async () => {
    const raw = "a-raw-nonce-from-the-phone";
    const hashed = hashToken(raw); // same lowercase-hex SHA-256 as iOS AppleNonce.hashed
    const email = "nonce.check@privaterelay.appleid.com";

    // Matching pair: gets past verification and only then fails eligibility (403).
    const ok = await appleLogin(
      { identity_token: forgeToken({ sub: "apple-sub-nonce", email, nonce: hashed }), nonce: raw },
      { ip: "10.2.0.8" },
    );
    assert.equal(ok.status, 403, "a correctly hashed nonce must pass verification");

    // Raw echoed into the claim (the bug this pins), and a stripped nonce: both 401.
    for (const token of [
      forgeToken({ sub: "apple-sub-nonce", email, nonce: raw }),
      forgeToken({ sub: "apple-sub-nonce", email }),
    ]) {
      assert.equal((await appleLogin({ identity_token: token, nonce: raw }, { ip: "10.2.0.9" })).status, 401);
    }
  });

  await test("an unknown email is 403 not_eligible with the address echoed back", async () => {
    // The echo IS the Hide My Email mechanism: the worker reads the relay address off
    // the dead-end screen to their manager, who pastes it into the worker record.
    const email = "nobody-here@privaterelay.appleid.com";
    const res = await appleLogin({ identity_token: forgeToken({ sub: "apple-sub-stranger", email }) }, { ip: "10.2.0.5" });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, "not_eligible");
    assert.equal(data.email, email, "the 403 must carry the address Apple gave, or first login is impossible");
    assert.equal(cookieFrom(res), null);
    assert.equal(await sessionRows(), 0);
  });

  await test("an inactive worker is not eligible", async () => {
    const res = await appleLogin(
      { identity_token: forgeToken({ sub: "apple-sub-gone", email: "gone.worker@example.test" }) },
      { ip: "10.2.0.6" },
    );
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "not_eligible");
    assert.equal(
      (await admin.query("SELECT apple_sub FROM workers WHERE id = $1", [inactiveWorkerId])).rows[0].apple_sub,
      null,
      "an ineligible login must not bind a sub",
    );
  });

  await test("an inactive worker is not eligible even with a bound apple_sub", async () => {
    await admin.query("UPDATE workers SET apple_sub = 'apple-sub-gone' WHERE id = $1", [inactiveWorkerId]);
    const res = await appleLogin(
      { identity_token: forgeToken({ sub: "apple-sub-gone", email: "gone.worker@example.test" }) },
      { ip: "10.2.0.7" },
    );
    assert.equal(res.status, 403, "deactivating must lock out, sub match or not");
  });

  await test("an eligible worker gets a session, hardened cookie and a HASHED token", async () => {
    const res = await appleLogin(
      { identity_token: forgeToken({ sub: WORKER_SUB, email: "CHECK.Worker@Example.test" }) },
      { ip: "10.2.1.1" },
    );
    const body = await res.text(); // once: a Response body is single-use
    assert.equal(res.status, 200, body);
    const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
    assert.match(raw, /^ts_worker=/, "workers get their own cookie name, not the admin one");
    assert.ok(/HttpOnly/i.test(raw), "worker cookie must be HttpOnly");
    assert.ok(/Secure/i.test(raw), "worker cookie must be Secure");
    assert.ok(/SameSite=Strict/i.test(raw), "worker cookie must be SameSite=Strict");

    workerCookie = cookieFrom(res);
    const token = workerCookie.split("=")[1];
    assert.equal(JSON.parse(body).worker.id, workerId, "the SERVER decides which worker this is");
    assert.ok(new Date(JSON.parse(body).expires_at).getTime() > Date.now());
    assert.ok(!body.includes(token), "the token lives in the cookie only");

    const hashed = await admin.query("SELECT worker_id FROM worker_sessions WHERE token = $1", [hashToken(token)]);
    assert.equal(hashed.rowCount, 1, "the session must be stored under SHA-256(token)");
    assert.equal(Number(hashed.rows[0].worker_id), workerId);
    const rawStored = await admin.query("SELECT 1 FROM worker_sessions WHERE token = $1", [token]);
    assert.equal(rawStored.rowCount, 0, "a leaked dump must not yield a replayable token");

    // The address arrived mixed-case; the lower-case invariant is what makes the next
    // login find the row at all.
    const stored = await admin.query("SELECT email, apple_sub FROM workers WHERE id = $1", [workerId]);
    assert.equal(stored.rows[0].email, "check.worker@example.test");
    assert.equal(stored.rows[0].apple_sub, WORKER_SUB, "first login must bind the sub");
  });

  await test("a returning worker matches on apple_sub, even after the admin edits the email", async () => {
    await admin.query("UPDATE workers SET email = 'renamed.worker@example.test' WHERE id = $1", [workerId]);
    const res = await appleLogin({ identity_token: forgeToken({ sub: WORKER_SUB }) }, { ip: "10.2.1.2" });
    assert.equal(res.status, 200, "apple_sub is authoritative once bound");
    await admin.query("UPDATE workers SET email = 'check.worker@example.test' WHERE id = $1", [workerId]);
  });

  await test("a claimed worker row is never re-pointed at a different Apple ID", async () => {
    const res = await appleLogin(
      { identity_token: forgeToken({ sub: "apple-sub-impostor", email: "check.worker@example.test" }) },
      { ip: "10.2.1.3" },
    );
    assert.equal(res.status, 403, "knowing a colleague's address must not be a login");
    assert.equal(
      (await admin.query("SELECT apple_sub FROM workers WHERE id = $1", [workerId])).rows[0].apple_sub,
      WORKER_SUB,
    );
  });

  await test("/auth/apple is behind the app key and the shared rate limit", async () => {
    assert.equal(
      (await call("/auth/apple", { method: "POST", key: null, body: { identity_token: "x" } })).status,
      401,
      "sign-in keeps the coarse app-key gate in front of it",
    );
    resetLoginRate();
    const ip = "10.2.2.1";
    const codes = [];
    for (let i = 0; i < 7; i++) {
      codes.push((await appleLogin({ identity_token: forgeToken({ sub: "x" }, { key: ATTACKER_KEY.privateKey }) }, { ip })).status);
    }
    assert.ok(codes.includes(429), `an unthrottled token endpoint is a DoS lever, got ${codes}`);
    resetLoginRate();
  });

  await test("a worker session authorises /roster and the roster names only ME", async () => {
    otherCookie = await workerCookieFor(OTHER_SUB, "other.worker@example.test", "10.2.1.4");
    const res = await call("/roster", { cookie: workerCookie });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.worker.id, workerId);
    assert.equal(data.workers, undefined, "shipping the staff roster to the app is the hole this closed");
    assert.equal(data.locations[0].id, locationUuid);
    assert.equal(data.locations[0].hourly_rate_cents, undefined, "pay data must not leak to the app");
  });

  await test("a forged or expired worker cookie does not authorise anything", async () => {
    assert.equal((await call("/roster", { cookie: `ts_worker=${"a".repeat(64)}` })).status, 401);
    const expired = await admin.query(
      "UPDATE worker_sessions SET expires_at = now() - interval '1 minute' WHERE token = $1",
      [hashToken(otherCookie.split("=")[1])],
    );
    assert.equal(expired.rowCount, 1, "test must actually expire the session row");
    assert.equal((await call("/roster", { cookie: otherCookie })).status, 401);
    otherCookie = await workerCookieFor(OTHER_SUB, "other.worker@example.test", "10.2.1.5");
  });

  await test("/auth/session names me and /auth/logout revokes server-side", async () => {
    const cookie = await workerCookieFor(OTHER_SUB, "other.worker@example.test", "10.2.1.6");
    const who = await call("/auth/session", { cookie });
    assert.equal(who.status, 200);
    assert.equal((await who.json()).worker.id, otherWorkerId);

    const out = await call("/auth/logout", { method: "POST", cookie });
    assert.equal(out.status, 200);
    assert.match(cookieFrom(out) ?? "", /^ts_worker=$/, "logout must clear the cookie");
    assert.equal(
      (await admin.query("SELECT 1 FROM worker_sessions WHERE token = $1", [hashToken(cookie.split("=")[1])]))
        .rowCount,
      0,
      "logout must delete the row, not just the cookie",
    );
    assert.equal((await call("/roster", { cookie })).status, 401);
  });

  // Named helpers so every request below states WHOSE session it is presenting.
  const asWorker = (path, opts = {}) => call(path, { cookie: workerCookie, ...opts });
  const asOther = (path, opts = {}) => call(path, { cookie: otherCookie, ...opts });

  // ---- password login (decision-20) -----------------------------------------------
  let adminCookie = null;

  await test("login succeeds with the right password and sets a hardened cookie", async () => {
    resetLoginRate();
    const res = await login(ADMIN_PASSWORD, { ip: "10.0.0.1" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).admin.email, ADMIN_EMAIL);

    const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
    assert.ok(/HttpOnly/i.test(raw), "session cookie must be HttpOnly (not readable by JS)");
    assert.ok(/Secure/i.test(raw), "session cookie must be Secure");
    assert.ok(/SameSite=Strict/i.test(raw), "session cookie must be SameSite=Strict");
    adminCookie = cookieFrom(res);
    assert.ok(adminCookie, "login must return a session cookie");
  });

  await test("login fails uniformly for a wrong password and an unknown email", async () => {
    resetLoginRate();
    const badPass = await login("not the password", { ip: "10.0.0.2" });
    const badEmail = await call("/admin/login", {
      method: "POST",
      key: null,
      ip: "10.0.0.3",
      body: { email: "nobody@example.test", password: ADMIN_PASSWORD },
    });
    assert.equal(badPass.status, 401);
    assert.equal(badEmail.status, 401);
    assert.deepEqual(
      await badPass.json(),
      await badEmail.json(),
      "responses must be identical or the route enumerates accounts",
    );
  });

  await test("malformed login input fails the same way, not with a 400", async () => {
    resetLoginRate();
    for (const body of [{}, { email: 42, password: ADMIN_PASSWORD }, { email: ADMIN_EMAIL }]) {
      const res = await call("/admin/login", { method: "POST", key: null, ip: "10.0.1.1", body });
      assert.equal(res.status, 401, `expected 401 for ${JSON.stringify(body)}`);
      assert.equal((await res.json()).error, "invalid_credentials");
    }
    resetLoginRate();
  });

  await test("login sets no cookie when it fails", async () => {
    resetLoginRate();
    const res = await login("wrong again", { ip: "10.0.0.4" });
    assert.equal(res.status, 401);
    assert.equal(cookieFrom(res), null);
  });

  await test("login rate limit returns 429 after repeated failures", async () => {
    resetLoginRate();
    const ip = "10.0.0.5";
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await login("wrong", { ip })).status);
    assert.ok(codes.slice(0, 5).every((c) => c === 401), `first 5 should be 401, got ${codes}`);
    assert.ok(codes.includes(429), `expected a 429 after 5 failures, got ${codes}`);

    const locked = await login("wrong", { ip });
    assert.equal(locked.status, 429);
    assert.equal((await locked.json()).error, "too_many_attempts");
    assert.ok(Number(locked.headers.get("retry-after")) > 0, "429 must say when to come back");

    // Lockout must apply even to the CORRECT password, or it is not a lockout.
    assert.equal((await login(ADMIN_PASSWORD, { ip })).status, 429);
    // ...and must not spill onto an unrelated caller.
    assert.equal((await login(ADMIN_PASSWORD, { ip: "10.0.0.6" })).status, 200);
    resetLoginRate();
  });

  // ---- session cookie authorises /admin/* -----------------------------------------
  await test("a session cookie authorises /admin/data", async () => {
    const res = await call("/admin/data", { key: null, cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).workers[0].hourly_rate_cents !== undefined, true);
  });

  await test("a missing cookie does not authorise /admin/data", async () => {
    const res = await call("/admin/data", { key: null });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  await test("a forged cookie does not authorise /admin/data", async () => {
    const res = await call("/admin/data", { key: null, cookie: `ts_session=${"a".repeat(64)}` });
    assert.equal(res.status, 401);
  });

  await test("the app key does not authorise /admin/data", async () => {
    assert.equal((await call("/admin/data")).status, 401);
  });

  await test("an expired session does not authorise /admin/data", async () => {
    const res = await login(ADMIN_PASSWORD, { ip: "10.0.0.7" });
    const cookie = cookieFrom(res);
    assert.equal((await call("/admin/session", { key: null, cookie })).status, 200);

    // Match on the HASH. Using the raw cookie value here updates zero rows, the session
    // never actually expires, and the assertion below then passes for the wrong reason.
    const expired = await admin.query(
      "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token = $1",
      [hashToken(cookie.split("=")[1])],
    );
    assert.equal(expired.rowCount, 1, "test must actually expire the session row");
    assert.equal((await call("/admin/data", { key: null, cookie })).status, 401);
  });

  await test("logout revokes the session server-side", async () => {
    const cookie = cookieFrom(await login(ADMIN_PASSWORD, { ip: "10.0.0.8" }));
    const out = await call("/admin/logout", { method: "POST", key: null, cookie });
    assert.equal(out.status, 200);
    assert.match(cookieFrom(out) ?? "", /^ts_session=$/, "logout must clear the cookie");
    assert.equal((await call("/admin/data", { key: null, cookie })).status, 401, "revoked cookie must not work");
  });

  await test("the session token is never echoed back in a response body", async () => {
    const res = await login(ADMIN_PASSWORD, { ip: "10.0.0.9" });
    const cookie = cookieFrom(res);
    const token = cookie.split("=")[1];
    const body = await res.text();
    assert.ok(!body.includes(token), "token must live in the cookie only");
    assert.ok(!body.includes(ADMIN_PASSWORD), "password must never come back");
    assert.ok(!body.includes("password_hash"), "hash must never come back");
  });

  // ---- clock-in / clock-out (decision-19) -----------------------------------------
  const openBody = {
    client_uuid: uuid(1),
    location_uuid: locationUuid,
    start_time: new Date(Date.now() - 3 * 3600_000).toISOString(),
  };

  await test("POST /shifts/open creates an OPEN shift (end_time NULL) for the SESSION's worker", async () => {
    // body.worker_id is the hole decision-22 closed. Sent here on purpose: it must be
    // ignored, not honoured, and not 400 — the field simply does not exist any more.
    const res = await asWorker("/shifts/open", { method: "POST", body: { ...openBody, worker_id: otherWorkerId } });
    assert.equal(res.status, 201);
    const { shift, duplicate } = await res.json();
    assert.equal(duplicate, false);
    assert.equal(shift.worker_id, workerId, "identity comes from the session, never from the body");
    assert.equal(shift.end_time, null, "a clock-in must leave end_time NULL or the 8h timer can never fire");
    assert.equal(shift.auto_closed, false);
    assert.equal(shift.location_id, locationUuid);
  });

  await test("a shift route without a worker session is 401, app key or not", async () => {
    const res = await call("/shifts/open", { method: "POST", body: { ...openBody, client_uuid: uuid(12) } });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  await test("POST /shifts/open is idempotent under retry", async () => {
    const before = await countShifts();
    const res = await asWorker("/shifts/open", { method: "POST", body: openBody });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).duplicate, true);
    assert.equal(await countShifts(), before, "a retry must not create a second row");
  });

  await test("a second open shift for the same worker returns 409, not a 500", async () => {
    const res = await asWorker("/shifts/open", {
      method: "POST",
      body: { ...openBody, client_uuid: uuid(2) },
    });
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.error, "shift_already_open");
    assert.ok(data.shift, "409 should name the shift that is in the way");
  });

  await test("GET /shifts/open reports MY running shift and nobody else's", async () => {
    // `?worker=` is gone: it let any app-key holder watch any worker.
    const mine = await (await asWorker(`/shifts/open?worker=${otherWorkerId}`)).json();
    assert.equal(mine.shift.client_uuid, uuid(1));
    assert.equal(mine.shift.location_slug, "checkhaus");
    const theirs = await (await asOther(`/shifts/open?worker=${workerId}`)).json();
    assert.equal(theirs.shift, null, "a query parameter must not be able to name a worker");
  });

  await test("one worker cannot clock another one out", async () => {
    const res = await asOther("/shifts/close", {
      method: "POST",
      body: { client_uuid: uuid(1), end_time: new Date().toISOString() },
    });
    assert.equal(res.status, 404, "someone else's shift must not exist for me");
    const still = await admin.query("SELECT end_time FROM shifts WHERE client_uuid = $1", [uuid(1)]);
    assert.equal(still.rows[0].end_time, null, "and it must still be running");
  });

  await test("POST /shifts/close closes it and is idempotent under retry", async () => {
    const endTime = new Date(Date.now() - 3600_000).toISOString();
    const first = await asWorker("/shifts/close", {
      method: "POST",
      body: { client_uuid: uuid(1), end_time: endTime },
    });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.duplicate, false);
    assert.equal(new Date(firstBody.shift.end_time).toISOString(), endTime);

    const second = await asWorker("/shifts/close", {
      method: "POST",
      body: { client_uuid: uuid(1), end_time: endTime },
    });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.duplicate, true);
    assert.equal(
      new Date(secondBody.shift.end_time).toISOString(),
      endTime,
      "a retry must not move end_time",
    );
  });

  await test("closing frees the worker to open the next shift", async () => {
    const res = await asWorker("/shifts/open", {
      method: "POST",
      body: { ...openBody, client_uuid: uuid(3), start_time: new Date(Date.now() - 600_000).toISOString() },
    });
    assert.equal(res.status, 201);
    await asWorker("/shifts/close", {
      method: "POST",
      body: { client_uuid: uuid(3), end_time: new Date().toISOString() },
    });
  });

  await test("a 30h shift can still be closed - the 8h timer owns runaways, not a 422", async () => {
    // The old code rejected this with 422 shift_too_long, which trapped exactly the
    // worker the safety net exists for: they could never clock out at all.
    await asWorker("/shifts/open", {
      method: "POST",
      body: { ...openBody, client_uuid: uuid(4), start_time: new Date(Date.now() - 30 * 3600_000).toISOString() },
    });
    const res = await asWorker("/shifts/close", {
      method: "POST",
      body: { client_uuid: uuid(4), end_time: new Date().toISOString() },
    });
    assert.equal(res.status, 200, `expected the close to succeed, got ${await res.text()}`);
  });

  await test("closing an unknown client_uuid is a 404, not a silent no-op", async () => {
    const res = await asWorker("/shifts/close", {
      method: "POST",
      body: { client_uuid: uuid(90), end_time: new Date().toISOString() },
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "unknown_shift");
  });

  // ---- validation ------------------------------------------------------------------
  await test("unknown location uuid is rejected", async () => {
    const res = await asWorker("/shifts/open", {
      method: "POST",
      body: { ...openBody, client_uuid: uuid(5), location_uuid: "00000000-0000-4000-8000-000000000000" },
    });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error, "unknown_location");
  });

  await test("a malformed location id never reaches SQL", async () => {
    const before = await countShifts();
    const res = await asWorker("/shifts/open", {
      method: "POST",
      body: { ...openBody, client_uuid: uuid(6), location_uuid: "'; DROP TABLE shifts; --" },
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_uuid");
    assert.equal(await countShifts(), before, "tables must be intact");
  });

  await test("the slug is not accepted as a location identifier (decision-21)", async () => {
    const res = await asWorker("/shifts/open", {
      method: "POST",
      body: { ...openBody, client_uuid: uuid(7), location_uuid: "checkhaus" },
    });
    assert.equal(res.status, 400, "a guessable slug must not resolve to a location");
  });

  await test("inactive location stops resolving", async () => {
    await admin.query("UPDATE locations SET active = false WHERE slug = 'checkhaus'");
    const res = await asWorker("/shifts/open", { method: "POST", body: { ...openBody, client_uuid: uuid(8) } });
    await admin.query("UPDATE locations SET active = true WHERE slug = 'checkhaus'");
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error, "unknown_location");
  });

  await test("future start_time is rejected", async () => {
    const res = await asWorker("/shifts/open", {
      method: "POST",
      body: { ...openBody, client_uuid: uuid(10), start_time: new Date(Date.now() + 86_400_000).toISOString() },
    });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error, "timestamp_in_future");
  });

  await test("end before start is rejected on close", async () => {
    await asWorker("/shifts/open", {
      method: "POST",
      body: { ...openBody, client_uuid: uuid(11), start_time: new Date(Date.now() - 600_000).toISOString() },
    });
    const res = await asWorker("/shifts/close", {
      method: "POST",
      body: { client_uuid: uuid(11), end_time: new Date(Date.now() - 7200_000).toISOString() },
    });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error, "end_before_start");
    await admin.query("UPDATE shifts SET end_time = now() WHERE client_uuid = $1", [uuid(11)]);
  });

  await test("oversized body is rejected with 413", async () => {
    const res = await asWorker("/shifts/open", { method: "POST", body: JSON.stringify({ pad: "x".repeat(200_000) }) });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error, "body_too_large");
  });

  // ---- 8h auto-close resolution (decision-10) --------------------------------------
  let autoShiftId;
  await test("auto-closed shift resolution flow", async () => {
    // Exactly what ops/sql/autoclose.sql writes: end_time = start+8h, auto_closed.
    const { rows } = await admin.query(
      `INSERT INTO shifts (worker_id, location_id, start_time, end_time, auto_closed, client_uuid)
       VALUES ($1, $2, now() - interval '10 hours', now() - interval '2 hours', true, 'auto-1')
       RETURNING id`,
      [otherWorkerId, locationUuid],
    );
    autoShiftId = Number(rows[0].id);

    const unresolved = await (await asOther("/shifts/unresolved")).json();
    assert.equal(unresolved.shifts.length, 1);
    assert.equal(unresolved.shifts[0].id, autoShiftId);

    const realEnd = new Date(Date.now() - 4 * 3600_000).toISOString();
    const res = await asOther(`/shifts/${autoShiftId}/resolve`, { method: "POST", body: { end_time: realEnd } });
    assert.equal(res.status, 200);
    const { shift } = await res.json();
    assert.equal(shift.auto_closed, true, "auto_closed is history and must survive resolution");
    assert.notEqual(shift.corrected_at, null, "resolution must stamp corrected_at");

    const after = await (await asOther("/shifts/unresolved")).json();
    assert.equal(after.shifts.length, 0, "a resolved shift must drop out of the unresolved list");

    assert.equal(
      (await asOther(`/shifts/${autoShiftId}/resolve`, { method: "POST", body: { end_time: realEnd } })).status,
      409,
    );
  });

  // The on-device migration's only server call (DataMigrations.swift). If this 404s, a
  // device holding a legacy row with a real location can NEVER finish migrating: the
  // fetch throws, the chain defers, and the version never advances.
  await test("/shifts/mine answers the migration's reconciliation question, session-scoped", async () => {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const res = await asOther(`/shifts/mine?since=${encodeURIComponent(since)}`);
    assert.equal(res.status, 200, "the iOS migration calls this route by name");
    const { shifts } = await res.json();
    assert.ok(shifts.length > 0);
    assert.ok(
      shifts.every((s) => s.client_uuid !== undefined),
      "client_uuid is the idempotency key the migration matches on - it must be in the payload",
    );
    assert.deepEqual(
      [...shifts].sort((a, b) => new Date(b.start_time) - new Date(a.start_time)).map((s) => s.id),
      shifts.map((s) => s.id),
      "newest first",
    );

    const other = await (await asWorker(`/shifts/mine?since=${encodeURIComponent(since)}`)).json();
    assert.equal(
      other.shifts.find((s) => s.worker_id === otherWorkerId),
      undefined,
      "/shifts/mine must be scoped to the session's worker, never ?worker=",
    );

    assert.equal((await asOther("/shifts/mine")).status, 400, "since is required");
  });

  await test("a worker cannot read or resolve another worker's shifts", async () => {
    // Shift ids are sequential, so "hard to guess" is not a defence here.
    const { rows } = await admin.query(
      `INSERT INTO shifts (worker_id, location_id, start_time, end_time, auto_closed, client_uuid)
       VALUES ($1, $2, now() - interval '11 hours', now() - interval '3 hours', true, 'auto-other')
       RETURNING id`,
      [otherWorkerId, locationUuid],
    );
    const theirShiftId = Number(rows[0].id);

    const mine = await (await asWorker("/shifts/unresolved")).json();
    assert.equal(
      mine.shifts.find((s) => s.id === theirShiftId),
      undefined,
      "/shifts/unresolved must be scoped to the session's worker",
    );

    const stolen = await asWorker(`/shifts/${theirShiftId}/resolve`, {
      method: "POST",
      body: { end_time: new Date(Date.now() - 5 * 3600_000).toISOString() },
    });
    assert.equal(stolen.status, 404, "someone else's id must answer exactly like a nonexistent one");
    const untouched = await admin.query("SELECT corrected_at FROM shifts WHERE id = $1", [theirShiftId]);
    assert.equal(untouched.rows[0].corrected_at, null, "and must not have been stamped");
    await admin.query("DELETE FROM shifts WHERE id = $1", [theirShiftId]);
  });

  await test("a shift the timer never touched cannot be 'resolved'", async () => {
    const { rows } = await admin.query("SELECT id FROM shifts WHERE client_uuid = $1", [uuid(1)]);
    const res = await asWorker(`/shifts/${Number(rows[0].id)}/resolve`, {
      method: "POST",
      body: { end_time: new Date().toISOString() },
    });
    assert.equal(res.status, 409);
  });

  // ---- admin CRUD -------------------------------------------------------------------
  await test("admin data reports aggregates and excludes unresolved hours", async () => {
    const res = await call("/admin/data", { key: null, cookie: adminCookie });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.workers[0].hourly_rate_cents !== undefined, true);
    assert.ok(data.hours.find((h) => h.worker_id === workerId).hours > 0);

    const { rows } = await admin.query(
      `INSERT INTO shifts (worker_id, location_id, start_time, end_time, auto_closed, client_uuid)
       VALUES ($1, $2, now() - interval '9 hours', now() - interval '1 hour', true, 'auto-2')
       RETURNING id`,
      [otherWorkerId, locationUuid],
    );
    const after = await (await call("/admin/data", { key: null, cookie: adminCookie })).json();
    const before = data.hours.find((h) => h.worker_id === otherWorkerId)?.hours ?? 0;
    const now = after.hours.find((h) => h.worker_id === otherWorkerId)?.hours ?? 0;
    assert.equal(now, before, "an unresolved auto-closed shift must not enter payroll");
    await admin.query("DELETE FROM shifts WHERE id = $1", [Number(rows[0].id)]);
  });

  await test("PATCH does NOT stamp corrected_at on an ordinary edit", async () => {
    const { rows } = await admin.query("SELECT id FROM shifts WHERE client_uuid = $1", [uuid(1)]);
    const shiftId = Number(rows[0].id);
    const res = await call(`/admin/shifts/${shiftId}`, {
      method: "PATCH",
      key: null,
      cookie: adminCookie,
      body: { start_time: new Date(Date.now() - 4 * 3600_000).toISOString() },
    });
    assert.equal(res.status, 200);
    const { shift } = await res.json();
    assert.equal(shift.auto_closed, false);
    assert.equal(shift.corrected_at, null, "corrected_at means 'a flagged shift was resolved', nothing else");
  });

  await test("PATCH does not re-stamp corrected_at on an already resolved shift", async () => {
    const { rows } = await admin.query("SELECT corrected_at FROM shifts WHERE id = $1", [autoShiftId]);
    const original = rows[0].corrected_at.toISOString();
    const res = await call(`/admin/shifts/${autoShiftId}`, {
      method: "PATCH",
      key: null,
      cookie: adminCookie,
      body: { end_time: new Date(Date.now() - 3 * 3600_000).toISOString() },
    });
    assert.equal(res.status, 200);
    assert.equal(new Date((await res.json()).shift.corrected_at).toISOString(), original);
  });

  await test("PATCH stamps corrected_at when it actually resolves a flagged shift", async () => {
    const { rows } = await admin.query(
      `INSERT INTO shifts (worker_id, location_id, start_time, end_time, auto_closed, client_uuid)
       VALUES ($1, $2, now() - interval '12 hours', now() - interval '4 hours', true, 'auto-3')
       RETURNING id`,
      [otherWorkerId, locationUuid],
    );
    const shiftId = Number(rows[0].id);
    const res = await call(`/admin/shifts/${shiftId}`, {
      method: "PATCH",
      key: null,
      cookie: adminCookie,
      body: { end_time: new Date(Date.now() - 6 * 3600_000).toISOString() },
    });
    assert.equal(res.status, 200);
    assert.notEqual((await res.json()).shift.corrected_at, null);
  });

  await test("admin cannot forge auto_closed", async () => {
    const { rows } = await admin.query("SELECT id FROM shifts WHERE client_uuid = $1", [uuid(1)]);
    const res = await call(`/admin/shifts/${Number(rows[0].id)}`, {
      method: "PATCH",
      key: null,
      cookie: adminCookie,
      body: { auto_closed: true },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).shift.auto_closed, false, "auto_closed is a machine fact, not an input");
  });

  await test("admin registers an email, the worker signs in, deactivation locks them out", async () => {
    // The whole enrolment path in one case: /admin/workers is the ONLY way in.
    const created = await call("/admin/workers", {
      method: "POST",
      key: null,
      cookie: adminCookie,
      body: { name: "Temp Worker", hourly_rate_cents: 2000, email: "Temp.Worker@Example.test" },
    });
    assert.equal(created.status, 201);
    const { worker } = await created.json();
    assert.equal(worker.email, "temp.worker@example.test", "email must come back, lower-cased");
    assert.equal(worker.apple_sub, undefined, "apple_sub is a credential id, not admin UI data");

    const cookie = await workerCookieFor("apple-sub-temp", "temp.worker@example.test", "10.3.0.1");
    assert.equal((await call("/roster", { cookie })).status, 200);

    const deleted = await call(`/admin/workers/${worker.id}`, { method: "DELETE", key: null, cookie: adminCookie });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).worker.active, false);
    assert.equal(
      (await admin.query("SELECT active FROM workers WHERE id = $1", [worker.id])).rows.length,
      1,
      "soft delete must keep the row",
    );
    assert.equal((await call("/roster", { cookie })).status, 401, "deactivating must kill the live session");
    assert.equal(
      (await appleLogin({ identity_token: forgeToken({ sub: "apple-sub-temp" }) }, { ip: "10.3.0.2" })).status,
      403,
      "...and must stop them signing back in",
    );
  });

  await test("a malformed worker email is rejected and a duplicate is a 409", async () => {
    // A typo here is invisible otherwise: the worker just gets "not eligible" forever.
    const bad = await call("/admin/workers", {
      method: "POST",
      key: null,
      cookie: adminCookie,
      body: { name: "Typo Worker", email: "anna at example dot at" },
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid_email");

    const dup = await call("/admin/workers", {
      method: "POST",
      key: null,
      cookie: adminCookie,
      body: { name: "Clone", email: "check.worker@example.test" },
    });
    assert.equal(dup.status, 409, "two people must not share a login");
    assert.equal((await dup.json()).error, "email_taken");
  });

  await test("a new location gets a server-generated UUID id", async () => {
    const res = await call("/admin/locations", {
      method: "POST",
      key: null,
      cookie: adminCookie,
      body: { slug: "neuhaus", name: "Neuhaus" },
    });
    assert.equal(res.status, 201);
    const { location } = await res.json();
    assert.match(location.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(location.slug, "neuhaus");
  });

  await test("duplicate location slug is rejected", async () => {
    const res = await call("/admin/locations", {
      method: "POST",
      key: null,
      cookie: adminCookie,
      body: { slug: "checkhaus", name: "Copycat" },
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "slug_taken");
  });

  await test("malformed slug is rejected before it hits SQL", async () => {
    const before = await countShifts();
    const res = await call("/admin/locations", {
      method: "POST",
      key: null,
      cookie: adminCookie,
      body: { slug: "'; DROP TABLE shifts; --", name: "Injection" },
    });
    assert.equal(res.status, 400);
    assert.equal(await countShifts(), before, "tables must be intact");
  });

  // ---- clients, contacts, inventory (003) -------------------------------------------
  const asAdmin = (path, opts = {}) => call(path, { key: null, cookie: adminCookie, ...opts });

  await test("every new admin route rejects a missing session, app key or not", async () => {
    // The app key is a coarse "this is our build" gate and must never stand in for an admin
    // session. A new route that forgot `auth: "admin"` would be a public write endpoint.
    const newRoutes = [
      ["POST", "/admin/clients"],
      ["DELETE", "/admin/clients/1"],
      ["POST", "/admin/contacts"],
      ["DELETE", "/admin/contacts/1"],
      ["POST", "/admin/inventory"],
      ["DELETE", "/admin/inventory/1"],
      ["POST", "/admin/portal-grants"],
      ["DELETE", `/admin/portal-grants/${"a".repeat(64)}`],
      ["POST", "/admin/shifts"],
    ];
    for (const [method, path] of newRoutes) {
      const body = method === "POST" ? {} : undefined;
      const noCred = await call(path, { method, key: null, body });
      assert.equal(noCred.status, 401, `${method} ${path} with no credential`);
      assert.equal((await noCred.json()).error, "unauthorized");
      assert.equal(
        (await call(path, { method, body })).status,
        401,
        `${method} ${path} must not accept the app key as an admin credential`,
      );
    }
  });

  let clientId;
  let contactId;
  await test("client and contact upsert, then soft deactivate", async () => {
    const created = await asAdmin("/admin/clients", { method: "POST", body: { name: "Hausverwaltung Meier" } });
    assert.equal(created.status, 201);
    clientId = (await created.json()).client.id;

    const renamed = await asAdmin("/admin/clients", {
      method: "POST",
      body: { id: clientId, name: "Hausverwaltung Meier GmbH" },
    });
    assert.equal(renamed.status, 200, "an id in the body means update, same idiom as /admin/workers");
    assert.equal((await renamed.json()).client.name, "Hausverwaltung Meier GmbH");

    const contact = await asAdmin("/admin/contacts", {
      method: "POST",
      body: { client_id: clientId, name: "Frau Gruber", email: "Gruber@Meier.test", phone: "+43 664 1234567" },
    });
    assert.equal(contact.status, 201);
    const created2 = (await contact.json()).contact;
    contactId = created2.id;
    assert.equal(created2.email, "gruber@meier.test", "contact email is lower-cased like a worker's");

    const orphan = await asAdmin("/admin/contacts", { method: "POST", body: { client_id: 999_999, name: "Ghost" } });
    assert.equal(orphan.status, 422, "a contact must belong to a real client");
    assert.equal((await orphan.json()).error, "unknown_client");

    const gone = await asAdmin(`/admin/clients/${clientId}`, { method: "DELETE" });
    assert.equal(gone.status, 200);
    assert.equal((await gone.json()).client.active, false);
    assert.equal(
      (await admin.query("SELECT active FROM clients WHERE id = $1", [clientId])).rows.length,
      1,
      "soft delete must keep the row — history has to keep naming who was paying",
    );
    await asAdmin("/admin/clients", { method: "POST", body: { id: clientId, name: "Hausverwaltung Meier GmbH" } });
  });

  await test("inventory is one table for products and equipment, cost in integer cents", async () => {
    const product = await asAdmin("/admin/inventory", {
      method: "POST",
      body: { name: "Allzweckreiniger 5L", kind: "product", unit_cost_cents: 1290 },
    });
    assert.equal(product.status, 201);
    assert.equal((await product.json()).item.unit_cost_cents, 1290);

    const equipment = await asAdmin("/admin/inventory", {
      method: "POST",
      body: { name: "Wischmop", kind: "equipment" },
    });
    assert.equal(equipment.status, 201);
    const item = (await equipment.json()).item;
    assert.equal(item.unit_cost_cents, 0, "not priced yet is a real state");

    for (const bad of [{ name: "Ding", kind: "tool" }, { name: "Ding", kind: "product", unit_cost_cents: 12.5 }]) {
      const res = await asAdmin("/admin/inventory", { method: "POST", body: bad });
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }

    const gone = await asAdmin(`/admin/inventory/${item.id}`, { method: "DELETE" });
    assert.equal((await gone.json()).item.active, false);
  });

  let contractLocationId;
  await test("a building carries its client, contact and contract figures", async () => {
    const res = await asAdmin("/admin/locations", {
      method: "POST",
      body: {
        slug: "meierhof",
        name: "Meierhof",
        address: "Praterstrasse 1, 1020 Wien",
        contact_id: contactId, // client_id deliberately omitted
        monthly_contract_cents: 120_000,
        target_minutes_per_month: 1200,
      },
    });
    assert.equal(res.status, 201);
    const location = (await res.json()).location;
    contractLocationId = location.id;
    assert.equal(location.client_id, clientId, "picking the contact must imply the company");
    assert.equal(location.monthly_contract_cents, 120_000);
    assert.equal(location.target_minutes_per_month, 1200);

    // A building entered before 003 has no contract data and must still be editable.
    const bare = await asAdmin("/admin/locations", { method: "POST", body: { slug: "barehaus", name: "Barehaus" } });
    assert.equal(bare.status, 201);
    const bareRow = (await bare.json()).location;
    assert.equal(bareRow.client_id, null);
    assert.equal(bareRow.monthly_contract_cents, null, "NULL means nobody has told us, not zero revenue");

    const mismatch = await asAdmin("/admin/locations", {
      method: "POST",
      body: { id: contractLocationId, slug: "meierhof", name: "Meierhof", client_id: 999_999, contact_id: contactId },
    });
    assert.equal(mismatch.status, 422);
    assert.equal((await mismatch.json()).error, "contact_not_for_client");

    const data = await (await asAdmin("/admin/data")).json();
    assert.equal(data.clients.length >= 1, true);
    assert.equal(data.contacts.length >= 1, true);
    assert.equal(data.inventory.length >= 1, true);
    assert.ok(Array.isArray(data.portal_grants));
    assert.equal(data.locations.find((l) => l.id === contractLocationId).contact_name, "Frau Gruber");
  });

  // ---- POST /admin/shifts (T6: the phone died) --------------------------------------
  let phoneDeadWorkerId;
  await test("POST /admin/shifts creates a shift nobody tapped, marked by a NULL client_uuid", async () => {
    const created = await asAdmin("/admin/workers", {
      method: "POST",
      body: { name: "Dead Phone", hourly_rate_cents: 1400, phone: "0664/9999999" },
    });
    const worker = (await created.json()).worker;
    assert.equal(created.status, 201);
    phoneDeadWorkerId = worker.id;
    assert.equal(worker.phone, "0664/9999999", "the director asked for name and phone; phone must come back");

    const res = await asAdmin("/admin/shifts", {
      method: "POST",
      body: {
        worker_id: phoneDeadWorkerId,
        location_id: contractLocationId,
        start_time: new Date(Date.now() - 5 * 3600_000).toISOString(),
        end_time: new Date(Date.now() - 3 * 3600_000).toISOString(),
      },
    });
    const shift = (await res.json()).shift;
    assert.equal(res.status, 201, JSON.stringify(shift));
    assert.equal(shift.client_uuid, null, "a hand-entered shift is exactly one no phone ever keyed");
    assert.equal(shift.auto_closed, false, "auto_closed is a machine fact and is not an input here");
    assert.equal(shift.corrected_at, null);
  });

  await test("POST /admin/shifts rejects end before start and a future window", async () => {
    const backwards = await asAdmin("/admin/shifts", {
      method: "POST",
      body: {
        worker_id: phoneDeadWorkerId,
        location_id: contractLocationId,
        start_time: new Date(Date.now() - 3600_000).toISOString(),
        end_time: new Date(Date.now() - 7200_000).toISOString(),
      },
    });
    assert.equal(backwards.status, 422);
    assert.equal((await backwards.json()).error, "end_before_start");

    const future = await asAdmin("/admin/shifts", {
      method: "POST",
      body: {
        worker_id: phoneDeadWorkerId,
        location_id: contractLocationId,
        start_time: new Date(Date.now() + 3600_000).toISOString(),
        end_time: new Date(Date.now() + 7200_000).toISOString(),
      },
    });
    assert.equal(future.status, 422);
    assert.equal((await future.json()).error, "timestamp_in_future");
  });

  await test("POST /admin/shifts rejects an overlap, including with an OPEN shift", async () => {
    const before = await countShifts();
    const overlapping = await asAdmin("/admin/shifts", {
      method: "POST",
      body: {
        worker_id: phoneDeadWorkerId,
        location_id: contractLocationId,
        start_time: new Date(Date.now() - 4 * 3600_000).toISOString(),
        end_time: new Date(Date.now() - 2 * 3600_000).toISOString(),
      },
    });
    assert.equal(overlapping.status, 409);
    const conflict = await overlapping.json();
    assert.equal(conflict.error, "shift_overlap");
    assert.ok(conflict.shift, "409 must name the shift that is in the way");

    // An OPEN shift has end_time NULL, so it cannot be caught by comparing end times.
    await admin.query(
      "INSERT INTO shifts (worker_id, location_id, start_time, client_uuid) VALUES ($1, $2, now() - interval '30 minutes', 'open-dead-phone')",
      [phoneDeadWorkerId, contractLocationId],
    );
    const duringOpen = await asAdmin("/admin/shifts", {
      method: "POST",
      body: {
        worker_id: phoneDeadWorkerId,
        location_id: contractLocationId,
        start_time: new Date(Date.now() - 20 * 60_000).toISOString(),
        end_time: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
    });
    assert.equal(duringOpen.status, 409, "a worker on the clock cannot also be somewhere else");
    assert.equal(await countShifts(), before + 1, "a rejected shift must not be written");
    await admin.query("DELETE FROM shifts WHERE client_uuid = 'open-dead-phone'");
  });

  await test("POST /admin/shifts refuses an inactive worker or building", async () => {
    const noWorker = await asAdmin("/admin/shifts", {
      method: "POST",
      body: {
        worker_id: inactiveWorkerId,
        location_id: contractLocationId,
        start_time: new Date(Date.now() - 9 * 3600_000).toISOString(),
        end_time: new Date(Date.now() - 8 * 3600_000).toISOString(),
      },
    });
    assert.equal(noWorker.status, 422);
    assert.equal((await noWorker.json()).error, "unknown_worker");

    const noLocation = await asAdmin("/admin/shifts", {
      method: "POST",
      body: {
        worker_id: phoneDeadWorkerId,
        location_id: "00000000-0000-4000-8000-000000000000",
        start_time: new Date(Date.now() - 9 * 3600_000).toISOString(),
        end_time: new Date(Date.now() - 8 * 3600_000).toISOString(),
      },
    });
    assert.equal(noLocation.status, 422);
    assert.equal((await noLocation.json()).error, "unknown_location");
  });

  // ---- client portal (public trust boundary) ----------------------------------------
  // The link WILL be forwarded, screenshotted and pasted into a group chat. Everything
  // below asserts what an outsider holding it can and cannot learn.
  const SURNAME = "Musterfrau";
  const CLEANER_EMAIL = "anna.musterfrau@example.test";
  let portalToken;
  let portalLocationId; // its OWN building, so the payload assertions below are exact

  await test("a portal grant returns the raw token ONCE and stores only its SHA-256", async () => {
    resetLoginRate();
    const madeBuilding = await (
      await asAdmin("/admin/locations", {
        method: "POST",
        body: {
          slug: "portalhaus",
          name: "Portalhaus",
          address: "Taborstrasse 9, 1020 Wien",
          contact_id: contactId,
          monthly_contract_cents: 99_000,
          target_minutes_per_month: 600,
        },
      })
    ).json();
    portalLocationId = madeBuilding.location.id;

    const { rows } = await admin.query(
      "INSERT INTO workers (name, email, phone, hourly_rate_cents) VALUES ($1, $2, '+43 660 7654321', 3333) RETURNING id",
      [`Anna ${SURNAME}`, CLEANER_EMAIL],
    );
    const cleanerId = Number(rows[0].id);
    await admin.query(
      `INSERT INTO shifts (worker_id, location_id, start_time, end_time, client_uuid) VALUES
         ($1, $2, now() - interval '2 days',  now() - interval '2 days'  + interval '90 minutes', 'portal-1'),
         ($1, $2, now() - interval '9 days',  now() - interval '9 days'  + interval '75 minutes', 'portal-2')`,
      [cleanerId, portalLocationId],
    );
    // Must NOT appear: an unresolved 8h stub is a guess, and telling a client we cleaned
    // for eight hours when nobody confirmed it is worse than telling them nothing.
    await admin.query(
      `INSERT INTO shifts (worker_id, location_id, start_time, end_time, auto_closed, client_uuid)
       VALUES ($1, $2, now() - interval '3 days', now() - interval '3 days' + interval '8 hours', true, 'portal-stub')`,
      [cleanerId, portalLocationId],
    );
    // A shift at a DIFFERENT building, for the same cleaner. Must not leak.
    await admin.query(
      `INSERT INTO shifts (worker_id, location_id, start_time, end_time, client_uuid)
       VALUES ($1, $2, now() - interval '4 days', now() - interval '4 days' + interval '45 minutes', 'portal-other')`,
      [cleanerId, locationUuid],
    );

    const res = await asAdmin("/admin/portal-grants", {
      method: "POST",
      body: { contact_id: contactId, location_id: portalLocationId },
    });
    const issued = await res.json();
    assert.equal(res.status, 201, JSON.stringify(issued));
    portalToken = issued.token;
    assert.match(portalToken, /^[A-Za-z0-9_-]{43}$/, "32 CSPRNG bytes, url-safe, no percent-encoding");
    assert.equal(issued.path, `/portal/${portalToken}`);

    const stored = await admin.query("SELECT contact_id, location_id FROM portal_grants WHERE token_hash = $1", [
      hashToken(portalToken),
    ]);
    assert.equal(stored.rowCount, 1, "the grant must be stored under SHA-256(token)");
    assert.equal(stored.rows[0].location_id, portalLocationId);
    const raw = await admin.query("SELECT 1 FROM portal_grants WHERE token_hash = $1", [portalToken]);
    assert.equal(raw.rowCount, 0, "a leaked dump must not yield a working link");
  });

  await test("re-issuing a link revokes the previous one", async () => {
    const first = await (
      await asAdmin("/admin/portal-grants", {
        method: "POST",
        body: { contact_id: contactId, location_id: portalLocationId },
      })
    ).json();
    assert.equal((await call(`/portal/${portalToken}`, { key: null, ip: "10.9.0.1" })).status, 404);
    assert.equal((await call(`/portal/${first.token}`, { key: null, ip: "10.9.0.2" })).status, 200);
    portalToken = first.token;
    resetLoginRate();
  });

  await test("the portal payload answers the question and discloses NOTHING else", async () => {
    const res = await call(`/portal/${portalToken}`, { key: null, ip: "10.9.1.1" });
    assert.equal(res.status, 200);
    const text = await res.text();
    const data = JSON.parse(text);

    assert.equal(data.building.name, "Portalhaus");
    assert.deepEqual(Object.keys(data).sort(), ["building", "cleanings"]);
    assert.deepEqual(Object.keys(data.building), ["name"], "not even the building's address or id");
    assert.equal(data.cleanings.length, 2, "completed and confirmed cleanings only");
    for (const c of data.cleanings) {
      assert.deepEqual(Object.keys(c).sort(), ["date", "first_name", "minutes"]);
      assert.equal(c.first_name, "Anna", "FIRST NAME ONLY — GDPR minimum that answers the question");
      assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(Number.isInteger(c.minutes), true);
    }
    assert.equal(data.cleanings[0].minutes, 90, "newest first");

    for (const forbidden of [
      SURNAME, // worker surname
      CLEANER_EMAIL, // worker email
      "+43 660 7654321", // worker phone
      "3333", // hourly rate
      "apple_sub",
      "Checkhaus", // another building
      "Meierhof", // ...and another
      "Hausverwaltung", // the client company
      "Frau Gruber", // the contact
      "99000", // monthly contract volume
      "Allzweckreiniger", // inventory
      "Taborstrasse", // the building's address
      "portal-1", // client_uuid
      "shift_id",
      '"id"', // nothing enumerable at all
    ]) {
      assert.ok(!text.includes(forbidden), `portal payload must not contain ${forbidden}: ${text}`);
    }
    assert.equal(res.headers.get("cache-control"), "no-store", "a shared link must not be cached by a proxy");
  });

  await test("a revoked token and an unknown token 404 identically", async () => {
    const unknown = await call(`/portal/${"z".repeat(43)}`, { key: null, ip: "10.9.2.1" });
    assert.equal(unknown.status, 404);

    const revoked = await asAdmin(`/admin/portal-grants/${hashToken(portalToken)}`, { method: "DELETE" });
    assert.equal(revoked.status, 200);
    assert.notEqual((await revoked.json()).grant.revoked_at, null);

    const dead = await call(`/portal/${portalToken}`, { key: null, ip: "10.9.2.2" });
    assert.equal(dead.status, 404);
    assert.deepEqual(
      await dead.json(),
      await unknown.json(),
      "'this link used to work' is itself information about our client relationships",
    );
    assert.equal(
      (await admin.query("SELECT 1 FROM portal_grants WHERE token_hash = $1", [hashToken(portalToken)])).rowCount,
      1,
      "revoking is an UPDATE: 'we stopped sharing this in March' stays answerable",
    );
    resetLoginRate();
  });

  await test("a malformed portal token never reaches SQL, and the route is rate limited", async () => {
    resetLoginRate();
    const injection = await call(`/portal/${encodeURIComponent("'; DROP TABLE shifts; --")}`, {
      key: null,
      ip: "10.9.3.1",
    });
    assert.equal(injection.status, 404);
    assert.equal(await countShifts() > 0, true, "tables must be intact");

    const ip = "10.9.4.1";
    const codes = [];
    for (let i = 0; i < 7; i++) {
      codes.push((await call(`/portal/${"y".repeat(43)}`, { key: null, ip })).status);
    }
    assert.ok(codes.includes(429), `an unthrottled public route is a DoS lever, got ${codes}`);
    resetLoginRate();
  });

  await test("deactivating a contact or a building kills its live links", async () => {
    const grant = await (
      await asAdmin("/admin/portal-grants", {
        method: "POST",
        body: { contact_id: contactId, location_id: portalLocationId },
      })
    ).json();
    assert.equal((await call(`/portal/${grant.token}`, { key: null, ip: "10.9.5.1" })).status, 200);

    await asAdmin(`/admin/contacts/${contactId}`, { method: "DELETE" });
    assert.equal(
      (await call(`/portal/${grant.token}`, { key: null, ip: "10.9.5.2" })).status,
      404,
      "a contact who left the client company must lose access at that moment",
    );

    // ...and an inactive contact cannot be handed a new one.
    const reissue = await asAdmin("/admin/portal-grants", {
      method: "POST",
      body: { contact_id: contactId, location_id: portalLocationId },
    });
    assert.equal(reissue.status, 422);
    assert.equal((await reissue.json()).error, "unknown_contact");
    resetLoginRate();
  });

  // ---- access log + PII sweep (decision-23) ---------------------------------------
  // The defect that started this: a tap failed and the server had NO evidence at all.
  // These two cases pin the fix and its safety rail — there IS a line now, and the line
  // never carries a credential.

  /** Run `fn` with stdout/stderr collected. The access log fires on res 'finish'. */
  const withCapturedStdio = async (fn) => {
    const lines = [];
    const realLog = console.log;
    const realError = console.error;
    const grab = (...args) => lines.push(args.map((a) => String(a)).join(" "));
    console.log = grab;
    console.error = grab;
    try {
      await fn();
      // 'finish' lands a tick after the client has its response; without this the last
      // line is written after the capture is torn down and the case passes for the
      // wrong reason.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      console.log = realLog;
      console.error = realError;
    }
    return lines;
  };

  await test("the access log records a routed 200, a 404 and a 4xx with its error code", async () => {
    const lines = await withCapturedStdio(async () => {
      await call("/health");
      await call("/nope");
      await call("/shifts/open", {
        method: "POST",
        cookie: workerCookie,
        body: { client_uuid: uuid(70), location_uuid: uuid(99), start_time: new Date().toISOString() },
      });
    });
    const log = lines.join("\n");
    assert.match(log, /\[req\] GET \/health 200 \d+ms/, `routed 200 missing:\n${log}`);
    assert.match(log, /\[req\] GET \/nope 404 \d+ms/, `404 missing:\n${log}`);
    assert.match(
      log,
      /\[req\] POST \/shifts\/open 422 \d+ms w=\d+ err=unknown_location/,
      `the 4xx line must name the worker and the reason:\n${log}`,
    );
  });

  await test("no credential, cookie, token or email reaches stdout or stderr", async () => {
    const portalToken = "zZ".repeat(20) + "abc"; // 43 chars, the shape routes/portal.js mints
    const workerToken = workerCookie.split("=")[1];
    const identityToken = forgeToken({ sub: WORKER_SUB, email: "check.worker@example.test" });

    const lines = await withCapturedStdio(async () => {
      await call(`/portal/${portalToken}`, { key: null, ip: "10.9.9.1" }); // 404, path is logged
      await call("/roster", { cookie: workerCookie }); // app key + live session
      await appleLogin({ identity_token: identityToken }, { ip: "10.9.9.2" });
      await login(ADMIN_PASSWORD, { ip: "10.9.9.3" });
      await call("//", { key: null }); // the malformed-URL 400 branch
    });
    const log = lines.join("\n");

    for (const [what, secret] of [
      ["the portal token", portalToken],
      ["the worker session token", workerToken],
      ["the app key", APP_KEY],
      ["an Apple identity token", identityToken],
      ["the admin email", ADMIN_EMAIL],
      ["the admin password", ADMIN_PASSWORD],
      ["a worker email", "check.worker@example.test"],
    ]) {
      assert.ok(!log.includes(secret), `${what} reached the log:\n${log}`);
    }
    assert.match(log, /\[req\] GET \/portal\/<redacted> 404/, `the portal path must be redacted, not absent:\n${log}`);
    resetLoginRate();
  });

  // ---- GET /admin/data?from=&to= : the period the total describes (T4) --------------
  //
  // The defect this guards: the `hours` aggregate had NO date bound while the shift rows
  // were period-filtered in the browser and row-capped here, so on 3 August 2026 the panel
  // showed EUR 51.18 of July pay next to an empty August table. Totals that describe
  // different days from the rows beneath them is how somebody is paid twice, or not at all.
  //
  // Every boundary below is a VIENNA midnight expressed in UTC, which is what the admin
  // panel puts on the wire. July starts at 21:00/22:00 UTC the previous day depending on
  // the season, and that is exactly the hour that moves a shift between payslips.
  {
    const rangeWorker = Number(
      (
        await admin.query(
          "INSERT INTO workers (name, email, hourly_rate_cents) VALUES ('Range Worker', 'range.worker@example.test', 1000) RETURNING id",
        )
      ).rows[0].id,
    );

    // One hour each, so 1 shift = 1.000 h = 1000 cents at this worker's rate.
    const seed = async (startIso) =>
      Number(
        (
          await admin.query(
            `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
             VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '1 hour') RETURNING id`,
            [rangeWorker, locationUuid, startIso],
          )
        ).rows[0].id,
      );

    // Vienna 2026-07-31 23:59 (CEST, +02:00) - the last minute of July.
    const julyLast = await seed("2026-07-31T21:59:00Z");
    // Vienna 2026-08-01 00:00 - the first minute of August. One minute later, another month.
    const augustFirst = await seed("2026-07-31T22:00:00Z");
    // Vienna 2026-09-30 23:30 (CEST) - September, i.e. just OUTSIDE October.
    const septemberLast = await seed("2026-09-30T21:30:00Z");
    // Vienna 2026-10-01 00:30 (CEST) - the first hours of October.
    const octoberFirst = await seed("2026-09-30T22:30:00Z");
    // Vienna 2026-10-31 23:30 (CET, +01:00) - the last hours of October, AFTER the clocks
    // went back on 25 October. A period built with one fixed offset loses this shift.
    const octoberLast = await seed("2026-10-31T22:30:00Z");

    const VIENNA_JULY = { from: "2026-06-30T22:00:00Z", to: "2026-07-31T22:00:00Z" };
    const VIENNA_AUGUST = { from: "2026-07-31T22:00:00Z", to: "2026-08-31T22:00:00Z" };
    // Starts at +02:00 and ends at +01:00: a period whose two ends sit on opposite sides of
    // a daylight-saving change, and therefore 31 days AND one hour long.
    const VIENNA_OCTOBER = { from: "2026-09-30T22:00:00Z", to: "2026-10-31T23:00:00Z" };

    const data = async (params = "") =>
      (await asAdmin(`/admin/data?limit=2000${params}`)).json();
    const range = ({ from, to }) => `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const ids = (payload) => payload.shifts.map((s) => Number(s.id));
    const centsFor = (payload, workerId) =>
      Number(payload.hours.find((h) => h.worker_id === workerId)?.pay_cents ?? 0);

    await test("no from/to behaves exactly as it did before the parameter existed", async () => {
      const payload = await data();

      // The literal pre-change aggregate, run straight against the table.
      const { rows: expected } = await admin.query(
        `SELECT s.worker_id,
                ROUND(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0) * w.hourly_rate_cents) AS pay_cents
           FROM shifts s JOIN workers w ON w.id = s.worker_id
          WHERE s.end_time IS NOT NULL AND NOT (s.auto_closed AND s.corrected_at IS NULL)
          GROUP BY s.worker_id, w.hourly_rate_cents
          ORDER BY s.worker_id`,
      );
      const got = [...payload.hours].sort((a, b) => a.worker_id - b.worker_id);
      assert.deepEqual(
        got.map((h) => [h.worker_id, Number(h.pay_cents)]),
        expected.map((h) => [Number(h.worker_id), Number(h.pay_cents)]),
        "an unparameterised call must still return the all-time aggregate the iOS app and the dashboard expect",
      );

      const { rows: rowCount } = await admin.query("SELECT count(*)::int AS n FROM shifts");
      assert.equal(payload.shifts.length, rowCount[0].n, "and every shift row");
      assert.deepEqual(payload.shift_range, { from: null, to: null }, "and must say it applied no range");
    });

    await test("a Vienna month boundary puts each shift in exactly one month", async () => {
      const july = ids(await data(range(VIENNA_JULY)));
      const august = ids(await data(range(VIENNA_AUGUST)));

      assert.ok(july.includes(julyLast), "23:59 Vienna on 31 July is July");
      assert.ok(!july.includes(augustFirst), "00:00 Vienna on 1 August is not July");
      assert.ok(august.includes(augustFirst), "00:00 Vienna on 1 August is August");
      assert.ok(!august.includes(julyLast), "and 23:59 on 31 July is not August");
      // The two shifts are one minute apart. A UTC-midnight boundary would put both in
      // August and move an hour of pay onto the wrong payslip.
      assert.equal(
        july.filter((id) => id === julyLast || id === augustFirst).length +
          august.filter((id) => id === julyLast || id === augustFirst).length,
        2,
        "each shift lands in exactly one of the two months, never both and never neither",
      );
    });

    await test("a period that crosses the October clock change keeps its last day", async () => {
      const october = ids(await data(range(VIENNA_OCTOBER)));
      assert.ok(october.includes(octoberFirst), "00:30 Vienna on 1 October is October");
      assert.ok(october.includes(octoberLast), "23:30 Vienna on 31 October is October");
      assert.ok(!october.includes(septemberLast), "23:30 Vienna on 30 September is not October");

      // What a fixed +02:00 offset would have produced: the end bound one hour early, and
      // the last evening of the month silently unpaid. Asserted so the check states what it
      // is defending rather than merely passing.
      const naive = ids(await data(range({ from: VIENNA_OCTOBER.from, to: "2026-10-31T22:00:00Z" })));
      assert.ok(
        !naive.includes(octoberLast),
        "a period built with one fixed UTC offset must be visibly wrong, or this check proves nothing",
      );
    });

    await test("the hours total and the shift rows describe the SAME period", async () => {
      for (const [name, window] of [
        ["July", VIENNA_JULY],
        ["August", VIENNA_AUGUST],
        ["October", VIENNA_OCTOBER],
      ]) {
        const payload = await data(range(window));
        // Echoed as a canonical instant, so compare instants and not text.
        assert.deepEqual(
          [Date.parse(payload.shift_range.from), Date.parse(payload.shift_range.to)],
          [Date.parse(window.from), Date.parse(window.to)],
          `${name}: the server must echo the range it actually applied`,
        );

        // Recompute the total from the rows the same response returned, in integer cents.
        const ms = payload.shifts
          .filter((s) => s.worker_id === rangeWorker && s.end_time !== null)
          .reduce((sum, s) => sum + (Date.parse(s.end_time) - Date.parse(s.start_time)), 0);
        assert.equal(
          centsFor(payload, rangeWorker),
          Math.round((ms * 1000) / 3_600_000),
          `${name}: the aggregate must equal the rows shown beside it`,
        );
      }

      // The concrete regression: one payable hour in July, one in August, never both.
      assert.equal(centsFor(await data(range(VIENNA_JULY)), rangeWorker), 1000);
      assert.equal(centsFor(await data(range(VIENNA_AUGUST)), rangeWorker), 1000);
      assert.equal(centsFor(await data(range(VIENNA_OCTOBER)), rangeWorker), 2000);
    });

    await test("a bounded period still excludes unresolved auto-closed shifts (decision-10)", async () => {
      const { rows } = await admin.query(
        `INSERT INTO shifts (worker_id, location_id, start_time, end_time, auto_closed)
         VALUES ($1, $2, '2026-08-05T06:00:00Z', '2026-08-05T14:00:00Z', true) RETURNING id`,
        [rangeWorker, locationUuid],
      );
      const stub = Number(rows[0].id);
      const payload = await data(range(VIENNA_AUGUST));

      assert.ok(ids(payload).includes(stub), "the stub must still be VISIBLE so a human can resolve it");
      assert.equal(
        centsFor(payload, rangeWorker),
        1000,
        "but a start+8h guess must not become money just because a period was named",
      );

      await admin.query("UPDATE shifts SET corrected_at = now() WHERE id = $1", [stub]);
      assert.equal(
        centsFor(await data(range(VIENNA_AUGUST)), rangeWorker),
        9000,
        "and must count once a human has confirmed it",
      );
      await admin.query("DELETE FROM shifts WHERE id = $1", [stub]);
    });

    await test("shift_bounds ignores both the period and the row cap", async () => {
      const { rows } = await admin.query("SELECT min(start_time) AS lo, max(start_time) AS hi FROM shifts");
      for (const params of ["", range(VIENNA_JULY), "&limit=1"]) {
        const payload = await data(params);
        assert.equal(payload.shift_bounds.earliest, rows[0].lo.toISOString(), params);
        assert.equal(payload.shift_bounds.latest, rows[0].hi.toISOString(), params);
      }
      // Without this an empty list means "nobody worked" and "your data is gone" at once.
      assert.equal((await data(range({ from: "2020-01-01T00:00:00Z", to: "2020-02-01T00:00:00Z" }))).shifts.length, 0);
    });

    await test("garbage from/to is REFUSED, never ignored", async () => {
      const before = await countShifts();
      const bad = [
        ["from=nonsense", 400],
        ["from=30", 400], // new Date("30") is the year 2030 in V8, not NaN
        ["from=2026-08-01T00:00", 400], // no zone: would be read in the server's zone
        ["from=2026-08-01", 400], // date only, same reason
        ["to=' OR 1=1 --", 400],
        ["from=2026-08-01T00:00:00Z&to=2026-08-01T00:00:00Z", 422], // empty range
        ["from=2026-09-01T00:00:00Z&to=2026-08-01T00:00:00Z", 422], // inverted
        ["from=1799-01-01T00:00:00Z", 422], // outside any plausible ledger
      ];
      for (const [params, status] of bad) {
        const res = await asAdmin(`/admin/data?limit=2000&${params}`);
        assert.equal(res.status, status, `${params} must be refused, got ${res.status}`);
        const body = await res.json();
        assert.ok(body.error, `${params} must name the failure`);
        // Answering 200 with an empty list is the dangerous outcome: it is indistinguishable
        // from "nobody worked that month" and would be paid as such.
        assert.notEqual(res.status, 200);
      }
      assert.equal(await countShifts(), before, "and nothing may be written by a rejected query");
    });

    await test("a from/to that only bounds one side leaves the other unbounded", async () => {
      const onlyFrom = ids(await data("&from=2026-07-31T22:00:00Z"));
      assert.ok(onlyFrom.includes(augustFirst) && onlyFrom.includes(octoberLast));
      assert.ok(!onlyFrom.includes(julyLast));

      const onlyTo = ids(await data("&to=2026-07-31T22:00:00Z"));
      assert.ok(onlyTo.includes(julyLast));
      assert.ok(!onlyTo.includes(augustFirst));
    });

    await admin.query("DELETE FROM shifts WHERE worker_id = $1", [rangeWorker]);
    await admin.query("DELETE FROM workers WHERE id = $1", [rangeWorker]);
  }

  await test("unknown route returns a 404 code, not a stack trace", async () => {
    const res = await call("/nope");
    assert.equal(res.status, 404);
    const text = await res.text();
    assert.equal(JSON.parse(text).error, "not_found");
    assert.ok(!text.includes("at "), "no stack trace on the wire");
  });
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${pg.escapeIdentifier(SCHEMA)} CASCADE`);
  } catch {
    // best effort
  }
  await admin.end();
  const { pool } = await import("./lib/db.js").catch(() => ({ pool: null }));
  if (pool) await pool.end().catch(() => {});
}

console.log(failures === 0 ? "check-api: PASS" : `check-api: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
