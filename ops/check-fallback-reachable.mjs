#!/usr/bin/env node
// "SO IF SMS DIDNT WORK, THERE IS ALWAYS A FALLBACK." — the owner, verbatim.
//
//   node ops/check-fallback-reachable.mjs
//
// THIS FILE IS THE WORD "ALWAYS". decision-48 §7 makes four claims, and every one of them
// is the kind of thing a later change breaks IN GOOD FAITH — by tidying a cell, by adding
// a sensible-looking guard, by "not showing a button that cannot work". None of them would
// look like a regression in review. So each is checked here, and each has a seeded RED case
// in ops/check-fallback-reachable-mutants.sh:
//
//   1  NOT MODIFIED       POST + DELETE /admin/workers/:id/enrolment-code and POST /auth/code
//                         are still in the route tables, still on the same auth kinds.
//   2  A SEPARATE ROUTE   the SMS route is its own path, never a {deliver:"sms"} option on
//                         the existing one — an option would put the fallback behind a
//                         PARAMETER, where a caller can fail to pass it.
//   3  NEVER CONDITIONAL  the „Zugangscode erstellen" button's render condition mentions
//                         none of smsConfigured / sms_deliveries / phone_identit / sms_last.
//   4  BUILT BEFORE SEND  in the SMS handler, the response body is constructed BEFORE
//                         sendSms() is called, so no network failure can lose the code.
//
// NO DATABASE, NO NETWORK, NO CREDENTIAL. It reads the route tables as real objects (an
// import, not a grep) and the panel as source (a .tsx cannot be imported by node). Safe in
// a pre-deploy gate on any machine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const test = async (name, fn) => {
  try {
    await fn();
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").join("\n       ")}`);
  }
};

// ---- 1 · the routes are still there, unchanged -------------------------------------
await test("the enrolment-code routes still exist, on the same methods and the same auth", async () => {
  const { adminRoutes } = await import(path.join(ROOT, "server/routes/admin.js"));
  const { authRoutes } = await import(path.join(ROOT, "server/routes/auth.js"));
  const has = (routes, method, p, auth) => {
    const hit = routes.find((r) => r.method === method && r.path === p);
    assert.ok(hit, `${method} ${p} IS GONE — the fallback the owner asked for no longer exists`);
    assert.equal(hit.auth, auth, `${method} ${p} changed auth kind to ${hit.auth}`);
    assert.equal(typeof hit.handler, "function");
  };
  // The admin's two buttons.
  has(adminRoutes, "POST", "/admin/workers/:id/enrolment-code", "admin");
  has(adminRoutes, "DELETE", "/admin/workers/:id/enrolment-code", "admin");
  // The worker's door. If this goes, every code already read out over the telephone
  // becomes worthless at once.
  has(authRoutes, "POST", "/auth/code", "app");
  // Operators have the same pair and it is the same promise.
  has(adminRoutes, "POST", "/admin/operators/:id/enrolment-code", "admin");
  has(authRoutes, "POST", "/auth/operator-code", "app");
  ok("POST + DELETE /admin/workers/:id/enrolment-code, POST /auth/code — present, admin/app");
});

await test("the SMS route is SEPARATE — the code route takes no delivery parameter", async () => {
  const { adminRoutes } = await import(path.join(ROOT, "server/routes/admin.js"));
  const smsRoute = adminRoutes.find((r) => r.path === "/admin/workers/:id/enrolment-code/sms");
  assert.ok(smsRoute, "the SMS route should exist as its own path");
  assert.equal(smsRoute.method, "POST");
  assert.equal(smsRoute.auth, "admin");

  // The existing handler must not read a delivery/channel/sms flag out of the body. If it
  // ever did, the fallback would be reachable only by callers who remember to omit it.
  const src = read("server/routes/admin.js");
  const handler = src.slice(src.indexOf("async function issueEnrolmentCode"), src.indexOf("async function mintEnrolmentCode"));
  assert.ok(handler.length > 50, "issueEnrolmentCode not found where expected");
  for (const forbidden of ["deliver", "channel", "body.sms", "sendSms", "smsConfigured"]) {
    assert.ok(!handler.includes(forbidden), `issueEnrolmentCode mentions ${forbidden} — it must stay a pure mint`);
  }
  ok("POST .../enrolment-code/sms is its own path; issueEnrolmentCode takes no delivery option");
});

// ---- 2 · the code is built before Twilio is contacted ------------------------------
await test("the SMS handler builds the response body BEFORE it calls sendSms", async () => {
  const src = read("server/routes/admin.js");
  const start = src.indexOf("async function sendEnrolmentCodeBySms");
  const end = src.indexOf("async function putWorkerPhone");
  assert.ok(start > 0 && end > start, "sendEnrolmentCodeBySms not found");
  const handler = src.slice(start, end);

  const guard = handler.indexOf('fail(503, "sms_not_configured")');
  const mint = handler.indexOf("await mintEnrolmentCode(");
  const built = handler.indexOf("code: minted.display");
  const send = handler.indexOf("await sendSms(");
  const record = handler.indexOf("INSERT INTO sms_deliveries");

  assert.ok(guard >= 0, "the 503 guard is GONE — a box with no credentials would try anyway");
  assert.ok(guard < mint, "the flag must be checked BEFORE a code is minted, or a 503 burns the worker's code");
  assert.ok(mint < built && built < send, "the body must be complete before Twilio is contacted");
  assert.ok(send < record, "the delivery row is written after the attempt, never instead of it");

  // A failed send is a 200. A 4xx/5xx here would let the panel's error path swallow the
  // body, and the code with it.
  assert.ok(!/fail\(5\d\d, "sms_/.test(handler.slice(send)), "a failure after the send must not become an error status");
  ok("order: 503 guard -> mint -> body -> sendSms -> sms_deliveries row");
});

// ---- 3 · the panel never makes the code button conditional -------------------------
await test("the „Zugangscode erstellen\" button is rendered with NO reference to SMS", async () => {
  const page = read("web/app/workers/page.tsx");
  const cell = page.slice(page.indexOf("codeStatusText(worker)"), page.indexOf("codeStatusText(worker)") + 1800);
  assert.ok(cell.includes("codeIssue"), "the code cell was not found where expected");

  // THE FOUR NAMES THAT MUST NEVER APPEAR IN THIS CELL'S RENDER CONDITION. Each is a way
  // somebody could, entirely reasonably, decide the button is not worth showing.
  for (const forbidden of ["smsConfigured", "sms_deliveries", "phone_identit", "sms_last", "smsStatus"]) {
    assert.ok(!cell.includes(forbidden), `the code cell mentions ${forbidden} — the fallback is now conditional`);
  }
  // The ONLY condition allowed on it is `worker.active`, and the inactive branch says so in
  // words rather than rendering nothing (NOTHING TRUE may be deleted to lighten a screen).
  assert.ok(cell.includes("worker.active ?"), "the button's only condition must be worker.active");
  assert.ok(cell.includes("codeInactive"), "an inactive worker must still be TOLD why, not shown a gap");
  ok("the button's only condition is worker.active; no SMS name appears in the cell");
});

await test("the i18n keys the fallback needs still exist, in BOTH locales", async () => {
  // A missing key renders as the key name or an empty button. The button would still be
  // there, and it would be unusable — which is the same outcome as deleting it.
  const de = JSON.parse(read("web/messages/de.json"));
  const en = JSON.parse(read("web/messages/en.json"));
  for (const key of ["codeIssue", "codeReissue", "codeRevoke", "codeInactive", "codeCopy", "codeOnce"]) {
    for (const [name, msgs] of [
      ["de", de],
      ["en", en],
    ]) {
      const value = msgs.workers?.[key];
      assert.ok(typeof value === "string" && value.trim() !== "", `workers.${key} missing or empty in ${name}.json`);
    }
  }
  ok("codeIssue / codeReissue / codeRevoke / codeInactive / codeCopy / codeOnce present in de + en");
});

// ---- 4 · nothing about SMS can reach the clock-in path -----------------------------
await test("CLOCK-IN IS NEVER BLOCKED BY ANYTHING: no /shifts route mentions SMS", async () => {
  const { appRoutes } = await import(path.join(ROOT, "server/routes/app.js"));
  const shiftRoutes = appRoutes.filter((r) => r.path.startsWith("/shifts"));
  assert.ok(shiftRoutes.length > 0, "the shift routes vanished");
  for (const r of shiftRoutes) assert.ok(!/sms|otp/i.test(r.path), `${r.path} is SMS-shaped`);

  const app = read("server/routes/app.js");
  for (const forbidden of ["smsConfigured", "sendSms", "sms_deliveries", "otp_challenges", "TWILIO"]) {
    assert.ok(!app.includes(forbidden), `routes/app.js mentions ${forbidden} — SMS reached the clock-in path`);
  }
  ok(`${shiftRoutes.length} /shifts routes, and routes/app.js does not import or mention SMS at all`);
});

if (failures > 0) {
  console.error(`\nFAIL check-fallback-reachable: ${failures} case(s) — THE OWNER'S "ALWAYS" IS BROKEN`);
  process.exit(1);
}
console.log("\nOK check-fallback-reachable");
process.exit(0);
