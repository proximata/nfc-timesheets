#!/usr/bin/env node
// Create the first web-admin login, or re-password an existing one (decision-20).
//
//   DATABASE_URL=postgres:///nfc node server/bin/create-admin.js
//
// THE PASSWORD IS NEVER AN ARGUMENT AND NEVER AN ENV VAR. `node create-admin.js
// hunter2` would put it in ~/.bash_history, in `ps auxww` for every other user on the
// box, and in the systemd journal if it were ever run from a unit. It is read from the
// terminal with echo off, hashed, and dropped. It is never printed and never logged.
//
// For the same reason this REFUSES to run without a TTY: piping a password in from a
// file or a CI variable is exactly the leak this is avoiding.
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { hashPassword } from "../lib/auth.js";
import { one, pool } from "../lib/db.js";

// Long enough that the scrypt cost plus the login rate limit make online guessing
// hopeless. A 6-digit PIN, which this replaces, has ~20 bits; this floor is the point.
const MIN_PASSWORD_LEN = 12;

function ask(prompt, { secret = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    let muted = false;
    // readline routes every echo through _writeToOutput. Swallowing it after the
    // prompt has been written is what keeps the password off the screen (and out of a
    // shoulder-surfer's view, and out of any terminal-recording tool).
    rl._writeToOutput = (chunk) => {
      if (!muted) stdout.write(chunk);
    };
    rl.question(prompt, (answer) => {
      if (secret) stdout.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = secret;
  });
}

// RFC-perfect email validation is a fool's errand and not a security boundary here;
// this only catches typos. The unique index is what actually keeps accounts distinct.
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 320;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("create-admin: DATABASE_URL is not set");
    return 1;
  }
  if (!stdin.isTTY) {
    console.error("create-admin: refusing to read a password from a non-tty. Run this interactively.");
    return 1;
  }

  const email = (await ask("admin email: ")).trim().toLowerCase();
  if (!looksLikeEmail(email)) {
    console.error("create-admin: that does not look like an email address");
    return 1;
  }

  const existing = await one("SELECT id FROM admins WHERE email = $1", [email]);
  if (existing) {
    const confirm = (await ask(`${email} already exists. Reset its password? [y/N] `)).trim().toLowerCase();
    if (confirm !== "y" && confirm !== "yes") {
      console.error("create-admin: aborted");
      return 1;
    }
  }

  const password = await ask(`password (min ${MIN_PASSWORD_LEN} chars, not echoed): `, { secret: true });
  if (password.length < MIN_PASSWORD_LEN) {
    console.error(`create-admin: password must be at least ${MIN_PASSWORD_LEN} characters`);
    return 1;
  }
  const again = await ask("repeat password: ", { secret: true });
  if (password !== again) {
    console.error("create-admin: passwords do not match");
    return 1;
  }

  const hash = await hashPassword(password);
  const row = await one(
    `INSERT INTO admins (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email, created_at`,
    [email, hash],
  );

  // Existing sessions were issued against the old password. A password reset that
  // leaves them alive is not a reset.
  const { rowCount } = await pool.query("DELETE FROM sessions WHERE admin_id = $1", [row.id]);

  console.log(`create-admin: ${existing ? "updated" : "created"} ${row.email} (id ${row.id})`);
  if (rowCount > 0) console.log(`create-admin: revoked ${rowCount} existing session(s)`);
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  // Print the message only. A pg error object can carry the parameter list, which
  // would mean the hash - never the password, but still not something for a terminal.
  console.error(`create-admin: ${err?.message ?? err}`);
} finally {
  await pool.end().catch(() => {});
}
process.exit(code);
