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
// Already-installed dependency (the API's own client, `pg` + `@sentry/node` is the whole
// budget) — needed for exactly one thing below: proving a concurrent-write race is
// actually BLOCKED on a row lock, which `psql -c` (autocommit, one statement per process)
// cannot hold open long enough to demonstrate.
import pg from "pg";

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
  // hourly_rate_cents is supplied because 006 dropped its DEFAULT (decision-41): a fixture
  // that omits the column now raises 23502, which is the whole point of dropping it.
  query(
    "INSERT INTO workers (name, hourly_rate_cents, enrolment_code_hash, enrolment_code_expires_at) VALUES ('Coded', 1500, 'deadbeef', now() + interval '1 hour');",
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

  // --- 006 spot-checks: zones, typed revenue, a rate that cannot be zero ----
  //
  // decision-41 · THE RATE. 001 shipped `hourly_rate_cents INTEGER NOT NULL DEFAULT 0`,
  // so a worker created without a rate silently cost EUR 0,00/h. Two halves fix it and
  // BOTH are asserted, because each one alone still lets a zero through:
  //   DROP DEFAULT   an INSERT that OMITS the column now raises 23502 at the mistake
  //   CHECK (> 0)    an INSERT that says 0 out loud raises 23514
  assert.equal(
    query(
      "SELECT count(*) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'public.workers'::regclass AND a.attname = 'hourly_rate_cents';",
    ),
    "0",
    "workers.hourly_rate_cents must have NO DEFAULT — a DEFAULT 0 lands a zero wage on every INSERT that omits it",
  );
  assert.throws(
    () => query("INSERT INTO workers (name) VALUES ('No Rate At All');"),
    /null value in column "hourly_rate_cents"|not-null/i,
    "omitting the rate must raise 23502, not silently default to 0",
  );
  assert.throws(
    () => query("INSERT INTO workers (name, hourly_rate_cents) VALUES ('Zero Rate', 0);"),
    /workers_rate_positive/,
    "a rate of 0 must be unrepresentable — a wage has no 'free of charge' reading (decision-41)",
  );
  query("INSERT INTO workers (name, hourly_rate_cents) VALUES ('Real Rate', 1500);");
  query("DELETE FROM workers WHERE name = 'Real Rate';");

  // decision-42 · REVENUE. A month is a Vienna CALENDAR month, always the 1st. A figure
  // filed against the 15th would be a payment for half a month that nobody agreed to, and
  // the partial unique index below would then admit two live rows for one month.
  assert.equal(query("SELECT to_regclass('public.location_revenue') IS NOT NULL;"), "t", "location_revenue missing");
  assert.equal(
    query(
      "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.location_revenue'::regclass AND attname = 'amount_cents';",
    ),
    "integer",
    "location_revenue.amount_cents must be INTEGER cents, never a float",
  );
  assert.equal(
    query(
      "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.location_revenue'::regclass AND attname = 'month';",
    ),
    "date",
    "location_revenue.month must be DATE — a timestamptz would move a month across midnight twice a year",
  );
  assert.throws(
    () =>
      query(
        "INSERT INTO location_revenue (location_id, month, amount_cents) SELECT id, DATE '2026-09-15', 100000 FROM locations LIMIT 1;",
      ),
    /location_revenue_month_start/,
    "a revenue row dated mid-month must be refused by the database",
  );
  query(
    "INSERT INTO location_revenue (location_id, month, amount_cents) SELECT id, DATE '2026-09-01', 100000 FROM locations ORDER BY slug LIMIT 1;",
  );
  // 0 is EXPRESSIBLE and means "they paid nothing this month". Row-absence is the unknown.
  query(
    "INSERT INTO location_revenue (location_id, month, amount_cents) SELECT id, DATE '2026-10-01', 0 FROM locations ORDER BY slug LIMIT 1;",
  );
  // APPEND-ONLY: at most one row IN FORCE per (building, month). A second live row would
  // make "what did they pay in September" have two answers inside one report.
  assert.equal(
    query(
      "SELECT indisunique AND indpred IS NOT NULL FROM pg_index WHERE indexrelid = 'public.location_revenue_one_live_idx'::regclass;",
    ),
    "t",
    "location_revenue_one_live_idx must be a PARTIAL UNIQUE index",
  );
  assert.throws(
    () =>
      query(
        "INSERT INTO location_revenue (location_id, month, amount_cents) SELECT id, DATE '2026-09-01', 90000 FROM locations ORDER BY slug LIMIT 1;",
      ),
    /location_revenue_one_live_idx/,
    "two live figures for one building-month must be impossible",
  );
  // ...and superseding the first one is what makes a correction legal.
  query("UPDATE location_revenue SET superseded_at = now() WHERE month = DATE '2026-09-01';");
  query(
    "INSERT INTO location_revenue (location_id, month, amount_cents) SELECT id, DATE '2026-09-01', 90000 FROM locations ORDER BY slug LIMIT 1;",
  );
  assert.equal(
    query("SELECT count(*) FROM location_revenue WHERE month = DATE '2026-09-01';"),
    "2",
    "a correction must KEEP the superseded figure — money that changes invisibly is an opinion",
  );
  query("DELETE FROM location_revenue;");
  // NO BACKFILL. 005 backfilled contracts from locations; 006 must NOT do the equivalent
  // for revenue, because a contract is what was AGREED and copying it in asserts a payment.
  assert.equal(
    query("SELECT count(*) FROM location_revenue;"),
    "0",
    "006 must create ZERO revenue rows — a contract figure is not a payment",
  );

  // decision-43 · ZONES. Zero rows created, and the area is NULLable on purpose: a zone
  // nobody has measured is real, and a required area would be an invented one poisoning
  // the EUR/m2 benchmark that is the only reason the column exists.
  assert.equal(query("SELECT to_regclass('public.zones') IS NOT NULL;"), "t", "zones table missing");
  assert.equal(query("SELECT count(*) FROM zones;"), "0", "006 must create ZERO zones — no default zone, ever");
  assert.equal(
    query(
      "SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.zones'::regclass AND attname = 'area_sqm';",
    ),
    "f",
    "zones.area_sqm must be NULLable — 'nobody has measured it' is a real, permanent state",
  );
  assert.equal(
    query(
      "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.zones'::regclass AND attname = 'area_sqm';",
    ),
    "numeric(8,2)",
    "zones.area_sqm must be NUMERIC — it is the DENOMINATOR of a EUR/m2 figure, so no float",
  );
  // THE BUILDING STORES NO AREA. A stored total drifts the first time a zone is resized.
  assert.equal(
    query(
      "SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.locations'::regclass AND attname IN ('area_sqm', 'square_metres', 'total_area_sqm') AND NOT attisdropped;",
    ),
    "0",
    "locations must NOT store an area — it is SUM(zones.area_sqm), derived at read time",
  );
  // decision-44: one adopted serial can only ever mean one place.
  assert.equal(
    query(
      "SELECT indisunique AND indpred IS NOT NULL FROM pg_index WHERE indexrelid = 'public.zones_tag_serial_idx'::regclass;",
    ),
    "t",
    "zones_tag_serial_idx must be a PARTIAL UNIQUE index — two zones must never claim one serial",
  );
  assert.throws(
    () => query("INSERT INTO zones (location_id, name, tag_serial) SELECT id, 'Bad Serial', '04-a1-a8' FROM locations LIMIT 1;"),
    /zones_tag_serial/,
    "a serial that is not uppercase colon-separated hex must be refused (the form KnownTags produces)",
  );

  // THE COMPOSITE FK, and it is the whole reason (id, location_id) is UNIQUE on zones:
  // the DATABASE makes it impossible for a shift to name another building's zone. Without
  // it a mis-typed patch attributes a tap at Neuhaus to a stairwell in Arsenalstraße.
  query(`INSERT INTO zones (location_id, name, area_sqm)
           SELECT id, 'Stiege A', 120.50 FROM locations ORDER BY slug LIMIT 1;
         INSERT INTO zones (location_id, name)
           SELECT id, 'Stiege B' FROM locations ORDER BY slug OFFSET 1 LIMIT 1;`);
  assert.throws(
    () => query(`INSERT INTO shifts (worker_id, location_id, start_time, end_time, start_zone_id)
                 SELECT w.id, l.id, now() - interval '2 hours', now() - interval '1 hour', z.id
                   FROM workers w, locations l, zones z
                  WHERE w.name = 'Anna Müller' AND l.slug = (SELECT slug FROM locations ORDER BY slug LIMIT 1)
                    AND z.name = 'Stiege B' LIMIT 1;`),
    /shifts_start_zone_fk/,
    "a shift must never be able to name a zone of a DIFFERENT building",
  );
  query(`INSERT INTO shifts (worker_id, location_id, start_time, end_time, start_zone_id)
         SELECT w.id, l.id, now() - interval '2 hours', now() - interval '1 hour', z.id
           FROM workers w, locations l, zones z
          WHERE w.name = 'Anna Müller' AND l.id = z.location_id AND z.name = 'Stiege A' LIMIT 1;`);
  assert.equal(
    query("SELECT count(*) FROM shifts WHERE start_zone_id IS NOT NULL;"),
    "1",
    "a shift naming a zone of its OWN building must be accepted",
  );
  // A building-level tap keeps working, for ever: NULL means "a building tag was tapped,
  // or this predates zones". It is not a missing value to be backfilled.
  query(`INSERT INTO shifts (worker_id, location_id, start_time, end_time)
         SELECT w.id, l.id, now() - interval '5 hours', now() - interval '4 hours'
           FROM workers w, locations l WHERE w.name = 'Ivan Horvat' ORDER BY l.slug LIMIT 1;`);
  assert.equal(
    query("SELECT count(*) FROM shifts WHERE start_zone_id IS NULL AND end_zone_id IS NULL;"),
    "1",
    "a building-level shift with no zone at all must remain legal",
  );
  query("DELETE FROM shifts; DELETE FROM zones;");

  // --- 007 spot-checks: operator identity, and the registry that makes a phone unique
  // across two kinds of person (decision-45) — TASK-211 AC#1-4 ------------------------
  //
  // AC#1 (table existence half; the workers/admins byte-identical half is proven properly
  // in the LIVE_DB_NAME section below, where migrations apply one at a time and a real
  // before/after schema snapshot is possible).
  for (const table of ["operators", "phone_identities", "operator_sessions"]) {
    assert.equal(
      query(`SELECT to_regclass('public.${table}') IS NOT NULL;`),
      "t",
      `${table} table missing (decision-45)`,
    );
  }
  assert.equal(query("SELECT count(*) FROM operators;"), "0", "007 must invent no operator — same convention as 006's zones");

  // AC#2 · phone_identities.phone_e164 CHECK enforces E.164 shape AT THE DATABASE, not
  // merely the API — paired with a PASSING insert so this cannot pass by the column
  // simply not existing.
  query("INSERT INTO operators (name) VALUES ('Feldleiter Eins');");
  const feldleiterId = query("SELECT id FROM operators WHERE name = 'Feldleiter Eins';");
  query(`INSERT INTO phone_identities (phone_e164, operator_id) VALUES ('+436641234567', ${feldleiterId});`);
  assert.throws(
    () =>
      query(
        "INSERT INTO phone_identities (phone_e164, worker_id) VALUES ('+0664123456', (SELECT id FROM workers ORDER BY id LIMIT 1));",
      ),
    /phone_identities_phone_e164_check/,
    "a leading 0 immediately after '+' must be refused by the CHECK, not merely by the API",
  );

  // AC#4 · a row with BOTH worker_id and operator_id set is the owner-cleans-a-building
  // case (§3) and must be ACCEPTED; a row with NEITHER set must be REFUSED by the CHECK.
  const secondWorkerId = query("SELECT id FROM workers ORDER BY id LIMIT 1;");
  query(`UPDATE phone_identities SET worker_id = ${secondWorkerId} WHERE phone_e164 = '+436641234567';`);
  assert.equal(
    query(
      "SELECT (worker_id IS NOT NULL AND operator_id IS NOT NULL) FROM phone_identities WHERE phone_e164 = '+436641234567';",
    ),
    "t",
    "a phone_identities row must accept BOTH worker_id and operator_id set (§3, one person, two capabilities)",
  );
  assert.throws(
    () => query("INSERT INTO phone_identities (phone_e164) VALUES ('+436649999999');"),
    /phone_identities_claims/,
    "a phone_identities row with NEITHER worker_id nor operator_id set must be refused",
  );
  query("DELETE FROM phone_identities WHERE phone_e164 = '+436641234567';");
  query("DELETE FROM operators WHERE name = 'Feldleiter Eins';");

  // UNPROMPTED BUT LOAD-BEARING (found walking the FK graph 007 introduces, and the same
  // fact ops/reset-w1.sql's own comment names before its pre-DELETE UPDATE): ON DELETE SET
  // NULL on phone_identities.worker_id, applied to a row that carries ONLY a worker_id,
  // drives that row to (NULL, NULL) MID-STATEMENT — which phone_identities_claims forbids.
  // DELETE FROM workers therefore ABORTS the instant one such row exists. RED case: this
  // assertion is what would have caught the reset-script bug if written first; asserted
  // here, at the schema level, before the reset script has to work around it.
  const workerOnlyId = query("SELECT id FROM workers ORDER BY id LIMIT 1;");
  query(`INSERT INTO phone_identities (phone_e164, worker_id) VALUES ('+436645550001', ${workerOnlyId});`);
  assert.throws(
    () => query(`DELETE FROM workers WHERE id = ${workerOnlyId};`),
    /phone_identities_claims/,
    "DELETE FROM workers must be blocked by ON DELETE SET NULL driving a worker-only phone_identities row to (NULL, NULL) — the exact fact ops/reset-w1.sql detaches BEFORE deleting workers",
  );
  query("DELETE FROM phone_identities WHERE phone_e164 = '+436645550001';");

  // AC#3 · the collision is impossible under CONCURRENT writers, not merely checked
  // read-then-write. Two REAL connections, not two `psql -c` subprocesses: proving
  // "blocked on an uncommitted row lock" needs a lock actually held mid-transaction, and
  // `psql -c` (autocommit, one statement, disconnects) cannot hold one open.
  await (async () => {
    const connA = new pg.Client({ connectionString: DATABASE_URL });
    const connB = new pg.Client({ connectionString: DATABASE_URL });
    await connA.connect();
    await connB.connect();
    const BLOCKED = Symbol("still blocked");
    try {
      const raceWorkerId = (await connA.query("SELECT id FROM workers ORDER BY id LIMIT 1")).rows[0].id;

      await connA.query("BEGIN");
      // Uncommitted on purpose — B's insert of the SAME phone must block on THIS row's
      // lock, not race past it after the fact.
      await connA.query("INSERT INTO phone_identities (phone_e164, worker_id) VALUES ('+436647778888', $1)", [
        raceWorkerId,
      ]);

      await connB.query("BEGIN");
      const bOperator = await connB.query("INSERT INTO operators (name) VALUES ('Race Operator') RETURNING id");
      const bPromise = connB
        .query("INSERT INTO phone_identities (phone_e164, operator_id) VALUES ('+436647778888', $1)", [
          bOperator.rows[0].id,
        ])
        .then(
          () => ({ blocked: false }),
          (err) => ({ blocked: true, err }),
        );

      const early = await Promise.race([bPromise, new Promise((r) => setTimeout(() => r(BLOCKED), 200))]);
      assert.equal(early, BLOCKED, "B must be BLOCKED on A's uncommitted row lock, not racing past it");

      await connA.query("COMMIT");
      const bResult = await bPromise;
      assert.equal(bResult.blocked, true, "exactly ONE of the two racing inserts may commit — B must lose once A commits");
      assert.match(
        String(bResult.err.message),
        /duplicate key|phone_identities_pkey/,
        "B's failure must be the PRIMARY KEY, not something else",
      );

      await connA.query("DELETE FROM phone_identities WHERE phone_e164 = '+436647778888'");
      await connA.query("DELETE FROM operators WHERE name = 'Race Operator'");
    } finally {
      await connA.end();
      await connB.end();
    }
  })();

  // --- 010 spot-checks: the verification gate's two columns (decision-47) ------------
  //
  // The whole design rests on one property of the SCHEMA rather than of any handler: a zone
  // that nobody stamped is NULL, and stays NULL, no matter which INSERT created it. Every
  // assertion below is about that, and each names the mutation of 010 that turns it red.
  {
    // NO DEFAULT is the load-bearing half, exactly as `DROP DEFAULT` was in 006 §1. RED
    // case: `ALTER TABLE zones ADD COLUMN verified_at TIMESTAMPTZ DEFAULT now()` — every
    // fixture that forgets the column silently becomes a VERIFIED zone and the gate is
    // decorative.
    assert.equal(
      query(
        "SELECT count(*) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'public.zones'::regclass AND a.attname = 'verified_at';",
      ),
      "0",
      "zones.verified_at must have NO DEFAULT — a DEFAULT now() lands a VERIFIED zone on every INSERT that omits it (006 §1's failure, wearing a different hat)",
    );
    assert.equal(
      query(
        "SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.zones'::regclass AND attname = 'verified_at';",
      ),
      "f",
      "zones.verified_at must be NULLable — 'nobody has proved this card yet' is the state every new zone starts in",
    );

    // The property, demonstrated rather than inferred from the catalogue: an INSERT that
    // says nothing about verification produces an UNVERIFIED zone.
    query("INSERT INTO zones (location_id, name) SELECT id, 'Ungeprüfte Stiege' FROM locations ORDER BY slug LIMIT 1;");
    assert.equal(
      query("SELECT verified_at IS NULL AND verified_by_operator_id IS NULL FROM zones WHERE name = 'Ungeprüfte Stiege';"),
      "t",
      "a zone created without saying anything about verification must land UNVERIFIED",
    );

    // ON DELETE SET NULL, never CASCADE: an operator leaving must not delete the zones they
    // proved. RED case: change the FK to ON DELETE CASCADE and the row count below drops.
    query("INSERT INTO operators (name) VALUES ('Prüfender Feldleiter');");
    query(
      "UPDATE zones SET verified_at = now(), verified_by_operator_id = (SELECT id FROM operators WHERE name = 'Prüfender Feldleiter') WHERE name = 'Ungeprüfte Stiege';",
    );
    query("DELETE FROM operators WHERE name = 'Prüfender Feldleiter';");
    assert.equal(
      query("SELECT count(*) FROM zones WHERE name = 'Ungeprüfte Stiege';"),
      "1",
      "deleting the operator must NOT delete the zone they verified — ON DELETE SET NULL, never CASCADE",
    );
    assert.equal(
      query("SELECT verified_by_operator_id IS NULL AND verified_at IS NOT NULL FROM zones WHERE name = 'Ungeprüfte Stiege';"),
      "t",
      "the operator reference is cleared and the FACT of verification survives — a zone must never go dark because a person left",
    );

    // The worklist index, PARTIAL, so it stays the size of the problem.
    assert.equal(
      query("SELECT indpred IS NOT NULL FROM pg_index WHERE indexrelid = 'public.zones_unverified_idx'::regclass;"),
      "t",
      "zones_unverified_idx must be PARTIAL — it answers 'which doors still need somebody to walk to them'",
    );
    query("DELETE FROM zones WHERE name = 'Ungeprüfte Stiege';");
  }

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

  // --- 006 on top of live data, and the rate guard REFUSING rather than inventing ---
  //
  // THIS IS PRODUCTION'S ACTUAL SHAPE. The live box carries one leftover row — 'TTL Test',
  // rate 0, inactive, no shifts — so migration 006 REFUSES there until a human deals with
  // it. Reproduced here so the refusal is a tested property and not a surprise on the box.
  //
  // A migration that halts with a COUNT and an instruction is strictly better than one
  // that writes a number nobody chose into a payroll column, and better than one that
  // deactivates people to avoid the question (decision-41 §3).
  liveQuery("INSERT INTO workers (name, hourly_rate_cents, active) VALUES ('Rateless Leftover', 0, false);");

  // --- THE DEPLOY GATE: the refusal must be discoverable BEFORE anything moves ---
  //
  // ops/deploy.sh step 0b runs `migrate.js --dry-run` against the live database as its FIRST
  // remote action. Before that existed, the first thing to touch the database was step 5 of
  // 7 — and steps 3 and 4 had already rsynced the new admin bundle into $DEST/public, which
  // the RUNNING API serves immediately (a static export needs no restart). A refusal at step
  // 5 therefore left new screens sitting on an old schema: the window in which /workers/ and
  // /payroll/, having deleted their „no hourly rate" copy because 006 makes that state
  // unrepresentable, would render this very row as a confident EUR 0,00 wage.
  //
  // Asserted from BOTH sides, because a gate that cannot fail is not a gate.
  //
  // This harness applied 001-005 with psql DIRECTLY (`apply()` above) rather than through
  // the runner, so the runner's own bookkeeping table does not exist here. Told the truth
  // once, explicitly: without it --dry-run would start again at 001 and fail on "relation
  // workers already exists", which is a harness artefact and not a property of anything.
  liveQuery(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
    INSERT INTO schema_migrations (filename) VALUES
      ('001_init.sql'), ('002_worker_identity.sql'), ('003_clients_contracts_inventory.sql'),
      ('004_worker_enrolment_codes.sql'), ('005_v2_features.sql')
    ON CONFLICT DO NOTHING;`);

  const dryRun = () => run("node", [MIGRATE, "--dry-run"], { DATABASE_URL: LIVE_URL });
  assert.throws(
    dryRun,
    /have no hourly rate; refusing to invent one/,
    "--dry-run must REFUSE exactly as the real run does, and for the same stated reason",
  );
  // ...AND IT MUST NAME THE FILE. All pending files now go to psql as ONE script, and psql
  // reports errors by line number OF ITS STDIN — "ERROR at line 173" names nothing anybody
  // can act on when three migrations were concatenated. migrate.js emits a `\echo` marker
  // before each file and reports the last one echoed; if that ever breaks it prints
  // "(unknown file)", which reads like a working gate and is not one.
  assert.throws(
    dryRun,
    /migrate --dry-run: 006_zones_revenue_rates\.sql does NOT apply/,
    "a refusal must name the FILE that refused, not a line number and not '(unknown file)'",
  );
  assert.equal(
    liveQuery("SELECT to_regclass('public.zones') IS NULL;"),
    "t",
    "a refused --dry-run must have written nothing",
  );

  assert.throws(
    () => apply("006_zones_revenue_rates.sql"),
    /1 worker\(s\) have no hourly rate; refusing to invent one/,
    "006 must REFUSE while any worker has no rate — and it must say HOW MANY",
  );
  // `psql -1` means the RAISE aborted the whole file. Nothing may have landed.
  assert.equal(
    liveQuery("SELECT to_regclass('public.zones') IS NULL AND to_regclass('public.location_revenue') IS NULL;"),
    "t",
    "a refused 006 must leave the database EXACTLY as it was — no table, no column, no constraint",
  );
  assert.equal(
    liveQuery("SELECT count(*) FROM pg_constraint WHERE conname = 'workers_rate_positive';"),
    "0",
    "a refused 006 must not have applied its own constraint either",
  );
  // The exemption decision-41 REJECTED: `OR NOT active`. The leftover row above is
  // inactive, and it still blocks. If someone ever adds that exemption to soften the
  // refusal, the assertion above stops throwing and this check goes red.
  assert.equal(
    liveQuery("SELECT count(*) FROM workers WHERE hourly_rate_cents <= 0 AND NOT active;"),
    "1",
    "the blocking row is INACTIVE on purpose — inactivity must not be an exemption",
  );

  // Deal with it the way the ops step says to, then re-run: it applies.
  liveQuery("DELETE FROM workers WHERE name = 'Rateless Leftover';");

  // The other side of the gate: it now says the file WOULD apply, and it still writes
  // nothing. A dry run that quietly committed would be worse than no dry run — it would
  // migrate production from a step whose whole promise is that it does not.
  //
  // THREE files are pending here, not one: 006, 007, AND 008. 008 is the FIRST migration in
  // this tree with a real cross-file dependency (`tag_aliases.zone_id -> zones`, `zones`
  // itself only existing once 006 has *committed*; `reported_tags.reported_by_operator_id
  // -> operators`, same story with 007).
  //
  // THAT DEPENDENCY USED TO MAKE THIS STEP FAIL, AND THE FAILURE WAS THE RUNNER'S, NOT 008's.
  // Pending files were dry-run one at a time, each rolled back before the next began, so 008
  // met a database where 007's `operators` had just been un-created:
  //
  //   would apply 006 / would apply 007 / ERROR: relation "operators" does not exist
  //
  // That is what step 0b printed against the LIVE box on deploy day, and it blocks a deploy
  // that is perfectly good. A gate that cries wolf gets disabled by the third person who
  // meets it. migrate.js now dry-runs ALL pending files in ONE transaction, in order, and
  // rolls the lot back — which is also the more honest question: „does this DEPLOY apply".
  // So the chain must now come back CLEAN, all three of them, and still write nothing.
  const dryRunOutput = dryRun();
  assert.match(dryRunOutput, /would apply 006_zones_revenue_rates\.sql/, "--dry-run must clear once the rate is real");
  assert.match(
    dryRunOutput,
    /would apply 007_operator_identity\.sql/,
    "--dry-run must carry 007 on top of 006 in the same transaction",
  );
  assert.match(
    dryRunOutput,
    /would apply 008_reported_tags\.sql/,
    "008 depends on tables 006 and 007 create — a per-file dry run reports a FALSE failure here",
  );
  assert.equal(
    liveQuery("SELECT to_regclass('public.zones') IS NULL;"),
    "t",
    "...and a CLEARED --dry-run must still have written nothing — BEGIN/ROLLBACK, never -1",
  );
  assert.equal(
    liveQuery("SELECT count(*) FROM schema_migrations;"),
    "5",
    "...and must record nothing in schema_migrations either",
  );

  // --- ...AND THE GATE MUST BE LOOKING AT THIS TREE'S MIGRATIONS ---------------------
  //
  // Everything above proves --dry-run REFUSES when it can see 006. It cannot prove the
  // deploy lets it see 006, and for a while the deploy did not: migrate.js resolves its
  // files as `path.join(__dirname, "migrations")`, step 0b runs the copy ON THE BOX, and
  // 006 did not reach the box until step 3. Against a restored production dump the gate
  // therefore printed "up to date" and exited 0 — a check whose negative case could not
  // fire — and the deploy walked into the exact window step 0b exists to close.
  //
  // So the ORDER is asserted, out of ops/deploy.sh itself. Read as text because that is
  // what the failure was: every command was correct and only their sequence was wrong, and
  // no amount of running migrate.js here can see that. Positions, not mere presence —
  // "the file mentions rsync somewhere" is what let this through the first time.
  const deploySh = fs.readFileSync(path.join(__dirname, "..", "..", "ops", "deploy.sh"), "utf8");
  const at = (re, what) => {
    const i = deploySh.search(re);
    assert.notEqual(i, -1, `ops/deploy.sh no longer contains ${what} — this ordering check is stale`);
    return i;
  };
  // `[\s\S]{0,240}?` and not `[^\n]*`: the staging rsync wraps onto a second line with a
  // backslash continuation, and a single-line pattern silently found nothing and reported
  // the check as stale rather than reporting the order.
  const stageDb = at(
    /rsync[\s\S]{0,240}?\.\/server\/db\/\s+"\$HOST:\$DEST\/db\/"/,
    "the step 0a staging rsync of server/db/",
  );
  const gate = at(/migrate\.js --dry-run/, "the step 0b --dry-run gate");
  const shipBundle = at(/rsync[^\n]*\.\/web\/out\//, "the step 4 rsync of web/out");
  const realMigrate = at(/node '"\$DEST"'\/db\/migrate\.js\n/, "the step 5 real migrate");
  assert.ok(
    stageDb < gate,
    "ops/deploy.sh must put THIS TREE's migrations on the box BEFORE the --dry-run gate, or " +
      "the gate dry-runs the migrations that are already applied and passes vacuously",
  );
  assert.ok(
    gate < shipBundle,
    "the --dry-run gate must run BEFORE web/out is rsynced: the running API serves a static " +
      "export the instant it lands, so a refusal after this point leaves new screens on an old schema",
  );
  assert.ok(
    shipBundle < realMigrate,
    "the real migrate still runs after the bundle ships — if this ever flips, re-derive the window above",
  );
  // The staging rsync must not prune the running server's files before anything is proven.
  assert.doesNotMatch(
    deploySh.slice(stageDb, gate),
    /--delete/,
    "the step 0a staging rsync must be ADDITIVE (no --delete) — it runs before any gate has passed",
  );

  apply("006_zones_revenue_rates.sql");
  // `apply()` runs the file DIRECTLY, the same shortcut used for 001-005 above (and for the
  // same stated reason — this harness predates schema_migrations existing at all). Recorded
  // here by hand so a LATER --dry-run (008's, below) correctly reads 006 as already applied
  // instead of trying to redo its DDL and colliding with what is now really on disk.
  liveQuery("INSERT INTO schema_migrations (filename) VALUES ('006_zones_revenue_rates.sql');");
  assert.equal(
    liveQuery("SELECT to_regclass('public.zones') IS NOT NULL AND to_regclass('public.location_revenue') IS NOT NULL;"),
    "t",
    "006 must apply once every rate is real",
  );
  // The two live shifts — one closed, one OPEN — must survive with both zone columns NULL.
  // Zero backfill: a default zone would assert a tap that never happened.
  assert.equal(
    liveQuery("SELECT count(*) FROM shifts WHERE start_zone_id IS NULL AND end_zone_id IS NULL;"),
    "2",
    "006 must add the zone columns NULLable and backfill NOTHING",
  );
  assert.equal(liveQuery("SELECT count(*) FROM shifts WHERE end_time IS NULL;"), "1", "the open shift must survive 006");
  assert.equal(liveQuery("SELECT count(*) FROM zones;"), "0", "006 must invent no zone for a live building");
  assert.equal(
    liveQuery("SELECT count(*) FROM location_revenue;"),
    "0",
    "006 must invent no revenue row, even for the building that HAS a contract figure",
  );

  // --- 007 on top of live data: composes with 006, invents nothing, workers/admins
  // byte-identical (TASK-211 AC#1) ----------------------------------------------------
  //
  // COMPOSITION WITH 006, PROVEN RATHER THAN STATED: 007 has no functional dependency on
  // 006's content (no FK into zones/location_revenue), but migrate.js applies
  // migrations/*.sql in strict LEXICAL FILENAME ORDER and stops on the first failure — so
  // while 006 refuses (the rateless leftover, above), 007 is unreachable purely by
  // filename ordering, which is already proven above: schema_migrations read "5" and
  // to_regclass('public.zones') was NULL during the refusal, i.e. NEITHER 006 NOR 007 had
  // landed. Reaching this line at all is the positive half of that same proof.
  const colSnapshot = (table) =>
    liveQuery(
      `SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY column_name) ` +
        `FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}';`,
    );
  // Snapshotted HERE, immediately before 007 — not at the top of the file — so this is a
  // schema-diff assertion (would catch a stray ALTER TABLE workers that got added,
  // mistyped, and rolled back) and not merely "the file doesn't mention ALTER TABLE".
  const workersBefore007 = colSnapshot("workers");
  const adminsBefore007 = colSnapshot("admins");

  apply("007_operator_identity.sql");
  liveQuery("INSERT INTO schema_migrations (filename) VALUES ('007_operator_identity.sql');"); // same reason as 006, above

  assert.equal(
    liveQuery(
      "SELECT to_regclass('public.operators') IS NOT NULL AND to_regclass('public.phone_identities') IS NOT NULL " +
        "AND to_regclass('public.operator_sessions') IS NOT NULL;",
    ),
    "t",
    "007 must create operators, phone_identities and operator_sessions",
  );
  assert.equal(colSnapshot("workers"), workersBefore007, "workers must be BYTE-IDENTICAL after 007 — decision-45 touches it not at all");
  assert.equal(colSnapshot("admins"), adminsBefore007, "admins must be BYTE-IDENTICAL after 007 — decision-45 §5, the admin login is untouched");
  assert.equal(liveQuery("SELECT count(*) FROM operators;"), "0", "007 must invent no operator, same convention 006 states for zones");

  // --- 008 on top of live data: composes with 006 AND 007, invents nothing -----------
  //
  // 008 alone, with 006 and 007 already COMMITTED: the other arrangement of the same
  // question the all-three-pending dry run asks above. Both must clear.
  assert.match(
    dryRun(),
    /would apply 008_reported_tags\.sql/,
    "--dry-run must clear 008 once its dependencies (zones, operators) are real, not merely pending",
  );

  apply("008_reported_tags.sql");
  assert.equal(
    liveQuery(
      "SELECT to_regclass('public.reported_tags') IS NOT NULL AND to_regclass('public.tag_aliases') IS NOT NULL;",
    ),
    "t",
    "008 must create reported_tags and tag_aliases",
  );
  assert.equal(liveQuery("SELECT count(*) FROM reported_tags;"), "0", "008 must invent no reported tag");
  assert.equal(liveQuery("SELECT count(*) FROM tag_aliases;"), "0", "008 must invent no alias");
  // The FKs are load-bearing, not decorative: prove they are actually enforced, not just
  // present as columns.
  assert.throws(
    () => liveQuery("INSERT INTO tag_aliases (id, zone_id) VALUES (gen_random_uuid(), gen_random_uuid())"),
    /violates foreign key constraint/,
    "tag_aliases.zone_id must actually reference a real zone, not merely be a uuid column",
  );

  console.log(
    "OK check-migrate: migrations apply once, re-run is a no-op, seed is idempotent, " +
      "003+004+005 apply on top of 001+002 with live data, 005's contract backfill is idempotent, " +
      "006 refuses a rate-less worker before applying cleanly over live rows, 007 composes with " +
      "006 (blocked transitively by filename order while 006 refuses) leaving workers/admins " +
      "untouched, --dry-run clears all three PENDING files in one rolled-back transaction " +
      "(008's FKs resolve against 006/007 the same deploy applies), and 008 composes with both " +
      "once they are real and invents neither a tag nor an alias",
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
