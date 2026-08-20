// The states demo/shoot-look.mjs cannot reach, in the two desktop configurations.
//
//   node demo/shoot-look-states.mjs        (needs the same stack as demo/shoot-look.mjs)
//
// shoot-look.mjs photographs seventeen screens against whatever nfc_demo happens to hold.
// It therefore photographs "many rows, nothing unusual" seventeen times. What it cannot
// photograph:
//
//   NEVER SEEN   `/tags/` with a tag in it. `reported_tags` is EMPTY in nfc_demo, so the
//                one screen the whole write→report→resolve flow ends on has only ever been
//                looked at in its empty state — including by the agent that built it.
//   MONEY        `/pl/` with a margin baseline set. `app_settings` ships empty, so the
//                flagged-building blocks — the actual OUTPUT of that screen — have never
//                been on a screen. Same for `/inventory/`'s `noCost`: every seeded item is
//                priced, so the rule "0 € means nobody priced this, not free" has never
//                been rendered.
//   TRANSIENT    loading / error / 401. They last milliseconds. Produced by patching
//                `window.fetch` INSIDE the page after sign-in.
//   OVERLAY      drawers, confirm modals and the one-shot secret panels. They exist only
//                after a click.
//   ROW COUNT    one row, and no rows. This project has passed checks over zero rows five
//                times; the reverse trap is judging a table that only ever had eight.
//
// THE DATABASE IS MUTATED. `pg_dump -Fc` runs before the first UPDATE, the restore is in a
// `finally`, and the run ends by comparing every table's row count with the counts taken
// before it started. A probe killed mid-run skips its finally — so the dump on disk, and
// not the finally, is the actual guarantee.
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
const DB = process.env.DEMO_DB ?? "nfc_demo";
const OUT = new URL("../docs/media/look/", import.meta.url).pathname;
const DUMP = "/tmp/look/nfc_demo-before-look-states.dump";

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`shoot-look-states: refusing to shoot "${host}" — loopback only.`);
  process.exit(1);
}
if (DB !== "nfc_demo") {
  console.error(`shoot-look-states: refusing to write to "${DB}" — nfc_demo only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const sql = (q) => execFileSync("psql", ["-d", DB, "-tAc", q], { encoding: "utf8" }).trim();
const exec = (q) => execFileSync("psql", ["-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", q], { encoding: "utf8" });

mkdirSync(OUT, { recursive: true });
mkdirSync("/tmp/look", { recursive: true });

const TABLES = sql(
  "SELECT string_agg(table_name, ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
).split(" ");
const fingerprint = () => TABLES.map((t) => `${t} ${sql(`SELECT count(*) FROM ${t}`)}`).join("\n");
const BEFORE = fingerprint();
writeFileSync("/tmp/look/db-fingerprint-before.txt", `${BEFORE}\n`);
execFileSync("pg_dump", ["-Fc", "-f", DUMP, DB]);
console.log(`shoot-look-states: dump -> ${DUMP}\n${BEFORE.replace(/^/gm, "  ")}`);

const CONFIGS = [
  { w: 1680, h: 1000, theme: "dark" },
  { w: 1680, h: 1000, theme: "light" },
].filter((c) => !process.env.LOOK_CONFIG || `${c.w}-${c.theme}` === process.env.LOOK_CONFIG);

const report = { at: new Date().toISOString(), shots: [], notes: [] };

async function freePort(from) {
  for (let port = from; port < from + 80; port++) {
    const ok = await new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error(`no free debugging port in ${from}..${from + 80}`);
}

async function shot(page, file) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}${file}`, Buffer.from(data, "base64"));
  report.shots.push(file);
  console.log(`  ${file}`);
}

async function signIn(page) {
  await page.goto(`${BASE}/login/`, { settle: 600 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: "sign-in button" });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { label: "dashboard", timeout: 20000 });
  await sleep(600);
}

// ------------------------------------------------------------------------------------
// SEED. Every row created here is created because the state it produces does not exist.
// ------------------------------------------------------------------------------------
const OP1 = sql("SELECT id FROM operators WHERE active ORDER BY id LIMIT 1");
const TAG_A = "0f5a91c2-31b7-4e2c-9a44-1c86d5b0e771";
const TAG_B = "3d21ba55-8c94-4f10-b2d7-6e0a44c1f9ab";
const TAG_C = "a7c40e19-52d8-4b63-8f05-9b71c3ea2d40";

let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  execFileSync("pg_restore", ["-c", "--if-exists", "-d", DB, DUMP], { stdio: "ignore" });
  const after = fingerprint();
  writeFileSync("/tmp/look/db-fingerprint-after.txt", `${after}\n`);
  console.log(after === BEFORE ? "\nshoot-look-states: database restored, fingerprint MATCHES" : `\nshoot-look-states: FINGERPRINT DRIFT\n${after}`);
};
process.on("SIGINT", () => { restore(); process.exit(130); });

try {
  // /tags/: three reported tags. One reported by a named operator, one whose operator row
  // is gone (`ON DELETE SET NULL` -> the screen's `(unbekannt)` branch), one more so the
  // table is not a single row pretending to be a list.
  exec(`INSERT INTO reported_tags (id, reported_at, reported_by_operator_id) VALUES
    ('${TAG_A}', now() - interval '2 hours', ${OP1}),
    ('${TAG_B}', now() - interval '1 day', NULL),
    ('${TAG_C}', now() - interval '3 days', ${OP1})`);

  // /pl/: a margin baseline, so the flagged blocks render at all.
  exec(`INSERT INTO app_settings (key, value) VALUES ('pl_margin_baseline_bp', '3000')
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`);

  // /inventory/: one item nobody has priced. 0 is NOT free — the screen has a string for
  // that and it has never been rendered.
  const ITEM = sql("SELECT id FROM inventory_items ORDER BY name LIMIT 1");
  exec(`UPDATE inventory_items SET unit_cost_cents = 0 WHERE id = ${ITEM}`);

  // /locations/ + /pl/ + the greyscale test: one deactivated building.
  const LOC = sql("SELECT id FROM locations WHERE active ORDER BY name DESC LIMIT 1");
  exec(`UPDATE locations SET active = false WHERE id = '${LOC}'`);

  for (const [index, cfg] of (process.env.LOOK_PHASE === "rows" ? [] : CONFIGS).entries()) {
    const tag = `${cfg.w}-${cfg.theme}`;
    console.log(`\n=== ${tag} ===`);
    const { child, port } = await launchChrome({ port: await freePort(9800 + index * 12), width: cfg.w, height: cfg.h });
    const page = await attach(port);
    try {
      await page.send("Emulation.setDeviceMetricsOverride", { width: cfg.w, height: cfg.h, deviceScaleFactor: 1, mobile: false });
      await page.goto(`${BASE}/login/`, { settle: 300 });
      await page.eval(`localStorage.setItem('nfcts.theme', ${JSON.stringify(cfg.theme)})`);

      // ---- login, wrong credentials (the ONE message, no user-enumeration oracle) ------
      await page.goto(`${BASE}/login/`, { settle: 900 });
      await page.type('input[name="email"]', "schimmer", { perChar: 0 });
      await page.type('input[name="password"]', "definitely-wrong", { perChar: 0 });
      await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
      await sleep(1400);
      await shot(page, `s01-login-failed-${tag}.png`);

      await signIn(page);

      // ---- /tags/ with rows, and the three action shapes -------------------------------
      await page.goto(`${BASE}/tags/`, { settle: 1600 });
      await shot(page, `s02-tags-rows-${tag}.png`);
      // "Neue Zone in bestehendem Gebäude" — the second radio, which swaps the sub-form.
      await page.eval(`document.querySelectorAll('input[type=radio]')[1].click()`);
      await sleep(500);
      await shot(page, `s03-tags-zone-form-${tag}.png`);
      // Submit with nothing filled in: the row-level refusal.
      await page.clickText("Zuordnen", { selector: "button" });
      await sleep(900);
      await shot(page, `s04-tags-row-error-${tag}.png`);
      // And a refusal that comes from the SERVER, whose code the screen prints verbatim:
      // resolve a tag to a building whose slug is already taken.
      await page.eval(`document.querySelectorAll('input[type=radio]')[0].click()`);
      await sleep(300);
      const taken = sql("SELECT slug FROM locations ORDER BY name LIMIT 1");
      const inputs = `document.querySelectorAll('tbody tr')[0].querySelectorAll('input[type=text], input:not([type])')`;
      await page.eval(`(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        const els = ${inputs}
        set.call(els[0], 'Doppelter Slug'); els[0].dispatchEvent(new Event('input', { bubbles: true }))
        set.call(els[1], ${JSON.stringify(taken)}); els[1].dispatchEvent(new Event('input', { bubbles: true }))
        return els.length
      })()`);
      await sleep(300);
      await page.clickText("Zuordnen", { selector: "button" });
      await sleep(1400);
      await shot(page, `s05-tags-server-refusal-${tag}.png`);

      // ---- /operators/: drawer, validation, fresh code, confirm modal ------------------
      await page.goto(`${BASE}/operators/`, { settle: 1400 });
      await page.clickText("Operator anlegen", { selector: "button.btn-primary" });
      await sleep(700);
      await shot(page, `s06-operators-drawer-${tag}.png`);
      await page.clickText("Operator anlegen", { selector: 'button[type="submit"]' });
      await sleep(700);
      await shot(page, `s07-operators-drawer-errors-${tag}.png`);
      await page.eval(`document.querySelector('.drawer button.btn-ghost')?.click()`);
      await sleep(500);
      await page.clickText("Zugangscode erstellen", { selector: "button" });
      await sleep(1600);
      await shot(page, `s08-operators-fresh-code-${tag}.png`);
      await page.clickText("Neuen Zugangscode erstellen", { selector: "button" });
      await sleep(700);
      await shot(page, `s09-operators-confirm-${tag}.png`);
      await page.eval(`document.querySelector('dialog[open] .btn-ghost, .modal .btn-ghost')?.click()`);
      await sleep(400);

      // ---- /workers/: the same one-shot secret, in the house style --------------------
      await page.goto(`${BASE}/workers/`, { settle: 1400 });
      await page.clickText("Zugangscode erstellen", { selector: "button" });
      await sleep(1600);
      await shot(page, `s10-workers-fresh-code-${tag}.png`);
      await page.goto(`${BASE}/workers/`, { settle: 1200 });
      await page.clickText("Mitarbeiter anlegen", { selector: "button.btn-primary" });
      await sleep(800);
      await shot(page, `s11-workers-drawer-${tag}.png`);

      // ---- /pl/ WITH a baseline: the flagged blocks, never photographed ----------------
      await page.goto(`${BASE}/pl/`, { settle: 2200 });
      await shot(page, `s12-pl-baseline-fold-${tag}.png`);
      await page.eval(`document.querySelector('.panel, .list-panel, h2')&&window.scrollTo(0, 700)`);
      await sleep(600);
      await shot(page, `s13-pl-flagged-${tag}.png`);

      // ---- /inventory/ with an unpriced item -------------------------------------------
      await page.goto(`${BASE}/inventory/`, { settle: 1400 });
      await shot(page, `s14-inventory-unpriced-${tag}.png`);

      // ---- /locations/ with an inactive building, and the tag disclosure open ----------
      await page.goto(`${BASE}/locations/`, { settle: 1600 });
      await page.eval(`document.querySelectorAll('details')[0]?.setAttribute('open','')`);
      await sleep(500);
      await shot(page, `s15-locations-tag-open-${tag}.png`);

      // ---- /shifts/: an empty period that is NOT an empty database ---------------------
      await page.goto(`${BASE}/shifts/?period=thisMonth`, { settle: 1600 });
      await shot(page, `s16-shifts-empty-period-${tag}.png`);
      await page.goto(`${BASE}/shifts/`, { settle: 1800 });
      await page.clickText("Korrigieren", { selector: "button" });
      await sleep(900);
      await shot(page, `s17-shifts-correct-${tag}.png`);

      // ---- the client portal: the ready state, and the one failure message -------------
      await page.goto(`${BASE}/reinigung/#k=nicht-echt`, { settle: 1600 });
      await shot(page, `s18-portal-invalid-${tag}.png`);

      // ---- TRANSIENT: loading, error, 401 ----------------------------------------------
      // A loading screen is a fetch that never settles; there is no other way to hold one
      // still. Installed for the NEXT document so it is in place before React's first
      // effect runs.
      const patch = async (body) => {
        await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const real = window.fetch; window.fetch = ${body} })()` });
      };
      await patch(`(input, init) => (String(input).includes('/admin/') ? new Promise(() => {}) : real(input, init))`);
      await page.goto(`${BASE}/payroll/`, { settle: 1800 });
      await shot(page, `s19-payroll-loading-${tag}.png`);
      await page.goto(`${BASE}/`, { settle: 1800 });
      await shot(page, `s20-home-loading-${tag}.png`);

      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => { const real = window.fetch; window.fetch = (i, o) => (String(i).includes('/admin/') ? Promise.reject(new TypeError('Failed to fetch')) : real(i, o)) })()`,
      });
      await page.goto(`${BASE}/payroll/`, { settle: 2000 });
      await shot(page, `s21-payroll-offline-${tag}.png`);
      await page.goto(`${BASE}/shifts/`, { settle: 2000 });
      await shot(page, `s22-shifts-offline-${tag}.png`);

      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => { const real = window.fetch; window.fetch = (i, o) => (String(i).includes('/admin/') ? Promise.resolve(new Response('{"error":"server"}', { status: 500, headers: { 'content-type': 'application/json' } })) : real(i, o)) })()`,
      });
      await page.goto(`${BASE}/pl/`, { settle: 2000 });
      await shot(page, `s23-pl-server-error-${tag}.png`);

      // 401: the contract is that a dead session must NOT render an empty table that reads
      // as "no data". What is photographed is therefore wherever the screen ends up.
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => { const real = window.fetch; window.fetch = (i, o) => (String(i).includes('/admin/') ? Promise.resolve(new Response('{"error":"unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } })) : real(i, o)) })()`,
      });
      await page.goto(`${BASE}/payroll/`, { settle: 2200 });
      report.notes.push({ shot: `s24-payroll-401-${tag}.png`, path: await page.eval("location.pathname") });
      await shot(page, `s24-payroll-401-${tag}.png`);
    } finally {
      page.close();
      child.kill();
    }
  }

  // ---- ROW COUNT: one row, and none at all ------------------------------------------
  // Done last, in one browser, because it deletes the data every shot above needs.
  {
    const { child, port } = await launchChrome({ port: await freePort(9860), width: 1680, height: 1000 });
    const page = await attach(port);
    try {
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
      await page.goto(`${BASE}/login/`, { settle: 300 });
      await page.eval(`localStorage.setItem('nfcts.theme','dark')`);
      await signIn(page);

      exec(`DELETE FROM reported_tags WHERE id IN ('${TAG_B}','${TAG_C}')`);
      await page.goto(`${BASE}/tags/`, { settle: 1500 });
      await shot(page, "s25-tags-one-row-1680-dark.png");

      exec("DELETE FROM material_requests WHERE status <> 'submitted'");
      await page.goto(`${BASE}/material-requests/`, { settle: 1600 });
      await shot(page, "s26-materials-few-1680-dark.png");

      // The whole ledger gone. This is what a brand-new deployment looks like, and it is
      // the state five checks in this repo have passed over without anybody seeing it.
      exec("DELETE FROM shifts");
      await page.goto(`${BASE}/`, { settle: 2600 });
      await shot(page, "s27-home-no-shifts-1680-dark.png");
      await page.goto(`${BASE}/shifts/`, { settle: 1800 });
      await shot(page, "s28-shifts-empty-db-1680-dark.png");
      await page.goto(`${BASE}/payroll/`, { settle: 1800 });
      await shot(page, "s29-payroll-empty-db-1680-dark.png");
      await page.goto(`${BASE}/pl/`, { settle: 2000 });
      await shot(page, "s30-pl-empty-db-1680-dark.png");
      await page.goto(`${BASE}/analytics/`, { settle: 2000 });
      await shot(page, "s31-analytics-empty-db-1680-dark.png");

      // `phone_identities` has a CHECK that a row claims SOMEBODY, and the operator FK is
      // ON DELETE SET NULL — so deleting an operator with no worker on the same number
      // makes the check fail. The identity goes first.
      exec("DELETE FROM phone_identities WHERE operator_id IS NOT NULL AND worker_id IS NULL");
      exec("UPDATE phone_identities SET operator_id = NULL WHERE operator_id IS NOT NULL");
      exec("DELETE FROM operators");
      await page.goto(`${BASE}/operators/`, { settle: 1500 });
      await shot(page, "s32-operators-empty-1680-dark.png");

      exec("DELETE FROM inventory_items");
      await page.goto(`${BASE}/inventory/`, { settle: 1400 });
      await shot(page, "s33-inventory-empty-1680-dark.png");

      exec("DELETE FROM phone_identities; DELETE FROM portal_grants; DELETE FROM location_revenue; DELETE FROM location_contracts; DELETE FROM material_requests; DELETE FROM zones; DELETE FROM tag_aliases; DELETE FROM reported_tags; DELETE FROM locations; DELETE FROM contacts; DELETE FROM clients; DELETE FROM workers");
      await page.goto(`${BASE}/workers/`, { settle: 1400 });
      await shot(page, "s34-workers-empty-1680-dark.png");
      await page.goto(`${BASE}/locations/`, { settle: 1400 });
      await shot(page, "s35-locations-empty-1680-dark.png");
      await page.goto(`${BASE}/clients/`, { settle: 1400 });
      await shot(page, "s36-clients-empty-1680-dark.png");
      await page.goto(`${BASE}/contracts/`, { settle: 1400 });
      await shot(page, "s37-contracts-empty-1680-dark.png");
      await page.goto(`${BASE}/`, { settle: 2600 });
      await shot(page, "s38-home-empty-1680-dark.png");
    } finally {
      page.close();
      child.kill();
    }
  }
} finally {
  restore();
}

writeFileSync(`${OUT}states-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nshoot-look-states: ${report.shots.length} shot(s) -> ${OUT}`);
