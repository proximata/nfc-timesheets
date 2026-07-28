// Runnable self-check for the API. assert-based, no test framework.
//   node check-api.js
// Skips cleanly (exit 0) when no database is reachable, so it is safe in any environment.
// Runs against a throwaway Postgres schema; it never touches the real tables.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as rsaSign } from "node:crypto";
import pg from "pg";

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
  email TEXT UNIQUE CHECK (email = lower(email))
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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

const skip = (why) => {
  console.log(`check-api: SKIP (${why})`);
  process.exit(0);
};

let admin;
try {
  admin = new pg.Client({ connectionString: BASE_URL, connectionTimeoutMillis: 2000 });
  await admin.connect();
} catch (err) {
  skip(`no database reachable: ${err.message}`);
}

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

const uuid = (n) => `11111111-2222-4333-8444-5555555555${String(n).padStart(2, "0")}`;

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
