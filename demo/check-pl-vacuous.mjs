// LOOK.md W1, W4, W5, W6 — money that reads as a clean answer over a state that was never
// measured. Each condition is SEEDED, not waited for, because none of them occur naturally
// in nfc_demo as shipped: labour is never zero while revenue is typed, the margin baseline
// is always set once seeded, and every material request nfc_demo ships is priced.
//
//   «stack»  seeded nfc_demo + the API serving a build of these screens (loopback only)
//   DEMO_BASE=http://127.0.0.1:8092 node demo/check-pl-vacuous.mjs
//
// THE DATABASE IS MUTATED. `pg_dump -Fc` runs before the first UPDATE/DELETE, the restore
// is in a `finally`, and the run ends by comparing a per-table row-count fingerprint against
// the one taken before it started — the same guarantee demo/shoot-look-states.mjs makes, for
// the same reason: a probe killed mid-run skips its `finally`, so the dump on disk is the
// actual guarantee, not the restore call.
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8092";
const DB = process.env.DEMO_DB ?? "nfc_demo";
const DUMP = "/tmp/ts-demo/nfc_demo-before-check-pl-vacuous.dump";

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-pl-vacuous: refusing "${host}" — loopback only.`);
  process.exit(1);
}
if (DB !== "nfc_demo") {
  console.error(`check-pl-vacuous: refusing to write to "${DB}" — nfc_demo only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const sql = (q) => execFileSync("psql", ["-d", DB, "-tAc", q], { encoding: "utf8" }).trim();
const exec = (q) => execFileSync("psql", ["-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", q], { encoding: "utf8" });

mkdirSync("/tmp/ts-demo", { recursive: true });

const TABLES = sql(
  "SELECT string_agg(table_name, ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
).split(" ");
const fingerprint = () => TABLES.map((t) => `${t} ${sql(`SELECT count(*) FROM ${t}`)}`).join("\n");
const BEFORE = fingerprint();
execFileSync("pg_dump", ["-Fc", "-f", DUMP, DB]);
console.log(`check-pl-vacuous: dump -> ${DUMP}`);

let failures = 0;
const assert = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
};

let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  execFileSync("pg_restore", ["-c", "--if-exists", "-d", DB, DUMP], { stdio: "ignore" });
  const after = fingerprint();
  console.log(
    after === BEFORE
      ? "check-pl-vacuous: database restored, fingerprint MATCHES"
      : `check-pl-vacuous: FINGERPRINT DRIFT\n${after}`,
  );
};
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

async function signIn(page) {
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: "sign-in button" });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 15000, label: "the dashboard" });
}

const VISIBLE_TEXT = `(() => {
  const out = []
  const walk = (node) => {
    for (const el of node.children) {
      if (!el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: false, visibilityProperty: true })) continue
      if (el.children.length === 0) out.push((el.textContent || '').trim())
      else walk(el)
    }
  }
  walk(document.body)
  return out.join('\\n')
})()`;

async function main() {
  const port0 = 9700 + (process.pid % 300);
  const { child, port } = await launchChrome({ port: port0, width: 1680, height: 1000 });
  const page = await attach(port);

  try {
    await signIn(page);

    // ---------------------------------------------------------------------------------
    // SEED 1 (W1 + W6): every shift this period gone. Real revenue stays typed for
    // whichever buildings already had it, so /pl/ prices a real month at zero cost, and
    // /payroll/ has a totally empty ledger for the same period.
    // ---------------------------------------------------------------------------------
    exec(`UPDATE shifts SET end_time = start_time + interval '1 minute' WHERE end_time IS NULL`); // close anything open first, or the DELETE below still leaves it referenced elsewhere
    exec(`DELETE FROM shifts`);

    // lastMonth, not thisMonth: nfc_demo's seeded revenue rows are dated to whole past
    // calendar months (decision-42 — a typed monthly figure cannot land on a period still
    // running), so "this month" has no revenue at all yet and marginBp would stay null for
    // an unrelated reason, proving nothing about the caveat under test.
    console.log("\nW1 · /pl/ with zero recorded hours and real revenue");
    await page.goto(`${BASE}/pl/?period=lastMonth`, { settle: 1200 });
    await page.waitFor(`document.querySelector('.answer')`, { timeout: 15000, label: "the answer band" });
    await sleep(300);
    let text = await page.eval(VISIBLE_TEXT);
    const profitCell = await page.eval(`(() => {
      const cell = [...document.querySelectorAll('.answer .cell')].find((c) => (c.querySelector('.k')?.textContent || '').trim() === 'Ergebnis')
      return cell ? (cell.querySelector('.v')?.textContent || '').trim() : null
    })()`);
    assert(
      "pl: the seeded period has a COMPUTED profit (a priced building), or this proves nothing",
      profitCell !== null && profitCell !== "Nicht berechenbar",
      `profit cell reads "${profitCell}" — reseed nfc_demo and retry`,
    );
    assert(
      "pl: zero hours against real revenue shows the no-hours caveat, not a silent 100% margin",
      text.includes("keine Arbeitsstunden erfasst"),
      "caveatNoHours not found in visible text",
    );

    console.log("\nW6 · /payroll/ with a totally empty ledger");
    await page.goto(`${BASE}/payroll/?period=thisMonth`, { settle: 1200 });
    await page.waitFor(`document.body.textContent.includes('Auszuzahlen') || document.body.textContent.includes('Es wurde noch keine')`, {
      timeout: 15000,
      label: "payroll settled",
    });
    await sleep(300);
    text = await page.eval(VISIBLE_TEXT);
    assert(
      "payroll: the empty-ledger state is on screen (EmptyState), or this proves nothing",
      /Es wurde noch keine|nichts auszuwerten|noch nichts/.test(text) || !/data-table/.test(await page.eval("document.body.innerHTML")),
      "could not confirm the ledger rendered empty",
    );
    assert(
      "payroll: 'nothing is excluded' is NOT claimed over zero rows",
      !text.includes("Keine Schicht in diesem Zeitraum ist offen"),
      "caveatNoneExcluded is visible over an empty ledger",
    );
    assert(
      "payroll: 'the server agrees' is NOT claimed over zero rows",
      !text.includes("ergeben genau die Summe des Servers"),
      "caveatReconcileOk is visible over an empty ledger",
    );

    // ---------------------------------------------------------------------------------
    // SEED 2 (W4): no margin baseline at all. Every building becomes NOT ASSESSABLE.
    // ---------------------------------------------------------------------------------
    exec(`DELETE FROM app_settings WHERE key = 'pl_margin_baseline_bp'`);

    console.log("\nW4 · /pl/ with no baseline set, every building not assessable");
    await page.goto(`${BASE}/pl/?period=thisMonth`, { settle: 1200 });
    await page.waitFor(`document.querySelector('.answer')`, { timeout: 15000, label: "the answer band" });
    await sleep(300);
    const flaggedCell = await page.eval(`(() => {
      const cell = [...document.querySelectorAll('.answer .cell')].find((c) => (c.querySelector('.k')?.textContent || '').includes('Zielmarge'))
      return cell ? (cell.querySelector('.v')?.textContent || '').trim() : null
    })()`);
    assert(
      "pl: the flagged cell reads 'Nicht beurteilbar', never a bare 0, when NOTHING could be assessed",
      flaggedCell === "Nicht beurteilbar",
      `cell reads "${flaggedCell}"`,
    );

    // ---------------------------------------------------------------------------------
    // SEED 3 (W5): one unpriced material request, ordered this month.
    // ---------------------------------------------------------------------------------
    const REQ = sql("SELECT id FROM material_requests ORDER BY id LIMIT 1");
    assert("setup: nfc_demo has at least one material_requests row", REQ !== "", "material_requests is empty");
    if (REQ !== "") {
      exec(
        `UPDATE material_requests SET status = 'ordered', ordered_at = now(), cost_cents = NULL WHERE id = ${REQ}`,
      );

      console.log("\nW5 · /pl/ with an unpriced material request this period");
      await page.goto(`${BASE}/pl/?period=thisMonth`, { settle: 1200 });
      await page.waitFor(`document.querySelector('.answer')`, { timeout: 15000, label: "the answer band" });
      await sleep(300);
      text = await page.eval(VISIBLE_TEXT);
      assert(
        "pl: an unpriced material request is stated where the Material column it changes is, not only 1400px down",
        text.includes("keinen hinterlegten Preis") && text.includes("Kein Preis hinterlegt"),
        "caveatMaterialUnpriced not found in visible text",
      );
    }
  } finally {
    child.kill("SIGKILL");
    restore();
  }

  console.log(failures ? `\ncheck-pl-vacuous: FAIL (${failures})` : "\ncheck-pl-vacuous: all checks green");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  restore();
  process.exit(1);
});
