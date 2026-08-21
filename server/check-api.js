// Runnable self-check for the API. assert-based, no test framework.
//   node check-api.js
// Skips cleanly (exit 0) when no database is reachable, so it is safe in any environment.
// Runs against a throwaway Postgres schema; it never touches the real tables.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync, randomBytes, sign as rsaSign } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { CODE_TTL_MS } from "./lib/enrolment.js";
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
  -- decision-41: NO DEFAULT, and strictly positive. The default was the defect — an INSERT
  -- that omits the column silently made somebody cost EUR 0,00/h. Both halves are here
  -- because either one alone still lets a zero through.
  hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  apple_sub TEXT UNIQUE,
  email TEXT UNIQUE CHECK (email = lower(email)),
  phone TEXT,
  enrolment_code_hash TEXT UNIQUE,
  enrolment_code_expires_at TIMESTAMPTZ,
  enrolment_code_issued_at TIMESTAMPTZ,
  enrolment_code_issued_by BIGINT,
  enrolment_code_redeemed_at TIMESTAMPTZ,
  -- 009 (TASK-225): what this worker's phone last told us it is still holding. The two
  -- counts default to 0 and phone_last_seen_at stays NULL until a phone actually calls,
  -- which is what distinguishes "nothing pending" from "never heard from".
  phone_last_seen_at TIMESTAMPTZ,
  phone_pending_shifts INTEGER NOT NULL DEFAULT 0,
  phone_pending_blocked INTEGER NOT NULL DEFAULT 0,
  phone_pending_oldest_start TIMESTAMPTZ,
  CONSTRAINT workers_enrolment_code_pair
    CHECK ((enrolment_code_hash IS NULL) = (enrolment_code_expires_at IS NULL))
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
-- decision-45 / 007_operator_identity.sql, transcribed verbatim.
CREATE TABLE operators (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  enrolment_code_hash TEXT UNIQUE,
  enrolment_code_expires_at TIMESTAMPTZ,
  enrolment_code_issued_at TIMESTAMPTZ,
  enrolment_code_issued_by BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  enrolment_code_redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operators_enrolment_code_pair
    CHECK ((enrolment_code_hash IS NULL) = (enrolment_code_expires_at IS NULL))
);
CREATE TABLE phone_identities (
  phone_e164 TEXT PRIMARY KEY CHECK (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  worker_id BIGINT UNIQUE REFERENCES workers(id) ON DELETE SET NULL,
  operator_id BIGINT UNIQUE REFERENCES operators(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT phone_identities_claims CHECK (worker_id IS NOT NULL OR operator_id IS NOT NULL)
);
CREATE INDEX phone_identities_worker_idx ON phone_identities (worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX phone_identities_operator_idx ON phone_identities (operator_id) WHERE operator_id IS NOT NULL;
CREATE TABLE operator_sessions (
  token TEXT PRIMARY KEY,
  operator_id BIGINT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX operator_sessions_expires_at_idx ON operator_sessions (expires_at);
CREATE INDEX operator_sessions_operator_id_idx ON operator_sessions (operator_id);
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
  target_minutes_per_month INTEGER CHECK (target_minutes_per_month >= 0),
  geocoded_at TIMESTAMPTZ,
  geocode_status TEXT,
  street_view_status TEXT
);
CREATE INDEX locations_client_id_idx ON locations (client_id);
CREATE TABLE location_contracts (
  id BIGSERIAL PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES locations(id),
  client_id BIGINT REFERENCES clients(id),
  monthly_contract_cents INTEGER NOT NULL CHECK (monthly_contract_cents >= 0),
  target_minutes_per_month INTEGER CHECK (target_minutes_per_month >= 0),
  valid_from DATE NOT NULL,
  valid_to DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT location_contracts_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX location_contracts_one_current_idx
  ON location_contracts (location_id) WHERE valid_to IS NULL;
CREATE INDEX location_contracts_period_idx ON location_contracts (location_id, valid_from);
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (btrim(value) <> ''),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE material_requests (
  id BIGSERIAL PRIMARY KEY,
  worker_id BIGINT NOT NULL REFERENCES workers(id),
  location_id UUID REFERENCES locations(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'ordered', 'arrived', 'rejected')),
  admin_note TEXT,
  inventory_item_id BIGINT REFERENCES inventory_items(id),
  quantity INTEGER CHECK (quantity > 0),
  cost_cents INTEGER CHECK (cost_cents >= 0),
  decided_by BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  ordered_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX material_requests_worker_idx ON material_requests (worker_id, created_at DESC);
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
CREATE TABLE location_revenue (
  id BIGSERIAL PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES locations(id),
  month DATE NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  note TEXT,
  entered_by BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,
  superseded_by BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT location_revenue_month_start CHECK (EXTRACT(DAY FROM month) = 1)
);
CREATE UNIQUE INDEX location_revenue_one_live_idx
  ON location_revenue (location_id, month) WHERE superseded_at IS NULL;
CREATE INDEX location_revenue_month_idx ON location_revenue (month, location_id);
CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  note TEXT,
  area_sqm NUMERIC(8,2) CHECK (area_sqm > 0),
  tag_serial TEXT CHECK (tag_serial ~ '^[0-9A-F]{2}(:[0-9A-F]{2})+$'),
  tag_deployed_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX zones_location_id_idx ON zones (location_id);
CREATE UNIQUE INDEX zones_one_live_name_idx
  ON zones (location_id, lower(btrim(name))) WHERE active;
CREATE UNIQUE INDEX zones_tag_serial_idx ON zones (tag_serial) WHERE tag_serial IS NOT NULL;
ALTER TABLE zones ADD CONSTRAINT zones_id_location_key UNIQUE (id, location_id);
ALTER TABLE shifts
  ADD COLUMN start_zone_id UUID,
  ADD COLUMN end_zone_id UUID,
  ADD CONSTRAINT shifts_start_zone_fk
    FOREIGN KEY (start_zone_id, location_id) REFERENCES zones (id, location_id),
  ADD CONSTRAINT shifts_end_zone_fk
    FOREIGN KEY (end_zone_id, location_id) REFERENCES zones (id, location_id);
CREATE INDEX shifts_start_zone_idx ON shifts (start_zone_id, start_time DESC)
  WHERE start_zone_id IS NOT NULL;
-- 008_reported_tags.sql, transcribed verbatim.
CREATE TABLE reported_tags (
  id UUID PRIMARY KEY,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_by_operator_id BIGINT REFERENCES operators(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX reported_tags_unresolved_idx ON reported_tags (reported_at) WHERE resolved_at IS NULL;
CREATE TABLE tag_aliases (
  id UUID PRIMARY KEY REFERENCES reported_tags(id),
  zone_id UUID NOT NULL REFERENCES zones(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tag_aliases_zone_idx ON tag_aliases (zone_id);
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
  // decision-26. A live bearer credential: redeeming one mints a worker session. It
  // arrives as {"code": "..."} in a request body, so the bare `code` key has to go.
  enrolmentCode: "K7QF-3MZ2",
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
    extra: {
      password_hash: SECRETS.passwordHash,
      apple_sub: SECRETS.appleSub,
      // Three places an enrolment code could plausibly be attached by hand or by a future
      // SDK field: a bare `code` key, a nested one, and the spelled-out column name.
      code: SECRETS.enrolmentCode,
      body: { code: SECRETS.enrolmentCode },
      enrolment_code: SECRETS.enrolmentCode,
    },
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

// The `^code$` rule is anchored so it cannot eat the fields that make a 4xx diagnosable.
// Over-broad redaction is not "safe": it deletes the only evidence of what went wrong,
// and someone eventually turns it off.
await test("the code rule is anchored - status codes and error codes still survive", () => {
  const out = JSON.stringify(
    scrubEvent({
      contexts: { trace: { data: { "http.response.status_code": 401 } } },
      extra: { status_code: 429, error_code: "invalid_code", code: SECRETS.enrolmentCode },
    }),
  );
  assert.ok(!out.includes(SECRETS.enrolmentCode), `the enrolment code survived: ${out}`);
  const parsed = JSON.parse(out);
  assert.equal(parsed.contexts.trace.data["http.response.status_code"], 401);
  assert.equal(parsed.extra.status_code, 429);
  assert.equal(parsed.extra.error_code, "invalid_code", "the error CODE is diagnostics, not a secret");
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
    code: SECRETS.enrolmentCode,
    "ts.enrolment_code": SECRETS.enrolmentCode,
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

// TASK-223: run it the two WRONG ways and demand ONE line naming the right one, not a
// stack. This is the guard's own message under test — delete the guard in
// check-telemetry-wire.mjs and this fails, because a raw Node AssertionError stack is
// many lines and does not contain "run with:".
const misinvoke = (args, env) => {
  try {
    const out = execFileSync(process.execPath, args, {
      cwd: import.meta.dirname,
      env,
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out };
  } catch (err) {
    return { status: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};

await test("check-telemetry-wire refuses to run without --import: ONE line, no stack (TASK-223)", () => {
  const env = { ...process.env };
  delete env.SENTRY_DSN;
  const { status, out } = misinvoke(["check-telemetry-wire.mjs"], env);
  assert.notEqual(status, 0, "must exit non-zero");
  const trimmed = out.trim();
  assert.equal(trimmed.split("\n").length, 1, `expected exactly one line: ${out}`);
  assert.ok(trimmed.includes("run with:") && trimmed.includes("--import"), trimmed);
  assert.ok(!trimmed.includes("AssertionError") && !trimmed.includes("at file://"), `looks like a stack: ${out}`);
});

await test("check-telemetry-wire refuses to run without SENTRY_DSN: ONE line, no stack (TASK-223)", () => {
  const env = { ...process.env };
  delete env.SENTRY_DSN;
  const { status, out } = misinvoke(["--import", "./instrument.mjs", "check-telemetry-wire.mjs"], env);
  assert.notEqual(status, 0, "must exit non-zero");
  const trimmed = out.trim();
  assert.equal(trimmed.split("\n").length, 1, `expected exactly one line: ${out}`);
  assert.ok(trimmed.includes("run with:") && trimmed.includes("SENTRY_DSN="), trimmed);
  assert.ok(!trimmed.includes("TypeError") && !trimmed.includes("at file://"), `looks like a stack: ${out}`);
});

// ---- decision-6 arithmetic (no database needed) ------------------------------------
// The pro-rata split is the one piece of P&L arithmetic that can be wrong QUIETLY: the
// naive `round(total * share)` per building loses a cent on almost every three-way split
// and the columns simply never add up. Like the telemetry cases above, this runs before
// the database check so it is asserted on any machine at all.
{
  const { splitProRata } = await import("./lib/prorata.js");
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);

  await test("a pro-rata split gives back EXACTLY the pot, at every awkward ratio (decision-6)", () => {
    // 100 / 3 is the canonical loser: 33.33 each, three roundings, one cent gone.
    const thirds = splitProRata(100, [
      { key: "a", weight: 3600 },
      { key: "b", weight: 3600 },
      { key: "c", weight: 3600 },
    ]);
    assert.equal(sum(thirds), 100, "three equal buildings must still account for all 100 cents");
    assert.deepEqual([...thirds.values()].sort(), [33, 33, 34], "largest remainder, not three 33s");

    // Exhaustive over the shapes a real month produces: odd pots, lopsided hours, one
    // building that did almost nothing, and a pot of zero.
    const weightSets = [
      [1, 1],
      [1, 2, 3],
      [3600, 1],
      [3600, 3600, 3600, 3600, 3600, 3600, 3600],
      [86_400, 3_600, 1_800, 900, 60],
      [0, 3600, 0],
    ];
    for (const weights of weightSets) {
      for (const pot of [0, 1, 2, 7, 99, 100, 101, 999_999, 1_234_567]) {
        const entries = weights.map((weight, i) => ({ key: `l${i}`, weight }));
        const split = splitProRata(pot, entries);
        assert.equal(sum(split), pot, `pot ${pot} over ${weights} must sum back exactly`);
        // A building with no hours consumed none of the period's supplies. Nothing may be
        // handed to it by the remainder pass either.
        for (const [i, weight] of weights.entries()) {
          if (weight === 0) assert.equal(split.get(`l${i}`), 0, "zero hours must mean zero materials");
        }
      }
    }
  });

  await test("nothing to split by is NULL, not a silent pile of zeroes", () => {
    assert.equal(
      splitProRata(5000, [{ key: "a", weight: 0 }, { key: "b", weight: 0 }]),
      null,
      "materials bought in a month nobody worked cannot be attributed; the caller must report that",
    );
    assert.equal(splitProRata(0, []), null, "no buildings at all is the same answer");
  });

  await test("the split is deterministic and refuses nonsense input", () => {
    const entries = [
      { key: "b", weight: 1 },
      { key: "a", weight: 1 },
      { key: "c", weight: 1 },
    ];
    // A report that moves a cent between two buildings on refresh contradicts yesterday's
    // screenshot, which is how a director stops believing the whole screen.
    const once = splitProRata(100, entries);
    for (let i = 0; i < 5; i++) assert.deepEqual([...splitProRata(100, entries)], [...once]);
    assert.throws(() => splitProRata(1.5, entries), TypeError, "cents are integers");
    assert.throws(() => splitProRata(-1, entries), TypeError);
    assert.throws(() => splitProRata(10, [{ key: "a", weight: -1 }]), TypeError);
  });
}

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
  // A rate is supplied because 006 dropped the column's DEFAULT (decision-41). A fixture
  // that omits it now raises 23502 — which is the entire point of dropping it, and the
  // reason this line had to change at all.
  const { rows: seedInactive } = await admin.query(
    "INSERT INTO workers (name, email, hourly_rate_cents, active) VALUES ('Gone Worker', 'gone.worker@example.test', 1500, false) RETURNING id",
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
  // A scratch directory, empty to start — GET /app/version must answer {published:false}
  // against a directory with NOTHING in it, not 500. Individual releases cases write a
  // manifest (and, when they need one, a fake .apk) into this SAME directory mid-run:
  // routes/release.js re-reads the manifest on every request, so there is no server
  // restart needed between "nothing published" and "a build exists".
  const RELEASES_DIR = mkdtempSync(path.join(tmpdir(), "ts-check-releases-"));
  process.env.RELEASES_DIR = RELEASES_DIR;

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
  const call = (path, { method = "GET", body, key = APP_KEY, cookie, ip, headers = {} } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        ...(key === null ? {} : { "X-App-Key": key }),
        ...(cookie ? { Cookie: cookie } : {}),
        // The login rate limit buckets by caller address; every request from this
        // process would otherwise share one bucket and poison unrelated cases.
        ...(ip ? { "X-Forwarded-For": ip } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        // Arbitrary extras, LAST so a case can override any of the above. Added for the
        // X-Pending-* heartbeat (TASK-225), which is the only thing in this API that a
        // client states in a header rather than in a body.
        ...headers,
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
  // count(*) arrives as a NUMBER, not a string: lib/db.js registers an int8 parser on the
  // shared pg module and this raw client inherits it. Wrapped once here so no case has to
  // remember, and so a `"0"` typo cannot pass by accident.
  const countOf = async (sql, params = []) => Number((await admin.query(sql, params)).rows[0].n);

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

  // ---- what a phone is still holding (TASK-225, migration 009) ---------------------
  //
  // The office's half of the offline-tap problem. A cleaner taps in a basement, the row
  // is written on the phone and delivered later by a background job; these three headers
  // are how the director finds out, BEFORE month end, that hours exist which the server
  // has never seen. Recorded fire-and-forget in server.js, so every case below has to
  // wait for the write rather than read it straight off the response.

  const phoneRow = async () =>
    (
      await admin.query(
        `SELECT phone_last_seen_at, phone_pending_shifts, phone_pending_blocked, phone_pending_oldest_start
           FROM workers WHERE id = $1`,
        [workerId],
      )
    ).rows[0];

  /** The heartbeat UPDATE is deliberately not awaited by the request. Poll for it. */
  const untilPhone = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      const row = await phoneRow();
      if (predicate(row)) return row;
      await new Promise((r) => setTimeout(r, 20));
    }
    return await phoneRow();
  };

  await test("a worker request carrying X-Pending-* records what that phone is still holding", async () => {
    const oldest = "2026-08-20T04:15:00.000Z";
    const res = await asWorker("/roster", {
      headers: { "X-Pending-Shifts": "2", "X-Pending-Blocked": "1", "X-Pending-Oldest": oldest },
    });
    assert.equal(res.status, 200, "the heartbeat must never change the answer to the request");

    const row = await untilPhone((r) => r.phone_pending_shifts === 2);
    assert.equal(row.phone_pending_shifts, 2);
    assert.equal(row.phone_pending_blocked, 1, "blocked is counted SEPARATELY from waiting");
    assert.equal(row.phone_pending_oldest_start.toISOString(), oldest, "the oldest undelivered start survives");
    assert.ok(row.phone_last_seen_at, "…and we know when we last heard from the phone");
  });

  await test("a client that reports nothing updates last-seen but must NOT zero a real count", async () => {
    // THE BUG THIS PREVENTS: an iOS build, a curl, or an older Android calls the API and
    // silently overwrites a live Android count with an implied 0 — so the one screen that
    // says "this phone is holding two shifts" goes quiet while the shifts are still there.
    const before = await phoneRow();
    assert.equal(before.phone_pending_shifts, 2, "precondition: a real count is on the row");

    const seenBefore = before.phone_last_seen_at.getTime();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await asWorker("/roster")).status, 200);

    const row = await untilPhone((r) => r.phone_last_seen_at.getTime() > seenBefore);
    assert.equal(row.phone_pending_shifts, 2, "a silent client must not zero somebody else's queue");
    assert.equal(row.phone_pending_blocked, 1);
    assert.ok(row.phone_last_seen_at.getTime() > seenBefore, "…but 'we heard from this phone' is still recorded");
  });

  await test("an emptied queue is reported as zero, and the oldest start goes back to NULL", async () => {
    // X-Pending-Oldest is OMITTED, never sent empty, when there is nothing outstanding.
    // A NULL here is therefore a statement and must be written as one — leaving yesterday's
    // timestamp standing would tell the office work is still missing after it arrived.
    assert.equal((await asWorker("/roster", { headers: { "X-Pending-Shifts": "0" } })).status, 200);
    const row = await untilPhone((r) => r.phone_pending_shifts === 0);
    assert.equal(row.phone_pending_shifts, 0);
    assert.equal(row.phone_pending_blocked, 0);
    assert.equal(row.phone_pending_oldest_start, null, "an absent oldest header clears the column");
  });

  await test("a garbage or hostile heartbeat is ignored, never trusted and never a 500", async () => {
    for (const headers of [
      { "X-Pending-Shifts": "-4" },
      { "X-Pending-Shifts": "1e9" },
      { "X-Pending-Shifts": "'; DROP TABLE workers;--" },
      { "X-Pending-Shifts": "999999999999999999999" },
      { "X-Pending-Shifts": "3", "X-Pending-Oldest": "not a date" },
      { "X-Pending-Shifts": "3", "X-Pending-Oldest": "2099-01-01T00:00:00Z" },
    ]) {
      const res = await asWorker("/roster", { headers });
      assert.equal(res.status, 200, `a bad heartbeat must not change the answer: ${JSON.stringify(headers)}`);
    }
    // The two well-formed-count rows above did land; both carry an unusable date, so the
    // column must be NULL rather than holding a phone's broken clock.
    const row = await untilPhone((r) => r.phone_pending_shifts === 3);
    assert.equal(row.phone_pending_shifts, 3, "a valid count alongside a bad date still counts");
    assert.equal(row.phone_pending_oldest_start, null, "an unparseable or far-future date is dropped, not stored");
    assert.equal(
      await countOf("SELECT count(*) AS n FROM workers"),
      await countOf("SELECT count(*) AS n FROM workers"),
      "…and the table is still there",
    );
  });

  await test("the heartbeat never leaks a session: a worker cannot report for anybody else", async () => {
    // decision-22 from the other side. The count is filed against the SESSION's worker and
    // there is no id in the header — so a phone cannot claim somebody else is offline.
    const before = await phoneRow();
    const res = await asOther("/roster", { headers: { "X-Pending-Shifts": "77" } });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal((await phoneRow()).phone_pending_shifts, before.phone_pending_shifts, "another session's heartbeat lands on THAT worker");
  });

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

  // ---- enrolment codes (decision-26) ----------------------------------------------
  // A code is a low-entropy bearer credential spoken over the phone. Everything below is
  // a property that makes 40 bits safe; none of them is optional.
  {
    const { rows: enrolSeed } = await admin.query(
      "INSERT INTO workers (name, hourly_rate_cents) VALUES ('Enrol Worker', 1400) RETURNING id",
    );
    const enrolWorkerId = Number(enrolSeed[0].id);

    // Tee stdout/stderr for the whole section. The last case asserts that not one code
    // minted here reached a line — the access log, the 500 line, anything. Nothing is
    // suppressed: the real streams still get everything, so a failure is still readable.
    const logged = [];
    const realLog = console.log;
    const realError = console.error;
    console.log = (...args) => {
      logged.push(args.map(String).join(" "));
      realLog(...args);
    };
    console.error = (...args) => {
      logged.push(args.map(String).join(" "));
      realError(...args);
    };

    const minted = []; // every plaintext this section has ever seen, canonical + display

    const issueCode = (workerId) =>
      call(`/admin/workers/${workerId}/enrolment-code`, { method: "POST", key: null, cookie: adminCookie });
    const revokeCode = (workerId) =>
      call(`/admin/workers/${workerId}/enrolment-code`, { method: "DELETE", key: null, cookie: adminCookie });
    const redeem = (code, ip) => call("/auth/code", { method: "POST", body: { code }, ip });

    const freshCode = async (workerId = enrolWorkerId) => {
      const res = await issueCode(workerId);
      assert.equal(res.status, 201, `issue should return 201, got ${res.status}`);
      const code = (await res.json()).code;
      minted.push(code, code.replace("-", ""));
      return code;
    };

    const codeRowState = async (workerId = enrolWorkerId) =>
      (
        await admin.query(
          `SELECT enrolment_code_hash IS NOT NULL AS has_code, enrolment_code_expires_at,
                  enrolment_code_issued_at, enrolment_code_issued_by, enrolment_code_redeemed_at
             FROM workers WHERE id = $1`,
          [workerId],
        )
      ).rows[0];

    // Crockford base32 minus I, L, O, U — the misread pairs, plus the letter that spells
    // things nobody wants to read down a phone line.
    const CODE_SHAPE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

    await test("an issued code has an unambiguous alphabet, an expiry, and an audit trail", async () => {
      const before = Date.now();
      const res = await issueCode(enrolWorkerId);
      assert.equal(res.status, 201);
      const body = await res.json();
      minted.push(body.code, body.code.replace("-", ""));

      assert.match(body.code, CODE_SHAPE, `0/O and 1/I/L are a support-call generator: ${body.code}`);
      assert.equal(body.worker.id, enrolWorkerId);

      // AGAINST THE CONSTANT, not against a second copy of the number. This assertion read
      // "~60 min" for a day after 6e5fb96 raised the TTL to five days at the operator's
      // request; the code and its justification block moved and the check did not, so a
      // green suite went red for a reason that was not a defect. Importing CODE_TTL_MS
      // alone would make it vacuous, so the CONSTANT ITSELF is bounded too: anything
      // outside minutes-to-a-fortnight is a typo, whatever both sides agree on.
      const ttl = new Date(body.expires_at).getTime() - before;
      assert.ok(
        CODE_TTL_MS >= 10 * 60_000 && CODE_TTL_MS <= 14 * 24 * 3_600_000,
        `CODE_TTL_MS is ${CODE_TTL_MS}ms — a code that lives that long is a decision, not an edit`,
      );
      assert.ok(
        ttl >= CODE_TTL_MS - 60_000 && ttl <= CODE_TTL_MS + 60_000,
        `expected the wire to carry CODE_TTL_MS (${CODE_TTL_MS}ms), got ${ttl}ms`,
      );

      const row = await codeRowState();
      assert.equal(row.has_code, true, "the hash must be stored");
      assert.ok(row.enrolment_code_issued_at, "who/when is the audit trail decision-26 asked for");
      assert.ok(row.enrolment_code_issued_by, "the issuing admin must be recorded");
      assert.equal(row.enrolment_code_redeemed_at, null, "a fresh code has not been redeemed");

      // The stored value is a hash, never the code. A pg_dump must not replay.
      const stored = (
        await admin.query("SELECT enrolment_code_hash FROM workers WHERE id = $1", [enrolWorkerId])
      ).rows[0].enrolment_code_hash;
      assert.match(stored, /^[0-9a-f]{64}$/, "only SHA-256(code) may be stored");
      assert.equal(stored, hashToken(body.code.replace("-", "")), "stored hash must be of the canonical form");
    });

    await test("the plaintext is shown EXACTLY once - /admin/data can never hand it back", async () => {
      const code = await freshCode();
      const raw = await (await call("/admin/data", { key: null, cookie: adminCookie })).text();
      assert.ok(!raw.includes(code), "the code came back from /admin/data");
      assert.ok(!raw.includes(code.replace("-", "")), "the canonical form came back from /admin/data");
      assert.ok(!raw.includes("enrolment_code_hash"), "the hash is not the panel's business either");

      const worker = JSON.parse(raw).workers.find((w) => w.id === enrolWorkerId);
      assert.ok(worker.enrolment_code_expires_at, "but the panel must be able to say a code is live");
    });

    let enrolCookie = null;

    await test("a valid code mints the SAME session Sign in with Apple mints", async () => {
      resetLoginRate();
      const code = await freshCode();
      const before = await sessionRows();

      const res = await redeem(code, "10.5.1.1");
      // Read the body ONCE: a template literal in an assert message is evaluated eagerly,
      // so `got ${await res.text()}` would consume it before res.json() ever runs.
      const raw200 = await res.text();
      assert.equal(res.status, 200, `redemption should succeed, got ${raw200}`);
      const body = JSON.parse(raw200);
      assert.deepEqual(
        Object.keys(body).sort(),
        ["expires_at", "worker"],
        "one session system: the body must match /auth/apple exactly",
      );
      assert.equal(body.worker.id, enrolWorkerId);
      assert.equal(body.worker.name, "Enrol Worker");

      const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
      assert.match(raw, /^ts_worker=/, "the same cookie name Apple sign-in sets");
      assert.ok(/HttpOnly/i.test(raw) && /Secure/i.test(raw) && /SameSite=Strict/i.test(raw), raw);
      assert.ok(!raw.includes(code.replace("-", "")), "the cookie is a session token, not the code");

      assert.equal(await sessionRows(), before + 1, "exactly one worker_sessions row");
      enrolCookie = cookieFrom(res);

      // The point of the whole mechanism: this session is a worker identity downstream.
      const roster = await call("/roster", { cookie: enrolCookie });
      assert.equal(roster.status, 200);
      assert.equal((await roster.json()).worker.id, enrolWorkerId);

      const row = await codeRowState();
      assert.equal(row.has_code, false, "redeeming must CLEAR the code");
      assert.equal(row.enrolment_code_expires_at, null, "and its expiry with it");
      assert.ok(row.enrolment_code_redeemed_at, "and record when it was used");
    });

    await test("whatever a tired cleaner types is normalised - O/0 and I/L/1, case, spaces", async () => {
      resetLoginRate();
      const code = await freshCode();
      const typed = code
        .toLowerCase()
        .replace(/0/g, "o")
        .replace(/1/g, "l")
        .replace("-", " - ");
      const res = await redeem(typed, "10.5.1.2");
      assert.equal(res.status, 200, `"${typed}" must be accepted, got ${res.status}`);
    });

    await test("a code is SINGLE USE - the second attempt fails and mints nothing", async () => {
      resetLoginRate();
      const code = await freshCode();
      assert.equal((await redeem(code, "10.5.1.3")).status, 200);

      const before = await sessionRows();
      const again = await redeem(code, "10.5.1.4");
      assert.equal(again.status, 401);
      assert.equal(cookieFrom(again), null, "a spent code must not mint a cookie");
      assert.equal(await sessionRows(), before, "...nor a session row");
    });

    await test("issuing a new code REPLACES the previous one (one worker, one live code)", async () => {
      resetLoginRate();
      const first = await freshCode();
      const second = await freshCode();
      assert.notEqual(first, second);
      assert.equal((await redeem(first, "10.5.1.5")).status, 401, "the replaced code must be dead");
      assert.equal((await redeem(second, "10.5.1.6")).status, 200);
    });

    await test("revoke is immediate, idempotent, and does not need the plaintext", async () => {
      resetLoginRate();
      const code = await freshCode();
      const res = await revokeCode(enrolWorkerId);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).worker.enrolment_code_expires_at, null);
      assert.equal((await codeRowState()).has_code, false);
      assert.equal((await redeem(code, "10.5.1.7")).status, 401);

      assert.equal((await revokeCode(enrolWorkerId)).status, 200, "revoking twice must not be an error");
      // The audit trail outlives the secret - that is what it is for.
      assert.ok((await codeRowState()).enrolment_code_issued_at, "who issued it must survive revocation");
      assert.equal((await revokeCode(999_999)).status, 404);
    });

    await test("EVERY rejection is byte-identical - expired must not be distinguishable", async () => {
      resetLoginRate();
      const outcomes = {};

      // unknown: correctly shaped, never issued
      outcomes.unknown = await redeem("ZZZZ-ZZZZ", "10.5.2.1");
      // malformed: not even the right shape
      outcomes.malformed = await redeem("nope!!", "10.5.2.2");
      // missing: no field at all
      outcomes.missing = await call("/auth/code", { method: "POST", body: {}, ip: "10.5.2.3" });

      // expired: real code, one minute past its expiry
      const expired = await freshCode();
      await admin.query(
        "UPDATE workers SET enrolment_code_expires_at = now() - interval '1 minute' WHERE id = $1",
        [enrolWorkerId],
      );
      outcomes.expired = await redeem(expired, "10.5.2.4");

      // already redeemed
      const spent = await freshCode();
      assert.equal((await redeem(spent, "10.5.2.5")).status, 200);
      outcomes.redeemed = await redeem(spent, "10.5.2.6");

      // revoked by the admin
      const revoked = await freshCode();
      await revokeCode(enrolWorkerId);
      outcomes.revoked = await redeem(revoked, "10.5.2.7");

      // live code, worker deactivated underneath it
      const orphaned = await freshCode();
      await admin.query("UPDATE workers SET active = false WHERE id = $1", [enrolWorkerId]);
      outcomes.inactive = await redeem(orphaned, "10.5.2.8");
      await admin.query("UPDATE workers SET active = true WHERE id = $1", [enrolWorkerId]);

      const seen = [];
      for (const [name, res] of Object.entries(outcomes)) {
        seen.push(`${name}=${res.status}:${await res.text()}`);
        assert.equal(cookieFrom(res), null, `${name} must not mint a cookie`);
      }
      const shapes = new Set(seen.map((s) => s.split("=")[1]));
      assert.equal(
        shapes.size,
        1,
        `every rejection must be identical in status AND body, got ${[...shapes].join(" | ")}`,
      );
      assert.equal([...shapes][0], '401:{"error":"invalid_code"}');
    });

    await test("redemption is rate limited per IP - a shared secret needs a hard floor", async () => {
      resetLoginRate();
      const ip = "10.5.3.1";
      const codes = [];
      for (let i = 0; i < 7; i++) codes.push((await redeem("ZZZZ-ZZZY", ip)).status);
      assert.ok(codes.slice(0, 5).every((c) => c === 401), `first 5 should be 401, got ${codes}`);
      assert.ok(codes.includes(429), `an unthrottled code endpoint is a guessing oracle, got ${codes}`);

      // The lockout must apply to a GOOD code too, or it is not a lockout.
      const good = await freshCode();
      const locked = await redeem(good, ip);
      assert.equal(locked.status, 429);
      assert.ok(Number(locked.headers.get("retry-after")) > 0, "429 must say when to come back");
      // ...and must not spill onto an unrelated caller.
      assert.equal((await redeem(good, "10.5.3.2")).status, 200);
      resetLoginRate();
    });

    await test("a GLOBAL ceiling bounds the SHARED search space, not just one address", async () => {
      // The per-IP limiter does nothing against IP rotation, and every live code in the
      // system is a valid answer to a guess - so an attacker walks one shared space, not
      // one worker's. This is the bound that makes the arithmetic in lib/enrolment.js hold.
      resetLoginRate();
      const statuses = [];
      for (let i = 0; i < 40; i++) statuses.push((await redeem("ZZZZ-ZZZX", `10.5.4.${i}`)).status);
      const firstThrottled = statuses.indexOf(429);
      assert.ok(firstThrottled >= 0, `40 guesses from 40 addresses must be throttled, got ${statuses}`);
      assert.ok(
        firstThrottled <= 30,
        `the global ceiling must bite by the 31st attempt, first 429 at ${firstThrottled}`,
      );
      assert.equal((await (await redeem("ZZZZ-ZZZX", "10.5.4.99")).json()).error, "too_many_attempts");
      resetLoginRate();
    });

    await test("two racing redemptions of one code yield EXACTLY one session", async () => {
      resetLoginRate();
      const code = await freshCode();
      const before = await sessionRows();

      // Distinct addresses so the per-IP limiter cannot be what makes this pass - the
      // database has to be what decides it.
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => redeem(code, `10.5.5.${i}`)),
      );
      const won = results.filter((r) => r.status === 200);
      const lost = results.filter((r) => r.status === 401);
      assert.equal(won.length, 1, `exactly one racer may win, got ${results.map((r) => r.status)}`);
      assert.equal(lost.length, 7, `the rest must lose with 401, got ${results.map((r) => r.status)}`);
      assert.equal(await sessionRows(), before + 1, "a race must not mint two sessions");
      assert.equal((await codeRowState()).has_code, false);
    });

    await test("issuing needs an admin session, and never for a deactivated worker", async () => {
      assert.equal((await call(`/admin/workers/${enrolWorkerId}/enrolment-code`, { method: "POST" })).status, 401);
      assert.equal(
        (await call(`/admin/workers/${enrolWorkerId}/enrolment-code`, { method: "DELETE" })).status,
        401,
        "the app key must not authorise revocation either",
      );
      assert.equal((await issueCode(inactiveWorkerId)).status, 404, "a live code for someone let go");
      assert.equal((await issueCode(999_999)).status, 404);
      assert.equal(
        (await call("/auth/code", { method: "POST", key: null, body: { code: "ZZZZ-ZZZZ" } })).status,
        401,
        "/auth/code keeps the coarse app-key gate in front of it",
      );
    });

    await test("NO code this section minted reached a log line or a telemetry payload", async () => {
      console.log = realLog;
      console.error = realError;

      assert.ok(minted.length >= 20, `this case is vacuous without codes to look for (${minted.length})`);
      assert.ok(
        logged.some((line) => line.includes("[req] POST /auth/code")),
        "the access log must actually have logged these requests, or this proves nothing",
      );

      const haystack = logged.join("\n");
      for (const code of minted) {
        assert.ok(!haystack.includes(code), `an enrolment code reached a log line: ${code.slice(0, 2)}\u2026`);
      }

      // ...and the same values through the telemetry boundary, in the shape they arrive in.
      const event = scrubEvent({
        transaction: "POST /auth/code",
        request: { data: { code: minted[0] }, url: "https://timesheets.exe.xyz/auth/code" },
        extra: { body: { code: minted[0] }, enrolment_code: minted[1] },
      });
      const wire = JSON.stringify(event);
      for (const code of minted) {
        assert.ok(!wire.includes(code), "an enrolment code reached a Sentry payload");
      }
      const attrs = JSON.stringify(scrubLogAttributes({ code: minted[0], "ts.enrolment_code": minted[1] }));
      for (const code of minted) assert.ok(!attrs.includes(code), "an enrolment code reached a log attribute");
    });

    // Belt and braces: restore even if the case above never ran.
    console.log = realLog;
    console.error = realError;

    await admin.query("DELETE FROM worker_sessions WHERE worker_id = $1", [enrolWorkerId]);
    await admin.query("DELETE FROM workers WHERE id = $1", [enrolWorkerId]);
    resetLoginRate();
  }

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

  // ---- the recovery wire: GET /shifts/open + /shifts/unresolved --------------------
  //
  // Both clients are growing a shift screen that takes the app over while a shift runs,
  // plus a signal OUTSIDE the app (Android ongoing notification, iOS Live Activity and
  // icon badge). After a reinstall, a new phone, or a signal the OS dropped, the phone's
  // own copy of "a shift is running" is gone and these two routes are the only thing left
  // that knows (decision-19). Nothing was added for them - no route, no field, no
  // migration 006. This section exists to FREEZE what they already answer, so the next
  // refactor cannot quietly drop a key the shipped iOS build in daily use decodes.

  // The payload is a contract with a build that is on workers' phones RIGHT NOW. Adding a
  // key is a deliberate act (old clients ignore unknown JSON, so it is safe); removing or
  // renaming one breaks the lock screen, the adopt path, or the ability to clock out at all.
  const OPEN_SHIFT_KEYS = [
    "auto_closed", //   \ decision-10: "needs confirming" is derived from exactly these
    "client_uuid", //   the idempotency key - without it an ADOPTED shift can never be CLOSED
    "corrected_at", //  /
    "end_time",
    // decision-43, ADDED not renamed: the two tap facts and the door's name. Both clients
    // in the field ignore unknown JSON keys, so adding is safe where removing never is.
    // NULL here means "a building-level tag was tapped" - which is what the card on the
    // wall at HOIV does, and will keep doing for ever.
    "end_zone_id",
    "id",
    "location_id", //   "is the next tap the same building, or a switch?"
    "location_name", // the lock screen names the building with no second round trip
    "location_slug", // display and log lines only, never back into a tag URI (decision-21)
    "start_time", //    the ticking clock, AND the locally computed start+8h flip
    "start_zone_id",
    "worker_id",
    "zone_name", //     the running screen names the DOOR, nullable, no second round trip
  ];

  const lockStart = new Date(Date.now() - 3600_000).toISOString();
  const lockOpen = { client_uuid: uuid(20), location_uuid: locationUuid, start_time: lockStart };

  await test("GET /shifts/open carries everything a reinstalled phone needs to re-arm the signal", async () => {
    assert.equal((await asWorker("/shifts/open", { method: "POST", body: lockOpen })).status, 201);

    const res = await asWorker("/shifts/open");
    assert.equal(res.status, 200);
    const { shift } = await res.json();
    assert.deepEqual(
      Object.keys(shift).sort(),
      OPEN_SHIFT_KEYS,
      "this payload is a contract with the LIVE iOS build - a removed key is a broken clock-out",
    );
    assert.equal(shift.client_uuid, uuid(20), "adopt must be able to close the shift it adopted");
    assert.equal(new Date(shift.start_time).toISOString(), lockStart, "the clock ticks from this");
    assert.equal(shift.location_name, "Checkhaus", "the lock screen names the building from this");
    assert.equal(shift.location_id, locationUuid);
    assert.equal(shift.end_time, null);
    assert.equal(shift.auto_closed, false);
    assert.equal(shift.corrected_at, null);
  });

  await test("not being clocked in is 200 {shift:null}, never a 4xx - a miss is not a rejection", async () => {
    // A thrown call means "unknown, keep what I have". If the ordinary not-clocked-in case
    // errored, every worker between shifts would keep a stale lock screen and a stale
    // notification. The same bug class already cost this project a dead tag tap.
    const res = await asOther("/shifts/open");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).shift, null);
  });

  await test("two workers clocked in at once each see ONLY their own running shift", async () => {
    const theirs = { client_uuid: uuid(21), location_uuid: locationUuid, start_time: lockStart };
    assert.equal((await asOther("/shifts/open", { method: "POST", body: theirs })).status, 201);

    const mine = (await (await asWorker("/shifts/open")).json()).shift;
    const other = (await (await asOther("/shifts/open")).json()).shift;
    assert.equal(mine.client_uuid, uuid(20));
    assert.equal(mine.worker_id, workerId);
    assert.equal(other.client_uuid, uuid(21), "and the positive direction too: they see THEIRS");
    assert.equal(other.worker_id, otherWorkerId);
    assert.notEqual(mine.id, other.id, "one worker's lock screen must never show another's shift");
  });

  await test("the REAL 8h timer flips the wire from 'running' to 'needs confirming'", async () => {
    // ops/sql/autoclose.sql itself, not a paraphrase of it: this check is worthless if it
    // asserts against a copy that has drifted from what nfc-autoclose.timer actually runs.
    const autocloseSql = readFileSync(new URL("../ops/sql/autoclose.sql", import.meta.url), "utf8");
    // Mine started 9h ago -> stale. Theirs is 1h old and must be left alone.
    await admin.query("UPDATE shifts SET start_time = now() - interval '9 hours' WHERE client_uuid = $1", [uuid(20)]);
    await admin.query("UPDATE shifts SET start_time = now() - interval '1 hour' WHERE client_uuid = $1", [uuid(21)]);
    const fired = await admin.query(autocloseSql);
    assert.equal(fired.rowCount, 1, "exactly the stale shift, and only it");

    // Running -> nothing running. The client MUST NOT keep a ticking clock here.
    assert.equal((await (await asWorker("/shifts/open")).json()).shift, null);

    const { shifts } = await (await asWorker("/shifts/unresolved")).json();
    assert.equal(shifts.length, 1, "it has to reappear as something the worker must confirm");
    const flipped = shifts[0];
    assert.equal(flipped.client_uuid, uuid(20));
    assert.equal(flipped.auto_closed, true);
    assert.equal(flipped.corrected_at, null);
    assert.equal(flipped.location_name, "Checkhaus", "the flipped screen still has to name the building");
    assert.equal(
      new Date(flipped.end_time) - new Date(flipped.start_time),
      8 * 3600_000,
      "the timer closes at start+8h - this is the boundary both clients compute locally",
    );

    // The fresh shift is untouched and its worker's signal stays armed.
    const stillRunning = (await (await asOther("/shifts/open")).json()).shift;
    assert.equal(stillRunning.client_uuid, uuid(21));
    assert.equal(stillRunning.end_time, null);

    // ...and nobody else's lock screen is told about it.
    assert.equal((await (await asOther("/shifts/unresolved")).json()).shifts.length, 0);
  });

  await test("the LIVE iOS build's exact request shapes still work, unchanged", async () => {
    // Byte-for-byte the bodies API.swift sends today: no auto_closed on close, no field
    // this server has not always accepted. If this ever fails, a phone in daily use has
    // stopped being able to clock out.
    const legacy = uuid(22);
    const start = new Date(Date.now() - 1800_000).toISOString();
    const end = new Date().toISOString();

    await asOther("/shifts/close", { method: "POST", body: { client_uuid: uuid(21), end_time: end } });

    const opened = await asWorker("/shifts/open", {
      method: "POST",
      body: { client_uuid: legacy, location_uuid: locationUuid, start_time: start },
    });
    assert.equal(opened.status, 201);
    const closed = await asWorker("/shifts/close", { method: "POST", body: { client_uuid: legacy, end_time: end } });
    assert.equal(closed.status, 200);
    assert.equal((await closed.json()).shift.auto_closed, false, "an omitted auto_closed still means false");

    // And forwards: a NEWER client sending a field this server does not know must be
    // served, not refused - otherwise shipping an app update requires a server deploy
    // first, which is not a sequence anyone can guarantee on TestFlight.
    const forward = await asWorker("/shifts/open", {
      method: "POST",
      body: { client_uuid: uuid(23), location_uuid: locationUuid, start_time: start, signal_armed: true },
    });
    assert.equal(forward.status, 201, "an unknown extra field is ignored, never a 400");
    await asWorker("/shifts/close", { method: "POST", body: { client_uuid: uuid(23), end_time: end } });
  });

  // Leave the schema as this section found it: no open shifts (POST /admin/shifts asserts
  // overlap against them) and no unresolved rows (the payroll aggregate asserts on those).
  await admin.query("DELETE FROM shifts WHERE client_uuid = ANY($1)", [[uuid(20), uuid(21), uuid(22), uuid(23)]]);

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
      body: { name: "Typo Worker", hourly_rate_cents: 1500, email: "anna at example dot at" },
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid_email");

    const dup = await call("/admin/workers", {
      method: "POST",
      key: null,
      cookie: adminCookie,
      body: { name: "Clone", hourly_rate_cents: 1500, email: "check.worker@example.test" },
    });
    assert.equal(dup.status, 409, "two people must not share a login");
    assert.equal((await dup.json()).error, "email_taken");
  });

  // decision-41 · A WAGE IS REQUIRED, ON BOTH BRANCHES OF THE UPSERT.
  //
  // `v.cents()` did `(value ?? 0)` and the column defaulted to 0, so a worker created
  // without a rate silently cost EUR 0,00/h. Eleven lines below it in validate.js,
  // `optionalCents` carried the comment that named the defect: NULL = "nobody has told me",
  // 0 = "free of charge". Contract money got that distinction; wages never did.
  await test("a worker cannot be created OR EDITED without a rate (decision-41)", async () => {
    const post = (body) => call("/admin/workers", { method: "POST", key: null, cookie: adminCookie, body });

    // CREATE. Absent, null and "" are the three shapes a form produces; 0 is what a
    // director types when they mean "I will fill it in later".
    for (const rate of [undefined, null, "", 0]) {
      const body = { name: "Rateless" };
      if (rate !== undefined) body.hourly_rate_cents = rate;
      const res = await post(body);
      assert.equal(res.status, 422, `rate ${JSON.stringify(rate)} must be refused, got ${res.status}`);
      const payload = await res.json();
      // ONE code for both absent and zero: the director does exactly one thing about
      // either, and two codes would be two message keys in two locales carrying one
      // instruction. RED: revert the call site to v.cents and every one of these is a 201.
      assert.equal(payload.error, "rate_required");
      assert.equal(payload.field, "hourly_rate_cents", "the refusal must NAME the field");
    }
    assert.equal(
      await countOf("SELECT count(*) AS n FROM workers WHERE name = 'Rateless'"),
      0,
      "and nothing may have been written by a refused create",
    );

    // 400 vs 422 is the house line and it must not blur: a malformed shape stays 400
    // invalid_field, and only a well-formed request the business refuses is 422.
    for (const rate of [-5, "zwanzig", 1.5]) {
      const res = await post({ name: "Rateless", hourly_rate_cents: rate });
      assert.equal(res.status, 400, `rate ${JSON.stringify(rate)} is malformed, not refused`);
      assert.equal((await res.json()).error, "invalid_field");
    }

    // UPDATE — THE BRANCH MOST LIKELY TO BE MISSED. A worker created WITH a rate can be
    // edited back to empty from /workers/, and one shared `rate` variable feeds both the
    // INSERT and the UPDATE precisely so this cannot diverge.
    const created = await post({ name: "Rate Haver", hourly_rate_cents: 1600 });
    assert.equal(created.status, 201);
    const id = (await created.json()).worker.id;
    for (const rate of ["", 0, null]) {
      const res = await post({ id, name: "Rate Haver", hourly_rate_cents: rate });
      assert.equal(res.status, 422, `editing the rate to ${JSON.stringify(rate)} must be refused`);
      assert.equal((await res.json()).error, "rate_required");
    }
    assert.equal(
      (await admin.query("SELECT hourly_rate_cents FROM workers WHERE id = $1", [id])).rows[0].hourly_rate_cents,
      1600,
      "a refused edit must leave the wage as it was",
    );
    await admin.query("DELETE FROM workers WHERE id = $1", [id]);
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

    // ---- GET /admin/data?worker=&location=&state= : the shift log WINDOWS (TASK-235) ---
    //
    // /shifts/ used to fetch every row up to `shift_limit` and filter worker/location/state
    // IN THE BROWSER. At 20 workers / 8 buildings that payload neared the 2000-row cap on a
    // single `thisYear` view, and the query was not even bounded by date, so the newest 2000
    // rows SITE-WIDE could exclude January while claiming to answer "this year". These three
    // parameters push the SAME filter into the query the row list and `hours` already use.
    // Every test below owns fresh workers and a fresh building of its own, rather than
    // reusing `rangeWorker` / `locationUuid`: BOTH are shared fixtures other blocks in this
    // file also seed shifts against, so a set-equality assertion pinned to them is only ever
    // as reliable as every OTHER test's cleanup — the first version of this section proved
    // that the hard way, failing against rows several unrelated tests had left behind.
    const freshWorker = async (label) =>
      Number(
        (
          await admin.query(
            "INSERT INTO workers (name, email, hourly_rate_cents) VALUES ($1, $2, 1000) RETURNING id",
            [label, `${label.toLowerCase().replace(/\s+/g, ".")}@example.test`],
          )
        ).rows[0].id,
      );
    const freshLocation = async (slug) =>
      (await admin.query("INSERT INTO locations (slug, name) VALUES ($1, $1) RETURNING id", [slug])).rows[0].id;

    await test("?worker= and ?location= narrow the row list to exactly that worker/building", async () => {
      const workerA = await freshWorker("Filter Worker A");
      const workerB = await freshWorker("Filter Worker B");
      const locA = await freshLocation("filter-location-a");
      const locB = await freshLocation("filter-location-b");
      const shiftAt = async (worker, location) =>
        Number(
          (
            await admin.query(
              `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
               VALUES ($1, $2, '2026-08-05T10:00:00Z', '2026-08-05T11:00:00Z') RETURNING id`,
              [worker, location],
            )
          ).rows[0].id,
        );
      // Three August rows, no two sharing both a worker and a building: each is kept by
      // exactly one single-filter query and only `home` survives both filters together.
      const home = await shiftAt(workerA, locA);
      const sameLocation = await shiftAt(workerB, locA);
      const sameWorker = await shiftAt(workerA, locB);

      const byWorker = ids(await data(`${range(VIENNA_AUGUST)}&worker=${workerA}`));
      assert.deepEqual(
        new Set(byWorker),
        new Set([home, sameWorker]),
        "a worker filter keeps that worker's rows at EVERY building, and only that worker's",
      );

      const byLocation = ids(await data(`${range(VIENNA_AUGUST)}&location=${locA}`));
      assert.deepEqual(
        new Set(byLocation),
        new Set([home, sameLocation]),
        "a location filter keeps EVERY worker's rows at that building, and only that building's",
      );

      const byBoth = ids(await data(`${range(VIENNA_AUGUST)}&worker=${workerA}&location=${locA}`));
      assert.deepEqual(byBoth, [home], "both filters together must keep exactly the one matching row");

      await admin.query("DELETE FROM shifts WHERE worker_id = ANY($1::int[])", [[workerA, workerB]]);
      await admin.query("DELETE FROM workers WHERE id = ANY($1::int[])", [[workerA, workerB]]);
      await admin.query("DELETE FROM locations WHERE id = ANY($1::uuid[])", [[locA, locB]]);
    });

    await test("?state= mirrors web/lib/shifts.ts shiftState() / isManualEntry() exactly", async () => {
      const worker = await freshWorker("Filter Worker State");
      const location = await freshLocation("filter-location-state");
      const closedManual = Number(
        (
          await admin.query(
            `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
             VALUES ($1, $2, '2026-08-09T06:00:00Z', '2026-08-09T14:00:00Z') RETURNING id`,
            [worker, location],
          )
        ).rows[0].id,
      );
      const openStub = Number(
        (
          await admin.query(
            `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
             VALUES ($1, $2, '2026-08-10T06:00:00Z', NULL) RETURNING id`,
            [worker, location],
          )
        ).rows[0].id,
      );
      const unresolvedStub = Number(
        (
          await admin.query(
            `INSERT INTO shifts (worker_id, location_id, start_time, end_time, auto_closed)
             VALUES ($1, $2, '2026-08-11T06:00:00Z', '2026-08-11T14:00:00Z', true) RETURNING id`,
            [worker, location],
          )
        ).rows[0].id,
      );

      const openIds = ids(await data(`${range(VIENNA_AUGUST)}&worker=${worker}&state=open`));
      assert.deepEqual(openIds, [openStub]);

      const unresolvedIds = ids(await data(`${range(VIENNA_AUGUST)}&worker=${worker}&state=unresolved`));
      assert.deepEqual(unresolvedIds, [unresolvedStub]);

      // Every shift seeded directly by this file carries no client_uuid, so all three of
      // these are "manual" by web/lib/shifts.ts `isManualEntry`.
      const manualIds = ids(await data(`${range(VIENNA_AUGUST)}&worker=${worker}&state=manual`));
      assert.deepEqual(new Set(manualIds), new Set([closedManual, openStub, unresolvedStub]));

      // A state this screen does not understand (decision-38 §4) must be IGNORED, not refused
      // and not treated as "match nothing".
      const unknownState = await asAdmin(`/admin/data?limit=2000${range(VIENNA_AUGUST)}&worker=${worker}&state=noEmail`);
      assert.equal(
        unknownState.status,
        400,
        "the server's own vocabulary is narrower than the URL contract's — lib/filters.ts drops noEmail/noTag before this route ever sees them",
      );

      await admin.query("DELETE FROM shifts WHERE worker_id = $1", [worker]);
      await admin.query("DELETE FROM workers WHERE id = $1", [worker]);
      await admin.query("DELETE FROM locations WHERE id = $1", [location]);
    });

    await test("shift_outside_count is the SAME filter, counted outside the window instead of fetched inside it", async () => {
      const worker = await freshWorker("Filter Worker Outside");
      const location = await freshLocation("filter-location-outside");
      const insideAugust = Number(
        (
          await admin.query(
            `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
             VALUES ($1, $2, '2026-08-05T10:00:00Z', '2026-08-05T11:00:00Z') RETURNING id`,
            [worker, location],
          )
        ).rows[0].id,
      );
      await admin.query(
        `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
         VALUES ($1, $2, '2026-07-05T10:00:00Z', '2026-07-05T11:00:00Z')`,
        [worker, location],
      );
      await admin.query(
        `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
         VALUES ($1, $2, '2026-09-05T10:00:00Z', '2026-09-05T11:00:00Z')`,
        [worker, location],
      );

      // 3 shifts total (July, August, September). Exactly 1 falls inside VIENNA_AUGUST, so
      // the other 2 are "outside".
      const scoped = await data(`${range(VIENNA_AUGUST)}&worker=${worker}`);
      assert.deepEqual(ids(scoped), [insideAugust]);
      assert.equal(scoped.shift_outside_count, 2, "2 of this worker's 3 shifts are outside August");

      // Widen to "all": nothing this filter matches is outside an unbounded range.
      const unbounded = await data(`&worker=${worker}`);
      assert.equal(unbounded.shift_outside_count, 0);

      // A period with none of this worker's shifts inside it: everything matching is outside.
      const empty = await data(
        `${range({ from: "2020-01-01T00:00:00Z", to: "2020-02-01T00:00:00Z" })}&worker=${worker}`,
      );
      assert.deepEqual(ids(empty), []);
      assert.equal(
        empty.shift_outside_count,
        3,
        "an empty FILTER result over a real worker must not read like an empty DATABASE",
      );

      await admin.query("DELETE FROM shifts WHERE worker_id = $1", [worker]);
      await admin.query("DELETE FROM workers WHERE id = $1", [worker]);
      await admin.query("DELETE FROM locations WHERE id = $1", [location]);
    });

    // ---- The 2000-row ceiling, proven at its own boundary (SHIFT_PAGE_MAX) -------------
    //
    // Not a scaled-down proxy: the real default `limit=2000` the admin panel actually
    // requests, against 1999, 2000 and 2001 rows for ONE isolated worker/location/period so
    // the count is exact. `truncated` (`shifts.length >= shift_limit`) must be RED at 1999
    // and GREEN at 2000 and 2001 — a check whose negative case cannot fail is not a check.
    // `shift_outside_count` must stay 0 throughout: every seeded row is INSIDE the period,
    // so none of them may ever be reported as "outside" just because the row cap bit.
    {
      const ceilingWorker = Number(
        (
          await admin.query(
            "INSERT INTO workers (name, email, hourly_rate_cents) VALUES ('Ceiling Worker', 'ceiling.worker@example.test', 1000) RETURNING id",
          )
        ).rows[0].id,
      );
      const ceilingLocation = (
        await admin.query("INSERT INTO locations (slug, name) VALUES ('ceiling-worker-site', 'Ceiling Site') RETURNING id")
      ).rows[0].id;
      // All inside Vienna August 2026, one minute apart, so 2001 of them still fit the month
      // and none collide with the one-open-shift-per-worker constraint (every row is closed).
      const seedCeiling = async (n) =>
        admin.query(
          `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
           SELECT $1, $2,
                  '2026-08-01T00:00:00Z'::timestamptz + (g * interval '1 minute'),
                  '2026-08-01T00:00:00Z'::timestamptz + (g * interval '1 minute') + interval '30 seconds'
             FROM generate_series(0, $3 - 1) AS g`,
          [ceilingWorker, ceilingLocation, n],
        );
      const ceilingData = async () =>
        (
          await asAdmin(
            `/admin/data?limit=2000${range(VIENNA_AUGUST)}&worker=${ceilingWorker}&location=${ceilingLocation}`,
          )
        ).json();

      await seedCeiling(1999);
      let payload = await ceilingData();
      assert.equal(payload.shifts.length, 1999);
      assert.equal(payload.shifts.length >= payload.shift_limit, false, "1999 rows must NOT read as truncated");
      assert.equal(payload.shift_outside_count, 0);

      await admin.query(
        `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
         VALUES ($1, $2, '2026-08-01T23:59:00Z', '2026-08-01T23:59:30Z')`,
        [ceilingWorker, ceilingLocation],
      );
      payload = await ceilingData();
      assert.equal(payload.shifts.length, 2000);
      assert.equal(payload.shifts.length >= payload.shift_limit, true, "exactly 2000 rows MUST read as truncated");
      assert.equal(payload.shift_outside_count, 0, "every one of the 2000 is INSIDE August — truncation is not the same fact as \"outside\"");

      await admin.query(
        `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
         VALUES ($1, $2, '2026-08-01T23:58:00Z', '2026-08-01T23:58:30Z')`,
        [ceilingWorker, ceilingLocation],
      );
      payload = await ceilingData();
      assert.equal(payload.shifts.length, 2000, "the row list itself never exceeds the limit");
      assert.equal(payload.shifts.length >= payload.shift_limit, true, "2001 real rows must still read as truncated");
      assert.equal(payload.shift_outside_count, 0, "all 2001 are inside August; the LIMIT truncates the list, it does not make rows leave the period");

      // And the honest cross-check: Postgres itself agrees there really are 2001 matching
      // rows in the window, so "truncated" is not a guess about a number nobody counted.
      const { rows: real } = await admin.query(
        "SELECT count(*)::int AS n FROM shifts WHERE worker_id = $1 AND location_id = $2",
        [ceilingWorker, ceilingLocation],
      );
      assert.equal(real[0].n, 2001);

      await admin.query("DELETE FROM shifts WHERE worker_id = $1", [ceilingWorker]);
      await admin.query("DELETE FROM workers WHERE id = $1", [ceilingWorker]);
      await admin.query("DELETE FROM locations WHERE id = $1", [ceilingLocation]);
    }

    await admin.query("DELETE FROM shifts WHERE worker_id = $1", [rangeWorker]);
    await admin.query("DELETE FROM workers WHERE id = $1", [rangeWorker]);
  }

  // ---- 005: material requests, contracts, P&L, analytics, geocoding ----------------
  //
  // The period below is OCTOBER 2025 IN VIENNA and nothing else in this file touches it,
  // so every aggregate asserted here is exact rather than "whatever the earlier cases left
  // behind". Its two ends sit on opposite sides of the 26 October clock change: it starts
  // at +02:00 and ends at +01:00, so it is 31 days AND one hour long. A period built with
  // one fixed UTC offset is one day short, and that day is a day of contract revenue.
  {
    const { setGeocoderForTest } = await import("./lib/geocode.js");

    const VIENNA_OCT_2025 = { from: "2025-09-30T22:00:00Z", to: "2025-10-31T23:00:00Z" }; // 31 days
    const VIENNA_NOV_2025 = { from: "2025-10-31T23:00:00Z", to: "2025-11-30T23:00:00Z" }; // 30 days
    const window = ({ from, to }) => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    // Read the body FIRST, then assert on the status with the body as the message. The
    // obvious `assert.equal(res.status, 201, await res.text())` evaluates its message
    // eagerly and leaves the stream consumed, so the following .json() throws "Body is
    // unusable" and hides the real failure.
    const expect = async (res, status) => {
      const payload = await res.json();
      assert.equal(res.status, status, JSON.stringify(payload));
      return payload;
    };
    const pl = async (period) => (await asAdmin(`/admin/pl?${window(period)}`)).json();
    const analytics = async (period, extra = "") =>
      (await asAdmin(`/admin/analytics?${window(period)}${extra}`)).json();
    const building = (payload, locationId) => payload.buildings.find((b) => b.location_id === locationId);

    // EUR 3100/month against 31 October days and 30 November days is 10000 and 10333.33
    // cents/day: one divides evenly, one does not, so both the exact and the rounded path
    // are exercised.
    const MONTHLY_CENTS = 310_000;

    const plWorker = Number(
      (
        await admin.query(
          "INSERT INTO workers (name, email, hourly_rate_cents) VALUES ('PL Worker', 'pl.worker@example.test', 1000) RETURNING id",
        )
      ).rows[0].id,
    );

    const newLocation = async (slug, name) =>
      (await expect(await asAdmin("/admin/locations", { method: "POST", body: { slug, name } }), 201)).location.id;
    const plA = await newLocation("pl-a", "PL Haus A");
    const plB = await newLocation("pl-b", "PL Haus B");
    const plC = await newLocation("pl-c", "PL Haus C");

    // One payable hour at each building, mid-October, an hour apart. Equal hours on
    // purpose: an even three-way split of an odd pot is where a cent goes missing.
    for (const [i, locationId] of [plA, plB, plC].entries()) {
      await admin.query(
        `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
         VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '1 hour')`,
        [plWorker, locationId, `2025-10-15T0${6 + i}:00:00Z`],
      );
    }

    // The material pot: 100 cents ordered inside the period, plus one request the admin
    // has NOT priced and one that was only ever approved. Neither may reach the pool.
    const seedRequest = async (status, costCents, orderedAt) =>
      Number(
        (
          await admin.query(
            `INSERT INTO material_requests (worker_id, location_id, body, status, cost_cents, ordered_at)
             VALUES ($1, $2, 'Wischmopp und Reiniger', $3, $4, $5) RETURNING id`,
            [plWorker, plA, status, costCents, orderedAt],
          )
        ).rows[0].id,
      );
    await seedRequest("arrived", 100, "2025-10-10T09:00:00Z");
    await seedRequest("ordered", null, "2025-10-11T09:00:00Z"); // unpriced
    await seedRequest("approved", 9_999_999, null); // approved is not a spend
    await seedRequest("arrived", 5_000_000, "2025-11-10T09:00:00Z"); // wrong period

    await test("a P&L without a period is REFUSED, and garbage bounds are too", async () => {
      for (const [qs, status] of [
        ["", 400],
        [`from=${VIENNA_OCT_2025.from}`, 400],
        [`to=${VIENNA_OCT_2025.to}`, 400],
        ["from=nonsense&to=2025-11-01T00:00:00Z", 400],
        ["from=2025-10-01&to=2025-11-01", 400], // no zone: read in the server's zone
        [`from=${VIENNA_OCT_2025.to}&to=${VIENNA_OCT_2025.from}`, 422], // inverted
      ]) {
        for (const route of ["/admin/pl", "/admin/analytics"]) {
          const res = await asAdmin(`${route}?${qs}`);
          assert.equal(res.status, status, `${route}?${qs} must be refused, got ${res.status}`);
          assert.ok((await res.json()).error, "and must name the failure");
        }
      }
    });

    await test("the material split sums back to the pot with no cent lost (decision-6)", async () => {
      const payload = await pl(VIENNA_OCT_2025);

      assert.equal(payload.materials.pool_cents, 100, "only ordered/arrived requests inside the period");
      assert.equal(payload.materials.unpriced_requests, 1, "and an unpriced one is COUNTED, not treated as free");
      assert.equal(payload.materials.basis, "pro_rata_labour_hours");

      // THE INVARIANT: every cent of the pot lands on exactly one building.
      const allocated = payload.buildings.reduce((sum, b) => sum + b.material_cents, 0);
      assert.equal(allocated, 100, "the per-building material column must add up to the pot");
      assert.equal(payload.materials.allocated_cents, 100);
      assert.equal(payload.materials.unallocated_cents, 0);

      // Equal hours, an odd pot: 33.33 each. Largest remainder gives 34/33/33, never 33/33/33.
      const shares = [plA, plB, plC].map((id) => building(payload, id).material_cents).sort();
      assert.deepEqual(shares, [33, 33, 34], `equal-hours split was ${shares}`);

      // A building nobody worked in October consumed none of October's supplies.
      for (const b of payload.buildings) {
        if (b.labour_seconds === 0) assert.equal(b.material_cents, 0, `${b.slug} got materials for zero hours`);
      }
    });

    await test("materials bought in a month nobody worked are reported, not spread or dropped", async () => {
      const payload = await pl(VIENNA_NOV_2025);
      assert.equal(payload.materials.pool_cents, 5_000_000, "the November order belongs to November");
      assert.equal(payload.materials.allocated_cents, 0);
      assert.equal(payload.materials.unallocated_cents, 5_000_000);
      assert.equal(payload.materials.unallocated_reason, "no_payable_labour_in_period");
      assert.equal(
        payload.buildings.reduce((sum, b) => sum + b.material_cents, 0),
        0,
        "with no hours anywhere there is nothing to split by; inventing an even spread would be a guess",
      );
    });

    await test("a month nobody has typed a payment for says so instead of reporting a 100% loss", async () => {
      const payload = await pl(VIENNA_OCT_2025);
      const b = building(payload, plB);
      assert.equal(b.revenue_cents, null, "NULL, never 0 — 0 would mean 'the client paid nothing'");
      assert.equal(b.revenue_unknown_reason, "not_entered");
      assert.equal(b.profit_cents, null, "and profit cannot be computed from an unknown");
      assert.equal(b.margin_bp, null);
      assert.equal(b.margin_unknown_reason, "revenue_not_entered");
      assert.equal(b.below_baseline, null, "a building we cannot assess is not a building that passed");
      assert.ok(b.labour_cents > 0, "the hours are still real and still shown");
      assert.equal(b.months_missing_revenue, 1, "and the screen has to be able to say HOW MANY months are blank");
    });

    await test("a Vienna period is priced by whole days, across the October clock change", async () => {
      const created = await expect(
        await asAdmin(`/admin/locations/${plA}/contracts`, {
          method: "POST",
          body: { monthly_contract_cents: MONTHLY_CENTS, target_minutes_per_month: 620, valid_from: "2025-01-01" },
        }),
        201,
      );
      // A DATE must survive the round trip as the day that was typed. pg's default parser
      // turns it into a local-midnight Date, which JSON.stringify then ships as the day
      // BEFORE in any positive-offset zone — every contract period silently one day early.
      assert.equal(created.contract.valid_from, "2025-01-01");

      const october = building(await pl(VIENNA_OCT_2025), plA);
      assert.equal(october.period_days, 31, "October in Vienna is 31 days even though it is 31 days + 1 hour long");
      // THE CONTRACT IS NO LONGER MONEY RECEIVED (decision-42). It rides as `contract_cents`
      // — "vereinbart" — beside "erhalten", which is the comparison the split buys. Revenue
      // itself stays UNKNOWN until a human types it, however confident the contract is.
      assert.equal(october.contract_cents, MONTHLY_CENTS, "the AGREED figure for the month is still answerable");
      assert.equal(october.revenue_cents, null, "a contract is not a payment; it must not become one");
      assert.equal(october.revenue_unknown_reason, "not_entered");

      const november = building(await pl(VIENNA_NOV_2025), plA);
      assert.equal(november.period_days, 30);
      assert.equal(november.contract_cents, MONTHLY_CENTS, "a 30-day month is agreed at the same monthly fee");

      // MARCH, the other clock change, and the one that breaks naive arithmetic. Vienna
      // March 2026 is 31 days MINUS one hour, so `(to - from) / 86_400_000` is 30.96 and
      // any day count derived by division floors to 30 — a day of revenue gone, every
      // spring, silently. Counting Vienna midnights instead cannot get this wrong.
      const MARCH_2026 = { from: "2026-02-28T23:00:00Z", to: "2026-03-31T22:00:00Z" };
      assert.equal(
        Math.floor((Date.parse(MARCH_2026.to) - Date.parse(MARCH_2026.from)) / 86_400_000),
        30,
        "the naive computation this defends against must really produce 30, or the case proves nothing",
      );
      const march = building(await pl(MARCH_2026), plA);
      assert.equal(march.period_days, 31, "March in Vienna is 31 days even though it is 31 days minus an hour long");
      // The MONTH SELECTION has the same hazard and it decides which revenue rows are read:
      // a March period built from July's +02:00 offset starts an hour late, so March stops
      // being fully contained and every margin in it is refused. Both clock changes are
      // exercised: October above, March here.
      const marchPl = await pl(MARCH_2026);
      assert.deepEqual(marchPl.revenue.months, ["2026-03"], "a Vienna March period contains exactly March");
      assert.equal(marchPl.revenue.month_aligned, true);
      assert.equal(march.contract_cents, MONTHLY_CENTS);

      // And the hour itself, on the labour side, where it really does move money: a shift
      // at 23:30 Vienna on 31 October is CET (+01:00) and is only inside the month if the
      // period end was built from the tz database rather than from July's offset.
      const lateShift = Number(
        (
          await admin.query(
            `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
             VALUES ($1, $2, '2025-10-31T22:30:00Z', '2025-10-31T22:30:00Z'::timestamptz + interval '30 minutes') RETURNING id`,
            [plWorker, plA],
          )
        ).rows[0].id,
      );
      assert.equal(building(await pl(VIENNA_OCT_2025), plA).labour_cents, 1500, "23:30 on 31 October is October");
      assert.equal(
        building(await pl({ from: VIENNA_OCT_2025.from, to: "2025-10-31T22:00:00Z" }), plA).labour_cents,
        1000,
        "a period built with one fixed +02:00 offset must visibly lose that half hour, or this case proves nothing",
      );
      await admin.query("DELETE FROM shifts WHERE id = $1", [lateShift]);
    });

    await test("a price change is period-correct: March keeps the March price", async () => {
      await expect(
        await asAdmin(`/admin/locations/${plA}/contracts`, {
          method: "POST",
          body: { monthly_contract_cents: MONTHLY_CENTS * 2, valid_from: "2025-10-16", note: "Preiserhöhung" },
        }),
        201,
      );

      // decision-42 §4: a contract figure is NOT sliced by day any more, in either
      // direction. October's AGREED figure is the one in force on 1 October — the old price
      // — and the mid-month raise shows up from November. Slicing a monthly figure across
      // arbitrary days was the accrual this decision removed; doing it to `contract_cents`
      // would be the same arithmetic wearing the new field's name.
      const october = building(await pl(VIENNA_OCT_2025), plA);
      assert.equal(october.contract_cents, MONTHLY_CENTS, "the price in force on the 1st is the month's agreed figure");
      assert.notEqual(october.contract_cents, MONTHLY_CENTS * 2, "the raise must not rewrite the month it landed in");
      assert.equal(
        building(await pl(VIENNA_NOV_2025), plA).contract_cents,
        MONTHLY_CENTS * 2,
        "...and must apply from the first full month after it",
      );

      const history = await (await asAdmin(`/admin/locations/${plA}/contracts`)).json();
      assert.equal(history.contracts.length, 2);
      assert.equal(history.contracts[0].valid_to, null, "exactly one current contract");
      assert.equal(history.contracts[1].valid_to, "2025-10-16", "and the old one closed where the new one starts");

      // Overlapping periods would give "the price on 20 October" two answers and the P&L
      // would count both.
      for (const validFrom of ["2025-10-16", "2025-10-01", "2024-01-01"]) {
        const clash = await asAdmin(`/admin/locations/${plA}/contracts`, {
          method: "POST",
          body: { monthly_contract_cents: 1, valid_from: validFrom },
        });
        assert.equal(clash.status, 409, `${validFrom} overlaps and must be refused`);
        assert.equal((await clash.json()).error, "contract_overlap");
      }
    });

    await test("locations.monthly_contract_cents stays a MIRROR of the current contract", async () => {
      // Two sources of truth are only safe when one is derived and something fails loudly
      // when it drifts. This is that something: /locations/, /reinigung/ and the shipped
      // iOS build all still read the mirror.
      const drift = async () =>
        (
          await admin.query(
            `SELECT l.id FROM locations l
               LEFT JOIN location_contracts c ON c.location_id = l.id AND c.valid_to IS NULL
              WHERE l.monthly_contract_cents IS DISTINCT FROM c.monthly_contract_cents
                 OR l.target_minutes_per_month IS DISTINCT FROM c.target_minutes_per_month`,
          )
        ).rows;

      assert.deepEqual(await drift(), [], "after POST /admin/locations/:id/contracts");

      // The buildings FORM is the other writer, and it must land in the same place.
      const viaForm = await expect(
        await asAdmin("/admin/locations", {
          method: "POST",
          body: { id: plB, slug: "pl-b", name: "PL Haus B", monthly_contract_cents: 50_000, target_minutes_per_month: 300 },
        }),
        200,
      );
      assert.equal(viaForm.location.monthly_contract_cents, 50_000);
      assert.deepEqual(await drift(), [], "after POST /admin/locations");
      const formHistory = await (await asAdmin(`/admin/locations/${plB}/contracts`)).json();
      assert.equal(formHistory.contracts.length, 1, "the form edits the current period, it does not mint a new one");

      // Undoing a contract entered by mistake reverts to the PREVIOUS price rather than
      // dropping the building to "no contract on file".
      const current = (await (await asAdmin(`/admin/locations/${plA}/contracts`)).json()).contracts[0];
      await expect(await asAdmin(`/admin/contracts/${current.id}`, { method: "DELETE" }), 200);
      assert.deepEqual(await drift(), [], "after DELETE /admin/contracts/:id");
      assert.equal(building(await pl(VIENNA_OCT_2025), plA).contract_cents, MONTHLY_CENTS, "the old price is back");

      // A closed period has already valued a month somebody has seen a report for.
      const closed = (await (await asAdmin(`/admin/locations/${plA}/contracts`)).json()).contracts.find(
        (c) => c.valid_to !== null,
      );
      if (closed) {
        const res = await asAdmin(`/admin/contracts/${closed.id}`, { method: "DELETE" });
        assert.equal(res.status, 409);
        assert.equal((await res.json()).error, "contract_not_current");
      }
    });

    await test("an unresolved auto-closed shift is excluded from cost AND named (decision-10)", async () => {
      const stub = Number(
        (
          await admin.query(
            `INSERT INTO shifts (worker_id, location_id, start_time, end_time, auto_closed)
             VALUES ($1, $2, '2025-10-20T05:00:00Z', '2025-10-20T13:00:00Z', true) RETURNING id`,
            [plWorker, plA],
          )
        ).rows[0].id,
      );

      const flagged = await pl(VIENNA_OCT_2025);
      const a = building(flagged, plA);
      assert.equal(a.labour_cents, 1000, "a start+8h guess must not become money just because a period was named");
      assert.equal(a.labour_seconds, 3600);
      // Silence would be the real failure: a building whose cost is low because three
      // shifts are stuck awaiting resolution is not a cheap building.
      assert.equal(a.excluded_unresolved_shifts, 1, "and the exclusion must be VISIBLE on the report");
      assert.equal(a.excluded_unresolved_seconds, 28_800);
      assert.equal(
        flagged.buildings.reduce((sum, b) => sum + b.material_cents, 0),
        100,
        "the material split must still account for every cent while a shift is excluded",
      );

      await admin.query("UPDATE shifts SET corrected_at = now() WHERE id = $1", [stub]);
      const resolved = await pl(VIENNA_OCT_2025);
      const b = building(resolved, plA);
      assert.equal(b.labour_cents, 9000, "and must count once a human has confirmed the end time");
      assert.equal(b.excluded_unresolved_shifts, 0);
      assert.equal(
        resolved.buildings.reduce((sum, x) => sum + x.material_cents, 0),
        100,
        "and still account for every cent after the weights change",
      );
      // The weights moved from 1h/1h/1h to 9h/1h/1h, so the split must move with them.
      assert.equal(building(resolved, plA).material_cents, 82);

      await admin.query("DELETE FROM shifts WHERE id = $1", [stub]);
    });

    // THE REPLACEMENT FOR "labour nobody has priced is excluded AND named" (decision-41).
    //
    // That case described a STATE THAT CAN NO LONGER OCCUR: `hourly_rate_cents` lost its
    // DEFAULT and gained CHECK (> 0), so a rate of 0 is unrepresentable and the whole
    // `labour_unpriced_*` apparatus is deleted rather than merely unused. Deleting the case
    // outright would have deleted the only statement of WHY it existed, so the invariant it
    // was protecting is asserted here instead — from the other side.
    await test("every payable second is priced: the rate-less state is unrepresentable (decision-41)", async () => {
      // 1 · THE DATABASE. Both halves, because either alone still lets a zero through.
      await assert.rejects(
        () =>
          admin.query(
            "INSERT INTO workers (name, email) VALUES ('PL Rateless', 'pl.rateless@example.test')",
          ),
        (err) => err.code === "23502",
        "omitting the rate must raise 23502 at the point of the mistake, not default to 0",
      );
      await assert.rejects(
        () =>
          admin.query(
            "INSERT INTO workers (name, email, hourly_rate_cents) VALUES ('PL Rateless', 'pl.rateless@example.test', 0)",
          ),
        (err) => err.code === "23514",
        "a rate of 0 must raise 23514 — a wage has no 'free of charge' reading",
      );
      // ...and an existing worker cannot be edited down to zero either. The UPDATE path is
      // the one a CHECK added to a fresh table is most likely to be assumed safe on.
      await assert.rejects(
        () => admin.query("UPDATE workers SET hourly_rate_cents = 0 WHERE id = $1", [plWorker]),
        (err) => err.code === "23514",
        "and a rate cannot be edited back down to zero afterwards",
      );

      // 2 · THE REPORT. `labour_seconds` and `labour_cents` now describe THE SAME SET of
      // seconds. Any building with hours and no cost is the old bug, back.
      const payload = await pl(VIENNA_OCT_2025);
      for (const b of payload.buildings) {
        if (b.labour_seconds > 0) {
          assert.ok(
            b.labour_cents > 0,
            `${b.slug} reports ${b.labour_seconds}s of payable labour and ${b.labour_cents} cents of cost — hours that cost nothing are the defect decision-41 removed`,
          );
        }
      }
      // 3 · THE FIELDS ARE GONE, not merely zero. A field left reporting 0 for ever is a
      // screen element nobody can explain and a caveat that can never fire.
      const a = building(payload, plA);
      for (const dead of ["labour_unpriced_seconds", "labour_unpriced_minutes", "labour_unpriced_workers"]) {
        assert.equal(a[dead], undefined, `${dead} must be DELETED, not reported as 0`);
      }
      assert.equal(payload.labour.unpriced_seconds, undefined);
      assert.equal(payload.labour.unpriced_workers, undefined);

      // 4 · AND THE LIMITATION THAT SURVIVES. `rate_basis` is a DIFFERENT, still-true
      // statement: one mutable column, no history, so raising a wage still re-values last
      // March. Deleting it along with the unpriced fields is the likeliest mistake in this
      // change — it would make the report look more certain than it is.
      assert.equal(payload.labour.rate_basis, "current");
      assert.ok(payload.labour.rate_basis_note.length > 0, "and it must be a sentence the screen can print");
    });

    // ---- decision-42: revenue is a TYPED, APPEND-ONLY monthly fact --------------------
    //
    // The P&L used to DERIVE revenue by daily accrual from the contract. Careful arithmetic
    // about a number nobody received. These cases assert what replaced it, and each one has
    // a stated mutation that turns it red.

    const revenueOf = async (period, locationId) => building(await pl(period), locationId);

    await test("a typed payment is the revenue, to the cent, and the contract is only a suggestion", async () => {
      // The month grid the /pl/ editor is built from, including the contract SUGGESTION.
      const grid = await (await asAdmin(`/admin/revenue?${window(VIENNA_OCT_2025)}`)).json();
      assert.deepEqual(grid.months, ["2025-10"], "one Vienna month, resolved against the tz database");
      assert.equal(grid.entries.length, 0, "nothing has been typed yet");
      const suggested = grid.suggestions.find((s) => s.location_id === plA);
      assert.equal(Number(suggested.contract_cents), MONTHLY_CENTS, "the contract is OFFERED for the form...");
      assert.equal(
        (await revenueOf(VIENNA_OCT_2025, plA)).revenue_cents,
        null,
        "...and OFFERING it must not have stored it. Auto-filling from the contract is the" +
          " accrual decision-42 removed, wearing a different hat.",
      );

      const created = await expect(
        await asAdmin(`/admin/locations/${plA}/revenue`, {
          method: "POST",
          body: { month: "2025-10", amount_cents: 280_000, note: "Teilzahlung" },
        }),
        201,
      );
      assert.equal(created.entry.amount_cents, 280_000);
      assert.equal(created.entry.month, "2025-10-01", "a month is stored as its FIRST day, always");
      assert.equal(created.previous_cents, null, "nothing was replaced");

      const a = await revenueOf(VIENNA_OCT_2025, plA);
      assert.equal(a.revenue_cents, 280_000, "what was RECEIVED, not what was agreed");
      assert.notEqual(a.revenue_cents, MONTHLY_CENTS, "and it must differ from the contract, or this proves nothing");
      assert.equal(a.contract_cents, MONTHLY_CENTS, "'vereinbart' rides alongside 'erhalten'");
      assert.equal(a.revenue_unknown_reason, null);
      assert.equal(a.months_missing_revenue, 0);
      assert.equal(a.profit_cents, 280_000 - a.labour_cents - a.material_cents);
    });

    await test("entered_by is the SESSION admin, never the body (decision-22, admin side)", async () => {
      await expect(
        await asAdmin(`/admin/locations/${plB}/revenue`, {
          method: "POST",
          // A caller naming themselves in an audit trail is not an audit trail.
          body: { month: "2025-10", amount_cents: 4200, entered_by: 999_999 },
        }),
        201,
      );
      const row = (
        await admin.query(
          "SELECT entered_by FROM location_revenue WHERE location_id = $1 AND superseded_at IS NULL",
          [plB],
        )
      ).rows[0];
      const sessionAdmin = (await admin.query("SELECT id FROM admins WHERE email = $1", [ADMIN_EMAIL])).rows[0].id;
      assert.equal(String(row.entered_by), String(sessionAdmin), "the body-supplied id must be ignored");
      await expect(await asAdmin(`/admin/locations/${plB}/revenue/2025-10`, { method: "DELETE" }), 200);
    });

    await test("a correction KEEPS the old figure; money that changes invisibly is an opinion", async () => {
      const corrected = await expect(
        await asAdmin(`/admin/locations/${plA}/revenue`, {
          method: "POST",
          body: { month: "2025-10", amount_cents: 310_000, note: "Restzahlung eingegangen" },
        }),
        200,
      );
      assert.equal(corrected.previous_cents, 280_000, "the route must say what it replaced");

      // THE HISTORY ASSERTION. Change the route to UPDATE in place and this goes red: there
      // is one row, the old amount is gone, and /pl/ can no longer print "vorher 2.800,00".
      const rows = (
        await admin.query(
          "SELECT amount_cents, superseded_at FROM location_revenue WHERE location_id = $1 AND month = DATE '2025-10-01' ORDER BY id",
          [plA],
        )
      ).rows;
      assert.equal(rows.length, 2, "append-only: a correction INSERTS, it never overwrites");
      assert.equal(rows[0].amount_cents, 280_000, "and the superseded row KEEPS its amount");
      assert.ok(rows[0].superseded_at !== null, "...stamped with when it stopped being believed");
      assert.equal(rows[1].amount_cents, 310_000);
      assert.equal(rows[1].superseded_at, null, "exactly one figure in force");

      // The partial unique index is the backstop, and it must really be one.
      await assert.rejects(
        () =>
          admin.query(
            "INSERT INTO location_revenue (location_id, month, amount_cents) VALUES ($1, DATE '2025-10-01', 1)",
            [plA],
          ),
        (err) => err.code === "23505",
        "two live figures for one building-month must be impossible",
      );

      // And the provenance reaches the screen in words, with the PREVIOUS amount named:
      // "this was changed" without "from what" sends the director to the database.
      const a = await revenueOf(VIENNA_OCT_2025, plA);
      assert.equal(a.revenue_cents, 310_000);
      assert.equal(a.revenue_previous_cents, 280_000);
      assert.ok(a.revenue_changed_at, "and WHEN it changed");
      assert.equal(a.revenue_entered_by, ADMIN_EMAIL, "and WHO");
    });

    await test("retracting a month returns it to UNKNOWN, which is not the same as 0", async () => {
      const zeroed = await expect(
        await asAdmin(`/admin/locations/${plC}/revenue`, { method: "POST", body: { month: "2025-10", amount_cents: 0 } }),
        201,
      );
      assert.equal(zeroed.entry.amount_cents, 0);
      const paidNothing = await revenueOf(VIENNA_OCT_2025, plC);
      // 0 IS A REAL ANSWER: a credit month, a dispute, a free trial. It is reported AS 0.
      assert.equal(paidNothing.revenue_cents, 0, "'they paid nothing' is an answer, not an absence");
      assert.equal(paidNothing.revenue_unknown_reason, null);
      assert.equal(paidNothing.margin_unknown_reason, "zero_revenue", "a margin over 0 is still refused");

      await expect(await asAdmin(`/admin/locations/${plC}/revenue/2025-10`, { method: "DELETE" }), 200);
      const retracted = await revenueOf(VIENNA_OCT_2025, plC);
      // Make retraction write a 0 instead of superseding, and this pair goes red.
      assert.equal(retracted.revenue_cents, null, "retraction must return the month to UNKNOWN");
      assert.equal(retracted.revenue_unknown_reason, "not_entered");
      assert.notEqual(
        retracted.revenue_cents,
        0,
        "0 would assert that a paying client paid nothing, inside the report we discuss with them",
      );
      // Retracting twice is a 404, not a silent second stamp.
      assert.equal((await asAdmin(`/admin/locations/${plC}/revenue/2025-10`, { method: "DELETE" })).status, 404);
      // The retracted row SURVIVES: what was believed, and when it stopped being believed,
      // are both facts.
      assert.equal(
        await countOf("SELECT count(*) AS n FROM location_revenue WHERE location_id = $1", [plC]),
        1,
      );
    });

    await test("a ragged period reports whole months only and REFUSES the margin", async () => {
      const aligned = await pl(VIENNA_OCT_2025);
      assert.equal(aligned.revenue.month_aligned, true, "the baseline must be aligned or the contrast proves nothing");
      assert.ok(building(aligned, plA).margin_bp !== null, "...and must have an answerable margin");

      // October in full, plus a fortnight of November. October's payment is real; the
      // fortnight's is not sliceable, because 14/30ths of a typed payment invents a
      // schedule nobody agreed to.
      const RAGGED = { from: VIENNA_OCT_2025.from, to: "2025-11-14T23:00:00Z" };
      const payload = await pl(RAGGED);
      assert.equal(payload.revenue.month_aligned, false);
      assert.deepEqual(payload.revenue.months, ["2025-10"], "only the WHOLE month is counted");
      assert.equal(payload.revenue.months_touched, 2);
      assert.equal(payload.revenue.partial_months_excluded, 1, "and the partial one is NAMED, not sliced");

      const a = building(payload, plA);
      assert.equal(a.revenue_cents, 310_000, "October's typed figure, unsliced and unsupplemented");
      assert.equal(a.margin_bp, null, "full-month revenue over partial-month labour is two periods, one number");
      assert.equal(a.margin_unknown_reason, "period_not_month_aligned");
      assert.equal(a.below_baseline, null, "a margin we refuse to compute is not a margin that passed");
    });

    await test("an unfinished month reports UNKNOWN rather than an inflated margin", async () => {
      // THE FREE WIN, and the reason it is worth a case of its own. Under contract accrual,
      // "Dieses Jahr" picked in August booked five FUTURE months of revenue against labour
      // that only existed for days that had happened, and reported 71,33% next to the
      // 10,70% the last closed month actually made. A month nobody has typed a payment for
      // now simply has no entry, so it reports unknown instead of inflated.
      const YEAR_2025 = { from: "2024-12-31T23:00:00Z", to: "2025-12-31T23:00:00Z" };
      const payload = await pl(YEAR_2025);
      assert.equal(payload.revenue.months.length, 12, "twelve Vienna months");
      assert.equal(payload.revenue.month_aligned, true);
      const a = building(payload, plA);
      assert.equal(a.revenue_cents, 310_000, "exactly the ONE month somebody typed");
      assert.equal(a.months_missing_revenue, 11, "and the other eleven are NAMED as blank, not booked");
      // Re-enable contract accrual and this goes red: revenue would be ~12x the monthly fee.
      assert.ok(
        a.revenue_cents < MONTHLY_CENTS * 2,
        "a year of contract accrual would be ~12 monthly fees; only typed months may count",
      );
    });

    await test("a month is a Vienna calendar month, and the future is capped at +1", async () => {
      for (const bad of ["2025-9", "2025-13", "abc", "2025-10-01", ""]) {
        const res = await asAdmin(`/admin/locations/${plA}/revenue`, {
          method: "POST",
          body: { month: bad, amount_cents: 100 },
        });
        assert.equal(res.status, 400, `month ${JSON.stringify(bad)} must be refused as malformed`);
      }
      // An amount is not optional — a revenue entry with no figure is not an entry.
      assert.equal(
        (await asAdmin(`/admin/locations/${plA}/revenue`, { method: "POST", body: { month: "2025-10" } })).status,
        422,
      );

      // PREPAID CLEANING CONTRACTS ARE REAL, so next month is accepted. The cap catches the
      // realistic typo, which is the wrong YEAR. Raise the cap and the second half goes red.
      const viennaNow = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Vienna",
        year: "numeric",
        month: "2-digit",
      }).format(new Date());
      const index = Number(viennaNow.slice(0, 4)) * 12 + Number(viennaNow.slice(5, 7)) - 1;
      const monthAt = (offset) => {
        const n = index + offset;
        return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
      };
      await expect(
        await asAdmin(`/admin/locations/${plC}/revenue`, {
          method: "POST",
          body: { month: monthAt(1), amount_cents: 1 },
        }),
        201,
      );
      const tooFar = await asAdmin(`/admin/locations/${plC}/revenue`, {
        method: "POST",
        body: { month: monthAt(2), amount_cents: 1 },
      });
      assert.equal(tooFar.status, 422);
      assert.equal((await tooFar.json()).error, "month_too_far_ahead");
      await expect(await asAdmin(`/admin/locations/${plC}/revenue/${monthAt(1)}`, { method: "DELETE" }), 200);
      await admin.query("DELETE FROM location_revenue WHERE location_id = $1", [plC]);
    });

    // ---- decision-43 §6: per square metre AT THE BUILDING, and never per zone ---------

    await test("per-m2 is refused until every live zone has been measured", async () => {
      const unzoned = building(await pl(VIENNA_OCT_2025), plA);
      // An unzoned building is a DIVISION BY ZERO waiting to happen, and 0 m2 would make
      // every per-m2 figure infinite. It is a named refusal instead.
      assert.equal(unzoned.building_m2, null);
      assert.equal(unzoned.area_unknown_reason, "no_zones");
      assert.equal(unzoned.zones_total, 0);
      assert.equal(unzoned.revenue_cents_per_m2, null);
      assert.equal(unzoned.labour_minutes_per_m2, null);
      assert.equal(unzoned.cost_cents_per_m2, null);

      const zoneA = (
        await expect(
          await asAdmin("/admin/zones", {
            method: "POST",
            body: { location_id: plA, name: "Stiege 1", area_sqm: "240.00" },
          }),
          201,
        )
      ).zone;
      const zoneB = (
        await expect(
          await asAdmin("/admin/zones", { method: "POST", body: { location_id: plA, name: "Tiefgarage" } }),
          201,
        )
      ).zone;
      assert.equal(zoneB.area_sqm, null, "a zone nobody has measured is a real, permanent state");

      // ONE UNMEASURED ZONE POISONS THE WHOLE FIGURE. Make it sum only the known areas and
      // this goes red: 240 would be reported as if it were the building, and every per-m2
      // number computed from it would be too big by however much the Tiefgarage is.
      const partial = building(await pl(VIENNA_OCT_2025), plA);
      assert.equal(partial.zones_total, 2);
      assert.equal(partial.zones_unmeasured, 1);
      assert.equal(partial.building_m2, null, "a floor is not a total, and a total is what a denominator must be");
      assert.equal(partial.area_unknown_reason, "area_incomplete");
      assert.equal(partial.revenue_cents_per_m2, null);
      assert.notEqual(partial.building_m2, 240, "summing only the measured zones is exactly the bug");

      // Measure it, and the figures appear. Both directions, or the guard rail is a
      // permanent hole rather than a guard rail.
      await expect(
        await asAdmin("/admin/zones", {
          method: "POST",
          body: { id: zoneB.id, location_id: plA, name: "Tiefgarage", area_sqm: "160.00" },
        }),
        200,
      );
      const measured = building(await pl(VIENNA_OCT_2025), plA);
      assert.equal(measured.building_m2, 400, "240 + 160, derived at read time and stored nowhere");
      assert.equal(measured.area_unknown_reason, null);
      // ARITHMETIC PIN: 1 payable hour = 60 minutes over 400 m2 is 0.15 exactly. Exact
      // decimal in, one rounding out — no floating-point drift.
      assert.equal(measured.labour_minutes_per_m2, 0.15);
      assert.equal(measured.revenue_cents_per_m2, Math.round((310_000 * 100) / 400) / 100);
      assert.equal(measured.cost_cents_per_m2, Math.round(((measured.labour_cents + measured.material_cents) * 100) / 400) / 100);

      // NOTHING STORES THE TOTAL. A stored copy drifts the first time a zone is resized,
      // and then the building's own report disagrees with its own zone list.
      assert.equal(
        await countOf(
          "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'locations' AND column_name LIKE '%area%'",
        ),
        0,
        "locations must never grow an area column — SUM(zones.area_sqm) is the only answer",
      );

      // Revenue missing is a SEPARATE reason from area missing, and the screen must be able
      // to tell them apart: minutes/m2 still computes while EUR/m2 cannot.
      await expect(await asAdmin(`/admin/locations/${plA}/revenue/2025-10`, { method: "DELETE" }), 200);
      const noRevenue = building(await pl(VIENNA_OCT_2025), plA);
      assert.equal(noRevenue.revenue_cents_per_m2, null);
      assert.equal(noRevenue.per_m2_unknown_reason, "not_entered");
      assert.equal(noRevenue.labour_minutes_per_m2, 0.15, "an unpriced month does not stop time being measurable");
      // Put October back — the baseline case below reads it.
      await expect(
        await asAdmin(`/admin/locations/${plA}/revenue`, {
          method: "POST",
          body: { month: "2025-10", amount_cents: 310_000 },
        }),
        201,
      );

      // Tidy: the zone rows stay (the resolution cases below use them), the shifts do not.
      assert.equal(zoneA.location_id, plA);
    });

    await test("zone_state is a GREY PIN, and locations.active is the tag — they never merge", async () => {
      // The owner's rule "a building with no zones is INACTIVE" is about the MAP. Read
      // operationally it kills the card on the wall. So the two words are reported
      // SEPARATELY and this case is what keeps them apart:
      //
      //   locations.active   OPERATIONAL. The tag resolves iff true.
      //   zone_state         PRESENTATION. A grey pin and a sentence, and nothing else.
      const grey = await newLocation("greyhaus", "Grauhaus");
      // A period around NOW, not October 2025: `reportableLocations` returns a building
      // that is active OR was worked in the period, so a DEACTIVATED building only stays
      // visible through a period that contains its shift. The tap below is that shift, and
      // it is deliberately not deleted until the last assertion has read it.
      const now = Date.now();
      const period = window({
        from: new Date(now - 86_400_000).toISOString(),
        to: new Date(now + 86_400_000).toISOString(),
      });

      const inPl = (payload) => payload.buildings.find((b) => b.location_id === grey);
      const analyticsOf = async () => inPl(await (await asAdmin(`/admin/analytics?${period}`)).json());

      assert.equal((await analyticsOf()).zone_state, "unzoned", "no zones -> grey, and the map says so in words");
      // EVERY surface that reports `active` must keep reporting the OPERATIONAL one. A
      // single `active: l.active && zoned` anywhere is the whole mistake, so all three are
      // asserted rather than one and a hope.
      for (const [where, row] of [
        ["/admin/analytics", await analyticsOf()],
        ["/admin/pl", inPl(await pl(VIENNA_OCT_2025))],
        ["/admin/data", (await (await asAdmin("/admin/data")).json()).locations.find((l) => l.id === grey)],
      ]) {
        assert.equal(row.active, true, `${where} must report the OPERATIONAL active, not "has zones"`);
      }
      assert.equal(inPl(await pl(VIENNA_OCT_2025)).area_unknown_reason, "no_zones");

      // AND THE TAG STILL RESOLVES WHILE IT IS GREY. This is the line that must never be
      // deleted for tidiness: it is the difference between a grey pin and a dead building.
      const tap = await asWorker("/shifts/open", {
        method: "POST",
        body: { client_uuid: uuid(66), location_uuid: grey, start_time: new Date().toISOString() },
      });
      assert.equal(tap.status, 201, "an UNZONED building is grey on the map and fully tappable at the wall");
      await expect(
        await asWorker("/shifts/close", {
          method: "POST",
          body: { client_uuid: uuid(66), end_time: new Date(Date.now() + 60_000).toISOString() },
        }),
        200,
      );

      // One zone flips the presentation and changes nothing else.
      await expect(
        await asAdmin("/admin/zones", { method: "POST", body: { location_id: grey, name: "Eingang" } }),
        201,
      );
      assert.equal((await analyticsOf()).zone_state, "zoned");
      assert.equal((await analyticsOf()).active, true);

      // A DEACTIVATED building with zones is the opposite corner, and proves the two are
      // genuinely independent rather than two names for one thing.
      await expect(await asAdmin(`/admin/locations/${grey}`, { method: "DELETE" }), 200);
      const gone = await analyticsOf();
      assert.equal(gone.active, false, "deactivated: the tag stops resolving");
      assert.equal(gone.zone_state, "unzoned", "...and its zones went with it (decision-43)");
      assert.equal(
        (
          await asWorker("/shifts/open", {
            method: "POST",
            body: { client_uuid: uuid(67), location_uuid: grey, start_time: new Date().toISOString() },
          })
        ).status,
        422,
        "and THIS is what an inactive building does — which 'unzoned' must never do",
      );
      await admin.query("DELETE FROM shifts WHERE client_uuid = $1", [uuid(66)]);
    });

    // GREP PIN · NO PER-ZONE COST, EVER, AND THE REFUSAL IS THE DELIVERABLE.
    //
    // A shift is building-level (decision-43 §4), so no duration is attributable to a zone.
    // The tempting move is to split the building's labour by area share — which asserts that
    // time is proportional to floor area. That is false in the obvious direction: a
    // Tiefgarage is fast per m2 and an office floor is slow. It is the same failure
    // decision-6 already refused for materials, and it would put a number nobody can defend
    // into a conversation about a client's contract.
    await test("GREP PIN: nothing divides labour or material cost by a zone's area share", () => {
      const sources = ["lib/reporting.js", "routes/admin.js", "routes/app.js", "lib/prorata.js"].map((f) => ({
        file: f,
        text: readFileSync(new URL(f, import.meta.url), "utf8"),
      }));
      for (const { file, text } of sources) {
        // A zone area appearing in the same SQL statement as a labour or material amount is
        // the shape of the mistake. Statement-scoped rather than file-scoped, so the
        // building-level per-m2 block above does not trip it.
        for (const statement of text.split(";")) {
          const usesZoneArea = /z\.area_sqm|zones[\s\S]{0,80}area_sqm/.test(statement);
          const usesCost = /labour_cents|material_cents|cost_cents|hourly_rate_cents/.test(statement);
          assert.ok(
            !(usesZoneArea && usesCost),
            `${file} appears to compute a cost against a zone area. A shift is building-level; splitting it by area asserts that time is proportional to floor area, which is false.`,
          );
        }
      }
    });

    await test("nothing is flagged until the operator says what the baseline is", async () => {
      const unset = await pl(VIENNA_OCT_2025);
      assert.equal(unset.baseline_margin_bp, null);
      assert.equal(unset.baseline_set, false);
      assert.ok(
        unset.buildings.every((b) => b.below_baseline === null),
        "with no baseline configured NOTHING may be flagged — this codebase does not know what margin a Viennese cleaning contract should make",
      );
      // The dishonesty that is NOT fixed, stated on the wire so the screen can carry it.
      assert.equal(unset.labour.rate_basis, "current");

      await expect(
        await asAdmin("/admin/settings", { method: "POST", body: { key: "pl_margin_baseline_bp", value: 9990 } }),
        200,
      );

      const flagged = await pl(VIENNA_OCT_2025);
      assert.equal(flagged.baseline_margin_bp, 9990);
      const a = building(flagged, plA);
      assert.equal(a.margin_bp, Math.round(((a.revenue_cents - a.labour_cents - a.material_cents) * 10000) / a.revenue_cents));
      assert.equal(a.below_baseline, a.margin_bp < 9990);
      assert.equal(
        building(flagged, plB).below_baseline,
        null,
        "a building whose month nobody has typed a payment for still cannot be assessed",
      );

      for (const bad of [
        { key: "pl_margin_baseline_bp", value: "fifteen" },
        { key: "pl_margin_baseline_bp", value: 1.5 },
        { key: "pl_margin_baseline_bp", value: 99_999 },
        // Not on the allowlist: it would be stored, do nothing forever, and leave the
        // director wondering why no building is ever flagged.
        { key: "pl_margin_baseline_bpp", value: 1500 },
      ]) {
        assert.equal((await asAdmin("/admin/settings", { method: "POST", body: bad })).status, 400, JSON.stringify(bad));
      }

      const cleared = await expect(await asAdmin("/admin/settings/pl_margin_baseline_bp", { method: "DELETE" }), 200);
      assert.deepEqual(cleared.setting, { key: "pl_margin_baseline_bp", value: null });
      assert.equal((await pl(VIENNA_OCT_2025)).baseline_set, false, "unsetting must be reachable");
      // Idempotent: pressing it twice must not look like a failure.
      assert.equal((await asAdmin("/admin/settings/pl_margin_baseline_bp", { method: "DELETE" })).status, 200);
    });

    await test("analytics reports actual vs target and refuses to call one month a trend", async () => {
      const payload = await analytics(VIENNA_OCT_2025, "&months=3");
      const a = payload.buildings.find((b) => b.location_id === plA);
      assert.equal(a.actual_minutes, 60);
      assert.equal(a.target_minutes, 620, "620 min/month over 31 October days is 620 minutes");
      assert.equal(a.variance_minutes, 60 - 620);

      const c = payload.buildings.find((b) => b.location_id === plC);
      assert.equal(c.target_minutes, null, "a building with no contract has no target — not a target of zero");
      assert.equal(c.variance_minutes, null);

      // October is the only month with shifts, so there is exactly one data point.
      assert.equal(a.trend.length, 3, "three buckets asked for, three buckets returned");
      assert.equal(a.trend_reason, "insufficient_data");
      assert.equal(a.trend_direction, null, "one month is not a flat line, it is one month");
      assert.equal(a.trend_delta_minutes, null);
      assert.deepEqual(
        a.trend.map((t) => t.month),
        ["2025-08", "2025-09", "2025-10"],
        "buckets are Vienna calendar months ending with the month the period ends in",
      );

      // A second month makes it arithmetic rather than a guess.
      await admin.query(
        `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
         VALUES ($1, $2, '2025-09-15T06:00:00Z', '2025-09-15T08:00:00Z')`,
        [plWorker, plA],
      );
      const withTrend = (await analytics(VIENNA_OCT_2025, "&months=3")).buildings.find((b) => b.location_id === plA);
      assert.equal(withTrend.trend_reason, null);
      assert.equal(withTrend.trend_delta_minutes, 60 - 120, "October's 60 minutes against September's 120");
      assert.equal(withTrend.trend_direction, "down");
      // September's shift is outside the reported period and must not touch its totals.
      assert.equal(withTrend.actual_minutes, 60);
      await admin.query("DELETE FROM shifts WHERE worker_id = $1 AND start_time < '2025-10-01'", [plWorker]);
    });

    // ---- geocoding: a building you cannot save is worse than one with no pin ---------
    await test("a geocoding failure NEVER stops a building being created", async () => {
      assert.equal(process.env.GOOGLE_GEOCODING_KEY, undefined, "this case must run with no Maps key");

      // 1. No key configured at all — the supported state of a fresh box.
      const noKey = await expect(
        await asAdmin("/admin/locations", {
          method: "POST",
          body: { slug: "geo-nokey", name: "Geo ohne Schlüssel", address: "Stephansplatz 1, 1010 Wien" },
        }),
        201,
      );
      assert.equal(noKey.location.lat, null);

      assert.equal(noKey.location.geocode_status, "no_key", "and the panel is told WHY, not just shown an empty map");

      // 2. The geocoder throws — network down, DNS gone, TLS refused.
      setGeocoderForTest(async () => {
        throw new Error("getaddrinfo ENOTFOUND maps.googleapis.com");
      });
      const thrown = await asAdmin("/admin/locations", {
        method: "POST",
        body: { slug: "geo-throws", name: "Geo mit Ausfall", address: "Kärntner Straße 1, 1010 Wien" },
      });
      const thrownLocation = (await thrown.json()).location;
      assert.equal(thrown.status, 201, "a Google outage is not a reason to lose a building");
      assert.equal(thrownLocation.lat, null);
      assert.ok(thrownLocation.geocoded_at, "but we must record that we ASKED, or the panel cannot offer a retry");

      // 3. Quota exhausted — a 200 from Google with no usable answer.
      setGeocoderForTest(async () => ({ status: "OVER_QUERY_LIMIT", lat: null, lng: null, street_view_status: null }));
      const empty = await expect(
        await asAdmin("/admin/locations", {
          method: "POST",
          body: { slug: "geo-empty", name: "Geo ohne Treffer", address: "Nirgendwogasse 999, 1010 Wien" },
        }),
        201,
      );
      assert.equal(empty.location.lat, null);
      assert.equal(empty.location.geocode_status, "OVER_QUERY_LIMIT", "'try again tomorrow' is not 'fix your address'");

      // 4. It works. The retry button is the same code path as the backfill script.
      setGeocoderForTest(async () => ({ status: "OK", lat: 48.2082, lng: 16.3738, street_view_status: "OK" }));
      const pinned = (await expect(await asAdmin(`/admin/locations/${thrownLocation.id}/geocode`, { method: "POST" }), 200))
        .location;
      assert.equal(pinned.lat, 48.2082);
      assert.equal(pinned.lng, 16.3738);
      // Stored, not guessed from the image: the static Street View endpoint answers 200
      // with a grey "no imagery" JPEG, so an onError handler alone ships a grey box.
      assert.equal(pinned.street_view_status, "OK");

      // A hand-placed pin is more authoritative than a geocoder and must not be overwritten.
      setGeocoderForTest(async () => ({ status: "OK", lat: 0, lng: 0, street_view_status: "ZERO_RESULTS" }));
      const manual = await asAdmin("/admin/locations", {
        method: "POST",
        body: { slug: "geo-manual", name: "Geo von Hand", address: "Praterstern 1, 1020 Wien", lat: 48.2185, lng: 16.3919 },
      });
      assert.equal((await manual.json()).location.lat, 48.2185);

      const noAddress = await asAdmin(`/admin/locations/${plA}/geocode`, { method: "POST" });
      assert.equal(noAddress.status, 422, "nothing to geocode is worth naming; the fix is to type an address");
      assert.equal((await noAddress.json()).error, "location_has_no_address");

      setGeocoderForTest(null);

      const state = (await analytics(VIENNA_OCT_2025)).buildings;
      const stateOf = (slug) => state.find((b) => b.slug === slug)?.geocode_state;
      assert.equal(stateOf("geo-throws"), "pinned");
      assert.equal(stateOf("geo-empty"), "failed", "'asked and got nothing' is not 'nobody has asked'");
      assert.equal(stateOf("pl-a"), "never_attempted", "a building with no address was never asked about");
    });

    // MEASURED AGAINST THE LIVE KEY, and the reason this guard exists at all:
    //   "Nirgendwogasse 99999, 1010 Wien" -> HTTP 200, status OK, partial_match: true,
    //                                        types ['postal_code'], APPROXIMATE,
    //                                        48.2082647 / 16.3739206
    //   "Quatsch Quatsch Quatsch"         -> HTTP 200, status OK, partial_match: true,
    //                                        types ['country'] — the middle of Austria
    // Without the guard, a typo puts a confident marker on the map and nothing says it is
    // a guess. This exercises the REAL parser, with Google's real response shape, offline.
    await test("a fuzzy Google match never becomes a pin (a wrong pin is worse than none)", async () => {
      const { geocodeAddress } = await import("./lib/geocode.js");
      const realFetch = globalThis.fetch;
      const reply = (payload) => {
        globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
      };
      process.env.GOOGLE_GEOCODING_KEY = "not-a-real-key-and-never-sent-anywhere";
      try {
        // Verbatim shape of the live "Nirgendwogasse 99999" answer.
        reply({
          status: "OK",
          results: [
            {
              partial_match: true,
              types: ["postal_code"],
              formatted_address: "1010 Vienna, Austria",
              geometry: { location: { lat: 48.2082647, lng: 16.3739206 }, location_type: "APPROXIMATE" },
            },
          ],
        });
        const fuzzy = await geocodeAddress("Nirgendwogasse 99999, 1010 Wien");
        assert.equal(fuzzy.lat, null, "the centre of the 1st district is not this building");
        assert.equal(fuzzy.status, "PARTIAL_MATCH");

        // Not flagged partial, but still only a district-level answer.
        reply({
          status: "OK",
          results: [{ types: ["locality"], geometry: { location: { lat: 48.2, lng: 16.37 }, location_type: "APPROXIMATE" } }],
        });
        assert.equal((await geocodeAddress("Wien")).status, "APPROXIMATE_ONLY");

        // A real building-level answer still gets through, or the guard is just an outage.
        // The second call this makes is Street View metadata, which against the live key
        // really does answer REQUEST_DENIED ("this API key is not authorized to use this
        // service") until the Street View Static API is switched on in the Cloud Console.
        // That reason must be PRESERVED: reported as null, every building would look like
        // "Google has no photograph here" when the fix is a checkbox someone has to tick.
        let call = 0;
        globalThis.fetch = async () => {
          call += 1;
          return new Response(
            JSON.stringify(
              call === 1
                ? {
                    status: "OK",
                    results: [
                      {
                        types: ["street_address"],
                        geometry: { location: { lat: 48.2084609, lng: 16.3734547 }, location_type: "ROOFTOP" },
                      },
                    ],
                  }
                : { status: "REQUEST_DENIED", error_message: "This API key is not authorized to use this service or API." },
            ),
            { status: 200 },
          );
        };
        const exact = await geocodeAddress("Stephansplatz 1, 1010 Wien");
        assert.equal(exact.status, "OK");
        assert.equal(exact.lat, 48.2084609);
        assert.equal(exact.street_view_status, "REQUEST_DENIED", "a pin is still worth having without a photo");
        assert.notEqual(exact.street_view_status, "OK", "and the UI must never be handed a false OK to render a grey tile from");

        // ZERO_RESULTS and a network failure are both "no pin", with different reasons.
        reply({ status: "ZERO_RESULTS", results: [] });
        assert.equal((await geocodeAddress("x")).status, "ZERO_RESULTS");
        globalThis.fetch = async () => {
          throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
        };
        assert.equal((await geocodeAddress("x")).status, "network:ENOTFOUND");
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.GOOGLE_GEOCODING_KEY;
      }
    });

    // The geocoding metadata describes lat/lng and must not outlive them. POST
    // /admin/locations writes EVERY column, so a caller that omits lat/lng clears them;
    // if `geocoded_at` and `geocode_status` survived that, the row would claim to be on
    // the map with no coordinates AND would be invisible to both repair paths
    // (`shouldGeocode` skips a row whose geocoded_at is set, and geocode-backfill.js
    // selects `geocoded_at IS NULL`). The building would stay unpinned forever.
    await test("clearing a building's pin also clears the status that described it", async () => {
      const id = await newLocation("geo-consistency", "Geo Consistency");
      const pinned = async () =>
        (await admin.query("SELECT lat, lng, geocoded_at, geocode_status FROM locations WHERE id = $1", [id])).rows[0];

      await admin.query(
        `UPDATE locations SET lat = 48.2083, lng = 16.3739, geocoded_at = now(),
                geocode_status = 'OK', street_view_status = 'OK' WHERE id = $1`,
        [id],
      );
      // An edit that touches an unrelated field and does not carry the coordinates back.
      await expect(
        await asAdmin("/admin/locations", {
          method: "POST",
          body: { id, slug: "geo-consistency", name: "Geo Consistency umbenannt", active: true },
        }),
        200,
      );
      const after = await pinned();
      assert.equal(after.lat, null, "the write-every-column contract still clears the pin");
      assert.equal(after.geocode_status, null, "a building with no coordinates must not report 'OK'");
      assert.equal(after.geocoded_at, null, "and it must become visible to the backfill again");

      // The other half: a geocode that legitimately FAILED keeps its reason. lat is
      // already NULL there, so nothing is being lost, and re-querying every such row on
      // every unrelated save is how the quota that pins the NEXT building gets burnt.
      await admin.query(
        `UPDATE locations SET lat = NULL, lng = NULL, geocoded_at = now(),
                geocode_status = 'ZERO_RESULTS' WHERE id = $1`,
        [id],
      );
      await expect(
        await asAdmin("/admin/locations", {
          method: "POST",
          body: { id, slug: "geo-consistency", name: "Geo Consistency nochmal", active: true },
        }),
        200,
      );
      assert.equal((await pinned()).geocode_status, "ZERO_RESULTS", "a named failure survives an unrelated edit");
    });

    // ---- material requests: the worker side (decision-22) ---------------------------
    await test("a worker's material request takes its owner from the SESSION (decision-22)", async () => {
      const request = (
        await expect(
          await asWorker("/material-requests", {
            method: "POST",
            // The body names somebody else. It must be ignored, exactly as on /shifts/open.
            body: { body: "Brauche neue Wischmopps", location_uuid: plA, worker_id: otherWorkerId },
          }),
          201,
        )
      ).request;
      assert.equal(request.worker_id, workerId, "the caller-supplied worker_id must not be read");
      assert.equal(request.status, "submitted");
      assert.equal(request.cost_cents, null, "a request nobody has priced is UNPRICED, not free");
      assert.equal(request.inventory_item_id, null, "free text is never fuzzy-matched to a product");

      for (const bad of [{}, { body: "" }, { body: "x".repeat(2001) }, { body: "ok", location_uuid: "not-a-uuid" }]) {
        const rejected = await asWorker("/material-requests", { method: "POST", body: bad });
        assert.ok(rejected.status >= 400, `${JSON.stringify(bad)} must be refused`);
      }
      // Unlocked tags mean an id off the wire is untrusted (decision-15): it is resolved
      // against ACTIVE locations or refused, never inserted on trust.
      const ghost = await asWorker("/material-requests", {
        method: "POST",
        body: { body: "ok", location_uuid: uuid(77) },
      });
      assert.equal(ghost.status, 422);
      assert.equal((await ghost.json()).error, "unknown_location");
    });

    await test("worker A cannot read, or acknowledge, worker B's material requests", async () => {
      const mine = await (await asWorker("/material-requests/mine")).json();
      assert.ok(mine.requests.length > 0);
      assert.ok(
        mine.requests.every((r) => r.worker_id === workerId),
        "GET /material-requests/mine must be scoped to the session and to nothing else",
      );
      const target = mine.requests[0].id;

      // The other worker's view: ids are sequential, so "not guessable" is not a defence.
      const theirs = await (await call("/material-requests/mine", { cookie: otherCookie })).json();
      assert.ok(
        !theirs.requests.some((r) => r.id === target),
        "a colleague's request must not appear in another worker's list",
      );
      assert.ok(theirs.requests.every((r) => r.worker_id === otherWorkerId));

      // Free text people write about their own workplace is not readable by walking ids.
      await admin.query("UPDATE material_requests SET status = 'arrived' WHERE id = $1", [target]);
      const stolen = await call(`/material-requests/${target}/seen`, { method: "POST", cookie: otherCookie });
      assert.equal(stolen.status, 404, "404 and not 403: an existence oracle over a colleague's requests is not worth it");
      assert.equal(
        (await admin.query("SELECT seen_at FROM material_requests WHERE id = $1", [target])).rows[0].seen_at,
        null,
        "and nothing may be written by a rejected call",
      );

      const own = await asWorker(`/material-requests/${target}/seen`, { method: "POST" });
      assert.equal(own.status, 200);
      const seenAt = (await own.json()).request.seen_at;
      assert.ok(seenAt, "the owner can acknowledge their own arrival");
      const again = await asWorker(`/material-requests/${target}/seen`, { method: "POST" });
      assert.equal((await again.json()).request.seen_at, seenAt, "idempotent: a double tap keeps the FIRST acknowledgement");

      // A signed-in worker is required, not just the build's app key.
      assert.equal((await call("/material-requests/mine")).status, 401);
      assert.equal((await call("/material-requests", { method: "POST", body: { body: "x" } })).status, 401);
    });

    await test("the admin advances a request one legal step at a time", async () => {
      const created = await asWorker("/material-requests", {
        method: "POST",
        body: { body: "Zwei Flaschen Glasreiniger" },
      });
      const id = (await created.json()).request.id;
      const patch = (body) => asAdmin(`/admin/material-requests/${id}`, { method: "PATCH", body });

      // Jumping the lifecycle would stamp ordered_at for a period in which nothing was
      // ever ordered, and a cost would land in the wrong month's P&L.
      for (const status of ["arrived", "ordered"]) {
        const res = await patch({ status });
        assert.equal(res.status, 409, `submitted -> ${status} must be refused`);
        assert.equal((await res.json()).error, "invalid_transition");
      }

      const approved = await (await patch({ status: "approved", admin_note: "OK, wird bestellt" })).json();
      assert.equal(approved.request.status, "approved");
      assert.ok(approved.request.decided_at, "who decided and when is stamped by the server");
      assert.equal(approved.request.ordered_at, null, "approving is not a spend");

      const ordered = await (await patch({ status: "ordered", quantity: 2, cost_cents: 1234 })).json();
      assert.ok(ordered.request.ordered_at, "ordering pins the period the cost belongs to");
      assert.equal(ordered.request.cost_cents, 1234);

      const arrived = await (await patch({ status: "arrived" })).json();
      assert.ok(arrived.request.arrived_at);
      assert.equal(arrived.request.ordered_at, ordered.request.ordered_at, "arriving must not move the spend");

      // A late invoice correction changes the amount, never the period.
      const corrected = await (await patch({ cost_cents: 1300 })).json();
      assert.equal(corrected.request.cost_cents, 1300);
      assert.equal(corrected.request.ordered_at, ordered.request.ordered_at);
      assert.equal((await patch({ status: "approved" })).status, 409, "arrived is terminal");

      for (const bad of [{ status: "eingekauft" }, { quantity: 0 }, { cost_cents: -1 }, { inventory_item_id: 999_999 }]) {
        assert.ok((await patch(bad)).status >= 400, `${JSON.stringify(bad)} must be refused`);
      }

      const rejectedId = (await (await asWorker("/material-requests", { method: "POST", body: { body: "Ein Auto" } })).json())
        .request.id;
      const rejectRes = await asAdmin(`/admin/material-requests/${rejectedId}`, {
        method: "PATCH",
        body: { status: "rejected", admin_note: "Nicht im Budget" },
      });
      assert.equal((await rejectRes.json()).request.status, "rejected");
      const reopen = await asAdmin(`/admin/material-requests/${rejectedId}`, { method: "PATCH", body: { cost_cents: 500 } });
      assert.equal(reopen.status, 409, "money must not be attributed to something we declined to buy");

      // And the admin panel gets the queue in the same round trip as everything else.
      const data = await (await asAdmin("/admin/data")).json();
      assert.ok(Array.isArray(data.material_requests));
      assert.ok(data.material_requests.some((r) => r.id === id));
      assert.ok(data.material_requests.every((r) => typeof r.worker_name === "string"));
      assert.deepEqual(data.settings, {}, "no settings configured is the normal state, and it is an empty object");
    });

    // ===================================================================================
    // decision-43 / decision-44 · ZONES, THE TAG ON THE WALL, AND THREE PINS WITH TEETH
    //
    // Each pin exists because its failure is expensive AND SILENT. The mutation that turns
    // each one red is named beside it, and each was run red before this landed.
    // ===================================================================================

    await test("PIN 1: an UNZONED building's own uuid still resolves — the card on the wall", async () => {
      // *** THE MOST EXPENSIVE FAILURE IN THIS BATCH. ***
      // A blank NTAG card was written in July and mounted at the only live building. It
      // carries a BUILDING uuid, and that building has ZERO zones. "A building with no
      // zones is inactive" is a PRESENTATION rule about a grey pin on the map; wired into
      // resolution it 422s that card on the day migration 006 lands, and NO SITE VISIT
      // FIXES IT — the tag cannot be rewritten from Vienna.
      //
      // RED: add `AND EXISTS (SELECT 1 FROM zones z WHERE z.location_id = l.id AND z.active)`
      // to the building branch of activePlace() -> this answers 422 unknown_location.
      const wallHouse = await newLocation("pin-unzoned", "Wandkarte Haus");
      assert.equal(
        await countOf("SELECT count(*) AS n FROM zones WHERE location_id = $1", [wallHouse]),
        0,
        "the fixture must have NO zones, or the pin proves nothing",
      );

      const opened = await expect(
        await asWorker("/shifts/open", {
          method: "POST",
          body: { client_uuid: uuid(60), location_uuid: wallHouse, start_time: new Date().toISOString() },
        }),
        201,
      );
      assert.equal(opened.shift.location_id, wallHouse, "a building uuid resolves to THE BUILDING, for ever");
      assert.equal(opened.shift.start_zone_id, null, "and to no zone — never 'the first zone', which fabricates a tap");
      await expect(
        await asWorker("/shifts/close", {
          method: "POST",
          body: { client_uuid: uuid(60), end_time: new Date(Date.now() + 60_000).toISOString() },
        }),
        200,
      );
      await admin.query("DELETE FROM shifts WHERE client_uuid = $1", [uuid(60)]);
    });

    await test("a zone uuid resolves to (its building, itself); deactivating either kills it", async () => {
      const zoneHouse = await newLocation("pin-zoned", "Zonenhaus");
      const zone = (
        await expect(
          await asAdmin("/admin/zones", { method: "POST", body: { location_id: zoneHouse, name: "Haupteingang" } }),
          201,
        )
      ).zone;

      const opened = await expect(
        await asWorker("/shifts/open", {
          method: "POST",
          body: { client_uuid: uuid(61), location_uuid: zone.id, start_time: new Date().toISOString() },
        }),
        201,
      );
      assert.equal(opened.shift.location_id, zoneHouse, "a shift stays BUILDING-level (decision-43 §4)");
      assert.equal(opened.shift.start_zone_id, zone.id, "...with the door recorded as a tap FACT beside it");
      // The zone NAME rides along on the worker's own reads, so the running screen can name
      // the door without a second round trip.
      assert.equal((await (await asWorker("/shifts/open")).json()).shift.zone_name, "Haupteingang");
      await expect(
        await asWorker("/shifts/close", {
          method: "POST",
          body: { client_uuid: uuid(61), end_time: new Date(Date.now() + 60_000).toISOString() },
        }),
        200,
      );

      // A tag taken off a wall stops resolving. Soft-deactivated, so the shift above keeps
      // naming the door it was tapped at.
      await expect(await asAdmin(`/admin/zones/${zone.id}`, { method: "DELETE" }), 200);
      const deadZone = await asWorker("/shifts/open", {
        method: "POST",
        body: { client_uuid: uuid(62), location_uuid: zone.id, start_time: new Date().toISOString() },
      });
      assert.equal(deadZone.status, 422);
      assert.equal(
        (await deadZone.json()).error,
        "unknown_location",
        "THE CODE MUST NOT CHANGE: the APK in the field maps exactly this string; a new one renders as 'unknown status'",
      );

      // Deactivating the BUILDING must take its zones with it. An active zone under an
      // inactive building is unresolvable anyway and would sit in the panel looking live.
      await admin.query("UPDATE zones SET active = true WHERE id = $1", [zone.id]);
      await expect(await asAdmin(`/admin/locations/${zoneHouse}`, { method: "DELETE" }), 200);
      assert.equal(
        await countOf("SELECT count(*) AS n FROM zones WHERE location_id = $1 AND active", [zoneHouse]),
        0,
        "deactivating a building must deactivate its zones — remove the cascade and this goes red",
      );
      for (const id of [zone.id, zoneHouse]) {
        const res = await asWorker("/shifts/open", {
          method: "POST",
          body: { client_uuid: uuid(63), location_uuid: id, start_time: new Date().toISOString() },
        });
        assert.equal(res.status, 422, "neither the zone nor the building resolves once the building is inactive");
      }
      await admin.query("DELETE FROM shifts WHERE client_uuid = ANY($1)", [[uuid(61), uuid(62), uuid(63)]]);
    });

    await test("the SHIPPED APK's clock-in shape still opens a shift, byte for byte", async () => {
      // AN OLD APK IN A POCKET MUST NOT START FAILING THE MOMENT THIS DEPLOYS. The build in
      // the field posts exactly these three keys, with a BUILDING uuid in `location_uuid`,
      // and never sends `location_uuid` on close. Nothing below is new syntax.
      const oldShape = { client_uuid: uuid(64), location_uuid: locationUuid, start_time: new Date().toISOString() };
      const opened = await expect(await asWorker("/shifts/open", { method: "POST", body: oldShape }), 201);
      assert.equal(opened.shift.location_id, locationUuid);
      assert.equal(opened.shift.start_zone_id, null);
      // The close the old build sends: client_uuid + end_time, and nothing else.
      const closed = await expect(
        await asWorker("/shifts/close", {
          method: "POST",
          body: { client_uuid: uuid(64), end_time: new Date(Date.now() + 60_000).toISOString() },
        }),
        200,
      );
      assert.equal(closed.shift.end_zone_id, null, "a close with no place named records no place");

      // GET /roster is what the old build parses on launch: it reads getJSONArray("locations")
      // and ignores everything else. `zones` is purely additive and must not disturb it.
      const roster = await (await asWorker("/roster")).json();
      assert.ok(Array.isArray(roster.locations), "the array the shipped build reads must still be there");
      assert.ok(Array.isArray(roster.zones), "...and the new one rides beside it");
      assert.deepEqual(
        Object.keys(roster.locations[0]).sort(),
        ["address", "id", "lat", "lng", "name", "slug"],
        "the locations element shape is unchanged",
      );
      assert.equal(roster.locations[0].hourly_rate_cents, undefined, "pay data must still not leak to the app");
      await admin.query("DELETE FROM shifts WHERE client_uuid = $1", [uuid(64)]);
    });

    await test("a close naming a DIFFERENT building is refused, not silently recorded", async () => {
      const houseA = await newLocation("close-a", "Close Haus A");
      const houseB = await newLocation("close-b", "Close Haus B");
      await expect(
        await asWorker("/shifts/open", {
          method: "POST",
          body: { client_uuid: uuid(65), location_uuid: houseA, start_time: new Date().toISOString() },
        }),
        201,
      );
      const wrong = await asWorker("/shifts/close", {
        method: "POST",
        body: { client_uuid: uuid(65), location_uuid: houseB, end_time: new Date(Date.now() + 60_000).toISOString() },
      });
      // Recording it would put an end time from one building's door onto another
      // building's shift. The app's own rule is that a different building CLOSES this one
      // and OPENS a new one there, so a close naming elsewhere is a client bug.
      assert.equal(wrong.status, 422);
      assert.equal((await wrong.json()).error, "wrong_building");
      assert.equal(
        (await admin.query("SELECT end_time FROM shifts WHERE client_uuid = $1", [uuid(65)])).rows[0].end_time,
        null,
        "and a refused close must not have written an end time",
      );
      await expect(
        await asWorker("/shifts/close", {
          method: "POST",
          body: { client_uuid: uuid(65), end_time: new Date(Date.now() + 60_000).toISOString() },
        }),
        200,
      );
      await admin.query("DELETE FROM shifts WHERE client_uuid = $1", [uuid(65)]);
    });

    await test("moving a shift to another building CLEARS its zone columns", async () => {
      const fromHouse = await newLocation("move-from", "Umzug von");
      const toHouse = await newLocation("move-to", "Umzug nach");
      const zone = (
        await expect(
          await asAdmin("/admin/zones", { method: "POST", body: { location_id: fromHouse, name: "Stiege X" } }),
          201,
        )
      ).zone;
      const shiftId = Number(
        (
          await admin.query(
            `INSERT INTO shifts (worker_id, location_id, start_zone_id, start_time, end_time)
             VALUES ($1, $2, $3, now() - interval '2 hours', now() - interval '1 hour') RETURNING id`,
            [workerId, fromHouse, zone.id],
          )
        ).rows[0].id,
      );
      // WITHOUT the clearing this is a 23503 surfacing as a 500 the director cannot act on:
      // the composite FK is (zone_id, location_id) -> zones (id, location_id), so a zone
      // from the OLD building cannot survive the move. Clearing is also the right SEMANTICS
      // — a human re-pointing a shift is saying the tap record was wrong.
      const patched = await expect(
        await asAdmin(`/admin/shifts/${shiftId}`, { method: "PATCH", body: { location_id: toHouse } }),
        200,
      );
      assert.equal(patched.shift.location_id, toHouse);
      assert.equal(patched.shift.start_zone_id, null, "the tap fact from the old building must be cleared");
      assert.equal(patched.shift.end_zone_id, null);
      await admin.query("DELETE FROM shifts WHERE id = $1", [shiftId]);
    });

    await test("an adopted serial is normalised, uniquely claimed, and 409s by NAME", async () => {
      const house = await newLocation("serial-haus", "Serial Haus");
      // The real tag: an NXP Mifare Ultralight EV1 someone else mounted, 46 B of NDEF
      // holding no URL at all. It cannot be rewritten to carry our URI, which is why the
      // serial is data on a zone rather than a hardcode in an APK (decision-44).
      const SERIAL = "04:A1:A8:52:AE:5C:80";
      const adopted = (
        await expect(
          await asAdmin("/admin/zones", {
            method: "POST",
            // Typed the way another reader spells it. Normalising means the CHECK never
            // fires on somebody who typed the truth in a different style.
            body: { location_id: house, name: "Übernommener Tag", tag_serial: "04-a1-a8-52-ae-5c-80" },
          }),
          201,
        )
      ).zone;
      assert.equal(adopted.tag_serial, SERIAL, "one stored spelling, whatever the director pasted");

      const clash = await asAdmin("/admin/zones", {
        method: "POST",
        body: { location_id: house, name: "Zweite Zone", tag_serial: "04 a1 a8 52 ae 5c 80" },
      });
      assert.equal(clash.status, 409);
      const clashBody = await clash.json();
      assert.equal(clashBody.error, "serial_taken");
      assert.equal(clashBody.zone.name, "Übernommener Tag", "the refusal must NAME the zone that has it, or it is a dead end");

      // Two live zones with one name in one building is a director about to tag the wrong door.
      assert.equal(
        (await asAdmin("/admin/zones", { method: "POST", body: { location_id: house, name: "übernommener tag" } })).status,
        409,
      );

      // THE DELIVERY PATH: server -> phone, inside /roster, and nowhere else.
      const roster = await (await asWorker("/roster")).json();
      const carried = roster.zones.find((z) => z.tag_serial === SERIAL);
      assert.ok(carried, "GET /roster must carry the serial — this is THE GATE before KnownTags.kt is deleted");
      assert.equal(carried.location_id, house, "...resolving to the right building");
      for (const key of ["area_sqm", "note", "tag_deployed_at"]) {
        assert.equal(carried[key], undefined, `${key} is admin data and has no business on a worker's phone`);
      }

      // Junk is refused rather than stored in a shape the CHECK would later reject.
      for (const bad of ["nope", "04:A1", "04:A1:A8:5", "zz:zz:zz:zz"]) {
        const res = await asAdmin("/admin/zones", {
          method: "POST",
          body: { location_id: house, name: `Bad ${bad}`, tag_serial: bad },
        });
        assert.equal(res.status, 400, `serial ${bad} must be refused`);
      }
    });

    await test("PIN 2: no zone name and no area ever reaches the client portal", async () => {
      // A zone name is internal building structure. An area PLUS the contract value is our
      // price per square metre, in the hands of the party negotiating it. The payload's
      // minimality IS the lawful-basis argument written at the top of routes/portal.js.
      //
      // RED: add `z.name` (or an area) to the portal select list -> this fires.
      const house = await newLocation("portal-zoned", "Portalhaus");
      for (const [name, area] of [["Stiege Geheim", "120.00"], ["Tiefgarage Geheim", "80.00"]]) {
        await expect(
          await asAdmin("/admin/zones", { method: "POST", body: { location_id: house, name, area_sqm: area } }),
          201,
        );
      }
      await admin.query(
        `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
         VALUES ($1, $2, now() - interval '3 hours', now() - interval '2 hours')`,
        [workerId, house],
      );
      const client = Number((await admin.query("INSERT INTO clients (name) VALUES ('Portalkunde') RETURNING id")).rows[0].id);
      const contact = Number(
        (
          await admin.query("INSERT INTO contacts (client_id, name) VALUES ($1, 'Frau Gruber') RETURNING id", [client])
        ).rows[0].id,
      );
      const path = (
        await expect(
          await asAdmin("/admin/portal-grants", { method: "POST", body: { contact_id: contact, location_id: house } }),
          201,
        )
      ).path;

      const view = await (await call(path, { key: null })).json();
      const serialised = JSON.stringify(view);
      for (const leak of ["Stiege Geheim", "Tiefgarage Geheim", "zone", "area", "sqm", "m2", "120", "80"]) {
        assert.ok(!serialised.includes(leak), `"${leak}" reached the client portal: ${serialised}`);
      }
      assert.deepEqual(Object.keys(view).sort(), ["building", "cleanings"], "the payload shape is unchanged");
      assert.deepEqual(Object.keys(view.building), ["name"]);
      assert.deepEqual(Object.keys(view.cleanings[0]).sort(), ["date", "first_name", "minutes"]);

      // A GRANT MUST NEVER BE ZONE-SCOPED EITHER. portal_grants references location_id and
      // must keep doing so: a grantable zone id is a smaller unit of disclosure that nobody
      // has a lawful basis to hand out, and it would need its own decision record.
      assert.equal(
        await countOf(
          "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'portal_grants' AND column_name LIKE '%zone%'",
        ),
        0,
        "portal_grants must have no zone-scoped column",
      );
      const zoneId = (await admin.query("SELECT id FROM zones WHERE location_id = $1 LIMIT 1", [house])).rows[0].id;
      const zoneGrant = await asAdmin("/admin/portal-grants", {
        method: "POST",
        body: { contact_id: contact, location_id: zoneId },
      });
      assert.ok(zoneGrant.status >= 400, "no route may mint a grant against a zone id");
    });

    await test("PIN 3: no route anywhere accepts a tag serial as INPUT", async () => {
      // Under this design the serial NEVER TRAVELS TOWARDS THE SERVER. The phone matches it
      // against the cached roster and posts the RESOLVED place UUID, which the server
      // resolves itself, with the worker taken from session.workerId (decision-22). A
      // cloned serial therefore buys a clock-in at that building AS YOURSELF — exactly what
      // a cloned URL tag already buys (decision-15). That is a stronger statement than any
      // rate limit could be, and it is worth keeping true BY MACHINE rather than by memory.
      //
      // RED: add a serial-accepting branch to any route -> this fires.
      const routeSources = ["routes/app.js", "routes/admin.js", "routes/portal.js", "routes/auth.js"];
      for (const file of routeSources) {
        const text = readFileSync(new URL(file, import.meta.url), "utf8");
        // Reading a serial OUT of a request is the shape of the mistake: body.*, query.get,
        // or a :serial path segment. Writing one INTO a zone from the admin form is not
        // (routes/admin.js legitimately does that) — so only the read side is banned.
        const reads = [
          /body\.[a-z_]*serial/i,
          /query\.get\(\s*["'][^"']*serial/i,
          /params\.[a-z_]*serial/i,
          /path:\s*["'][^"']*:serial/i,
        ];
        for (const pattern of reads) {
          const hit = pattern.exec(text);
          // routes/admin.js reads body.tag_serial to STORE it on a zone. That is the admin
          // writing down which tag is on which wall, from an authenticated browser — not a
          // tap, and not an identity claim. Every other read is banned outright.
          const allowed = file === "routes/admin.js" && hit?.[0] === "body.tag_serial";
          assert.ok(
            hit === null || allowed,
            `${file} parses a serial out of a request (${hit?.[0]}). A serial is broadcast in the clear and is clonable; nothing may ever resolve or authenticate on one.`,
          );
        }
      }
      // And no ROUTE PATH carries one either.
      const { adminRoutes } = await import("./routes/admin.js");
      const { appRoutes } = await import("./routes/app.js");
      for (const route of [...adminRoutes, ...appRoutes]) {
        assert.ok(!/serial|uid|tag_id/i.test(route.path), `${route.path} names hardware in its path`);
      }
    });

    await test("/admin/data carries zones with a DERIVED last_tap_at, and never a stored one", async () => {
      const house = await newLocation("tapstate-haus", "Tapstate Haus");
      const zone = (
        await expect(
          await asAdmin("/admin/zones", {
            method: "POST",
            body: { location_id: house, name: "Stiege 9", note: "Tag links neben der Gegensprechanlage" },
          }),
          201,
        )
      ).zone;

      const before = (await (await asAdmin("/admin/data")).json()).zones.find((z) => z.id === zone.id);
      assert.equal(before.last_tap_at, null, "'a tag is on this wall, never yet tapped' is a real state");
      assert.equal(before.note, "Tag links neben der Gegensprechanlage", "where the tag physically is");

      await admin.query(
        `INSERT INTO shifts (worker_id, location_id, start_zone_id, start_time, end_time)
         VALUES ($1, $2, $3, TIMESTAMPTZ '2026-05-14T07:00:00Z', TIMESTAMPTZ '2026-05-14T08:00:00Z')`,
        [workerId, house, zone.id],
      );
      const after = (await (await asAdmin("/admin/data")).json()).zones.find((z) => z.id === zone.id);
      assert.ok(after.last_tap_at, "...and 'the Tiefgarage tag has not been tapped since 14 May' is the answer zones buy");
      // Derived from shifts, never stored: a stored copy drifts the first time a shift is
      // corrected, and then the panel and the ledger disagree about the same tag.
      assert.equal(
        await countOf(
          "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'zones' AND column_name LIKE '%last_tap%'",
        ),
        0,
        "zones must not STORE a last-tap time — it is derivable, so a stored copy can only drift",
      );
      await admin.query("DELETE FROM shifts WHERE start_zone_id = $1", [zone.id]);
    });

    await admin.query("DELETE FROM material_requests WHERE worker_id = $1", [plWorker]);
    await admin.query("DELETE FROM shifts WHERE worker_id = $1", [plWorker]);
    await admin.query("DELETE FROM workers WHERE id = $1", [plWorker]);
  }

  // ---- operators (decision-45) ------------------------------------------------------
  {
    const expectOp = async (res, status) => {
      const payload = await res.json();
      assert.equal(res.status, status, JSON.stringify(payload));
      return payload;
    };

    const createOperator = (name, phone) => asAdmin("/admin/operators", { method: "POST", body: { name, phone } });
    const issueOperatorCode = (id) => asAdmin(`/admin/operators/${id}/enrolment-code`, { method: "POST" });
    const revokeOperatorCode = (id) => asAdmin(`/admin/operators/${id}/enrolment-code`, { method: "DELETE" });
    const deleteOperator = (id) => asAdmin(`/admin/operators/${id}`, { method: "DELETE" });
    const redeemOperator = (code, ip) => call("/auth/operator-code", { method: "POST", body: { code }, ip });

    /** Full lifecycle: create an operator with a phone, issue a code, return both. */
    const freshOperator = async (name, phone) => {
      const created = await expectOp(await createOperator(name, phone), 201);
      const issued = await expectOp(await issueOperatorCode(created.operator.id), 201);
      return { id: created.operator.id, name: created.operator.name, code: issued.code };
    };

    await test("every operator-facing route rejects a missing app key, admin session or operator session", async () => {
      const adminRoutesToCheck = [
        ["POST", "/admin/operators"],
        ["DELETE", "/admin/operators/1"],
        ["POST", "/admin/operators/1/enrolment-code"],
        ["DELETE", "/admin/operators/1/enrolment-code"],
      ];
      for (const [method, path] of adminRoutesToCheck) {
        const body = method === "POST" ? {} : undefined;
        const noCred = await call(path, { method, key: null, body });
        assert.equal(noCred.status, 401, `${method} ${path} with no credential`);
        assert.equal(
          (await call(path, { method, body })).status,
          401,
          `${method} ${path} must not accept the app key as an admin credential`,
        );
      }
      // /auth/operator-code is auth: "app" — the app key gates it, there is no session yet.
      assert.equal((await call("/auth/operator-code", { method: "POST", key: null, body: { code: "X" } })).status, 401);
      // /auth/operator-logout needs BOTH the app key AND a live operator session.
      assert.equal((await call("/auth/operator-logout", { method: "POST", key: null })).status, 401);
      assert.equal((await call("/auth/operator-logout", { method: "POST" })).status, 401, "app key alone must not be an operator session");
    });

    let opCookie = null;
    let opId = null;

    await test("POST /auth/operator-code mints ts_operator (not ts_worker), single use, TASK-212 AC#2", async () => {
      resetLoginRate();
      const op = await freshOperator("Feldleiter Redeem", "0664 900 00 01");
      opId = op.id;
      const before = Number(
        (await admin.query("SELECT count(*) AS n FROM operator_sessions")).rows[0].n,
      );

      const res = await redeemOperator(op.code, "10.6.1.1");
      const raw200 = await res.text();
      assert.equal(res.status, 200, `redemption should succeed, got ${raw200}`);
      const body = JSON.parse(raw200);
      assert.equal(body.operator.id, op.id);
      assert.equal(body.operator.name, "Feldleiter Redeem");

      // THE COOKIE NAME, checked literally — copy-pasting "ts_worker" here would collide
      // an operator session with the worker session table.
      const rawCookie = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
      assert.match(rawCookie, /^ts_operator=/, "POST /auth/operator-code must set ts_operator, not ts_worker");
      assert.ok(
        /HttpOnly/i.test(rawCookie) && /Secure/i.test(rawCookie) && /SameSite=Strict/i.test(rawCookie),
        rawCookie,
      );

      opCookie = cookieFrom(res);
      assert.equal(
        Number((await admin.query("SELECT count(*) AS n FROM operator_sessions")).rows[0].n),
        before + 1,
        "exactly one operator_sessions row",
      );

      const hashRow = await admin.query("SELECT 1 FROM operator_sessions WHERE token = $1", [
        hashToken(opCookie.split("=")[1]),
      ]);
      assert.equal(hashRow.rowCount, 1, "the DB stores the HASH, matched by hashing the raw cookie the same way");
      const rawStored = await admin.query("SELECT 1 FROM operator_sessions WHERE token = $1", [
        opCookie.split("=")[1],
      ]);
      assert.equal(rawStored.rowCount, 0, "the raw token must never be stored verbatim");

      const cleared = await admin.query("SELECT enrolment_code_hash FROM operators WHERE id = $1", [op.id]);
      assert.equal(cleared.rows[0].enrolment_code_hash, null, "redeeming must clear the code — single use");

      // Single use: the same code must not redeem twice.
      assert.equal((await redeemOperator(op.code, "10.6.1.2")).status, 401);
      resetLoginRate();
    });

    await test("operator code guesses spend their OWN per-IP bucket, not the worker one", async () => {
      resetLoginRate();
      const ip = "10.6.2.1";
      for (let i = 0; i < 5; i++) await redeemOperator("ZZZZ-ZZZY", ip);
      const locked = await redeemOperator("ZZZZ-ZZZY", ip);
      assert.equal(locked.status, 429, "the operator bucket must lock out after repeated failures, same as the worker one");
      // ...and must not spill onto /auth/code from the SAME address.
      assert.equal(
        (await call("/auth/code", { method: "POST", body: { code: "ZZZZ-ZZZY" }, ip })).status,
        401,
        "a locked-out operator bucket must not lock out the worker endpoint from the same IP (own bucket: enrolop:, not enrol:)",
      );
      resetLoginRate();
    });

    await test("operator and worker enrolment codes spend ONE shared global ceiling", async () => {
      resetLoginRate();
      const statuses = [];
      for (let i = 0; i < 20; i++) statuses.push((await redeemOperator("ZZZZ-ZZZX", `10.6.3.${i}`)).status);
      for (let i = 20; i < 40; i++) statuses.push((await call("/auth/code", { method: "POST", body: { code: "ZZZZ-ZZZX" }, ip: `10.6.3.${i}` })).status);
      assert.ok(statuses.includes(429), `40 guesses split across both endpoints must be throttled, got ${statuses}`);
      assert.ok(
        statuses.indexOf(429) <= 30,
        `the GLOBAL ceiling (shared across worker + operator codes) must bite by the 31st attempt total, first 429 at ${statuses.indexOf(429)}`,
      );
      resetLoginRate();
    });

    await test("an expired or revoked operator session is rejected in the SAME shape as an expired worker session", async () => {
      const op = await freshOperator("Feldleiter Expiry", "0664 900 00 02");
      const cookie = cookieFrom(await redeemOperator(op.code, "10.6.4.1"));

      await admin.query("UPDATE operator_sessions SET expires_at = now() - interval '1 minute' WHERE token = $1", [
        hashToken(cookie.split("=")[1]),
      ]);
      const expiredOp = await call("/auth/operator-logout", { method: "POST", cookie });
      const expiredOpBody = await expiredOp.text();

      // The SAME comparison, on the worker side: an expired ts_worker session hitting a
      // worker route. Both paths call the identical `fail(401, "unauthorized")` — this
      // proves it at the wire, not by reading the source.
      await expectOp(
        await call("/admin/workers", {
          method: "POST",
          key: null,
          cookie: adminCookie,
          body: { name: "Op Expiry Check", email: "op.expiry.check@example.test", hourly_rate_cents: 1500 },
        }),
        201,
      );
      const workerCookie = await workerCookieFor("apple-sub-op-expiry-check", "op.expiry.check@example.test", "10.6.4.2");
      await admin.query(
        "UPDATE worker_sessions SET expires_at = now() - interval '1 minute' WHERE token = $1",
        [hashToken(workerCookie.split("=")[1])],
      );
      const expiredWorker = await call("/roster", { cookie: workerCookie });
      const expiredWorkerBody = await expiredWorker.text();

      assert.equal(expiredOp.status, 401);
      assert.equal(expiredOp.status, expiredWorker.status);
      assert.equal(expiredOpBody, expiredWorkerBody, "an expired operator session and an expired worker session must fail identically");
      assert.equal(expiredOpBody, '{"error":"unauthorized"}');

      // Revoked: the row is simply gone. Same shape again.
      await admin.query("DELETE FROM operator_sessions WHERE token = $1", [hashToken(cookie.split("=")[1])]);
      const revoked = await call("/auth/operator-logout", { method: "POST", cookie });
      assert.equal(await revoked.text(), expiredOpBody, "revoked and expired must be indistinguishable, same as the worker path");
    });

    await test("deactivating an operator invalidates the session on the NEXT request — TASK-212 AC#1", async () => {
      const { requireOperatorSession } = await import("./lib/auth.js");
      const op = await freshOperator("Feldleiter Deaktiviert", "0664 900 00 03");
      const cookie = cookieFrom(await redeemOperator(op.code, "10.6.5.1"));
      const headers = { cookie };

      // WORKS BEFORE deactivation — the leg a bug that 401s everything would still pass
      // without. Without this assertion, removing `AND o.active` entirely would also
      // pass the test below by accident.
      const before = await requireOperatorSession(headers);
      assert.equal(before.operatorId, op.id);

      // Deactivated by hand (raw SQL), NOT via DELETE /admin/operators/:id — that route
      // also revokes the session row directly (destroyOperatorSessions), which would make
      // the 401 below prove "the row is gone", not "AND o.active reads live state". This
      // is the one property that matters for AC#1: expiry is not the only way out.
      await admin.query("UPDATE operators SET active = false WHERE id = $1", [op.id]);
      await assert.rejects(
        () => requireOperatorSession(headers),
        /unauthorized/,
        "deactivating an operator must invalidate their session on the NEXT request, not just at expiry",
      );
      await admin.query("UPDATE operators SET active = true WHERE id = $1", [op.id]);
    });

    await test("POST /admin/operators creates one, and a claimed phone is a non-enumerating 409", async () => {
      const created = await expectOp(await createOperator("Feldleiter Erstellt", "0664 900 10 01"), 201);
      assert.equal(created.operator.phone_e164, "+436649001001");
      assert.equal(created.operator.active, true);

      // Same phone again — 409, no hint of who holds it.
      const dup = await createOperator("A Second Person", "0664 900 10 01");
      assert.equal(dup.status, 409);
      const dupBody = await dup.json();
      assert.equal(dupBody.error, "phone_claimed");
      assert.deepEqual(Object.keys(dupBody), ["error"], "the 409 must name nothing about who holds the number");

      // No orphan operator row left behind by the failed second insert — the whole point
      // of the single writable CTE.
      assert.equal(
        Number((await admin.query("SELECT count(*) AS n FROM operators WHERE name = $1", ["A Second Person"])).rows[0].n),
        0,
        "a phone_claimed 409 must not leave an orphan operators row",
      );

      // CROSS-KIND collision: a phone already claimed by a WORKER's identity refuses an
      // operator claiming the same number — this is the owner's whole "one namespace"
      // requirement, proven across the table boundary decision-45 exists to keep safe.
      await admin.query("INSERT INTO phone_identities (phone_e164, worker_id) VALUES ('+436649002001', $1)", [
        workerId,
      ]);
      const crossKind = await createOperator("Claims A Worker Phone", "0664 900 20 01");
      assert.equal(crossKind.status, 409);
      assert.equal((await crossKind.json()).error, "phone_claimed");
      await admin.query("DELETE FROM phone_identities WHERE phone_e164 = '+436649002001'");

      // A malformed phone never reaches the database at all.
      const bad = await createOperator("Bad Phone", "Anna");
      assert.equal(bad.status, 422);
      assert.equal((await bad.json()).error, "invalid_phone");

      const missingName = await call("/admin/operators", { method: "POST", key: null, cookie: adminCookie, body: { phone: "0664 900 30 01" } });
      assert.equal(missingName.status, 400);
    });

    await test("DELETE /admin/operators/:id soft-deletes and revokes every session", async () => {
      const op = await freshOperator("Feldleiter Delete", "0664 900 40 01");
      const cookie = cookieFrom(await redeemOperator(op.code, "10.6.6.1"));
      assert.ok(cookie, "must have a live session to prove revocation");

      const del = await expectOp(await deleteOperator(op.id), 200);
      assert.equal(del.operator.active, false);
      assert.equal(
        (await admin.query("SELECT active FROM operators WHERE id = $1", [op.id])).rows.length,
        1,
        "soft delete must keep the row — an operator's issued codes are still audit history",
      );
      assert.equal(
        Number((await admin.query("SELECT count(*) AS n FROM operator_sessions WHERE operator_id = $1", [op.id])).rows[0].n),
        0,
        "deleting must revoke every session, same as deleteWorker",
      );
    });

    await test("operator enrolment code issue/revoke mirror the worker route byte-for-byte", async () => {
      const created = await expectOp(await createOperator("Feldleiter Code", "0664 900 50 01"), 201);
      const issued = await expectOp(await issueOperatorCode(created.operator.id), 201);
      assert.equal(issued.operator.id, created.operator.id);
      assert.match(issued.code, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);

      // The plaintext is shown exactly once — GET /admin/data can never hand it back.
      const raw = await (await asAdmin("/admin/data")).text();
      assert.ok(!raw.includes(issued.code), "the code leaked back out of /admin/data");
      assert.ok(!raw.includes("enrolment_code_hash"), "the hash is not the panel's business either");

      const revoked = await expectOp(await revokeOperatorCode(created.operator.id), 200);
      assert.equal(revoked.operator.enrolment_code_expires_at, null, "revoke must clear the expiry");
      assert.equal((await redeemOperator(issued.code, "10.6.7.1")).status, 401, "a revoked code must not redeem");
    });

    await test("GET /admin/data carries operators, joined to their phone and any linked worker", async () => {
      const op = await freshOperator("Feldleiter Roster", "0664 900 60 01");
      // The owner-cleans-a-building case (§3): link the SAME phone to a worker too.
      await admin.query("UPDATE phone_identities SET worker_id = $1 WHERE operator_id = $2", [workerId, op.id]);

      const data = await (await asAdmin("/admin/data")).json();
      assert.ok(Array.isArray(data.operators), "GET /admin/data must carry operators — no separate GET /admin/operators exists");
      const row = data.operators.find((o) => o.id === op.id);
      assert.ok(row, "the created operator must be in the list");
      assert.equal(row.phone_e164, "+436649006001");
      assert.equal(row.linked_worker_id, workerId, "both a worker_id and an operator_id on one phone_identities row must be visible");
      assert.equal(row.enrolment_code_hash, undefined, "the hash must never reach the panel");

      await admin.query("UPDATE phone_identities SET worker_id = NULL WHERE operator_id = $1", [op.id]);
    });

    await test("GET /admin/data carries what each phone is still holding (TASK-225)", async () => {
      // A fact behind its own endpoint is a fact nobody fetches. The four phone_* columns
      // ride in WORKER_COLS, so every screen that lists workers already has them — and the
      // director can answer "is Anna off sick, or is her phone holding three shifts" at any
      // moment instead of at month end, which is the most expensive place to find out.
      const data = await (await asAdmin("/admin/data")).json();
      const row = data.workers.find((w) => w.id === workerId);
      assert.ok(row, "the seeded worker is in /admin/data");
      assert.equal(row.phone_pending_shifts, 3, "the director sees the count the phone last reported");
      assert.ok(row.phone_last_seen_at, "…and when that phone was last heard from");
      assert.ok("phone_pending_blocked" in row, "…with 'needs a human' counted apart from 'waiting for signal'");
      assert.ok("phone_pending_oldest_start" in row, "…and how old the oldest undelivered shift is");
      assert.equal(row.enrolment_code_hash, undefined, "and still no code hash, as before");
    });

    await test("an operator has NO clock-in path — structural, not a check a handler could forget", async () => {
      const op = await freshOperator("Feldleiter Kein Dienst", "0664 900 70 01");
      const cookie = cookieFrom(await redeemOperator(op.code, "10.6.8.1"));

      const shiftsBefore = await countShifts();

      // ONLY an operator session, no ts_worker at all.
      const bare = await call("/shifts/open", { method: "POST", cookie, body: {} });
      assert.equal(bare.status, 401, "an operator session alone must not open /shifts/open");

      // ...and it cannot be bypassed by naming a worker in the body either — the SAME
      // decision-22 invariant ("body.worker_id is never read") re-confirmed under an
      // operator session specifically.
      const withBody = await call("/shifts/open", {
        method: "POST",
        cookie,
        body: { worker_id: workerId, client_uuid: uuid(90), location_uuid: locationUuid, start_time: new Date().toISOString() },
      });
      assert.equal(withBody.status, 401, "naming a real worker id in the body must not let an operator session through");
      assert.equal(await countShifts(), shiftsBefore, "neither refusal may have created a shift");

      // RED-FIRST, per TASK-212 AC#3 exactly: mutate the LIVE route object in place —
      // spreading into server.js's `routes` array copies references, not clones, so this
      // reaches the running server. If this assertion did NOT flip to passing auth, the
      // 401 above would be unfalsifiable — a check whose negative case cannot fail.
      const { appRoutes } = await import("./routes/app.js");
      const openRoute = appRoutes.find((r) => r.method === "POST" && r.path === "/shifts/open");
      assert.ok(openRoute, "/shifts/open route object must exist to mutate");
      const originalAuth = openRoute.auth;
      assert.equal(originalAuth, "worker");
      try {
        openRoute.auth = "operator";
        const mutated = await call("/shifts/open", { method: "POST", cookie, body: {} });
        assert.notEqual(
          mutated.status,
          401,
          "with auth mutated to 'operator' the SAME cookie must get PAST auth (a 400/422 on the missing body is fine — 401 here means the mutation didn't take, and the earlier 401 proved nothing)",
        );
      } finally {
        openRoute.auth = originalAuth;
      }
      const restored = await call("/shifts/open", { method: "POST", cookie, body: {} });
      assert.equal(restored.status, 401, "restoring auth: 'worker' must bring the refusal back");
    });

    await test("identityPhone: the worked-example table from decision-45 §4, and the collision it exists to catch", async () => {
      const { identityPhone } = await import("./lib/validate.js");
      const accept = [
        ["0664 123 45 67", "+436641234567"],
        ["+43 664/1234567", "+436641234567"],
        ["0043 664 1234567", "+436641234567"],
        ["01 5055904", "+4315055904"],
      ];
      for (const [input, expected] of accept) {
        assert.equal(identityPhone(input, "phone"), expected, `${JSON.stringify(input)} must normalise to ${expected}`);
      }
      // THE COLLISION — this pair normalising to the SAME string is the whole reason the
      // function exists. Paired with a genuinely DIFFERENT third number so a stub that
      // always returns one fixed string cannot pass this test by accident.
      assert.equal(identityPhone(accept[0][0], "phone"), identityPhone(accept[1][0], "phone"));
      assert.notEqual(identityPhone(accept[0][0], "phone"), identityPhone(accept[3][0], "phone"));

      const reject = [
        ["664 1234567", "invalid_phone"], // no leading 0 or + — never guessed as Austrian
        ["Anna", "invalid_phone"],
        ["+43664", "invalid_phone"], // below the 8-digit floor
        ["", "required_field"],
      ];
      for (const [input, code] of reject) {
        assert.throws(() => identityPhone(input, "phone"), (err) => err.code === code, `${JSON.stringify(input)} must be rejected as ${code}`);
      }
    });
  }

  // ===================================================================================
  // reported tags: WRITE -> REPORT -> RESOLVE (this iteration,
  // server/db/migrations/008_reported_tags.sql). An operator's phone mints a uuid, writes
  // it to a physical NFC tag, and POST /operator/tags is the only thing it does with the
  // server afterwards. Everything below that point is the admin turning it into something.
  // ===================================================================================
  {
    const expect = async (res, status) => {
      const payload = await res.json();
      assert.equal(res.status, status, JSON.stringify(payload));
      return payload;
    };

    /** A fresh operator, with a LIVE ts_operator session, minted directly (no need to walk
     * the enrolment-code flow again — that is already pinned in the operators block above). */
    const operatorCookieFor = async (name) => {
      const { rows } = await admin.query("INSERT INTO operators (name) VALUES ($1) RETURNING id", [name]);
      const operatorId = Number(rows[0].id);
      const token = randomBytes(32).toString("hex");
      await admin.query(
        "INSERT INTO operator_sessions (token, operator_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
        [hashToken(token), operatorId],
      );
      return { operatorId, cookie: `ts_operator=${token}` };
    };

    const reportTag = (tagId, cookie) => call("/operator/tags", { method: "POST", cookie, body: { id: tagId } });

    let op1;

    // ---- POST /operator/tags --------------------------------------------------------
    await test("POST /operator/tags needs a live OPERATOR session; the app key or a worker session are not enough", async () => {
      const tagId = uuid(91);
      assert.equal((await call("/operator/tags", { method: "POST", key: null, body: { id: tagId } })).status, 401);
      assert.equal(
        (await call("/operator/tags", { method: "POST", body: { id: tagId } })).status,
        401,
        "the app key alone must not authorise this route",
      );
      assert.equal(
        (await call("/operator/tags", { method: "POST", cookie: workerCookie, body: { id: tagId } })).status,
        401,
        "a WORKER session must not authorise an operator route",
      );
      assert.equal(await countOf("SELECT count(*) AS n FROM reported_tags WHERE id = $1", [tagId]), 0);
    });

    await test("a fresh report lands UNBOUND, the reporter comes from the SESSION, and malformed input is refused", async () => {
      op1 = await operatorCookieFor("Feldleiter Tag Melder");
      const tagId = uuid(91);

      const created = await expect(await reportTag(tagId, op1.cookie), 201);
      assert.equal(created.tag.id, tagId);
      assert.equal(created.tag.resolved_at, null, "unbound: no zone, no building yet");
      assert.equal(
        (await admin.query("SELECT reported_by_operator_id FROM reported_tags WHERE id = $1", [tagId])).rows[0]
          .reported_by_operator_id,
        op1.operatorId,
        "the reporter is taken from the SESSION — there is no operator_id field to lie in",
      );

      for (const body of [{}, { id: "not-a-uuid" }, { id: 12345 }, { id: "" }]) {
        const res = await call("/operator/tags", { method: "POST", cookie: op1.cookie, body });
        assert.equal(res.status, 400, `${JSON.stringify(body)} must be refused before it reaches the database`);
      }
    });

    await test("reporting the SAME tag twice is ONE row, idempotently (200, not a second 201)", async () => {
      const tagId = uuid(92);
      const first = await expect(await reportTag(tagId, op1.cookie), 201);
      const second = await expect(await reportTag(tagId, op1.cookie), 200);
      assert.equal(second.tag.id, first.tag.id);
      assert.equal(second.tag.reported_at, first.tag.reported_at, "a retry must not move the original report time");
      assert.equal(await countOf("SELECT count(*) AS n FROM reported_tags WHERE id = $1", [tagId]), 1);
    });

    await test("THE DOUBLE-REPORT RACE: two operators reporting the SAME physical tag AT ONCE is still ONE row", async () => {
      const op2 = await operatorCookieFor("Feldleiter Zweite Melderin");
      const tagId = uuid(93);
      const [a, b] = await Promise.all([reportTag(tagId, op1.cookie), reportTag(tagId, op2.cookie)]);
      assert.deepEqual(
        [a.status, b.status].sort(),
        [200, 201],
        "one request wins the INSERT, the other reads the row back — Postgres decides the race, not a check-then-insert in this process",
      );
      assert.equal(
        await countOf("SELECT count(*) AS n FROM reported_tags WHERE id = $1", [tagId]),
        1,
        "two concurrent reporters must never land two rows",
      );
    });

    await test("a reported id that collides with a REAL location or zone is refused, never silently landed", async () => {
      // RED-FIRST evidence this guard is load-bearing: comment out the pre-insert clash
      // check in reportTag() and this assertion flips from 409 to 201, with a row landing
      // in reported_tags right on top of an id that already names a real building — the
      // exact ambiguity this check exists to make unreachable.
      const clash = await reportTag(locationUuid, op1.cookie);
      assert.equal(clash.status, 409);
      assert.equal((await clash.json()).error, "id_in_use");
      assert.equal(
        await countOf("SELECT count(*) AS n FROM reported_tags WHERE id = $1", [locationUuid]),
        0,
        "a refused report must not land a row either",
      );
    });

    // ---- a tap on an unbound tag: MUST happen, MUST NOT 500, MUST be explainable -----
    await test("a tap on an UNBOUND tag is refused with its OWN code — never a shift, never a 500", async () => {
      const tagId = uuid(94);
      await expect(await reportTag(tagId, op1.cookie), 201);

      const before = await countShifts();
      const res = await asWorker("/shifts/open", {
        method: "POST",
        body: { client_uuid: uuid(30), location_uuid: tagId, start_time: new Date().toISOString() },
      });
      assert.equal(res.status, 422, "never a 500");
      assert.equal((await res.json()).error, "tag_unbound");
      assert.equal(await countShifts(), before, "no shift may be opened against an unresolved tag");

      // THE DIFFERENTIAL that makes the assertion above meaningful, not a tautology: a tag
      // this server has NEVER heard of — no report, ever — must still answer the OLD,
      // generic code. If `tag_unbound` ever became the answer for every miss (the RED
      // mutation: delete the `reported && reported.resolved_at === null` guard in
      // activePlace so it always tries the reported_tags branch), THIS is what would catch
      // it, because these two assertions would then agree when they must not.
      const stranger = await asWorker("/shifts/open", {
        method: "POST",
        body: { client_uuid: uuid(31), location_uuid: uuid(98), start_time: new Date().toISOString() },
      });
      assert.equal(res.status, stranger.status, "both are 422");
      assert.equal(
        (await stranger.json()).error,
        "unknown_location",
        "a tag we never heard of at all must NOT read as merely 'not yet assigned'",
      );
    });

    // ---- RESOLVE: new building --------------------------------------------------------
    await test("resolve-building requires the tag to have actually been reported", async () => {
      const never = uuid(89);
      const res = await asAdmin(`/admin/tags/${never}/resolve-building`, {
        method: "POST",
        body: { slug: "ghost-building", name: "Geisterhaus" },
      });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error, "unknown_reported_tag");
    });

    await test("resolve-building mints a NEW building at the TAG'S OWN id, and a repeat resolve is refused", async () => {
      const tagId = uuid(95);
      await expect(await reportTag(tagId, op1.cookie), 201);

      const created = await expect(
        await asAdmin(`/admin/tags/${tagId}/resolve-building`, {
          method: "POST",
          body: { slug: "resolved-building", name: "Aufgel\u00f6stes Haus" },
        }),
        201,
      );
      assert.equal(created.location.id, tagId, "the physical bytes already on the card never need rewriting");

      // it now taps like any other building, immediately.
      const opened = await expect(
        await asWorker("/shifts/open", {
          method: "POST",
          body: { client_uuid: uuid(32), location_uuid: tagId, start_time: new Date().toISOString() },
        }),
        201,
      );
      assert.equal(opened.shift.location_id, tagId);
      await admin.query("DELETE FROM shifts WHERE client_uuid = $1", [uuid(32)]);

      const again = await asAdmin(`/admin/tags/${tagId}/resolve-building`, {
        method: "POST",
        body: { slug: "resolved-building-again", name: "Zweiter Versuch" },
      });
      assert.equal(again.status, 409);
      assert.equal((await again.json()).error, "already_resolved");
      assert.equal(
        await countOf("SELECT count(*) AS n FROM locations WHERE id = $1", [tagId]),
        1,
        "a refused repeat must not create a second building",
      );
    });

    // ---- RESOLVE: new zone in an existing building ------------------------------------
    await test("resolve-zone mints a NEW zone at the TAG'S OWN id, stamping tag_deployed_at from the REPORT", async () => {
      const house = await expect(
        await asAdmin("/admin/locations", { method: "POST", body: { slug: "resolve-zone-haus", name: "Zonenhaus f\u00fcr Resolve" } }),
        201,
      );
      const tagId = uuid(96);
      const reported = await expect(await reportTag(tagId, op1.cookie), 201);

      const created = await expect(
        await asAdmin(`/admin/tags/${tagId}/resolve-zone`, {
          method: "POST",
          body: { location_id: house.location.id, name: "Tiefgarage", area_sqm: "120" },
        }),
        201,
      );
      assert.equal(created.zone.id, tagId);
      assert.equal(created.zone.location_id, house.location.id);
      assert.equal(
        created.zone.tag_deployed_at,
        reported.tag.reported_at,
        "the card was mounted when the operator reported it, not when an admin got to a desk",
      );

      const opened = await expect(
        await asWorker("/shifts/open", {
          method: "POST",
          body: { client_uuid: uuid(33), location_uuid: tagId, start_time: new Date().toISOString() },
        }),
        201,
      );
      assert.equal(opened.shift.location_id, house.location.id, "a shift stays BUILDING-level");
      assert.equal(opened.shift.start_zone_id, tagId);
      await admin.query("DELETE FROM shifts WHERE client_uuid = $1", [uuid(33)]);
    });

    // ---- RESOLVE: an EXISTING zone, via an ADDITIVE alias -----------------------------
    await test("resolve-existing-zone links via tag_aliases; the zone's OWN id is never re-keyed", async () => {
      const house = await expect(
        await asAdmin("/admin/locations", { method: "POST", body: { slug: "alias-haus", name: "Aliashaus" } }),
        201,
      );
      const zone = await expect(
        await asAdmin("/admin/zones", { method: "POST", body: { location_id: house.location.id, name: "Haupteingang" } }),
        201,
      );

      const tagId = uuid(97);
      await expect(await reportTag(tagId, op1.cookie), 201);

      // Refused against an INACTIVE zone — aliasing to one would create a row that can
      // never resolve, which is worse than refusing it up front.
      await admin.query("UPDATE zones SET active = false WHERE id = $1", [zone.zone.id]);
      const refused = await asAdmin(`/admin/tags/${tagId}/resolve-existing-zone`, {
        method: "POST",
        body: { zone_id: zone.zone.id },
      });
      assert.equal(refused.status, 422);
      assert.equal((await refused.json()).error, "unknown_zone");
      await admin.query("UPDATE zones SET active = true WHERE id = $1", [zone.zone.id]);

      const linked = await expect(
        await asAdmin(`/admin/tags/${tagId}/resolve-existing-zone`, { method: "POST", body: { zone_id: zone.zone.id } }),
        200,
      );
      assert.equal(linked.alias.id, tagId);
      assert.equal(linked.alias.zone_id, zone.zone.id);
      assert.equal(
        (await admin.query("SELECT id FROM zones WHERE id = $1", [zone.zone.id])).rowCount,
        1,
        "the zone's own id must be UNCHANGED — an alias is additive, never a re-key",
      );

      // BOTH ids now resolve to the SAME place: the zone's original id (its own printed
      // tag, unaffected) and the newly aliased physical tag.
      const viaOriginal = await expect(
        await asWorker("/shifts/open", {
          method: "POST",
          body: { client_uuid: uuid(34), location_uuid: zone.zone.id, start_time: new Date().toISOString() },
        }),
        201,
      );
      assert.equal(viaOriginal.shift.start_zone_id, zone.zone.id);
      await admin.query("DELETE FROM shifts WHERE client_uuid = $1", [uuid(34)]);

      const viaAlias = await expect(
        await asWorker("/shifts/open", {
          method: "POST",
          body: { client_uuid: uuid(35), location_uuid: tagId, start_time: new Date().toISOString() },
        }),
        201,
      );
      assert.equal(viaAlias.shift.location_id, house.location.id);
      assert.equal(viaAlias.shift.start_zone_id, zone.zone.id, "the ALIAS resolves to the SAME zone, not a new one");
      await admin.query("DELETE FROM shifts WHERE client_uuid = $1", [uuid(35)]);

      const again = await asAdmin(`/admin/tags/${tagId}/resolve-existing-zone`, { method: "POST", body: { zone_id: zone.zone.id } });
      assert.equal(again.status, 409);
      assert.equal((await again.json()).error, "already_resolved");
    });

    await test("THE RESOLVE RACE: two admins resolving the SAME reported tag at once — only one wins", async () => {
      const house = await expect(
        await asAdmin("/admin/locations", { method: "POST", body: { slug: "resolve-race-haus", name: "Rennhaus" } }),
        201,
      );
      const tagId = uuid(40);
      await expect(await reportTag(tagId, op1.cookie), 201);

      const [a, b] = await Promise.all([
        asAdmin(`/admin/tags/${tagId}/resolve-zone`, {
          method: "POST",
          body: { location_id: house.location.id, name: "Zone A" },
        }),
        asAdmin(`/admin/tags/${tagId}/resolve-zone`, {
          method: "POST",
          body: { location_id: house.location.id, name: "Zone B" },
        }),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [201, 409], "exactly one resolve may win a race for the same reported tag");
      assert.equal(await countOf("SELECT count(*) AS n FROM zones WHERE id = $1", [tagId]), 1);
    });

    // ---- the admin's own worklist -----------------------------------------------------
    await test("GET /admin/data lists UNRESOLVED reported tags, and drops them the moment they resolve", async () => {
      const tagId = uuid(41);
      await expect(await reportTag(tagId, op1.cookie), 201);

      const before = await (await asAdmin("/admin/data")).json();
      assert.ok(
        before.reported_tags.some((t) => t.id === tagId && t.reported_by_operator_name === "Feldleiter Tag Melder"),
        "an unresolved report must appear in the admin worklist, named by its reporter",
      );

      await expect(
        await asAdmin(`/admin/tags/${tagId}/resolve-building`, {
          method: "POST",
          body: { slug: "worklist-resolved", name: "Aus der Warteliste" },
        }),
        201,
      );
      const after = await (await asAdmin("/admin/data")).json();
      assert.ok(!after.reported_tags.some((t) => t.id === tagId), "a resolved report is history, not a queue item");
    });
  }

  // ===================================================================================
  // the app self-update surface (routes/release.js, this iteration): GET /app/version and
  // GET /app/download. No database dependency at all — a directory read is the whole
  // mechanism — so this block never touches `admin`.
  // ===================================================================================
  {
    const RELEASES_DIR = process.env.RELEASES_DIR;
    const manifestPath = path.join(RELEASES_DIR, "latest.json");
    const writeManifest = (obj) => writeFileSync(manifestPath, JSON.stringify(obj));
    const removeManifest = () => {
      try {
        unlinkSync(manifestPath);
      } catch {
        // already gone — fine, this is cleanup
      }
    };

    await test("GET /app/version answers {published:false} against an EMPTY releases directory, not an error", async () => {
      const res = await call("/app/version");
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { published: false });
    });

    await test("GET /app/version and /app/download need the app key; no session is required or accepted as a substitute", async () => {
      assert.equal((await call("/app/version", { key: null })).status, 401);
      assert.equal((await call("/app/version", { key: "wrong" })).status, 401);
      // A worker or admin session is NOT a wider credential than the app key here — the app
      // key is what is checked, full stop.
      assert.equal((await call("/app/version", { key: null, cookie: workerCookie })).status, 401);
    });

    await test("a published release answers version_code, version_name and a download url; the apk streams byte-for-byte", async () => {
      const apkBytes = Buffer.from("not a real apk, just some bytes to stream\n".repeat(50), "utf8");
      writeFileSync(path.join(RELEASES_DIR, "nfc-timesheets-9.9.9-9-release.apk"), apkBytes);
      writeManifest({
        version_code: 9,
        version_name: "9.9.9",
        file: "nfc-timesheets-9.9.9-9-release.apk",
        sha256: "deadbeef",
        notes: "check-api fixture build",
      });

      const version = await (await call("/app/version")).json();
      assert.equal(version.published, true);
      assert.equal(version.version_code, 9);
      assert.equal(version.version_name, "9.9.9");
      assert.equal(version.url, "/app/download");

      const res = await call("/app/download");
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/vnd.android.package-archive");
      assert.equal(Number(res.headers.get("content-length")), apkBytes.length);
      const body = Buffer.from(await res.arrayBuffer());
      assert.ok(body.equals(apkBytes), "the downloaded bytes must match the file on disk exactly");
    });

    await test("a malformed manifest is read as 'nothing published', never a 500", async () => {
      writeFileSync(manifestPath, "{ this is not json");
      const res = await call("/app/version");
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { published: false });
      assert.equal((await call("/app/download")).status, 404);
      assert.equal((await (await call("/app/download")).json()).error, "no_release_published");
    });

    await test("a manifest naming a file that is not actually on disk is a clean 404, not a crash", async () => {
      writeManifest({ version_code: 10, version_name: "10.0.0", file: "does-not-exist.apk" });
      const version = await (await call("/app/version")).json();
      assert.equal(version.published, true, "the manifest itself is well-formed");
      const dl = await call("/app/download");
      assert.equal(dl.status, 404);
      assert.equal((await dl.json()).error, "release_file_missing");
    });

    removeManifest();
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
