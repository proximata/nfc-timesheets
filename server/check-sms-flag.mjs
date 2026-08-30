#!/usr/bin/env node
// SMS FAILS CLOSED, AND THE ENROLMENT CODE NEVER NOTICES (decision-48).
//
//   node server/check-sms-flag.mjs
//
// THE OWNER, VERBATIM: "in admin there must be an option to choose how to onboard a worker,
// so if sms didnt work, there is always a fallback."
//
// THE CONDITION IS SEEDED, NOT WAITED FOR. Section 1 runs with NO TWILIO_* IN THE
// ENVIRONMENT AT ALL — byte for byte the state of /etc/nfc/env on the live box, which today
// carries APP_KEY, DATABASE_URL, GOOGLE_GEOCODING_KEY and PORT and nothing else. That is not
// a lab approximation of "off"; it IS production's configuration.
//
// Then section 2 turns the flag ON against a LOCAL STUB (TWILIO_API_BASE) and demands the
// same call now succeeds. Without that half, section 1 would pass on a server that had no
// SMS feature at all, and "a check whose negative case cannot fail is not a check" cuts both
// ways: the OFF assertion is only evidence if the flag can be observed to flip.
//
// NO REAL SMS IS SENT BY THIS FILE, EVER, AND NONE CAN BE. Every case points
// TWILIO_API_BASE at 127.0.0.1, the credentials are obvious fakes, and the live box holds no
// Twilio account to reach even if it did.
//
// IT NEVER TOUCHES PRODUCTION. One throwaway local database, dropped in a finally AND on
// every early exit — process.exit does not run a pending finally (the lesson of 9072a8e).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = `nfc_smsflag_${process.pid}`;
const APP_KEY = "sms-flag-check-key";

// Obvious fakes, correctly SHAPED. Shape matters: a malformed value must count as missing
// (§4.1), so a check that used "x" for the account sid would prove nothing about the ON case.
const FAKE_ACCOUNT_SID = `AC${"0123456789abcdef0123456789abcdef".slice(0, 32)}`;
const FAKE_API_KEY_SID = `SK${"fedcba9876543210fedcba9876543210".slice(0, 32)}`;
const FAKE_SECRET = "not-a-real-twilio-secret-000000000";
const FAKE_FROM = "+43720123456";
const FAKE_SERVICE_SID = `MG${"abcdef0123456789abcdef0123456789".slice(0, 32)}`;

const WORKER_PHONE_TYPED = "0664 900 77 01";
const WORKER_PHONE_E164 = "+436649007701";
const STRANGER_E164 = "+436649007799";

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const created = [];
const clients = [];
const servers = [];
let failures = 0;

const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  --   ${m}`);
const skip = (why) => {
  console.log(`SKIP check-sms-flag: ${why}`);
  process.exit(0);
};
function teardown() {
  for (const s of servers) s.close();
  for (const c of clients) c.end().catch(() => {});
  for (const name of created) {
    try {
      sh("dropdb", ["--force", "--if-exists", name]);
    } catch (e) {
      console.error(`       WARNING: could not drop ${name} — DROP IT BY HAND: dropdb --force ${name}`);
      console.error(`       ${String(e.stderr || e.message).trim().split("\n")[0]}`);
    }
  }
}
const die = (why) => {
  console.error(`\nFAIL check-sms-flag: ${why}`);
  teardown();
  process.exit(1);
};

for (const bin of ["psql", "createdb", "dropdb"]) {
  try {
    sh(bin, ["--version"]);
  } catch {
    skip(`\`${bin}\` not on PATH — install the Postgres client tools`);
  }
}
try {
  sh("pg_isready", []);
} catch {
  skip("no Postgres server reachable (pg_isready failed)");
}

async function test(name, fn) {
  try {
    await fn();
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").join("\n       ")}`);
  }
}

// ---- the stub carrier --------------------------------------------------------------
// It is the ONLY thing standing between this check and a real telephone bill, and it is
// also the only way the failure vocabulary can be exercised at all: there is no way to make
// a timeout, a 500 or an unsubscribed handset happen on demand against api.twilio.com
// without spending money and texting a stranger.
const stub = { mode: "ok", calls: [] };
const stubServer = createHttpServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    stub.calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization ?? null,
      contentType: req.headers["content-type"] ?? null,
      form: Object.fromEntries(new URLSearchParams(raw)),
    });
    if (stub.mode === "hang") return; // never answers: exercises AbortSignal.timeout
    if (stub.mode === "http500") {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: 20500, message: "Internal error — DO NOT LOG ME" }));
    }
    if (stub.mode === "rejected") {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: 21211, message: "The 'To' number is not a valid phone number." }));
    }
    if (stub.mode === "no_sid") {
      res.writeHead(201, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "queued" })); // 2xx, but no message id
    }
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ sid: `SM${randomBytes(16).toString("hex")}`, status: "queued" }));
  });
});
servers.push(stubServer);
await new Promise((r) => stubServer.listen(0, "127.0.0.1", r));
const STUB_BASE = `http://127.0.0.1:${stubServer.address().port}`;
// A port with nothing on it. ECONNREFUSED arrives in milliseconds, which is how the
// `network:*` branch gets exercised without an 8-second wait.
const deadServer = createHttpServer(() => {});
await new Promise((r) => deadServer.listen(0, "127.0.0.1", r));
const DEAD_BASE = `http://127.0.0.1:${deadServer.address().port}`;
await new Promise((r) => deadServer.close(r));

// The environment as production actually has it. Set at the top and restored between
// sections, so "off" is never merely the absence of a line somebody forgot to add.
const TWILIO_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_SID",
  "TWILIO_SECRET",
  "TWILIO_FROM",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_API_BASE",
];
const clearTwilio = () => {
  for (const k of TWILIO_VARS) delete process.env[k];
};
const configureTwilio = ({ base = STUB_BASE, service = false } = {}) => {
  clearTwilio();
  process.env.TWILIO_ACCOUNT_SID = FAKE_ACCOUNT_SID;
  process.env.TWILIO_SID = FAKE_API_KEY_SID;
  process.env.TWILIO_SECRET = FAKE_SECRET;
  process.env.TWILIO_API_BASE = base;
  if (service) process.env.TWILIO_MESSAGING_SERVICE_SID = FAKE_SERVICE_SID;
  else process.env.TWILIO_FROM = FAKE_FROM;
};
clearTwilio();

let db;
try {
  // ---- 0 · a database at HEAD's full migration set ---------------------------------
  sh("createdb", [DB]);
  created.push(DB);
  sh("node", [path.join(__dirname, "db", "migrate.js")], { env: { ...process.env, DATABASE_URL: `postgres:///${DB}` } });

  db = new pg.Client({ connectionString: `postgres:///${DB}` });
  await db.connect();
  clients.push(db);

  const applied = (await db.query("SELECT filename FROM schema_migrations ORDER BY filename")).rows.map((r) => r.filename);
  assert.ok(applied.includes("011_sms_onboarding.sql"), "011 must be applied before anything below means anything");
  assert.ok(applied.includes("012_sms_otp.sql"), "012 must be applied before anything below means anything");
  ok(`${applied.length} migration(s) applied, including 011 and 012`);

  // ENV BEFORE THE FIRST IMPORT OF ANYTHING UNDER lib/: lib/db.js builds its pool from
  // process.env.DATABASE_URL at IMPORT time and the ESM cache hands the same module to
  // every later importer.
  process.env.DATABASE_URL = `postgres:///${DB}`;
  process.env.APP_KEY = APP_KEY;
  process.env.PORT = "0";

  const { hashPassword, hashToken, resetLoginRate } = await import("./lib/auth.js");
  const adminId = Number(
    (
      await db.query("INSERT INTO admins (email, password_hash) VALUES ($1, $2) RETURNING id", [
        `smsflag-${process.pid}@example.test`,
        await hashPassword(`check-${randomBytes(9).toString("hex")}`),
      ])
    ).rows[0].id,
  );
  // A SESSION MINTED DIRECTLY IN THE DATABASE, never a guessed password — the same thing
  // ops/prove-zone-verification.sh does, and for the same reason.
  const adminToken = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token, admin_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [
    hashToken(adminToken),
    adminId,
  ]);

  const workerId = Number(
    (await db.query("INSERT INTO workers (name, hourly_rate_cents) VALUES ('SMS Check Cleaner', 1500) RETURNING id")).rows[0].id,
  );
  const noPhoneWorkerId = Number(
    (await db.query("INSERT INTO workers (name, hourly_rate_cents) VALUES ('No Number Cleaner', 1600) RETURNING id")).rows[0].id,
  );

  const { createServer } = await import("./server.js");
  const api = createServer();
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  servers.push(api);
  const base = `http://127.0.0.1:${api.address().port}`;

  const call = (p, { method = "GET", body, cookie, key = APP_KEY } = {}) =>
    fetch(base + p, {
      method,
      headers: {
        ...(key ? { "X-App-Key": key } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({
      status: r.status,
      body: await r.json().catch(() => null),
      cookie: (r.headers.getSetCookie?.()[0] ?? r.headers.get("set-cookie") ?? "").split(";")[0] || null,
    }));
  const asAdmin = (p, opts = {}) => call(p, { ...opts, cookie: `ts_session=${adminToken}` });

  const countOf = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
  const workerCodeState = async (id) =>
    (
      await db.query(
        `SELECT enrolment_code_hash, enrolment_code_expires_at, enrolment_code_issued_at,
                enrolment_code_issued_by, enrolment_code_redeemed_at
           FROM workers WHERE id = $1`,
        [id],
      )
    ).rows[0];

  console.log(`check-sms-flag: running against ${DB}, stub carrier on ${STUB_BASE}`);

  // ===================================================================================
  // 1 · THE FLAG IS OFF — the environment production actually has, right now.
  // ===================================================================================
  console.log("\n1 · the flag is OFF (no TWILIO_* in the environment — production's real state)");
  clearTwilio();

  await test("GET /admin/sms-status names WHICH pieces are missing, and never a value", async () => {
    const res = await asAdmin("/admin/sms-status");
    assert.equal(res.status, 200);
    assert.equal(res.body.configured, false);
    assert.deepEqual(res.body.missing, ["account_sid", "auth", "sender"], JSON.stringify(res.body));
    assert.equal(res.body.sender_kind, null);
    // Nothing in the body may be, or contain, a credential — not even one we made up.
    const raw = JSON.stringify(res.body);
    for (const secret of [FAKE_ACCOUNT_SID, FAKE_API_KEY_SID, FAKE_SECRET, FAKE_FROM]) {
      assert.ok(!raw.includes(secret), `sms-status leaked ${secret.slice(0, 4)}…`);
    }
    // `sender_name` is absent from the list: ops/branding.json resolved. If this ever
    // appears, the two-candidate path in lib/sms.js has stopped finding it and the message
    // would be signed by nobody.
    assert.ok(!res.body.missing.includes("sender_name"), "ops/branding.json did not resolve — see lib/sms.js senderName()");
    ok(`{configured:false, missing:["account_sid","auth","sender"], sender_kind:null}`);
  });

  await test("POST .../enrolment-code/sms answers 503 and writes NOTHING — no row, no code, no budget", async () => {
    await db.query("INSERT INTO phone_identities (phone_e164, worker_id) VALUES ($1, $2)", [WORKER_PHONE_E164, workerId]);
    const before = await workerCodeState(workerId);
    const deliveriesBefore = await countOf("SELECT count(*) AS n FROM sms_deliveries");

    const res = await asAdmin(`/admin/workers/${workerId}/enrolment-code/sms`, { method: "POST" });
    assert.equal(res.status, 503, `expected 503, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body, { error: "sms_not_configured" }, "one key, and it says plainly what is wrong");

    // 503 AND NOT 202. 202 would read as "accepted", which is the silent pretence the
    // owner forbade; 503 says the dependency is unavailable and cannot be misread.
    assert.notEqual(res.status, 202);

    const after = await workerCodeState(workerId);
    assert.deepEqual(after, before, "a 503 must leave the worker's enrolment-code columns byte-identical");
    assert.equal(after.enrolment_code_hash, null, "no code was minted");
    assert.equal(
      await countOf("SELECT count(*) AS n FROM sms_deliveries"),
      deliveriesBefore,
      "a non-delivery must not leave a delivery record",
    );
    assert.equal(stub.calls.length, 0, "nothing may reach the carrier when the flag is off");
    ok("503 sms_not_configured — 0 rows written, 0 codes minted, 0 calls made");
  });

  await test("POST /auth/sms/request FAILS CLOSED — 503, and no challenge is minted", async () => {
    const res = await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(res.status, 503, `expected 503, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body, { error: "sms_not_configured" });
    assert.equal(await countOf("SELECT count(*) AS n FROM otp_challenges"), 0, "no challenge may exist");
    assert.equal(await countOf("SELECT count(*) AS n FROM sms_deliveries"), 0);
    assert.equal(stub.calls.length, 0);
    ok("503 before the phone is even resolved — no challenge, no row, no call");
  });

  await test("POST /auth/sms/verify FAILS CLOSED too — 503, never 401 and never a session", async () => {
    const res = await call("/auth/sms/verify", { method: "POST", body: { phone: WORKER_PHONE_TYPED, code: "123456" } });
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: "sms_not_configured" });
    assert.equal(res.cookie, null, "no cookie on any failure path");
    assert.equal(await countOf("SELECT count(*) AS n FROM worker_sessions"), 0);
    ok("503, no ts_worker cookie, no worker_sessions row");
  });

  await test("GET /auth/capabilities says sms:false — THE ANDROID SIGN-IN SCREEN'S ONE PUBLIC READ", async () => {
    // No session, no admin cookie — this is what a phone asks before it has anything.
    const res = await call("/auth/capabilities");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // `email` joined `sms` here in decision-64 and is ADDITIVE: this check is about the SMS
    // half, and the email half must read false for its own two reasons (no RESEND_API_KEY in
    // this process, `email_login` seeded OFF by migration 021).
    assert.deepEqual(res.body, { sms: false, email: false }, "both doors read false with no TWILIO_*/RESEND_* set");
    ok("{sms:false, email:false} — the sign-in screen composes nothing behind either");
  });

  await test("THE FALLBACK IS RIGHT THERE: the enrolment code still mints and still redeems", async () => {
    // This is the case the owner's sentence is about. With SMS refusing every call, the
    // admin-issued code path must be indistinguishable from a box that has never heard of
    // SMS — same status, same body shape, same redemption, same session.
    resetLoginRate();
    const issued = await asAdmin(`/admin/workers/${workerId}/enrolment-code`, { method: "POST" });
    assert.equal(issued.status, 201, `the code button must be untouched by an SMS outage: ${JSON.stringify(issued.body)}`);
    assert.match(issued.body.code, /^[0-9]{5}$/); // decision-63: five digits, no dash, no letters
    assert.ok(issued.body.expires_at);

    const redeemed = await call("/auth/code", { method: "POST", body: { code: issued.body.code } });
    assert.equal(redeemed.status, 200, `the code must still redeem: ${JSON.stringify(redeemed.body)}`);
    assert.equal(redeemed.body.worker.id, workerId);
    assert.ok(redeemed.cookie?.startsWith("ts_worker="), "the SAME ts_worker cookie, from the SAME table");
    ok(`${issued.body.code} minted and redeemed while every SMS route answers 503`);

    const revoked = await asAdmin(`/admin/workers/${workerId}/enrolment-code`, { method: "DELETE" });
    assert.equal(revoked.status, 200, "revoke is untouched too");
    await db.query("DELETE FROM worker_sessions");
  });

  // ===================================================================================
  // 2 · THE FLAG FLIPS ON, against the stub. If this section cannot go green, section 1
  //     proved nothing — an endpoint that always 503s is not a feature behind a flag.
  // ===================================================================================
  console.log("\n2 · the SAME calls, with the flag ON (stub carrier, no real SMS)");
  configureTwilio();

  // ===================================================================================
  // 1.5 · A SECOND, INDEPENDENT GATE: `feature_flags.sms_login`, seeded false by migration
  //       016 (2026-08-27, asked for during UAT prep — SMS stays fully wired but hidden
  //       from the sign-in form). Twilio is configured (the stub above) yet everything
  //       here must still behave exactly like section 1, proving this is a REAL second
  //       gate and not merely riding along on smsConfigured().
  // ===================================================================================
  await test("feature_flags.sms_login is OFF by default, EVEN WITH SMS fully configured", async () => {
    const res = await call("/auth/capabilities");
    assert.deepEqual(res.body, { sms: false, email: false }, "Twilio being wired must not be enough on its own");
    const asked = await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(asked.status, 503, JSON.stringify(asked.body));
    assert.deepEqual(asked.body, { error: "sms_not_configured" }, "the SAME error a missing Twilio credential gives");
    ok("configured() true + flag false = still hidden, still 503, byte-identical to section 1");
  });

  await db.query("UPDATE feature_flags SET enabled = true WHERE name = 'sms_login'");

  await test("the flag is re-read PER REQUEST — no restart, no deploy, no cached boot value", async () => {
    const res = await asAdmin("/admin/sms-status");
    assert.equal(res.body.configured, true, JSON.stringify(res.body));
    assert.deepEqual(res.body.missing, []);
    assert.equal(res.body.sender_kind, "number");
    ok("the same process, the same server object: configured false -> true with no restart");
  });

  await test("GET /auth/capabilities flips to sms:true in the SAME PROCESS — no session, no admin cookie", async () => {
    const res = await call("/auth/capabilities");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body,
      { sms: true, email: false },
      "the app's one read agrees with the admin's detailed one — and the EMAIL door is untouched by an SMS flag",
    );
    // NAMES NOTHING beyond the booleans — this is the whole point of a separate, minimal
    // route rather than handing the app a slice of GET /admin/sms-status.
    assert.deepEqual(Object.keys(res.body).sort(), ["email", "sms"]);
    ok("{sms:true} — the sign-in screen may now compose the section");
  });

  await test("the wire: Basic auth with the SK pair, the ACCOUNT SID in the URL PATH, form-encoded", async () => {
    stub.mode = "ok";
    stub.calls.length = 0;
    const res = await asAdmin(`/admin/workers/${workerId}/enrolment-code/sms`, { method: "POST" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(stub.calls.length, 1, "exactly one HTTPS POST, not a retry storm");

    const c = stub.calls[0];
    assert.equal(c.method, "POST");
    // THE ACCOUNT SID IS A PATH SEGMENT UNDER EVERY TWILIO AUTH SCHEME. This is the whole
    // reason the SK pair in the vault is not enough to send anything today.
    assert.equal(c.url, `/2010-04-01/Accounts/${FAKE_ACCOUNT_SID}/Messages.json`);
    assert.equal(c.contentType, "application/x-www-form-urlencoded");
    const [scheme, b64] = String(c.authorization).split(" ");
    assert.equal(scheme, "Basic");
    assert.equal(Buffer.from(b64, "base64").toString("utf8"), `${FAKE_API_KEY_SID}:${FAKE_SECRET}`);
    assert.equal(c.form.To, WORKER_PHONE_E164, "the CANONICAL number, never what the director typed");
    assert.equal(c.form.From, FAKE_FROM);
    assert.ok(!("MessagingServiceSid" in c.form), "exactly one sender field");
    ok(`POST ${c.url} — Basic ${FAKE_API_KEY_SID.slice(0, 2)}…:…, To=${c.form.To}, From=${c.form.From}`);
  });

  await test("the message that goes out is the code that came back, GSM-7, one segment", async () => {
    const { isOneSegment } = await import("./lib/sms.js");
    stub.mode = "ok";
    stub.calls.length = 0;
    const res = await asAdmin(`/admin/workers/${workerId}/enrolment-code/sms`, { method: "POST" });
    const body = stub.calls[0].form.Body;
    assert.ok(body.includes(res.body.code), `the SMS must carry the code the admin is looking at: ${body}`);
    assert.ok(isOneSegment(body), `not one GSM-7 segment: ${JSON.stringify(body)}`);
    assert.match(body, /Gültig bis \d{2}\.\d{2}\. um \d{2}:\d{2} Uhr/);
    ok(`"${body}"`);
  });

  await test("a successful send: 200, delivery.status sent, and ONE append-only row", async () => {
    stub.mode = "ok";
    stub.calls.length = 0;
    const before = await countOf("SELECT count(*) AS n FROM sms_deliveries");
    const res = await asAdmin(`/admin/workers/${workerId}/enrolment-code/sms`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(res.body.delivery.status, "sent");
    assert.match(res.body.delivery.provider_sid, /^SM[0-9a-f]{32}$/);
    assert.equal(res.body.delivery.phone_e164, WORKER_PHONE_E164);
    assert.ok(res.body.code, "the code is in the body on the happy path too");
    assert.equal(await countOf("SELECT count(*) AS n FROM sms_deliveries"), before + 1);
    const row = (await db.query("SELECT * FROM sms_deliveries ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal(row.kind, "enrolment_code");
    assert.equal(row.status, "sent");
    assert.equal(Number(row.worker_id), workerId);
    assert.equal(Number(row.requested_by), adminId);
    assert.equal(row.reason, null);
    ok("200 sent, one sms_deliveries row, provider_sid recorded");
  });

  await test("THE CODE IS NEVER IN THE LOG: no row anywhere holds the message or the secret", async () => {
    const rows = (await db.query("SELECT * FROM sms_deliveries")).rows;
    const dump = JSON.stringify(rows);
    for (const secret of [FAKE_SECRET, FAKE_API_KEY_SID]) assert.ok(!dump.includes(secret), "a credential reached the table");
    for (const row of rows) {
      assert.ok(!Object.keys(row).some((k) => /body|message|text|code_/.test(k)), `unexpected column: ${Object.keys(row)}`);
      // provider_code is a NUMBER (Twilio's public error class), never a credential.
      assert.ok(row.provider_code === null || Number.isInteger(row.provider_code));
    }
    ok(`${rows.length} rows, no message body, no code, no credential`);
  });

  // ===================================================================================
  // 3 · IT NEVER PRETENDS. Every way a send can fail, and in every one of them the admin
  //     is still holding a working code.
  // ===================================================================================
  console.log("\n3 · every failure mode still returns the code (decision-48 §7)");

  for (const [mode, label, expected] of [
    ["http500", "Twilio answers 500", /^http_500$/],
    ["rejected", "Twilio rejects the number (21211)", /^http_400$/],
    ["no_sid", "Twilio answers 2xx with no message sid", /^malformed_response$/],
  ]) {
    await test(`${label} -> 200 carrying the code, delivery.status failed, reason from the vocabulary`, async () => {
      stub.mode = mode;
      stub.calls.length = 0;
      const res = await asAdmin(`/admin/workers/${workerId}/enrolment-code/sms`, { method: "POST" });
      assert.equal(res.status, 200, `a failed SEND is a 200 — a 4xx would let the panel swallow the code`);
      assert.match(res.body.code, /^[0-9]{5}$/, "THE FALLBACK: the code is in the body, five digits (decision-63)");
      assert.ok(res.body.expires_at);
      assert.equal(res.body.delivery.status, "failed");
      assert.match(res.body.delivery.reason, expected, `reason was ${res.body.delivery.reason}`);

      const row = (await db.query("SELECT * FROM sms_deliveries ORDER BY id DESC LIMIT 1")).rows[0];
      assert.equal(row.status, "failed", "a failure must never be recorded as 'sent'");
      assert.match(row.reason, expected);
      // The stub's message text says DO NOT LOG ME. Nothing Twilio said may survive.
      assert.ok(!JSON.stringify(row).includes("DO NOT LOG ME"), "a provider message body reached the table");
      assert.ok(!JSON.stringify(res.body).includes("DO NOT LOG ME"), "a provider message body reached the client");

      // and the minted code genuinely works, which is the only thing that makes it a fallback
      resetLoginRate();
      const redeemed = await call("/auth/code", { method: "POST", body: { code: res.body.code } });
      assert.equal(redeemed.status, 200, "the code handed back after a FAILED send must actually redeem");
      await db.query("DELETE FROM worker_sessions");
      ok(`${label}: 200 + a REDEEMABLE code, row recorded 'failed' (${row.reason})`);
    });
  }

  await test("the carrier is unreachable -> network:<errno>, and the code still comes back", async () => {
    configureTwilio({ base: DEAD_BASE });
    const res = await asAdmin(`/admin/workers/${workerId}/enrolment-code/sms`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.ok(res.body.code);
    assert.equal(res.body.delivery.status, "failed");
    assert.match(res.body.delivery.reason, /^network(:|$)/, `reason was ${res.body.delivery.reason}`);
    // No URL, no host, no port — the vocabulary and nothing else.
    assert.ok(!res.body.delivery.reason.includes("127.0.0.1"), "a URL escaped into the reason");
    ok(`connection refused -> ${res.body.delivery.reason}, code still returned`);
    configureTwilio();
  });

  await test("the carrier never answers -> timeout at the 8s leash, and the code still comes back", async () => {
    stub.mode = "hang";
    const started = Date.now();
    const res = await asAdmin(`/admin/workers/${workerId}/enrolment-code/sms`, { method: "POST" });
    const took = Date.now() - started;
    assert.equal(res.status, 200);
    assert.ok(res.body.code);
    assert.equal(res.body.delivery.reason, "timeout");
    assert.ok(took < 20_000, `the leash did not hold: ${took}ms`);
    ok(`no answer -> timeout after ${(took / 1000).toFixed(1)}s, code still returned`);
    stub.mode = "ok";
  });

  await test("a worker with NO login number: 409, and NOTHING is minted or spent", async () => {
    const before = await workerCodeState(noPhoneWorkerId);
    const rows = await countOf("SELECT count(*) AS n FROM sms_deliveries");
    stub.calls.length = 0;
    const res = await asAdmin(`/admin/workers/${noPhoneWorkerId}/enrolment-code/sms`, { method: "POST" });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "no_phone_identity" });
    assert.deepEqual(await workerCodeState(noPhoneWorkerId), before, "a 409 must not mint a code");
    assert.equal(await countOf("SELECT count(*) AS n FROM sms_deliveries"), rows);
    assert.equal(stub.calls.length, 0);

    // …and the code button still works for exactly that worker, which is the point.
    const issued = await asAdmin(`/admin/workers/${noPhoneWorkerId}/enrolment-code`, { method: "POST" });
    assert.equal(issued.status, 201, "no phone number must never block the code path");
    ok("409 no_phone_identity, nothing written — and the code button is unaffected");
  });

  await test("a Messaging Service SID WINS over a number, and only one sender field is sent", async () => {
    configureTwilio({ service: true });
    process.env.TWILIO_FROM = FAKE_FROM; // both set, deliberately
    stub.mode = "ok";
    stub.calls.length = 0;
    const status = await asAdmin("/admin/sms-status");
    assert.equal(status.body.sender_kind, "messaging_service");
    await asAdmin(`/admin/workers/${workerId}/enrolment-code/sms`, { method: "POST" });
    assert.equal(stub.calls[0].form.MessagingServiceSid, FAKE_SERVICE_SID);
    assert.ok(!("From" in stub.calls[0].form), "never both");
    ok("MessagingServiceSid wins; From is not sent");
    configureTwilio();
  });

  await test("a MALFORMED credential counts as MISSING — it must not turn the feature on", async () => {
    clearTwilio();
    process.env.TWILIO_ACCOUNT_SID = "yes"; // present, and nonsense
    process.env.TWILIO_SID = FAKE_API_KEY_SID;
    process.env.TWILIO_SECRET = FAKE_SECRET;
    process.env.TWILIO_FROM = "0664 900 77 01"; // not E.164
    process.env.TWILIO_API_BASE = STUB_BASE;
    const status = await asAdmin("/admin/sms-status");
    assert.equal(status.body.configured, false, JSON.stringify(status.body));
    assert.deepEqual(status.body.missing, ["account_sid", "sender"]);
    stub.calls.length = 0;
    const res = await asAdmin(`/admin/workers/${workerId}/enrolment-code/sms`, { method: "POST" });
    assert.equal(res.status, 503, "a box configured with nonsense must fail closed, not at the wire");
    assert.equal(stub.calls.length, 0);
    ok("TWILIO_ACCOUNT_SID=yes + a national number -> still 503, still nothing sent");
    configureTwilio();
  });

  // ===================================================================================
  // 4 · THE OTP DOOR — the same worker_sessions row, reached a third way.
  // ===================================================================================
  console.log("\n4 · POST /auth/sms/request + /auth/sms/verify (decision-48 §6)");

  const otpFromLastCall = () => {
    const body = stub.calls[stub.calls.length - 1].form.Body;
    const m = body.match(/\b(\d{6})\b/);
    assert.ok(m, `no 6-digit code in the message: ${body}`);
    return m[1];
  };

  await test("request -> 202, verify -> the SAME ts_worker cookie POST /auth/code mints", async () => {
    resetLoginRate();
    stub.mode = "ok";
    stub.calls.length = 0;
    await db.query("DELETE FROM worker_sessions");

    const req = await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(req.status, 202, JSON.stringify(req.body));
    assert.deepEqual(req.body, { status: "accepted" });
    assert.equal(stub.calls.length, 1, "exactly one message");
    assert.equal(await countOf("SELECT count(*) AS n FROM otp_challenges"), 1);

    const code = otpFromLastCall();
    const verified = await call("/auth/sms/verify", { method: "POST", body: { phone: WORKER_PHONE_TYPED, code } });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.worker.id, workerId);
    assert.ok(verified.cookie?.startsWith("ts_worker="), `expected a ts_worker cookie, got ${verified.cookie}`);
    assert.equal(await countOf("SELECT count(*) AS n FROM worker_sessions"), 1, "ONE session table, three doors");

    // The session is real: it authenticates a worker route.
    const who = await call("/auth/session", { cookie: verified.cookie });
    assert.equal(who.status, 200);
    assert.equal(who.body.worker.id, workerId);
    ok(`202 -> ${code} -> 200 + ts_worker, and GET /auth/session accepts it`);
  });

  await test("the OTP is SINGLE USE — a replay is 401 and mints nothing", async () => {
    resetLoginRate();
    stub.calls.length = 0;
    await db.query("DELETE FROM worker_sessions");
    await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    const code = otpFromLastCall();
    const first = await call("/auth/sms/verify", { method: "POST", body: { phone: WORKER_PHONE_TYPED, code } });
    assert.equal(first.status, 200);
    const replay = await call("/auth/sms/verify", { method: "POST", body: { phone: WORKER_PHONE_TYPED, code } });
    assert.equal(replay.status, 401, JSON.stringify(replay.body));
    assert.deepEqual(replay.body, { error: "invalid_code" });
    assert.equal(replay.cookie, null);
    assert.equal(await countOf("SELECT count(*) AS n FROM worker_sessions"), 1, "the replay minted a second session");
    ok("second use -> 401 invalid_code, no cookie, no extra session");
  });

  await test("THREE VERIFICATIONS RACE for one code and exactly ONE wins — decided by the database", async () => {
    // The SELECT that finds the candidate already filters on `consumed_at IS NULL`, so a
    // SEQUENTIAL replay is refused without the UPDATE's predicate doing any work. This case
    // exists because that is precisely the illusion: under READ COMMITTED three concurrent
    // verifications all read "live" from their own snapshot, and only the predicate repeated
    // inside the UPDATE stops all three minting a session. An `if (already_consumed)` in
    // this process could not — which is the whole reason POST /auth/code writes it that way
    // (decision-26) and why this one copies it.
    resetLoginRate();
    stub.calls.length = 0;
    await db.query("DELETE FROM otp_challenges");
    await db.query("DELETE FROM worker_sessions");
    await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    const code = otpFromLastCall();

    const racers = await Promise.all(
      [0, 1, 2].map(() => call("/auth/sms/verify", { method: "POST", body: { phone: WORKER_PHONE_TYPED, code } })),
    );
    const won = racers.filter((r) => r.status === 200);
    assert.equal(won.length, 1, `exactly one may win, got ${racers.map((r) => r.status).join("/")}`);
    for (const lost of racers.filter((r) => r.status !== 200)) {
      assert.equal(lost.status, 401);
      assert.equal(lost.cookie, null);
    }
    assert.equal(await countOf("SELECT count(*) AS n FROM worker_sessions"), 1, "one code, one session, ever");
    ok(`3 concurrent verifications -> ${racers.map((r) => r.status).join("/")}, one worker_sessions row`);
    await db.query("DELETE FROM worker_sessions");
  });

  await test("an unknown number is TOLD: 404 unknown_phone, and still mints no challenge (decision-51)", async () => {
    resetLoginRate();
    stub.calls.length = 0;
    const known = await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(known.status, 202, JSON.stringify(known.body));
    const unknown = await call("/auth/sms/request", { method: "POST", body: { phone: STRANGER_E164 } });
    assert.equal(unknown.status, 404, JSON.stringify(unknown.body));
    assert.deepEqual(unknown.body, { error: "unknown_phone" });
    assert.equal(
      await countOf("SELECT count(*) AS n FROM otp_challenges WHERE phone_e164 = $1", [STRANGER_E164]),
      0,
      "no challenge for a number nobody holds",
    );
    ok(`known -> 202 accepted; unknown -> 404 unknown_phone, no challenge minted`);
  });

  await test("every wrong answer is the SAME 401 — expired, unknown, wrong shape, wrong number", async () => {
    resetLoginRate();
    stub.calls.length = 0;
    await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    const live = otpFromLastCall();
    // An EXPIRED challenge is seeded rather than waited for.
    await db.query("INSERT INTO otp_challenges (phone_e164, code_hash, expires_at) VALUES ($1, $2, now() - interval '1 minute')", [
      WORKER_PHONE_E164,
      hashToken("000111"),
    ]);

    const bodies = [];
    for (const body of [
      { phone: WORKER_PHONE_TYPED, code: "000000" }, // wrong
      { phone: WORKER_PHONE_TYPED, code: "000111" }, // real, but expired
      { phone: WORKER_PHONE_TYPED, code: "abc" }, // wrong shape
      { phone: STRANGER_E164, code: live }, // a real code, the wrong number
      { phone: "not a phone", code: live }, // not a number at all
      {}, // nothing
    ]) {
      resetLoginRate(); // the per-IP lockout is not what is under test here
      const res = await call("/auth/sms/verify", { method: "POST", body });
      assert.equal(res.status, 401, `${JSON.stringify(body)} -> ${res.status} ${JSON.stringify(res.body)}`);
      assert.equal(res.cookie, null);
      bodies.push(JSON.stringify(res.body));
    }
    assert.equal(new Set(bodies).size, 1, `six failure bodies must be ONE string, got ${new Set(bodies).size}`);
    assert.equal(bodies[0], '{"error":"invalid_code"}');
    ok("six different failures, one byte-identical answer");
  });

  await test("five wrong answers BURN the challenge — the right code afterwards is still 401", async () => {
    resetLoginRate();
    stub.calls.length = 0;
    await db.query("DELETE FROM otp_challenges");
    await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    const code = otpFromLastCall();
    for (let i = 0; i < 5; i++) {
      resetLoginRate();
      const wrong = String((Number(code) + i + 1) % 1_000_000).padStart(6, "0");
      const res = await call("/auth/sms/verify", { method: "POST", body: { phone: WORKER_PHONE_TYPED, code: wrong } });
      assert.equal(res.status, 401);
    }
    resetLoginRate();
    const res = await call("/auth/sms/verify", { method: "POST", body: { phone: WORKER_PHONE_TYPED, code } });
    assert.equal(res.status, 401, "the correct code must be refused once the attempts are spent");
    assert.equal(res.cookie, null);
    const row = (await db.query("SELECT attempts FROM otp_challenges ORDER BY id DESC LIMIT 1")).rows[0];
    assert.ok(row.attempts >= 5, `attempts should be spent, got ${row.attempts}`);
    ok(`5 wrong answers -> the challenge is burned (attempts=${row.attempts}); the right code no longer works`);
  });

  await test("a DEACTIVATED worker cannot sign in by SMS — 404 unknown_phone, still zero messages", async () => {
    resetLoginRate();
    await db.query("UPDATE workers SET active = false WHERE id = $1", [workerId]);
    stub.calls.length = 0;
    const res = await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.deepEqual(res.body, { error: "unknown_phone" }, "deactivation reads exactly like an unknown number — decision-51 §2");
    assert.equal(stub.calls.length, 0, "no message may go to a worker who has been let go");
    await db.query("UPDATE workers SET active = true WHERE id = $1", [workerId]);
    ok("deactivated -> 404 unknown_phone, zero messages");
  });

  await test("the per-IP ceiling bites at the default of 3, spares the enrolment path, and POST /admin/settings changes it live (decision-51)", async () => {
    resetLoginRate();
    await db.query("DELETE FROM otp_challenges");
    stub.calls.length = 0;

    let last = null;
    for (let i = 0; i < 4; i++) last = await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(last.status, 429, `the 4th request in 5 minutes must be refused at the default of 3, got ${last.status}`);
    assert.equal(last.body.error, "too_many_attempts");

    // THE POINT: the enrolment code, from the same caller, in the same second, still works.
    // Own buckets — `enrol:` is nowhere near `smsreq:`.
    const issued = await asAdmin(`/admin/workers/${workerId}/enrolment-code`, { method: "POST" });
    assert.equal(issued.status, 201);
    const redeemed = await call("/auth/code", { method: "POST", body: { code: issued.body.code } });
    assert.equal(redeemed.status, 200, "an SMS-request flood must never lock a worker out of the code path");
    await db.query("DELETE FROM worker_sessions");
    ok("429 on the 4th SMS request within 5 min; POST /auth/code still 200 in the same second");

    // Raise the limit from the panel — NO RESTART, no cache to invalidate: the very next
    // request in the SAME process must obey the new number.
    const raised = await asAdmin("/admin/settings", { method: "POST", body: { key: "sms_otp_requests_per_5min", value: 5 } });
    assert.equal(raised.status, 200, JSON.stringify(raised.body));
    const afterRaise = await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(afterRaise.status, 202, `raising the limit to 5 must unblock the 4th-in-window caller, got ${afterRaise.status}`);
    ok("POST /admin/settings {sms_otp_requests_per_5min:5} -> the same process now allows a 4th request, no restart");

    // Delete the key — must fall back to the coded default of 3, and NOT to unlimited.
    const cleared = await asAdmin("/admin/settings/sms_otp_requests_per_5min", { method: "DELETE" });
    assert.equal(cleared.status, 200);
    const afterClear = await call("/auth/sms/request", { method: "POST", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(afterClear.status, 429, `unsetting the key must fall back to the default of 3, not to unlimited, got ${afterClear.status}`);
    ok("DELETE /admin/settings/sms_otp_requests_per_5min -> falls back to 3, immediately refuses again");
    await db.query("DELETE FROM otp_challenges");
  });

  // ===================================================================================
  // 5 · THE ROUTES ARE NOT ON THE CLOCK-IN PATH, AND ARE NOT REACHABLE FROM A PHONE.
  // ===================================================================================
  console.log("\n5 · who can reach what");

  await test("a WORKER session cannot reach the admin SMS route — 401, never 503", async () => {
    resetLoginRate();
    const issued = await asAdmin(`/admin/workers/${workerId}/enrolment-code`, { method: "POST" });
    const redeemed = await call("/auth/code", { method: "POST", body: { code: issued.body.code } });
    const workerCookie = redeemed.cookie;

    for (const [p, method] of [
      [`/admin/workers/${workerId}/enrolment-code/sms`, "POST"],
      [`/admin/workers/${workerId}/phone`, "PUT"],
      ["/admin/sms-status", "GET"],
    ]) {
      const res = await call(p, { method, cookie: workerCookie, body: method === "PUT" ? { phone: WORKER_PHONE_TYPED } : undefined });
      assert.equal(res.status, 401, `${method} ${p} answered ${res.status} to a worker cookie`);
      assert.deepEqual(res.body, { error: "unauthorized" });
    }
    await db.query("DELETE FROM worker_sessions");
    ok("401 unauthorized on all three admin SMS routes with a ts_worker cookie");
  });

  await test("no SMS route is auth 'worker' or 'operator', and none is near /shifts/*", async () => {
    const { adminRoutes } = await import("./routes/admin.js");
    const { authRoutes } = await import("./routes/auth.js");
    const { appRoutes } = await import("./routes/app.js");
    const smsish = [...adminRoutes, ...authRoutes, ...appRoutes].filter((r) => /sms|otp|\/phone$/i.test(r.path));
    // 7 SMS/OTP routes + PUT and DELETE .../phone. A magic number is the point here: if a
    // tenth appears, somebody must come back and say which auth kind it carries. It has
    // gone up twice by design — decision-45's operator enrolment-code SMS, and decision-54
    // §5's POST /auth/operator-sms/request + /verify, the operator's own OTP door — and
    // BOTH additions are `auth: "app"`, which is what the loop below is really pinning.
    assert.equal(smsish.length, 9, `expected 9 routes, found ${smsish.length}: ${smsish.map((r) => r.path).join(", ")}`);
    for (const r of smsish) {
      assert.ok(["admin", "app"].includes(r.auth), `${r.method} ${r.path} has auth ${r.auth}`);
      assert.ok(!r.path.startsWith("/shifts"), `${r.path} is on the clock-in path`);
    }
    // CLOCK-IN IS NEVER BLOCKED BY ANYTHING: the shift routes are untouched by this work.
    for (const r of appRoutes.filter((x) => x.path.startsWith("/shifts"))) {
      assert.ok(!/sms|otp/i.test(r.path));
    }
    ok(`${smsish.length} SMS/OTP/phone routes, all admin-or-app auth, none under /shifts`);
  });

  // ===================================================================================
  // 6 · PUT/DELETE /admin/workers/:id/phone — the promotion decision-45 named.
  // ===================================================================================
  console.log("\n6 · the login number (decision-45's named, unbuilt one-click promotion)");

  await test("the two spellings are ONE identity, and a stranger cannot take a claimed number", async () => {
    const other = Number(
      (await db.query("INSERT INTO workers (name, hourly_rate_cents) VALUES ('Second Cleaner', 1700) RETURNING id")).rows[0].id,
    );
    // Idempotent re-save in the OTHER spelling: same identity, still 200, still one row.
    const again = await asAdmin(`/admin/workers/${workerId}/phone`, { method: "PUT", body: { phone: "+43 664/9007701" } });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.phone_e164, WORKER_PHONE_E164, "normalised on the way in, never stored as typed");

    const stolen = await asAdmin(`/admin/workers/${other}/phone`, { method: "PUT", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(stolen.status, 409, JSON.stringify(stolen.body));
    assert.deepEqual(stolen.body, { error: "phone_claimed" }, "the 409 must name nobody");
    assert.equal(
      Number((await db.query("SELECT worker_id FROM phone_identities WHERE phone_e164 = $1", [WORKER_PHONE_E164])).rows[0].worker_id),
      workerId,
      "the original claim must survive a failed steal",
    );
    ok("0664 900 77 01 == +43 664/9007701; a second worker gets 409 phone_claimed");
  });

  await test("workers.phone (free text) is NEVER rewritten by this — decision-45 §4", async () => {
    await db.query("UPDATE workers SET phone = '0664/900 77 01' WHERE id = $1", [workerId]);
    await asAdmin(`/admin/workers/${workerId}/phone`, { method: "PUT", body: { phone: WORKER_PHONE_TYPED } });
    const row = (await db.query("SELECT phone FROM workers WHERE id = $1", [workerId])).rows[0];
    assert.equal(row.phone, "0664/900 77 01", "the director's own spelling must be left alone");
    ok("the free-text column is byte-identical after a login number is saved");
  });

  await test("DELETE releases the claim and leaves no orphan row", async () => {
    const res = await asAdmin(`/admin/workers/${workerId}/phone`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(res.body.phone_e164, null);
    assert.equal(
      await countOf("SELECT count(*) AS n FROM phone_identities WHERE phone_e164 = $1", [WORKER_PHONE_E164]),
      0,
      "a row owned by nobody is litter, not a reservation",
    );
    // Idempotent: pressing it twice is not an error.
    assert.equal((await asAdmin(`/admin/workers/${workerId}/phone`, { method: "DELETE" })).status, 200);
    // and the number is claimable again
    const reclaim = await asAdmin(`/admin/workers/${workerId}/phone`, { method: "PUT", body: { phone: WORKER_PHONE_TYPED } });
    assert.equal(reclaim.status, 200);
    ok("released, no orphan, idempotent, and claimable again");
  });

  await test("an OPERATOR's number may be ADOPTED by the worker half, never stolen", async () => {
    // ONE HUMAN, ONE TELEPHONE, TWO ROLES — precisely what 007's table exists for.
    const opId = Number((await db.query("INSERT INTO operators (name) VALUES ('Feldleiter') RETURNING id")).rows[0].id);
    await db.query("INSERT INTO phone_identities (phone_e164, operator_id) VALUES ('+436649007750', $1)", [opId]);
    const dual = Number(
      (await db.query("INSERT INTO workers (name, hourly_rate_cents) VALUES ('Also A Cleaner', 1800) RETURNING id")).rows[0].id,
    );
    const res = await asAdmin(`/admin/workers/${dual}/phone`, { method: "PUT", body: { phone: "0664 900 77 50" } });
    assert.equal(res.status, 200, `the worker half of an operator's row must be adoptable: ${JSON.stringify(res.body)}`);
    const row = (await db.query("SELECT worker_id, operator_id FROM phone_identities WHERE phone_e164 = '+436649007750'")).rows[0];
    assert.equal(Number(row.worker_id), dual);
    assert.equal(Number(row.operator_id), opId, "the operator claim must survive");
    assert.equal(await countOf("SELECT count(*) AS n FROM phone_identities WHERE phone_e164 = '+436649007750'"), 1, "ONE row");
    ok("one row, both halves — the operator claim is intact");
  });

  note("no SMS was sent to any real number by this run; every call went to the local stub");
} catch (err) {
  die(err?.stack ?? String(err));
} finally {
  teardown();
}

if (failures > 0) {
  console.error(`\nFAIL check-sms-flag: ${failures} case(s)`);
  process.exit(1);
}
console.log("\nOK check-sms-flag");
process.exit(0);
