#!/usr/bin/env node
// THE SECOND PRE-DEPLOY CHECK FOR MIGRATION 006 — the wire, not the schema.
//
//   ssh schimmer-glanz.exe.xyz 'sudo -n cat /var/backups/nfc/nfc-<newest>.sql.gz' > /tmp/nfc.sql.gz
//   node server/db/check-field-wire.mjs /tmp/nfc.sql.gz
//
// check-prod-restore.mjs proves 006 applies to the client's own database and that the card
// on the wall still opens a shift. It leaves five things unproven, and each of them is a
// day of the client's time if it is wrong:
//
//   1 · THE SHIPPED CLOSE CARRIES `auto_closed`. check-prod-restore closes with
//       {client_uuid, end_time} and calls that "the SHIPPED build's shape". It is not.
//       `CloseShiftRequest` (android/.../core/Wire.kt) has a NON-NULL Boolean and
//       `Wire.obj` always emits it, so every close the field APK has ever sent carries a
//       third key. All three APKs on disk contain the string. Asserting a two-key body is
//       asserting a request the phone does not make.
//   2 · `auto_closed` MONOTONICITY, IN THE DATABASE. check-close-flag.mjs greps
//       routes/app.js for `auto_closed = auto_closed OR $3` and then evaluates a JS truth
//       table. That proves a regex and an OR. It never opens a connection. The retry the
//       phone actually performs — auto-close lands, the network drops, the queue replays a
//       plain tap-out — is only a defect if the FLAG CLEARS, and only a database can say.
//   3 · THE BUILDING TAG AFTER THE BUILDING GAINS A ZONE. check-prod-restore taps the
//       building uuid FIRST, then creates the zone, then deletes it. So the one ordering
//       decision-43 puts at risk — the wall card tapped while a live zone exists under the
//       same building (ZONES-MODEL §11 risk 3) — is never exercised.
//   4 · A REPLAYED OPEN. The phone's offline queue re-posts. 201-then-409 would strand a
//       cleaner on an error screen with a shift that is, in fact, open.
//   5 · WHAT HEAD'S SERVER DOES ON A DATABASE THAT IS STILL AT 005. `v.activePlace`
//       SELECTs from `zones`, so every tap 500s — while `/health` stays 200, because it
//       only runs `SELECT 1`. Deploy order already puts migrate before restart, but the
//       window is real (a crash or a reboot between the code rsync and the migration) and
//       the point worth writing down is that NO HEALTH PROBE CAN SEE IT.
//
// IT NEVER TOUCHES PRODUCTION. Two throwaway local databases, dropped at the end. The
// dump is read-only input.
//
// THE WIRE SHAPE IS READ OUT OF THE APK, NOT OUT OF THE KOTLIN. A check that reads the
// source proves the tree agrees with itself; the phone in Vienna runs a binary from
// August. `dex` strings are the only artefact that is neither this tree nor a guess.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..", "..");

// The uuid the owner wrote onto a blank NTAG card and mounted at the only live building.
// A BUILDING uuid, on a building with zero zones. It cannot be rewritten from Vienna.
const WALL_TAG_UUID = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7";
// The Mifare Ultralight EV1 screwed to the same wall: 46 B of NDEF against the ~64 B our
// URI needs, so it holds no URL and its serial is its only stable handle (decision-44).
const MOUNTED_SERIAL = "04:A1:A8:52:AE:5C:80";

const PRE_DB = `nfc_wire_pre_${process.pid}`;
const MIG_DB = `nfc_wire_mig_${process.pid}`;
const APP_KEY = "field-wire-check-key";

const skip = (why) => {
  console.log(`SKIP check-field-wire: ${why}`);
  process.exit(0);
};
// process.exit() does NOT run a pending finally, so every throwaway database has to be
// dropped HERE too, or a failed run leaves a copy of the client's payroll on the laptop.
const die = (why, fix) => {
  console.error(`\nFAIL check-field-wire: ${why}`);
  if (fix) console.error(`       fix: ${fix}`);
  for (const name of created) {
    try {
      sh("dropdb", ["--if-exists", name]);
    } catch {
      console.error(`       warning: could not drop ${name}`);
    }
  }
  process.exit(1);
};
const ok = (m) => console.log(`  ok   ${m}`);

const dump = process.argv[2];
if (!dump) skip("no dump given — usage: node server/db/check-field-wire.mjs <nfc-*.sql[.gz]>");
if (!fs.existsSync(dump)) skip(`${dump} does not exist`);

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

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

// ---------------------------------------------------------------------------------
// 0 · THE FIELD SHAPE, READ OUT OF THE SHIPPED BINARY.
//
// If no APK is on disk this degrades to the constants below and SAYS SO — a build machine
// without android/dist is a normal thing and is not a failure. What is NOT allowed is for
// an APK to be present and to disagree, because then the assertions further down are
// describing a request nobody sends.
// ---------------------------------------------------------------------------------
const OPEN_KEYS = ["client_uuid", "location_uuid", "start_time"];
const CLOSE_KEYS = ["client_uuid", "end_time", "auto_closed"];

function apkStrings() {
  const candidates = [
    path.join(REPO, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
    ...(fs.existsSync(path.join(REPO, "android", "dist"))
      ? fs
          .readdirSync(path.join(REPO, "android", "dist"))
          .filter((f) => f.endsWith(".apk"))
          .map((f) => path.join(REPO, "android", "dist", f))
      : []),
  ].filter((p) => fs.existsSync(p));
  const out = [];
  for (const apk of candidates) {
    let names;
    try {
      names = sh("unzip", ["-Z1", apk])
        .split("\n")
        .filter((n) => n.endsWith(".dex"));
    } catch {
      continue; // no unzip, or not a zip — the fallback below covers it
    }
    const found = new Set();
    for (const dex of names) {
      let raw;
      try {
        raw = execFileSync("unzip", ["-p", apk, dex], { maxBuffer: 1 << 28 }).toString("latin1");
      } catch {
        continue;
      }
      for (const k of [...OPEN_KEYS, ...CLOSE_KEYS]) if (raw.includes(k)) found.add(k);
    }
    out.push([path.basename(apk), found]);
  }
  return out;
}

// The child (phase A, see below) inherits the same file and must not re-print this.
const CHILD = process.env.WIRE_PHASE === "pre";
const apks = CHILD ? null : apkStrings();
if (CHILD) {
  // nothing: the parent has already asserted the shape
} else if (apks.length === 0) {
  console.log("  --   no APK on disk: the wire shape below is the tree's, NOT a shipped binary's");
} else {
  for (const [name, found] of apks) {
    for (const k of [...OPEN_KEYS, ...CLOSE_KEYS]) {
      assert.ok(found.has(k), `${name} does not contain the wire key "${k}" — this check tests a request it never sends`);
    }
  }
  ok(`the wire keys below are present in ${apks.length} shipped APK(s): ${apks.map(([n]) => n).join(", ")}`);
  ok(`  open  {${OPEN_KEYS.join(", ")}}   close {${CLOSE_KEYS.join(", ")}}   <- auto_closed is NOT optional in the field`);
}

// ---------------------------------------------------------------------------------
// restore helper. A production dump carries `ALTER TABLE ... OWNER TO nfc`, so it needs a
// local role called `nfc`. Without one psql exits 3 and node prints a stack trace, which
// is how check-prod-restore.mjs behaves on any machine that has never run this project's
// demo stack — a pre-deploy gate that dies in a way an operator reads as "broken tooling".
// A dump WAS supplied here, so this FAILS with the one-line fix rather than skipping.
// ---------------------------------------------------------------------------------
const sql = dump.endsWith(".gz") ? sh("gunzip", ["-c", dump]) : fs.readFileSync(dump, "utf8");

function restore(name) {
  sh("createdb", [name]);
  created.push(name);
  try {
    sh("psql", [`postgres:///${name}`, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const message = String(e.stderr || e.message);
    const missingRole = message.match(/role "([^"]+)" does not exist/);
    if (missingRole) die(`the dump needs a local role "${missingRole[1]}" and this machine has none`, `createuser ${missingRole[1]}`);
    die(`the dump did not restore: ${message.trim().split("\n").slice(0, 3).join(" / ")}`);
  }
}

const q = (db, s) => sh("psql", [`postgres:///${db}`, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", s]).trim();

const servers = [];
const clients = [];
// Declared BEFORE die() needs it: every database this file creates is pushed here the
// moment it exists, so both the finally and the early exits drop all of them.
const created = [];

// A worker with a REAL rate (006 makes any other kind unrepresentable) plus a session. The
// row stores only the SHA-256 of the cookie (lib/auth.js), so this fixture cannot become a
// replayable credential even if it leaked.
async function fixtureSession(db) {
  const client = new pg.Client({ connectionString: `postgres:///${db}` });
  await client.connect();
  clients.push(client);
  const workerId = Number(
    (await client.query("INSERT INTO workers (name, hourly_rate_cents) VALUES ('Field Wire Check', 1500) RETURNING id")).rows[0].id,
  );
  const token = randomBytes(32).toString("hex");
  await client.query("INSERT INTO worker_sessions (token, worker_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [
    createHash("sha256").update(token, "utf8").digest("hex"),
    workerId,
  ]);
  return { client, workerId, token };
}

// ONE PROCESS CAN ONLY EVER BOOT ONE OF THESE. `lib/db.js` builds its pool from
// process.env.DATABASE_URL at IMPORT time and the ESM cache hands the same module to the
// second boot, so a second `createServer()` in this process would quietly keep talking to
// the FIRST database — and every request would 401 on a session that is in the other one.
// Phase A therefore runs in a child (`WIRE_PHASE=pre`), which is also honest: it is the
// only way to observe a process that started life on a 005 schema.
async function boot(db, token) {
  process.env.DATABASE_URL = `postgres:///${db}`;
  process.env.APP_KEY = APP_KEY;
  process.env.PORT = "0";
  const { createServer } = await import(path.join(__dirname, "..", "server.js"));
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  // RAW STRING BODIES throughout, never an object. `JSON.stringify({...})` is this tree's
  // idea of the request; a string literal is the phone's. The difference is exactly the
  // third key in the close body, and it is the reason this file exists.
  return (p, raw) =>
    fetch(base + p, {
      method: raw === undefined ? "GET" : "POST",
      headers: {
        "X-App-Key": APP_KEY,
        Cookie: `ts_worker=${token}`,
        ...(raw === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: raw,
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

// ISO to the second. The server tolerates 5 minutes of clock skew (lib/validate.js
// CLOCK_SKEW_MS) and 422s anything beyond, so an end_time must stay inside it — a fixture
// that closes "an hour later" tests the skew guard and nothing else.
const iso = (ms) => new Date(ms).toISOString();

// =================================================================================
// A · THE PRE-006 WINDOW — what HEAD's server does on the schema production has TODAY.
//     Runs as a CHILD of the block below; see boot().
// =================================================================================
async function phasePre(db) {
  assert.equal(q(db, "SELECT count(*) FROM schema_migrations"), "5", "a phase-A dump must be at migration 005");
  assert.equal(q(db, "SELECT to_regclass('public.zones') IS NULL"), "t", "...and must have no zones table");

  const pre = await fixtureSession(db);
  const preCall = await boot(db, pre.token);

  const preHealth = await preCall("/health");
  const preRoster = await preCall("/roster");
  const preOpen = await preCall(
    "/shifts/open",
    `{"client_uuid":"c0000000-0000-4000-8000-000000000001","location_uuid":"${WALL_TAG_UUID}","start_time":"${iso(Date.now())}"}`,
  );
  assert.equal(preHealth.status, 200, "…/health only runs SELECT 1, so it cannot see a schema mismatch");
  assert.equal(preRoster.status, 500, "GET /roster on a pre-006 schema must be the visible failure");
  assert.equal(preOpen.status, 500, "and the field APK's clock-in must be too");
  assert.equal(q(db, "SELECT count(*) FROM shifts"), "0", "…and must have written nothing");
  ok("MIGRATE BEFORE RESTART IS LOAD-BEARING: on a 005 schema /health is 200 while /roster and");
  ok("  POST /shifts/open are 500 — no health probe can see this, only a cleaner can");
}

if (process.env.WIRE_PHASE === "pre") {
  try {
    await phasePre(process.env.WIRE_DB);
  } finally {
    for (const s of servers) await new Promise((r) => s.close(r));
    for (const c of clients) await c.end().catch(() => {});
    const { pool } = await import(path.join(__dirname, "..", "lib", "db.js")).catch(() => ({ pool: null }));
    if (pool) await pool.end().catch(() => {});
  }
  process.exit(0);
}

try {
  restore(PRE_DB);

  // PHASE A ONLY EXISTS WHILE THE WINDOW DOES. Its whole subject is "HEAD's server running
  // on the schema production has TODAY", and on 2026-08-20 production stopped being at 005:
  // 006, 007 and 008 applied. A dump taken after that carries eight rows, and the phase-A
  // premise is simply false — the check died on `'8' !== '5'` with a raw stack, which reads
  // as "the tooling is broken" and is how a check gets ignored.
  //
  // So the dump decides, and only TWO shapes are allowed. Exactly 005: the window is open,
  // run phase A. Exactly the full migrations/ listing: the window is CLOSED, and that fact
  // is asserted here rather than assumed — zones must exist. Anything else (a half-applied
  // schema, a dump from a box nobody recognises) is a hard failure, because a check that
  // shrugs at an unknown input is a check that passes over anything.
  const allMigrations = fs
    .readdirSync(path.join(__dirname, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const dumpMigrations = q(PRE_DB, "SELECT filename FROM schema_migrations ORDER BY filename")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (dumpMigrations.length === 5) {
    // The child inherits nothing that matters except the two variables below; its stdout is
    // this file's stdout, so its `ok` lines land in order.
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), dump], {
      env: { ...process.env, WIRE_PHASE: "pre", WIRE_DB: PRE_DB },
      stdio: ["ignore", "inherit", "inherit"],
    });
  } else {
    assert.deepEqual(
      dumpMigrations,
      allMigrations,
      `this dump is at neither 005 (phase A applies) nor the full set (phase A is moot): ${dumpMigrations.join(", ")}`,
    );
    assert.equal(
      q(PRE_DB, "SELECT to_regclass('public.zones') IS NOT NULL"),
      "t",
      "a fully-migrated dump must actually carry the 006 schema, not just the bookkeeping rows",
    );
    ok(`phase A not applicable: this dump is already at ${dumpMigrations.at(-1)}, so the pre-006 window is CLOSED`);
    ok("  (it is asserted closed, not assumed: schema_migrations matches migrations/ and zones exists)");
  }

  // =================================================================================
  // B · THE MIGRATED DATABASE — the field APK's exact bytes.
  // =================================================================================
  restore(MIG_DB);

  // The ops step (server/db/README.md §006), reproduced on the SCRATCH copy only. 006's
  // refusal on the real rows is check-prod-restore.mjs's assertion and is not repeated.
  const rateless = Number(q(MIG_DB, "SELECT count(*) FROM workers WHERE hourly_rate_cents <= 0"));
  if (rateless > 0) {
    q(MIG_DB, "DELETE FROM workers WHERE hourly_rate_cents <= 0");
    ok(`(${rateless} rate-less worker(s) removed from the SCRATCH copy so 006 can apply here)`);
  }
  sh("node", [path.join(__dirname, "migrate.js")], { env: { ...process.env, DATABASE_URL: `postgres:///${MIG_DB}` } });
  // EVERY pending file, not a magic number. This assertion used to read `count === "6"`,
  // which is a claim about how many migrations exist rather than about whether the schema
  // this file's assertions need is actually present: 007 landed, the count became 7, and
  // the pre-deploy field-wire gate died on an AssertionError about arithmetic — printing a
  // raw stack an operator reads as "the tooling is broken", exactly the failure mode
  // 9072a8e fixed in check-prod-restore.mjs. Comparing against the directory listing means
  // 008 does not have to remember this line exists.
  const wantMigrations = fs
    .readdirSync(path.join(__dirname, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const haveMigrations = q(MIG_DB, "SELECT filename FROM schema_migrations ORDER BY filename")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.deepEqual(
    haveMigrations,
    wantMigrations,
    `every migration file must be applied before the wire assertions below mean anything — missing: ${wantMigrations.filter((f) => !haveMigrations.includes(f)).join(", ") || "(none)"}`,
  );
  ok(`${haveMigrations.length} migration(s) applied, matching migrations/ exactly: ${haveMigrations.at(-1)} is the newest`);

  const mig = await fixtureSession(MIG_DB);
  const call = await boot(MIG_DB, mig.token);

  const open = (cu, place, at) =>
    call("/shifts/open", `{"client_uuid":"${cu}","location_uuid":"${place}","start_time":"${iso(at)}"}`);
  const close = (cu, at, autoClosed) =>
    call("/shifts/close", `{"client_uuid":"${cu}","end_time":"${iso(at)}","auto_closed":${autoClosed}}`);

  const t0 = Date.now() - 60_000;

  // ---- B1 · the OLD-SHAPE clock-in, and the SHIPPED close with all three keys --------
  const c1 = "c0000000-0000-4000-8000-000000000011";
  const o1 = await open(c1, WALL_TAG_UUID, t0);
  assert.equal(o1.status, 201, `the wall card must clock a worker in: ${JSON.stringify(o1.body)}`);
  assert.equal(o1.body.shift.location_id, WALL_TAG_UUID);
  assert.equal(o1.body.shift.start_zone_id, null, "a building tag records NO zone and must not invent one");
  const x1 = await close(c1, t0 + 30_000, false);
  assert.equal(x1.status, 200, `the SHIPPED close carries auto_closed and must be accepted: ${JSON.stringify(x1.body)}`);
  assert.equal(x1.body.shift.auto_closed, false, "a deliberate tap-out stays a clean close");
  ok("field-shape open (building uuid) -> 201, field-shape close (3 keys, auto_closed:false) -> 200");

  // ---- B2 · auto_closed:true, and it MUST NOT CLEAR on the replayed tap-out ---------
  // This is the sequence the phone produces on a bad connection: the app auto-closes on a
  // cross-building tap, the request lands, the ack is lost, and the offline queue re-posts
  // whatever it holds. If the second write clears the flag, decision-10's resolution screen
  // never appears and an unconfirmed end time silently becomes payroll.
  const c2 = "c0000000-0000-4000-8000-000000000012";
  assert.equal((await open(c2, WALL_TAG_UUID, t0)).status, 201);
  const flagged = await close(c2, t0 + 30_000, true);
  assert.equal(flagged.status, 200);
  assert.equal(flagged.body.shift.auto_closed, true, "the app's auto-close must RAISE the flag");
  const replayed = await close(c2, t0 + 30_000, false);
  assert.equal(replayed.status, 200, "a replayed close must not error");
  assert.equal(replayed.body.shift.auto_closed, true, "*** auto_closed must never be CLEARED by a later close ***");
  assert.equal(
    q(MIG_DB, `SELECT auto_closed FROM shifts WHERE client_uuid = '${c2}'`),
    "t",
    "…and the DATABASE, not the response body, is what payroll reads",
  );
  ok("auto_closed is monotonic THROUGH THE DATABASE: raised by the app, never cleared by a replay");

  // ---- B3 · a replayed open converges rather than 409ing ----------------------------
  const c3 = "c0000000-0000-4000-8000-000000000013";
  const first = await open(c3, WALL_TAG_UUID, t0);
  const again = await open(c3, WALL_TAG_UUID, t0);
  assert.equal(first.status, 201);
  assert.equal(again.status, 200, "a replayed open is a duplicate, not a conflict");
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.shift.id, first.body.shift.id, "…and converges on the FIRST write");
  assert.equal((await close(c3, t0 + 30_000, false)).status, 200);
  assert.equal((await close(c3, t0 + 30_000, false)).status, 200, "and a replayed close is idempotent too");
  ok("the offline queue's replays converge: open 201 then 200 duplicate, close 200 then 200");

  // ---- B4 · the mounted EV1 serial, and THEN the wall card again --------------------
  // Ordering is the whole assertion. check-prod-restore taps the building first and deletes
  // the zone before it ends, so it never observes a building tag against a building that
  // HAS a live zone — which is the state the day TASK-201 puts a second tag on that wall,
  // and ZONES-MODEL §11 risk 3 is about exactly this.
  q(
    MIG_DB,
    `INSERT INTO zones (location_id, name, note, tag_serial) VALUES ('${WALL_TAG_UUID}', 'Stiege 1', 'Fremdtag am Eingang', '${MOUNTED_SERIAL}')`,
  );
  const zoneId = q(MIG_DB, `SELECT id FROM zones WHERE tag_serial = '${MOUNTED_SERIAL}'`);
  assert.match(zoneId, /^[0-9a-f-]{36}$/, "the mounted serial must be storable on a zone");

  // decision-47 — AND THIS IS THE SEQUENCING RULE THAT PROTECTS THE ONE WORKING TAP.
  // The zone above is UNVERIFIED, because that is what any zone is until an operator scans
  // its card. While it is, /roster ships the ROW but NOT the SERIAL: a published serial takes
  // priority over KnownTags.kt's compiled fallback on the phone, so the mounted card would
  // start posting this ZONE's id, which the gate refuses — i.e. publishing it early is
  // precisely how the wall card dies. The phone therefore keeps falling back to the compiled
  // table and the BUILDING id, which is exactly today's behaviour.
  const unverifiedRoster = (await call("/roster")).body;
  const unverifiedRow = unverifiedRoster.zones.find((z) => z.id === zoneId);
  assert.ok(unverifiedRow, "the ROW must ship even unverified — buildingIdOf() reads it to recognise a clock-out");
  assert.equal(unverifiedRow.tag_serial, null, "an UNVERIFIED zone must NOT publish its serial");
  const unverifiedTap = await open("c0000000-0000-4000-8000-000000000017", zoneId, t0);
  assert.equal(unverifiedTap.status, 422, "an unverified zone must not open a shift");
  assert.equal(unverifiedTap.body.error, "zone_unverified", "…and must say so by name");
  // THE WALL CARD, WITH AN UNVERIFIED ZONE UNDER IT. This is the state production takes the
  // moment somebody creates HOIV's first zone, and the building tap must be untouched by it.
  const duringUnverified = await open("c0000000-0000-4000-8000-000000000018", WALL_TAG_UUID, t0);
  assert.equal(
    duringUnverified.status,
    201,
    `*** the wall card must keep working while an UNVERIFIED zone sits under it: ${JSON.stringify(duringUnverified.body)} ***`,
  );
  assert.equal(duringUnverified.body.shift.start_zone_id, null);
  assert.equal((await close("c0000000-0000-4000-8000-000000000018", t0 + 30_000, false)).status, 200);
  ok("UNVERIFIED: no serial on the wire, the zone refuses a tap, and the WALL CARD is unaffected");

  // The operator's test scan, stamped in SQL here — the route itself is pinned in
  // check-api.js and driven live in ops/prove-live.sh; what this file is for is the WIRE.
  q(MIG_DB, `UPDATE zones SET verified_at = now() WHERE id = '${zoneId}'`);

  const roster = (await call("/roster")).body;
  const shipped = roster.zones.find((z) => z.id === zoneId);
  assert.ok(shipped, "GET /roster must ship the zone — there is no other route a serial arrives on");
  assert.equal(shipped.tag_serial, MOUNTED_SERIAL, "…carrying the serial verbatim, ONCE VERIFIED");

  const c4 = "c0000000-0000-4000-8000-000000000014";
  const zoneOpen = await open(c4, zoneId, t0);
  assert.equal(zoneOpen.status, 201, `the resolved zone must clock a worker in: ${JSON.stringify(zoneOpen.body)}`);
  assert.equal(zoneOpen.body.shift.location_id, WALL_TAG_UUID, "a zone tap is billed to the BUILDING");
  assert.equal(zoneOpen.body.shift.start_zone_id, zoneId, "…and records the door as a tap FACT");
  assert.equal((await close(c4, t0 + 30_000, false)).status, 200);

  const c5 = "c0000000-0000-4000-8000-000000000015";
  const stillWorks = await open(c5, WALL_TAG_UUID, t0);
  assert.equal(
    stillWorks.status,
    201,
    `*** the wall card must keep working AFTER its building gains a zone: ${JSON.stringify(stillWorks.body)} ***`,
  );
  assert.equal(stillWorks.body.shift.start_zone_id, null, "…and must not be silently attached to 'the first zone'");
  assert.equal((await close(c5, t0 + 30_000, false)).status, 200);
  ok("the BUILDING uuid still opens a shift while a live zone exists under it, with zone NULL");

  // A serial is not a credential and must never be a place (decision-44 §3).
  const bySerial = await open("c0000000-0000-4000-8000-000000000016", MOUNTED_SERIAL, t0);
  assert.equal(bySerial.status, 400, "a raw serial posted as a place must be refused");

  // ---- B5 · the rate is required through every path that can write a worker ---------
  // The API branch is check-api.js's. This is the half a CHECK constraint is most often
  // assumed to cover and does not: an omitted column, which without `DROP DEFAULT` would
  // still land a zero and satisfy nothing.
  const rejects = async (label, statement, code) => {
    await assert.rejects(
      () => mig.client.query(statement),
      (err) => err.code === code,
      `${label} must raise ${code}`,
    );
  };
  await rejects("omitting hourly_rate_cents", "INSERT INTO workers (name) VALUES ('No Rate')", "23502");
  await rejects("an explicit NULL rate", "INSERT INTO workers (name, hourly_rate_cents) VALUES ('Null Rate', NULL)", "23502");
  await rejects("a rate of 0", "INSERT INTO workers (name, hourly_rate_cents) VALUES ('Zero Rate', 0)", "23514");
  await rejects("a negative rate", "INSERT INTO workers (name, hourly_rate_cents) VALUES ('Neg Rate', -1)", "23514");
  await rejects("editing a rate down to 0", `UPDATE workers SET hourly_rate_cents = 0 WHERE id = ${mig.workerId}`, "23514");
  // VALIDATED, not NOT VALID: a constraint added NOT VALID would pass every test above and
  // still leave the existing rows it was written for untouched.
  assert.equal(
    q(MIG_DB, "SELECT convalidated FROM pg_constraint WHERE conname = 'workers_rate_positive'"),
    "t",
    "workers_rate_positive must be VALIDATED against existing rows, not merely enforced going forward",
  );
  assert.equal(
    q(MIG_DB, "SELECT count(*) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'workers'::regclass AND a.attname = 'hourly_rate_cents'"),
    "0",
    "…and the DEFAULT 0 must be GONE, or an omitted column still silently pays somebody nothing",
  );
  assert.equal(q(MIG_DB, "SELECT count(*) FROM workers WHERE hourly_rate_cents <= 0"), "0");
  ok("a rate-less worker is unrepresentable: omitted 23502, NULL 23502, 0 and negative 23514, edit-to-zero 23514");

  console.log(
    "\nOK check-field-wire: the bytes the phone in Vienna actually sends still open and close a\n" +
      "shift after 006, the auto-close flag survives a replay, and the wall card outlives its zone.",
  );
} finally {
  for (const s of servers) await new Promise((r) => s.close(r));
  for (const c of clients) await c.end().catch(() => {});
  const { pool } = await import(path.join(__dirname, "..", "lib", "db.js")).catch(() => ({ pool: null }));
  if (pool) await pool.end().catch(() => {});
  for (const name of created) {
    try {
      sh("dropdb", ["--if-exists", name]);
    } catch (e) {
      console.error(`warning: could not drop ${name}`, String(e.stderr || e.message).trim());
    }
  }
}
