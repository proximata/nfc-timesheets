#!/usr/bin/env node
// Migration runner. Applies migrations/*.sql in lexical order, once each.
//
// ponytail: shells out to `psql` instead of taking a node dep.
//   Ladder: (1) needed - yes, schema has to get into the DB somehow.
//   (2)/(3) no stdlib/platform answer. (4) already-installed dep: `psql` ships with
//   the postgresql-16 package the runbook already installs (§2), so it is on every
//   box that has a database at all — and this runs BEFORE `pnpm install` during a
//   cold bootstrap. (6) minimum code: ~20 lines.
//   Ceiling: no down-migrations, no checksums (an edited applied file is silently
//   ignored), no advisory lock so two concurrent migrate runs can race. Deploy is a
//   single rsync + run, so that race does not exist today.
//   Upgrade path: node-pg-migrate — it drives plain SQL files too, so migrations/
//   carries over unchanged.
//
// Usage:  DATABASE_URL=postgres:///nfc node server/db/migrate.js
//         (db + role are named `nfc`, same as the systemd units and backup scripts)
//
//         ... --dry-run   apply every pending file inside a transaction and ROLL IT BACK.
//
// WHY --dry-run EXISTS, and it is not a nicety. A migration is allowed to REFUSE: 006
// raises rather than inventing an hourly wage for a rate-less worker (decision-41), and
// production carries exactly such a row. ops/deploy.sh used to discover that at step 5 of 7
// — AFTER the new admin bundle had already been rsynced to $DEST/public and was therefore
// already being served by the running API. A refused migration then left the box holding a
// bundle that assumes the new schema on top of a database that does not have it: precisely
// the window in which a screen that deleted its „no hourly rate" copy renders a leftover
// zero as a confident EUR 0,00 wage.
//
// It is generic on purpose. A guard hard-coded to `SELECT count(*) ... WHERE
// hourly_rate_cents <= 0` would gate 006 and nothing after it; this runs whatever the
// pending files actually say, so 007 is gated the day it is written and nobody has to
// remember. SAFE because every migration in this tree is transactional DDL — no
// CREATE INDEX CONCURRENTLY, no VACUUM (checked at time of writing, and a non-transactional
// statement would fail here loudly rather than silently half-apply).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("migrate: DATABASE_URL is not set");
  process.exit(1);
}

const DIR = path.join(__dirname, "migrations");

// -t -A => bare tab-less rows, no headers, no padding. ON_ERROR_STOP => nonzero exit
// on the first SQL error instead of psql ploughing on.
// stderr is inherited so Postgres errors land in the deploy log verbatim.
const psql = (sql, singleTransaction) =>
  execFileSync(
    "psql",
    [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", ...(singleTransaction ? ["-1"] : []), "-f", "-"],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] },
  );

// Filenames come off our own disk, but quoting them properly costs one line.
const sqlLiteral = (s) => `'${s.replace(/'/g, "''")}'`;

psql(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

const applied = new Set(
  psql("SELECT filename FROM schema_migrations;")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean),
);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

const dryRun = process.argv.includes("--dry-run");

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(DIR, file), "utf8");
  if (dryRun) {
    // Explicit BEGIN/ROLLBACK rather than `-1`: `-1` COMMITS on success, which is the one
    // outcome a dry run must not produce. Pending files are dry-run one at a time and each
    // is rolled back, so a file that depends on its predecessor's DDL will report a false
    // failure — LOUDLY, which is the right way round for a gate.
    try {
      psql(`BEGIN;\n${sql}\nROLLBACK;`);
    } catch {
      // psql's own message already went to stderr verbatim (stdio inherit). A Node stack
      // trace on top of it buries the one line a human has to act on, and this runs as the
      // FIRST step of a deploy, where that line is the whole output that matters.
      console.error(`\nmigrate --dry-run: ${file} does NOT apply. Nothing was written.`);
      process.exit(1);
    }
    console.log(`would apply ${file}`);
    count += 1;
    continue;
  }
  // The migration and its bookkeeping row commit together, or neither does.
  psql(`${sql}\nINSERT INTO schema_migrations (filename) VALUES (${sqlLiteral(file)});`, true);
  console.log(`applied ${file}`);
  count += 1;
}

if (dryRun) {
  console.log(count === 0 ? "up to date" : `${count} migration(s) would apply; nothing was written`);
} else {
  console.log(count === 0 ? "up to date" : `${count} migration(s) applied`);
}
