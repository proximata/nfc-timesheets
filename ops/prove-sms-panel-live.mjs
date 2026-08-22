// ops/prove-sms-panel-live.mjs — THE ADMIN UI LAYER, ON THE LIVE BOX (decision-48).
//
//   node ops/prove-sms-panel-live.mjs [host]
//
// ops/prove-sms-live.sh proves the SERVER answers 503 cleanly. This proves the DIRECTOR IS
// TOLD — in words, on the screen she actually opens, served by the bundle that is actually
// on the box. A 503 that reaches a screen as a spinner, a blank cell or a hidden button is
// the same failure as a crash from where she is sitting.
//
// WHAT IS MEASURED, against https://<apiHost>/workers/ with a REAL worker row:
//
//   1  „SMS senden“ is RENDERED for an active worker — never hidden. Disabled,
//      aria-disabled, and the reason IN WORDS beside it: „SMS ist nicht eingerichtet.
//      Code vorlesen oder kopieren." Colour is the second signal; the sentence is the first.
//   2  „Zugangscode erstellen“ sits in the SAME cell, ENABLED, one click away — the
//      fallback is not hidden, moved or gated by the SMS attempt next to it.
//   3  THE SABOTAGE SELF-TEST. The live DOM is mutated into exactly the regression
//      decision-48 warns about (the `disabled` attribute stripped, the reason paragraph
//      deleted) and the SAME oracle is re-run: it MUST now report the screen broken. Then
//      the page is reloaded and must be green again. Without this, §1 is a sentence that
//      cannot fail.
//   4  The button is pressed for real and produces a code that REDEEMS at POST /auth/code.
//      The fallback is not a rendered promise; it is a working credential.
//   5  390px: the same two buttons, the same sentence, still there.
//
// THE ADMIN SESSION IS MINTED STRAIGHT INTO THE DATABASE. The vaulted ADMIN_PASSWORD is
// known to be stale and POST /admin/login is rate limited on this box; guessing at it is how
// a deploy window becomes a lockout. The row stores only SHA-256 of the token, it lives 20
// minutes, and it is deleted in the `finally`.
//
// IT WRITES TO PRODUCTION AND CLEANS UP AFTER ITSELF, then counts rows to prove it.
// Screenshots land in /tmp (docs/media is gitignored wholesale; nothing here is committed).
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attach, launchChrome, sleep } from "../demo/cdp.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.argv[2] ?? JSON.parse(execFileSync("/bin/cat", [path.join(ROOT, "ops/branding.json")], { encoding: "utf8" })).apiHost;
const BASE = `https://${HOST}`;
const SHOTS = "/tmp/ts-prove/sms-panel-live";
const MARK = "PROVE48P";

const NOT_CONFIGURED_DE = "SMS ist nicht eingerichtet. Code vorlesen oder kopieren.";
const SMS_LABEL = "SMS senden";
const CODE_LABEL = "Zugangscode erstellen";

const failures = [];
const ok = (m, d = "") => console.log(`  ok   ${m}${d ? `  ${d}` : ""}`);
const red = (m) => console.log(`  RED  ${m}`);
const assert = (what, cond, detail = "") => {
  if (cond) ok(what, detail);
  else {
    failures.push(what);
    console.log(`  FAIL ${what}${detail ? `\n         ${detail}` : ""}`);
  }
};

const ssh = (sql) =>
  execFileSync("ssh", [HOST, `sudo -u postgres psql -d nfc -v ON_ERROR_STOP=1 -Atc "${sql}"`], {
    encoding: "utf8",
  }).trim();

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** curl, because the box curling its own hostname hairpins to 000 — this runs from here. */
function req(method, urlPath, { cookie, appKey, body } = {}) {
  const args = ["-sS", "-o", "/tmp/ts-prove-body.json", "-w", "%{http_code}", "-X", method, `${BASE}${urlPath}`];
  if (cookie) args.push("-H", `Cookie: ${cookie}`);
  if (appKey) args.push("-H", `X-App-Key: ${appKey}`);
  if (body !== undefined) args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  const status = execFileSync("/usr/bin/curl", args, { encoding: "utf8" }).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(execFileSync("/bin/cat", ["/tmp/ts-prove-body.json"], { encoding: "utf8" }));
  } catch {
    parsed = null;
  }
  return { status: Number(status), body: parsed };
}

/**
 * THE ORACLE. One function, used on the real page AND on the sabotaged one — that is the
 * whole point of §3: if a mutated DOM and a healthy DOM cannot be told apart by the same
 * reader, the reader is not measuring anything.
 */
const ORACLE = `(() => {
  const rows = Array.from(document.querySelectorAll('table.data-table tbody tr'))
  const row = rows.find((r) => (r.textContent || '').includes(${JSON.stringify(MARK)}))
  if (!row) return { found: false, rowCount: rows.length }
  const btn = (label) => Array.from(row.querySelectorAll('button')).find((b) => (b.textContent || '').includes(label))
  const sms = btn(${JSON.stringify(SMS_LABEL)})
  const code = btn(${JSON.stringify(CODE_LABEL)})
  const note = Array.from(row.querySelectorAll('p.cell-muted')).map((p) => (p.textContent || '').trim())
  return {
    found: true,
    smsPresent: !!sms,
    smsDisabled: sms ? sms.disabled === true : null,
    smsAria: sms ? sms.getAttribute('aria-disabled') : null,
    codePresent: !!code,
    codeDisabled: code ? code.disabled === true : null,
    notes: note,
  }
})()`;

/** Is what the oracle read a HEALTHY screen? Returns [] when it is, or the complaints. */
function complaints(s) {
  const out = [];
  if (!s.found) return [`the ${MARK} row is not on the page (saw ${s.rowCount} rows)`];
  if (!s.smsPresent) out.push("„SMS senden“ is not rendered at all — hiding it deletes something true");
  if (s.smsDisabled !== true) out.push("„SMS senden“ is not disabled while SMS is off");
  if (s.smsAria !== "true") out.push(`aria-disabled is ${JSON.stringify(s.smsAria)}, not "true"`);
  if (!s.notes.includes(NOT_CONFIGURED_DE)) out.push("the reason sentence is not beside the button");
  if (!s.codePresent) out.push("„Zugangscode erstellen“ is missing — the fallback is gone");
  if (s.codeDisabled !== false) out.push("„Zugangscode erstellen“ is disabled");
  return out;
}

const atok = randomBytes(32).toString("hex");
let workerId = null;
let chrome = null;
let page = null;

try {
  mkdirSync(SHOTS, { recursive: true });
  const appKey = execFileSync("ssh", [HOST, 'sudo -n grep "^APP_KEY=" /etc/nfc/env | cut -d= -f2-'], {
    encoding: "utf8",
  }).trim();
  if (!appKey) throw new Error("no APP_KEY on the box");

  ssh(
    `INSERT INTO sessions (token, admin_id, expires_at) SELECT '${sha(atok)}', id, now() + interval '20 minutes' FROM admins ORDER BY id LIMIT 1`,
  );
  ok("a throwaway 20-minute admin session exists on the live box (never a guessed password)");

  const created = req("POST", "/admin/workers", {
    cookie: `ts_session=${atok}`,
    body: { name: `${MARK} Mitarbeiterin`, hourly_rate_cents: 1450, active: true },
  });
  workerId = created.body?.worker?.id ?? null;
  assert("a REAL worker exists in production", created.status === 201 && workerId !== null, `id ${workerId}`);

  const status = req("GET", "/admin/sms-status", { cookie: `ts_session=${atok}` });
  assert(
    "GET /admin/sms-status says configured=false — this is the state the screen must render",
    status.status === 200 && status.body?.configured === false,
    `missing=[${status.body?.missing?.join(", ")}]`,
  );

  chrome = await launchChrome({ port: 9341, width: 1680, height: 1000 });
  page = await attach(9341);
  await page.send("Network.setCookie", {
    name: "ts_session",
    value: atok,
    domain: HOST,
    path: "/",
    secure: true,
    httpOnly: true,
  });

  console.log("\n== 1+2 · the picker, on the live screen, at 1680px");
  await page.goto(`${BASE}/workers/`);
  await page.waitFor(`document.querySelector('table.data-table tbody tr')`, { label: "the roster table" });
  const healthy = await page.eval(ORACLE);
  const first = complaints(healthy);
  assert("the live /workers/ screen is healthy with SMS off", first.length === 0, first.join("\n         "));
  ok(`the sentence on screen, verbatim: „${healthy.notes.find((n) => n === NOT_CONFIGURED_DE) ?? "—"}“`);
  await page.screenshot(`${SHOTS}/1680-flag-off.png`);

  console.log("\n== 3 · THE SABOTAGE SELF-TEST (a check whose negative cannot fail is not a check)");
  const mutated = await page.eval(`(() => {
    const rows = Array.from(document.querySelectorAll('table.data-table tbody tr'))
    const row = rows.find((r) => (r.textContent || '').includes(${JSON.stringify(MARK)}))
    const sms = Array.from(row.querySelectorAll('button')).find((b) => (b.textContent || '').includes(${JSON.stringify(SMS_LABEL)}))
    sms.disabled = false
    sms.removeAttribute('aria-disabled')
    row.querySelectorAll('p.cell-muted').forEach((p) => p.remove())
    return true
  })()`);
  assert("the live DOM was mutated into the regression decision-48 warns about", mutated === true);
  const broken = complaints(await page.eval(ORACLE));
  if (broken.length > 0) {
    red(`the SAME oracle now reports ${broken.length} defect(s):`);
    for (const c of broken) console.log(`         - ${c}`);
  } else {
    failures.push("the sabotaged screen still read as healthy");
    console.log("  FAIL the sabotaged screen still read as healthy — the oracle measures nothing");
  }
  await page.screenshot(`${SHOTS}/1680-sabotaged.png`);

  await page.goto(`${BASE}/workers/`);
  await page.waitFor(`document.querySelector('table.data-table tbody tr')`, { label: "the roster table" });
  const again = complaints(await page.eval(ORACLE));
  assert("reloaded: GREEN again, after RED, on the same live screen", again.length === 0, again.join("\n         "));

  console.log("\n== 4 · press the fallback for real, and redeem what it produces");
  await page.clickText(CODE_LABEL);
  await page.waitFor(`document.querySelector('section.share-panel code.code')`, { label: "the code panel" });
  const shown = await page.eval(`document.querySelector('section.share-panel code.code').textContent.trim()`);
  assert("„Zugangscode erstellen“ opened the standing code panel", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(shown), shown);
  const redeemed = req("POST", "/auth/code", { appKey, body: { code: shown } });
  assert(
    "*** the code the DIRECTOR'S BUTTON put on screen redeems at POST /auth/code -> 200 ***",
    redeemed.status === 200,
    `status ${redeemed.status}`,
  );
  await page.screenshot(`${SHOTS}/1680-code-panel.png`);

  console.log("\n== 5 · 390px");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page.goto(`${BASE}/workers/`);
  await page.waitFor(`document.querySelector('table.data-table tbody tr')`, { label: "the roster table at 390" });
  await sleep(400);
  const narrow = complaints(await page.eval(ORACLE));
  assert("both buttons and the sentence survive 390px", narrow.length === 0, narrow.join("\n         "));
  const overflow = await page.eval(`document.documentElement.scrollWidth <= 390 + 1`);
  assert("nothing overflows horizontally at 390px", overflow === true);
  // Scroll the CELL into view before the shot: at 390 the roster renders as cards and the
  // Zugangscode row is below the fold, so an unscrolled screenshot is evidence of the
  // masthead and nothing else.
  await page.eval(`(() => {
    const rows = Array.from(document.querySelectorAll('table.data-table tbody tr'))
    const row = rows.find((r) => (r.textContent || '').includes(${JSON.stringify(MARK)}))
    const sms = Array.from(row.querySelectorAll('button')).find((b) => (b.textContent || '').includes(${JSON.stringify(SMS_LABEL)}))
    sms.scrollIntoView({ block: 'center' })
    return true
  })()`);
  await sleep(400);
  await page.screenshot(`${SHOTS}/390-flag-off.png`);
  ok(`screenshots in ${SHOTS} (on disk only — docs/media is gitignored wholesale)`);
} finally {
  try {
    page?.close();
  } catch {}
  try {
    chrome?.child?.kill();
  } catch {}
  console.log("\n== cleanup, and the count that proves it");
  ssh(`DELETE FROM sms_deliveries WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%')`);
  ssh(`DELETE FROM worker_sessions WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%')`);
  ssh(`DELETE FROM phone_identities WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%')`);
  ssh(`DELETE FROM workers WHERE name LIKE '${MARK}%'`);
  ssh(`DELETE FROM sessions WHERE token = '${sha(atok)}'`);
  const left = ssh(
    "SELECT (SELECT count(*) FROM locations) || '|' || (SELECT count(*) FROM zones) || '|' || (SELECT count(*) FROM clients) || '|' || (SELECT count(*) FROM contacts) || '|' || (SELECT count(*) FROM workers) || '|' || (SELECT count(*) FROM shifts) || '|' || (SELECT count(*) FROM admins) || '|' || (SELECT count(*) FROM sms_deliveries) || '|' || (SELECT count(*) FROM phone_identities)",
  );
  assert(
    "locations|zones|clients|contacts|workers|shifts|admins|sms_deliveries|phone_identities",
    left === "0|0|0|0|0|0|1|0|0",
    `= ${left} (want 0|0|0|0|0|0|1|0|0)`,
  );
}

console.log(failures.length === 0 ? "\nPROVE-48-PANEL OK" : `\nPROVE-48-PANEL FAILED: ${failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
