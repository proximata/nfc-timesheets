// Create the demo admin login, non-interactively.
//
//   DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs
//
// server/bin/create-admin.js REFUSES a non-tty password on purpose (a piped password
// lands in shell history and in `ps`). That refusal is correct and stays. This file
// exists because a screen recording cannot answer a password prompt, and it buys the
// exception back with two guards:
//
//   1. the database must be named nfc_demo AND be on this machine — the same guard
//      demo/seed.sql uses, plus demo/db-guard.mjs for the host, because
//      `SELECT current_database()` alone answers only AFTER connecting, and what it
//      connects to can be the live host (`?host=`, $PGHOST — see db-guard.mjs);
//   2. the password is a FIXED, PUBLISHED, WORTHLESS string that is written down in
//      backlog/docs/DEMO.md and appears on screen in the recording.
//
// It is not a secret and must never be one. If you find yourself wanting to pass a real
// password in here, use server/bin/create-admin.js instead — that is what it is for.
import { hashPassword } from "../server/lib/auth.js";
import { one, pool } from "../server/lib/db.js";
import { assertDemoDatabase } from "./db-guard.mjs";

const DEMO_DATABASE = "nfc_demo";
const EMAIL = "demo@example.test";
const PASSWORD = "demo-nur-lokal-2026";

// Before the first query, so a wrong host is refused instead of merely reported on.
assertDemoDatabase(process.env.DATABASE_URL ?? "", (why) => {
  console.error(`make-admin: ${why}`);
  process.exit(1);
});

async function main() {
  // Kept as well: the host guard reads the URL, this reads the SERVER. Both, because a
  // local socket can still front a database that is not the one the URL named.
  const db = await one("SELECT current_database() AS name");
  if (db.name !== DEMO_DATABASE) {
    console.error(`make-admin: refusing to touch "${db.name}" — expected "${DEMO_DATABASE}".`);
    return 1;
  }

  const hash = await hashPassword(PASSWORD);
  await one(
    `INSERT INTO admins (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [EMAIL, hash],
  );
  console.log(`demo admin ready: ${EMAIL} / ${PASSWORD}`);
  return 0;
}

main()
  .then((code) => pool.end().then(() => process.exit(code)))
  .catch((err) => {
    console.error("make-admin:", err.message);
    process.exit(1);
  });
