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

  console.log("OK check-migrate: migrations apply once, re-run is a no-op, seed is idempotent");
} finally {
  try {
    run("dropdb", ["--if-exists", DB_NAME]);
  } catch (e) {
    console.error(`warning: could not drop throwaway database ${DB_NAME}`, String(e.stderr || e.message).trim());
  }
}
