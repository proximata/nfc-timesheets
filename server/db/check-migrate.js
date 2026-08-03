#!/usr/bin/env node
// Runnable check for migrate.js. No test framework — node:assert only.
//
//   node server/db/check-migrate.js
//
// Creates a throwaway database, migrates it TWICE, asserts the second run is a
// no-op, spot-checks that the schema actually landed, then drops the database.
//
// If no Postgres is reachable (CI without a DB, fresh laptop) it prints why and
// exits 0. A missing database is "cannot check here", not "broken".
//
// Connects to the local default: unix socket, PG* env vars honoured by libpq.
// Override the server with PGHOST / PGPORT / PGUSER as usual.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const skip = (why) => {
  console.log(`SKIP check-migrate: ${why}`);
  process.exit(0);
};

const run = (cmd, args, env) =>
  execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });

for (const bin of ["psql", "createdb", "dropdb"]) {
  try {
    run(bin, ["--version"]);
  } catch {
    skip(`\`${bin}\` not on PATH — install the Postgres client tools`);
  }
}

try {
  run("pg_isready", []);
} catch {
  skip("no Postgres server reachable (pg_isready failed)");
}

const DB_NAME = `timesheets_migcheck_${process.pid}`;
const DATABASE_URL = `postgres:///${DB_NAME}`;
const MIGRATE = path.join(__dirname, "migrate.js");

// Second throwaway database: proves the newest migrations apply to a box that is already
// at 002 AND HAS LIVE DATA IN IT. 001-003 are applied in production, so "the whole file
// set builds a fresh database" is not the property that matters any more.
const LIVE_DB_NAME = `timesheets_livecheck_${process.pid}`;
const LIVE_URL = `postgres:///${LIVE_DB_NAME}`;

try {
  run("createdb", [DB_NAME]);
} catch (e) {
  skip(`could not create throwaway database ${DB_NAME}: ${String(e.stderr || e.message).trim()}`);
}

const query = (sql) =>
  run("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql]).trim();

try {
  // --- run 1: applies everything --------------------------------------------
  const first = run("node", [MIGRATE], { DATABASE_URL });
  assert.match(first, /applied 001_init\.sql/, "first run must apply 001_init.sql");
  assert.match(first, /migration\(s\) applied/, "first run must report a nonzero apply count");

  const fileCount = Number(query("SELECT count(*) FROM schema_migrations;"));
  assert.ok(fileCount > 0, "schema_migrations must record the applied files");

  // --- schema spot-checks ----------------------------------------------------
  assert.equal(query("SELECT to_regclass('public.workers') IS NOT NULL;"), "t", "workers table missing");
  assert.equal(query("SELECT to_regclass('public.locations') IS NOT NULL;"), "t", "locations table missing");
  assert.equal(query("SELECT to_regclass('public.shifts') IS NOT NULL;"), "t", "shifts table missing");
  // decision-20: password auth replaced the admin PIN.
  assert.equal(query("SELECT to_regclass('public.admins') IS NOT NULL;"), "t", "admins table missing");
  assert.equal(query("SELECT to_regclass('public.sessions') IS NOT NULL;"), "t", "sessions table missing");

  // the indexes the API and the 8h timer depend on
  for (const idx of [
    "shifts_worker_id_idx",
    "shifts_location_id_idx",
    "shifts_open_idx",
    "shifts_one_open_per_worker_idx",
    "sessions_expires_at_idx",
  ]) {
    assert.equal(query(`SELECT to_regclass('public.${idx}') IS NOT NULL;`), "t", `index ${idx} missing`);
  }
  for (const idx of ["shifts_open_idx", "shifts_one_open_per_worker_idx"]) {
    assert.equal(
      query(`SELECT indpred IS NOT NULL FROM pg_index WHERE indexrelid = 'public.${idx}'::regclass;`),
      "t",
      `${idx} must be a PARTIAL index (it must say nothing about closed shifts)`,
    );
  }
  // the overlap guard is only a guard if it is UNIQUE (decision-19: double-punch).
  assert.equal(
    query(
      "SELECT indisunique FROM pg_index WHERE indexrelid = 'public.shifts_one_open_per_worker_idx'::regclass;",
    ),
    "t",
    "shifts_one_open_per_worker_idx must be UNIQUE or it guards nothing",
  );

  // decision-21: the tag URI carries locations.id, so it must be a UUID, not a
  // guessable serial. slug survives as the human-readable column.
  assert.equal(
    query("SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.locations'::regclass AND attname = 'id';"),
    "uuid",
    "locations.id must be UUID (decision-21)",
  );
  assert.equal(
    query("SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.shifts'::regclass AND attname = 'location_id';"),
    "uuid",
    "shifts.location_id must be UUID (FK to locations.id)",
  );

  // decision-10: two independent facts. The old single manual_finish column could
  // not tell "the 8h timer closed it" from "a human resolved it" and is gone.
  assert.equal(
    query("SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.shifts'::regclass AND attname = 'auto_closed' AND NOT attisdropped;"),
    "1",
    "shifts.auto_closed missing (decision-10)",
  );
  assert.equal(
    query("SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.shifts'::regclass AND attname = 'corrected_at' AND NOT attisdropped;"),
    "1",
    "shifts.corrected_at missing (decision-10)",
  );
  assert.equal(
    query("SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.shifts'::regclass AND attname IN ('manual_finish', 'needs_correction') AND NOT attisdropped;"),
    "0",
    "manual_finish/needs_correction must be gone — auto_closed + corrected_at replace them",
  );

  // client_uuid idempotency key must actually be unique
  assert.equal(
    query(`SELECT count(*) FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
           WHERE c.conrelid = 'public.shifts'::regclass AND c.contype = 'u' AND a.attname = 'client_uuid';`),
    "1",
    "shifts.client_uuid must carry a UNIQUE constraint (POST /shifts/open + /shifts/close idempotency)",
  );

  // --- run 2: must be a no-op ------------------------------------------------
  const second = run("node", [MIGRATE], { DATABASE_URL });
  assert.match(second, /up to date/, "second run must report 'up to date'");
  assert.doesNotMatch(second, /applied /, "second run must not re-apply anything");
  assert.equal(
    Number(query("SELECT count(*) FROM schema_migrations;")),
    fileCount,
    "second run must not add schema_migrations rows",
  );

  // --- seed.sql is idempotent too -------------------------------------------
  const seed = path.join(__dirname, "seed.sql");
  run("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", seed]);
  const afterFirstSeed = query("SELECT count(*) FROM workers;") + "/" + query("SELECT count(*) FROM locations;");
  run("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", seed]);
  const afterSecondSeed = query("SELECT count(*) FROM workers;") + "/" + query("SELECT count(*) FROM locations;");
  assert.equal(afterSecondSeed, afterFirstSeed, "seed.sql must be idempotent");
  assert.equal(afterFirstSeed, "3/3", "seed.sql must create 3 workers and 3 locations");

  // --- 004 spot-checks: enrolment codes (decision-26) ------------------------
  // Columns on workers, NOT a codes table: one worker, one live code, replacement is an
  // UPDATE. A second table would allow two live codes for one person.
  assert.equal(
    query("SELECT count(*) FROM pg_class WHERE relname IN ('enrolment_codes', 'enrollment_codes');"),
    "0",
    "enrolment codes must live on workers — a table would allow two live codes per person",
  );
  for (const col of [
    "enrolment_code_hash",
    "enrolment_code_expires_at",
    "enrolment_code_issued_at",
    "enrolment_code_issued_by",
    "enrolment_code_redeemed_at",
  ]) {
    assert.equal(
      query(
        `SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.workers'::regclass AND attname = '${col}' AND NOT attisdropped;`,
      ),
      "1",
      `workers.${col} missing (decision-26)`,
    );
    // NULLable is what makes 004 applicable over the live rows that predate it.
    assert.equal(
      query(
        `SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.workers'::regclass AND attname = '${col}';`,
      ),
      "f",
      `workers.${col} must be NULLable — rows that predate the column cannot supply a value`,
    );
  }
  // A code that could name two workers is an ambiguous credential.
  assert.equal(
    query(`SELECT count(*) FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
           WHERE c.conrelid = 'public.workers'::regclass AND c.contype = 'u' AND a.attname = 'enrolment_code_hash';`),
    "1",
    "workers.enrolment_code_hash must be UNIQUE — one code must never name two workers",
  );
  // A hash with no expiry is a permanent bearer credential. decision-26 made expiry part
  // of the feature, so the database refuses the state rather than trusting the route.
  assert.equal(
    query(
      "SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.workers'::regclass AND conname = 'workers_enrolment_code_pair';",
    ),
    "1",
    "workers_enrolment_code_pair CHECK missing — an enrolment code must always carry an expiry",
  );
  query(
    "INSERT INTO workers (name, enrolment_code_hash, enrolment_code_expires_at) VALUES ('Coded', 'deadbeef', now() + interval '1 hour');",
  );
  assert.throws(
    () => query("UPDATE workers SET enrolment_code_expires_at = NULL WHERE name = 'Coded';"),
    /workers_enrolment_code_pair/,
    "the CHECK must actually reject a code with no expiry",
  );
  query("DELETE FROM workers WHERE name = 'Coded';");

  // --- 003 spot-checks: the director's vocabulary ----------------------------
  for (const table of ["clients", "contacts", "inventory_items", "portal_grants"]) {
    assert.equal(query(`SELECT to_regclass('public.${table}') IS NOT NULL;`), "t", `${table} table missing`);
  }

  // --- 005 spot-checks: material requests, contract history, settings --------
  for (const table of ["material_requests", "location_contracts", "app_settings"]) {
    assert.equal(query(`SELECT to_regclass('public.${table}') IS NOT NULL;`), "t", `${table} table missing`);
  }

  // NO DEFAULT BASELINE ROW. With `pl_margin_baseline_bp` absent the P&L flags nothing and
  // says so; a seeded 15% would be this schema having an opinion about a Viennese cleaning
  // company's margins. If a future migration seeds one, this fails and asks why.
  assert.equal(query("SELECT count(*) FROM app_settings;"), "0", "app_settings must ship EMPTY");

  // At most one CURRENT contract per building, enforced by the database. Two would make
  // "the price today" have two answers and the P&L would count both.
  assert.equal(
    query(
      "SELECT indisunique AND indpred IS NOT NULL FROM pg_index WHERE indexrelid = 'public.location_contracts_one_current_idx'::regclass;",
    ),
    "t",
    "location_contracts_one_current_idx must be a PARTIAL UNIQUE index",
  );

  // Money in integer cents on the new tables too. A NUMERIC or a float here is a P&L that
  // disagrees with itself.
  for (const [table, column] of [
    ["location_contracts", "monthly_contract_cents"],
    ["location_contracts", "target_minutes_per_month"],
    ["material_requests", "cost_cents"],
    ["material_requests", "quantity"],
  ]) {
    assert.equal(
      query(
        `SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.${table}'::regclass AND attname = '${column}';`,
      ),
      "integer",
      `${table}.${column} must be INTEGER (cents/minutes/counts, never a float)`,
    );
  }

  // Contract validity is a CALENDAR DATE, not an instant. A timestamptz here would put a
  // price change an hour either side of midnight and move it between months twice a year.
  for (const column of ["valid_from", "valid_to"]) {
    assert.equal(
      query(
        `SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.location_contracts'::regclass AND attname = '${column}';`,
      ),
      "date",
      `location_contracts.${column} must be DATE`,
    );
  }

  // A zero-length period is legal (entered and cleared the same day); an inverted one is
  // not, and would make revenue for those days negative or double-counted.
  query(
    "INSERT INTO location_contracts (location_id, monthly_contract_cents, valid_from, valid_to) " +
      "SELECT id, 1000, DATE '2025-01-01', DATE '2025-01-01' FROM locations LIMIT 1;",
  );
  assert.throws(
    () =>
      query(
        "INSERT INTO location_contracts (location_id, monthly_contract_cents, valid_from, valid_to) " +
          "SELECT id, 1000, DATE '2025-02-01', DATE '2025-01-01' FROM locations LIMIT 1;",
      ),
    /location_contracts_period/,
    "a contract that ends before it starts must be refused by the database",
  );
  query("DELETE FROM location_contracts;");

  // The lifecycle is a closed set. A free-text status would let a panel bug invent one
  // that no report knows how to treat.
  assert.equal(
    query(
      "SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.material_requests'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%';",
    ),
    "1",
    "material_requests.status must be CHECK-constrained to the five lifecycle states",
  );

  // Money as INTEGER cents, time as INTEGER minutes. A float or a numeric here means a
  // profitability report that disagrees with itself.
  for (const [table, column] of [
    ["locations", "monthly_contract_cents"],
    ["locations", "target_minutes_per_month"],
    ["inventory_items", "unit_cost_cents"],
  ]) {
    assert.equal(
      query(
        `SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.${table}'::regclass AND attname = '${column}';`,
      ),
      "integer",
      `${table}.${column} must be INTEGER (cents/minutes, never a float)`,
    );
  }

  // One live portal link per (contact, building), enforced by the database, so "Get link"
  // can stay a single button that always means the same thing.
  assert.equal(
    query(
      "SELECT indisunique AND indpred IS NOT NULL FROM pg_index WHERE indexrelid = 'public.portal_grants_one_live_idx'::regclass;",
    ),
    "t",
    "portal_grants_one_live_idx must be a PARTIAL UNIQUE index",
  );

  // products and equipment share ONE table (one admin screen), separated by a label.
  assert.equal(
    query(
      "SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.inventory_items'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%';",
    ),
    "1",
    "inventory_items.kind must be CHECK-constrained to product/equipment",
  );
  assert.equal(
    query("SELECT count(*) FROM pg_class WHERE relname IN ('products', 'equipment');"),
    "0",
    "products/equipment must NOT be separate tables — that would be two admin screens",
  );

  // --- 003 + 004 on top of an ALREADY MIGRATED database that holds real rows -
  try {
    run("createdb", [LIVE_DB_NAME]);
  } catch (e) {
    skip(`could not create throwaway database ${LIVE_DB_NAME}: ${String(e.stderr || e.message).trim()}`);
  }
  const liveQuery = (sql) =>
    run("psql", [LIVE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql]).trim();
  const apply = (file) =>
    run("psql", [LIVE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-1", "-f", path.join(__dirname, "migrations", file)]);

  apply("001_init.sql");
  apply("002_worker_identity.sql");
  // A worker, a building, one CLOSED shift and one OPEN one: the state the live box is in.
  liveQuery(`INSERT INTO workers (name, hourly_rate_cents) VALUES ('Live Worker', 1500);
    INSERT INTO locations (slug, name) VALUES ('livehaus', 'Livehaus');
    INSERT INTO shifts (worker_id, location_id, start_time, end_time, client_uuid)
      SELECT w.id, l.id, now() - interval '5 hours', now() - interval '3 hours', 'live-closed' FROM workers w, locations l;
    INSERT INTO shifts (worker_id, location_id, start_time, client_uuid)
      SELECT w.id, l.id, now() - interval '1 hour', 'live-open' FROM workers w, locations l;`);

  // THE ASSERTION THAT MATTERS: a migration demanding values for rows that predate its
  // columns cannot run. This must not throw.
  apply("003_clients_contracts_inventory.sql");
  apply("004_worker_enrolment_codes.sql");

  // The live box's actual shape before 005: one building WITH a contract figure typed into
  // the buildings form, and one WITHOUT. 005 has to backfill the first into contract
  // history and leave the second alone — inventing a EUR 0 contract for an unpriced
  // building would turn "nobody has told me" into "100% loss" on the P&L.
  liveQuery(`INSERT INTO clients (name) VALUES ('Live Client');
    INSERT INTO locations (slug, name, monthly_contract_cents, target_minutes_per_month, client_id, created_at)
      SELECT 'pricedhaus', 'Pricedhaus', 250000, 900, c.id, TIMESTAMPTZ '2025-06-15 04:00:00+02' FROM clients c;`);

  apply("005_v2_features.sql");

  assert.equal(
    liveQuery("SELECT count(*) FROM location_contracts;"),
    "1",
    "005 must backfill exactly the buildings that already carry a price",
  );
  assert.equal(
    liveQuery(
      "SELECT monthly_contract_cents || '/' || target_minutes_per_month || '/' || valid_from || '/' || coalesce(valid_to::text, 'current') FROM location_contracts;",
    ),
    "250000/900/2025-06-15/current",
    "the backfilled row must carry the figures and open on the building's VIENNA creation date",
  );
  assert.equal(
    liveQuery("SELECT count(*) FROM locations WHERE lat IS NULL AND geocoded_at IS NULL AND street_view_status IS NULL;"),
    "2",
    "geocoding columns must arrive NULLable — a live building cannot supply them",
  );
  // Re-running the backfill — a hand-applied fix, or a restored dump being caught up —
  // must not double the history. The statement is EXTRACTED FROM THE MIGRATION rather than
  // retyped here, so this cannot pass against a copy that has drifted from the real one.
  const backfill = /INSERT INTO location_contracts[\s\S]*?;/.exec(
    fs.readFileSync(path.join(__dirname, "migrations", "005_v2_features.sql"), "utf8"),
  );
  assert.ok(backfill, "005 must contain a location_contracts backfill");
  liveQuery(backfill[0]);
  assert.equal(liveQuery("SELECT count(*) FROM location_contracts;"), "1", "the backfill must be idempotent");

  assert.equal(liveQuery("SELECT count(*) FROM shifts;"), "2", "003 must not disturb existing shifts");
  // The live box has a worker enrolled via Sign in with Apple and no code. 004 must not
  // make that row invalid, or the one person using the product stops being able to work.
  assert.equal(
    liveQuery(
      "SELECT count(*) FROM workers WHERE enrolment_code_hash IS NULL AND enrolment_code_expires_at IS NULL;",
    ),
    "1",
    "a worker that predates enrolment codes must survive 004 with no code present",
  );
  assert.equal(
    liveQuery(
      "SELECT count(*) FROM locations WHERE client_id IS NULL AND monthly_contract_cents IS NULL AND target_minutes_per_month IS NULL;",
    ),
    "1",
    "a building that predates the contract columns must survive with them NULL",
  );
  assert.equal(
    liveQuery("SELECT count(*) FROM workers WHERE phone IS NULL;"),
    "1",
    "workers.phone must be added NULLable",
  );
  assert.equal(liveQuery("SELECT count(*) FROM shifts WHERE end_time IS NULL;"), "1", "the open shift must survive");

  console.log(
    "OK check-migrate: migrations apply once, re-run is a no-op, seed is idempotent, " +
      "003+004+005 apply on top of 001+002 with live data, and 005's contract backfill is idempotent",
  );
} finally {
  for (const db of [DB_NAME, LIVE_DB_NAME]) {
    try {
      run("dropdb", ["--if-exists", db]);
    } catch (e) {
      console.error(`warning: could not drop throwaway database ${db}`, String(e.stderr || e.message).trim());
    }
  }
}
