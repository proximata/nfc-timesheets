#!/usr/bin/env node
/**
 * Issue a worker enrolment code — creating the worker first if they do not exist yet.
 *
 * WHY THIS EXISTS. Inviting somebody used to be: open the admin panel, find or add the
 * worker, click through to issue a code, copy it before it disappears, paste it into a
 * message. Five steps across two screens, done rarely enough that it is re-learned every
 * time, and the code is shown exactly once so a mis-click costs a whole round trip. This
 * is one command.
 *
 *   node ops/issue-invite.mjs --name "Bálint"
 *   node ops/issue-invite.mjs --name "Anna Nowak" --phone "+43 660 1234567" --rate 14.50
 *   node ops/issue-invite.mjs --worker-id 4
 *
 * MATCHING. An existing worker is found by --worker-id, else by email, else by exact
 * (case-insensitive) name. Names are NOT unique in the database, so if a name matches more
 * than one active worker this refuses and asks for --worker-id rather than guessing which
 * human it meant — issuing a stranger's invite is not a recoverable mistake.
 *
 * CREATION. A missing worker is only created with --create. Without it a typo'd name is a
 * clear error instead of a silent second worker row, which is the failure that ends with
 * one person on two payslips.
 *
 * THE CODE IS PRINTED ONCE, to stdout, and never logged anywhere. It is a live credential
 * until it is redeemed or expires: single-use, and today it lasts 60 minutes (see TASK-45,
 * which is about making that configurable and longer). Do not paste it into a ticket.
 *
 * AUTH comes from the psst vault (ADMIN_PASSWORD, tag `admin`) — never a flag, so it stays
 * out of shell history and out of `ps`.
 */
import { execFileSync } from "node:child_process";

const API = process.env.API_BASE ?? "https://schimmer-glanz.exe.xyz";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) return true; // bare flag
  return v;
}

function die(msg) {
  console.error(`issue-invite: ${msg}`);
  process.exit(1);
}

/** Euros as typed by a human -> integer cents. No float multiply: 14.50 -> 1450. */
function toCents(raw) {
  if (raw === undefined) return null;
  const m = String(raw).trim().replace(",", ".").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) die(`--rate must look like 14 or 14.50, got "${raw}"`);
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

const name = arg("name");
const workerId = arg("worker-id");
const email = arg("email");
const phone = arg("phone");
const rate = toCents(arg("rate"));
const create = arg("create", false) === true;

if (!name && !workerId) die('need --name "Full Name" or --worker-id N');

// --- admin session ---------------------------------------------------------------
const vault = (key) => {
  let v;
  try {
    v = execFileSync("psst", ["get", key], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    }).trim();
  } catch {
    die(`could not read ${key} from psst (run from the project root)`);
  }
  // psst is project-scoped: outside the project it returns this string instead of failing.
  if (!v || v.startsWith("Run:")) die(`psst returned no value for ${key} — run from the project root`);
  return v;
};

const adminEmail = process.env.ADMIN_EMAIL ?? vault("ADMIN_EMAIL");
const password = vault("ADMIN_PASSWORD");

const login = await fetch(`${API}/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password }),
});
if (!login.ok) die(`admin login failed: ${login.status}`);
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
if (!cookie) die("admin login returned no session cookie");

const api = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
};

// --- find the worker -------------------------------------------------------------
const data = await api("/admin/data");
if (!data.ok) die(`GET /admin/data failed: ${data.status}`);
const workers = data.body.workers ?? [];

let worker = null;
if (workerId) {
  worker = workers.find((w) => String(w.id) === String(workerId));
  if (!worker) die(`no worker with id ${workerId}`);
} else if (email) {
  worker = workers.find((w) => (w.email ?? "").toLowerCase() === String(email).toLowerCase()) ?? null;
}
if (!worker && name) {
  const hits = workers.filter(
    (w) => w.active && (w.name ?? "").trim().toLowerCase() === String(name).trim().toLowerCase(),
  );
  if (hits.length > 1) {
    console.error("issue-invite: more than one active worker is called that:");
    for (const h of hits) console.error(`  id=${h.id}  ${h.name}  ${h.email ?? "(no email)"}`);
    die("pass --worker-id to say which one");
  }
  worker = hits[0] ?? null;
}

// --- create if asked -------------------------------------------------------------
if (!worker) {
  if (!create) die(`no worker matched. Re-run with --create to add "${name}" as a new worker.`);
  const payload = { name, active: true };
  if (email) payload.email = email;
  if (phone) payload.phone = phone;
  if (rate !== null) payload.hourly_rate_cents = rate;
  const made = await api("/admin/workers", { method: "POST", body: JSON.stringify(payload) });
  if (!made.ok) {
    if (made.body?.error === "email_taken") die("that email already belongs to another worker");
    die(`creating the worker failed: ${made.status} ${JSON.stringify(made.body)}`);
  }
  worker = made.body.worker ?? made.body;
  console.log(`created worker #${worker.id} — ${worker.name}`);
}

// --- issue -----------------------------------------------------------------------
const issued = await api(`/admin/workers/${worker.id}/enrolment-code`, { method: "POST" });
if (!issued.ok) die(`issuing the code failed: ${issued.status} ${JSON.stringify(issued.body)}`);

const code = issued.body.code;
const expires = issued.body.expires_at ? new Date(issued.body.expires_at) : null;

console.log("");
console.log(`  worker   ${worker.name} (#${worker.id})`);
console.log(`  code     ${code}`);
if (expires) {
  console.log(
    `  valid to ${expires.toLocaleString("de-AT", { timeZone: "Europe/Vienna" })} (Vienna)`,
  );
}
console.log("");
console.log("  Single use. Issuing a new code replaces this one.");
