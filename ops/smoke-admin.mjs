#!/usr/bin/env node
// A THROWAWAY admin login, for ops/smoke-live.sh only. Runs ON THE BOX — it needs
// /etc/nfc/env and the local Postgres socket, so it ships with the rest of ops/ to
// /srv/nfc/ops/ and is invoked over ssh under sudo. The CREDENTIAL is throwaway, not this
// file: a random password per run, one admin row, deleted in the same script's cleanup trap.
//
//   printf '%s' "$password" | sudo node /srv/nfc/ops/smoke-admin.mjs create <email>
//   sudo node /srv/nfc/ops/smoke-admin.mjs delete <email>
//
// WHY IT EXISTS. The live admin row is the DIRECTOR'S: one row, email `schimmer`, a
// password only he knows and which is not in the vault (the vault's ADMIN_PASSWORD belongs
// to a different, older login that no longer exists on this box). A smoke test that drove
// the admin API through his account would have to either know his password or CHANGE it —
// and changing it locks the client out of his own panel with no warning, which is a far
// worse outcome than an untested route. So the test brings its own identity, uses it for
// about a minute, and removes it.
//
// THREE REFUSALS, because this creates a live credential on a production box:
//   1. the email MUST carry the smoke marker, so no invocation of this file can ever
//      overwrite `schimmer` or any other real admin — there is no argument that reaches
//      the director's row;
//   2. `create` INSERTs and never updates: ON CONFLICT DO NOTHING, then it fails if the
//      row it reads back is not the one it just made. An upsert here would be a password
//      reset wearing a different name;
//   3. `delete` is scoped to the same marker and reports how many rows went, so the caller
//      can assert "exactly one".
//
// THE PASSWORD COMES FROM STDIN, never argv and never an env var: argv is world-readable
// in `ps auxww` for the seconds it runs, on a box that has other users.
import { hashPassword } from "/srv/nfc/lib/auth.js";
import { pool } from "/srv/nfc/lib/db.js";

const MARKER = "smoke-delete-me";
const [, , action, emailArg] = process.argv;
const email = String(emailArg ?? "").trim().toLowerCase();

if (!email.startsWith(MARKER)) {
  console.error(`refusing: '${email}' does not start with '${MARKER}' — this tool cannot touch a real admin`);
  process.exit(1);
}

try {
  if (action === "create") {
    const password = await new Promise((resolve) => {
      let s = "";
      process.stdin.on("data", (d) => (s += d)).on("end", () => resolve(s.trim()));
    });
    if (password.length < 12) {
      console.error("refusing: password shorter than 12 characters");
      process.exit(1);
    }
    const hash = await hashPassword(password);
    await pool.query("INSERT INTO admins (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING", [
      email,
      hash,
    ]);
    const { rows } = await pool.query("SELECT id, password_hash FROM admins WHERE email = $1", [email]);
    if (rows.length !== 1 || rows[0].password_hash !== hash) {
      console.error("refusing: that admin already existed and was NOT overwritten");
      process.exit(1);
    }
    console.log(`created ${rows[0].id}`);
  } else if (action === "delete") {
    const { rowCount } = await pool.query("DELETE FROM admins WHERE email = $1 AND email LIKE $2", [
      email,
      `${MARKER}%`,
    ]);
    console.log(`deleted ${rowCount}`);
  } else {
    console.error("usage: smoke-admin.mjs create|delete <email>");
    process.exit(2);
  }
} finally {
  await pool.end();
}
