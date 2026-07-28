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

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(DIR, file), "utf8");
  // The migration and its bookkeeping row commit together, or neither does.
  psql(`${sql}\nINSERT INTO schema_migrations (filename) VALUES (${sqlLiteral(file)});`, true);
  console.log(`applied ${file}`);
  count += 1;
}

console.log(count === 0 ? "up to date" : `${count} migration(s) applied`);
