#!/usr/bin/env node
// THE PRE-DEPLOY CHECK FOR MIGRATION 006. Run it before touching the live box.
//
//   ssh schimmer-glanz.exe.xyz 'sudo -n cat /var/backups/nfc/nfc-<newest>.sql.gz' > /tmp/nfc.sql.gz
//   node server/db/check-prod-restore.mjs /tmp/nfc.sql.gz
//
// check-migrate.js proves 006 applies to a database WE built. This proves it applies to
// the database the CLIENT actually has, and that the API then boots on it and the card
// physically on the wall still clocks a worker in.
//
// WHY IT IS A SEPARATE FILE. It needs an artefact nobody can commit — a dump of a live
// payroll database — so it cannot join the always-on suite. Without a dump it SKIPS and
// exits 0, like every other check here; "I cannot check this here" is not "broken".
//
// IT NEVER TOUCHES PRODUCTION. Everything below happens in a throwaway local database
// that is dropped at the end. The dump is read-only input.
//
// THE FACT THIS EXISTS TO CATCH, found the first time it was run: production carries a
// leftover worker with hourly_rate_cents = 0 ('TTL Test', inactive, no history), so 006
// REFUSES there. That is the designed behaviour (decision-41 §3 — a migration does not get
// to choose somebody's wage) and the deploy has to clear it first. Discovering that on the
// box, mid-deploy, is how a migration window becomes an incident.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The uuid the owner wrote onto a blank NTAG card with NFC Tools in July, and mounted at
// the only live building. It is a BUILDING uuid, and that building has zero zones. The tag
// cannot be rewritten from Vienna, so this value is not ours to change (decision-40).
const WALL_TAG_UUID = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7";

// The Mifare Ultralight EV1 physically mounted at HOIV. It is a THIRD-PARTY tag: 46 B of
// NDEF capacity against the ~64 B our URI needs, so it holds no URL and cannot be rewritten
// from here. Its serial is the only stable handle it has (decision-44), and today it is
// resolved by a hard-coded map compiled into the APK (android/.../nfc/KnownTags.kt). That
// map is deleted only once a zone row carries the serial and the phone has seen it come
// down /roster — so "can a zone carry it, and does /roster ship it" is the gate on a
// deletion, and it is checked here against the real database rather than against the design.
const MOUNTED_SERIAL = "04:A1:A8:52:AE:5C:80";

const DB_NAME = `nfc_prodrestore_${process.pid}`;
const DATABASE_URL = `postgres:///${DB_NAME}`;
const APP_KEY = "prod-restore-check-key";

const skip = (why) => {
  console.log(`SKIP check-prod-restore: ${why}`);
  process.exit(0);
};

const dump = process.argv[2];
if (!dump) skip("no dump given — usage: node server/db/check-prod-restore.mjs <nfc-*.sql[.gz]>");
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

const ok = (m) => console.log(`  ok   ${m}`);
const psql = (sql) => sh("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql]).trim();
const migrate = () =>
  sh("node", [path.join(__dirname, "migrate.js")], { env: { ...process.env, DATABASE_URL } });

try {
  sh("createdb", [DB_NAME]);
} catch (e) {
  skip(`could not create throwaway database: ${String(e.stderr || e.message).trim()}`);
}

let server;
let db;
try {
  // ---- 1 · restore -----------------------------------------------------------------
  const sql = dump.endsWith(".gz") ? sh("gunzip", ["-c", dump]) : fs.readFileSync(dump, "utf8");
  // stdio[0] must be "pipe" for `input` to reach psql. With the default "ignore" above,
  // psql reads an EMPTY script, exits 0, and the restore silently does nothing — which then
  // surfaces three lines later as a confusing "schema_migrations does not exist".
  sh("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const applied = psql("SELECT count(*) FROM schema_migrations");
  assert.equal(applied, "5", `the dump must be at migration 005, found ${applied}`);
  ok(`restored: ${psql(
    "SELECT (SELECT count(*) FROM workers) || ' workers, ' || (SELECT count(*) FROM locations) || ' locations, ' || (SELECT count(*) FROM shifts) || ' shifts'",
  )}, 5 migrations`);

  // ---- 2 · the rate guard, against real rows ---------------------------------------
  const rateless = Number(psql("SELECT count(*) FROM workers WHERE hourly_rate_cents <= 0"));
  if (rateless > 0) {
    // THE REFUSAL IS THE FEATURE. `psql -1` aborts the file, migrate.js records nothing,
    // and the database is left byte-identical. It must never invent a wage.
    let refused = false;
    try {
      migrate();
    } catch (e) {
      refused = true;
      const message = String(e.stderr || e.message);
      assert.match(message, /have no hourly rate; refusing to invent one/, "the refusal must say WHY");
      assert.match(message, new RegExp(`${rateless} worker`), "...and must say HOW MANY");
    }
    assert.ok(refused, `${rateless} worker(s) have no rate, so 006 MUST refuse — it did not`);
    assert.equal(psql("SELECT to_regclass('public.zones') IS NULL"), "t", "a refused 006 must leave NOTHING behind");
    assert.equal(psql("SELECT count(*) FROM schema_migrations"), "5", "...and must record nothing");
    ok(`006 REFUSES: ${rateless} worker(s) have no rate, and the database is untouched`);
    console.log(psql("SELECT '       -> id ' || id || ' · ' || name || ' · rate ' || hourly_rate_cents || ' · active ' || active FROM workers WHERE hourly_rate_cents <= 0"));
    console.log("       Deal with these on the box FIRST (server/db/README.md §006), then deploy.");
    // Reproduce the ops step here so the rest of the check can run.
    psql("DELETE FROM workers WHERE hourly_rate_cents <= 0");
    ok("(the ops step applied to the SCRATCH copy so the rest of this check can run)");
  } else {
    ok("no rate-less worker on the box: 006's guard will pass");
  }

  // ---- 3 · apply, and re-apply ------------------------------------------------------
  //
  // WHAT THE BUILDING LOOKED LIKE BEFORE, read now and compared after. "006 applied" and
  // "006 applied without touching anything" are different claims, and only the second one
  // is worth making: the pin is the landing surface (decision-39), and a migration that
  // silently rounded a coordinate would move a building on a map with nothing to notice it.
  const buildingsBefore = psql(
    "SELECT string_agg(id || '|' || name || '|' || active || '|' || coalesce(lat::text,'-') || '|' || coalesce(lng::text,'-'), E'\n' ORDER BY id) FROM locations",
  );

  assert.match(migrate(), /applied 006_zones_revenue_rates\.sql/, "006 must apply");
  assert.match(migrate(), /up to date/, "and re-running must be a no-op");
  assert.equal(psql("SELECT count(*) FROM zones"), "0", "006 must invent no zone");
  assert.equal(psql("SELECT count(*) FROM location_revenue"), "0", "006 must invent no revenue row");
  assert.equal(
    psql("SELECT count(*) FROM shifts WHERE start_zone_id IS NOT NULL OR end_zone_id IS NOT NULL"),
    "0",
    "006 must backfill no zone onto any existing shift",
  );
  ok("006 applies to the real database, twice, creating ZERO rows");

  // EVERY BUILDING SURVIVES, BYTE FOR BYTE — id, name, active flag AND both coordinates.
  // HOIV is pinned at 48.1761151/16.3953038 and that pin is the whole map screen.
  assert.equal(
    psql(
      "SELECT string_agg(id || '|' || name || '|' || active || '|' || coalesce(lat::text,'-') || '|' || coalesce(lng::text,'-'), E'\n' ORDER BY id) FROM locations",
    ),
    buildingsBefore,
    "006 must leave every building exactly as it found it, coordinates included",
  );
  assert.match(
    psql(`SELECT lat || '/' || lng FROM locations WHERE id = '${WALL_TAG_UUID}'`),
    /^\d+\.\d+\/\d+\.\d+$/,
    "the wall tag's building must still carry BOTH coordinates, so its pin still draws",
  );
  ok(`every building survives with its pin: ${psql(`SELECT name || ' @ ' || lat || '/' || lng FROM locations WHERE id = '${WALL_TAG_UUID}'`)}`);

  // ---- 4 · the API boots on it, and THE CARD ON THE WALL STILL WORKS ----------------
  //
  // A migration that applies and an API that then refuses the only live tag is a failed
  // deploy that looks like a successful one. This is the half that is easy to skip and is
  // the half the client would notice.
  assert.equal(psql(`SELECT active FROM locations WHERE id = '${WALL_TAG_UUID}'`), "t", "the wall tag's building must be ACTIVE");
  assert.equal(
    psql(`SELECT count(*) FROM zones WHERE location_id = '${WALL_TAG_UUID}'`),
    "0",
    "...and must have ZERO zones, which is the whole point of the tap below",
  );

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.APP_KEY = APP_KEY;
  process.env.PORT = "0";

  db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  // A worker with a REAL rate, because 006 makes any other kind unrepresentable. The raw
  // cookie is 64 hex characters and the ROW stores only its SHA-256 (lib/auth.js), so this
  // fixture cannot become a replayable credential even if it leaked.
  const workerId = Number(
    (await db.query("INSERT INTO workers (name, hourly_rate_cents) VALUES ('Restore Check', 1500) RETURNING id")).rows[0].id,
  );
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO worker_sessions (token, worker_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [createHash("sha256").update(token, "utf8").digest("hex"), workerId],
  );

  const { createServer, assertEnv } = await import(path.join(__dirname, "..", "server.js"));
  assertEnv();
  server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, opts = {}) =>
    fetch(base + p, {
      method: opts.method ?? "GET",
      headers: {
        "X-App-Key": APP_KEY,
        Cookie: `ts_worker=${token}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  ok("the API booted against the restored, migrated production database");

  assert.equal((await call("/health")).status, 200);

  const roster = await (await call("/roster")).json();
  assert.ok(
    roster.locations.some((l) => l.id === WALL_TAG_UUID),
    "GET /roster must still serve the building the card names",
  );
  assert.ok(Array.isArray(roster.zones), "and zones[] must be present even when it is empty");
  ok("GET /roster serves the live building; zones[] is additive and empty");

  // *** THE TAP THAT MATTERS. The SHIPPED APK's exact request shape, with the uuid off the
  // card on the wall, against a building that has no zones at all. If this ever answers
  // 422 the tag is dead and no site visit fixes it. ***
  const clientUuid = "11111111-2222-4333-8444-555555559001";
  const opened = await call("/shifts/open", {
    method: "POST",
    body: { client_uuid: clientUuid, location_uuid: WALL_TAG_UUID, start_time: new Date().toISOString() },
  });
  const body = await opened.json();
  assert.equal(opened.status, 201, `the wall card must clock a worker in: ${JSON.stringify(body)}`);
  assert.equal(body.shift.location_id, WALL_TAG_UUID);
  assert.equal(body.shift.start_zone_id, null, "a building tag records NO zone, and must not invent one");
  ok("POST /shifts/open with the WALL CARD's uuid -> 201, start_zone_id null");

  // And the shipped build's close: client_uuid + end_time, no place named.
  const closed = await call("/shifts/close", {
    method: "POST",
    body: { client_uuid: clientUuid, end_time: new Date(Date.now() + 60_000).toISOString() },
  });
  assert.equal(closed.status, 200, "the shipped build's close shape must still work");
  ok("POST /shifts/close in the SHIPPED build's shape -> 200");

  // ---- 5 · THE MOUNTED EV1 SERIAL, END TO END ON THE REAL DATABASE ------------------
  //
  // Everything above proves the BUILDING uuid still resolves. This proves the OTHER tag on
  // the same wall can be adopted: the serial goes into a zone row, comes back down /roster,
  // is matched by the phone's own pure resolver, and the resolved place opens a shift.
  //
  // WHY IT IS HERE and not in check-api.js: check-api builds its own schema from a
  // hand-written DDL copy, so it can prove the ROUTE. Only this file can prove the
  // constraint accepts this exact string in the database the client actually has — and
  // `zones.tag_serial ~ '^[0-9A-F]{2}(:[0-9A-F]{2})+$'` is a regex somebody could tighten
  // without ever typing the serial that is screwed to a wall in Vienna.
  //
  // WRITTEN AND THEN REMOVED. This is a throwaway scratch database, but the assertions
  // below have to hold for a database with ZERO zones (which is what production is), so the
  // zone is deleted again before the check ends rather than left to colour later runs.
  psql(
    `INSERT INTO zones (location_id, name, note, tag_serial) VALUES ('${WALL_TAG_UUID}', 'Stiege 1', 'Fremdtag am Eingang', '${MOUNTED_SERIAL}')`,
  );
  const zoneId = psql(`SELECT id FROM zones WHERE tag_serial = '${MOUNTED_SERIAL}'`);
  assert.match(zoneId, /^[0-9a-f-]{36}$/, "the mounted serial must be storable on a zone at all");

  const zoned = await (await call("/roster")).json();
  const shipped = zoned.zones.find((z) => z.id === zoneId);
  assert.ok(shipped, "GET /roster must SHIP the zone — there is no other route a serial arrives on");
  assert.equal(shipped.tag_serial, MOUNTED_SERIAL, "...carrying the serial verbatim, in the shape the phone normalises");
  assert.equal(shipped.location_id, WALL_TAG_UUID, "...and naming its building, which is what a tap is billed to");

  // THE PHONE'S OWN RESOLVER, RE-DERIVED HERE. `core/Zones.kt` is Kotlin and is proven on a
  // JVM by android/checks; what CANNOT be proven there is that its input arrives. This is
  // the same two rules against the real wire bytes: normalise both sides, match, and post
  // the ZONE's id — never the building's, and never the serial (decision-44 §3).
  const normalise = (s) => (s ?? "").toUpperCase().replace(/[^0-9A-F]/g, "").match(/../g)?.join(":") ?? null;
  for (const asRead of [MOUNTED_SERIAL, "04a1a852ae5c80", "04-A1-A8-52-AE-5C-80", " 04:a1:A8:52:ae:5C:80 "]) {
    const hit = zoned.zones.find((z) => normalise(z.tag_serial) === normalise(asRead));
    assert.equal(hit?.id, zoneId, `a reader printing the serial as "${asRead}" must still resolve it`);
  }
  ok(`the mounted EV1 serial resolves through /roster to zone ${zoneId} (4 reader spellings)`);

  // ...and the resolved ZONE id opens a shift that is still billed to the BUILDING. This is
  // decision-43's whole shape in one request: a zone is a place, never a costing unit.
  const zoneClientUuid = "11111111-2222-4333-8444-555555559002";
  const zoneOpen = await call("/shifts/open", {
    method: "POST",
    body: { client_uuid: zoneClientUuid, location_uuid: zoneId, start_time: new Date().toISOString() },
  });
  const zoneBody = await zoneOpen.json();
  assert.equal(zoneOpen.status, 201, `the mounted serial's zone must clock a worker in: ${JSON.stringify(zoneBody)}`);
  assert.equal(zoneBody.shift.location_id, WALL_TAG_UUID, "a zone tap is billed to the BUILDING, never to the zone");
  assert.equal(zoneBody.shift.start_zone_id, zoneId, "...and the door that was tapped is recorded as a tap FACT");
  ok("POST /shifts/open with the RESOLVED zone id -> 201, billed to the building, start_zone_id set");

  const zoneClosed = await call("/shifts/close", {
    method: "POST",
    body: { client_uuid: zoneClientUuid, end_time: new Date(Date.now() + 60_000).toISOString() },
  });
  assert.equal(zoneClosed.status, 200, "and it closes in the shipped build's shape too");

  // THE SERIAL NEVER REACHES THE SERVER. Asserted, not assumed: if any route ever started
  // accepting one, the adoption model's security argument (decision-44 §3 — a serial is
  // broadcast in the clear and is clonable) would be silently gone.
  const bySerial = await call("/shifts/open", {
    method: "POST",
    body: { client_uuid: "11111111-2222-4333-8444-555555559003", location_uuid: MOUNTED_SERIAL, start_time: new Date().toISOString() },
  });
  assert.equal(bySerial.status, 400, "a raw SERIAL must never be accepted as a place — it is not a credential");
  ok("a raw serial posted as a place is refused: the phone resolves, the server never sees it");

  psql("DELETE FROM shifts WHERE start_zone_id IS NOT NULL");
  psql(`DELETE FROM zones WHERE tag_serial = '${MOUNTED_SERIAL}'`);
  assert.equal(psql("SELECT count(*) FROM zones"), "0", "the scratch zone must not outlive this check");

  console.log(
    "\nOK check-prod-restore: 006 applies to the real database, the API boots on it, and the\n" +
      "card on the wall at HOIV still clocks a worker in.",
  );
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.end().catch(() => {});
  const { pool } = await import(path.join(__dirname, "..", "lib", "db.js")).catch(() => ({ pool: null }));
  if (pool) await pool.end().catch(() => {});
  try {
    sh("dropdb", ["--if-exists", DB_NAME]);
  } catch (e) {
    console.error(`warning: could not drop ${DB_NAME}`, String(e.stderr || e.message).trim());
  }
}
