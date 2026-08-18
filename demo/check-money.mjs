// The runnable check for the TWO money lies in backlog/docs/STATE-GALLERY.md §2(a).
//
//   «stack»  seeded nfc_demo + the API serving a build of these screens (loopback only)
//   DEMO_BASE=http://127.0.0.1:8093 node demo/check-money.mjs
//
// A1 — /pl/ (and /analytics/) report a period that has NOT FINISHED as if it had. The
// contract fee accrues for every contract-valid day in the range (server/lib/reporting.js
// `contractSlice`) while labour only exists for days that have happened, so „Dieses Jahr“
// in August books five more months of revenue against three weeks of work and reports
// 99,25 % Marge for a building in its first week. The same accrual drives /analytics/'s
// target minutes, where it lies in the other direction: every building reads as UNDER the
// agreed time because four months of target are compared against nothing.
//
// A2 — /payroll/'s „Nicht gezählt“ counted SHIFTS. A worker with hours and no hourly rate
// is not a shift, so the cell that exists to name what is missing read 0 while 810,30 € of
// somebody's wages were missing from the payout above it.
//
// WHAT MAKES THESE ASSERTIONS ABLE TO FAIL, which is the only property that matters:
//
//   1. THE DAY COUNT HAS AN INDEPENDENT ORACLE. `unhappenedDays` below is computed here,
//      from Intl in Europe/Vienna, and NOT imported from web/lib/period.ts. A check that
//      re-runs the implementation and compares it with itself is green for every wrong
//      answer both of them agree on.
//   2. EVERY POSITIVE ASSERTION HAS A NEGATIVE TWIN. „the line is there for Dieses Jahr“
//      is worth nothing without „and it is NOT there for Voriger Monat“, which is the one
//      that fails if somebody renders the sentence unconditionally.
//   3. THE PAYROLL COUNT IS ASSERTED AGAINST THE MONEY IT STANDS FOR. Not „the cell is
//      non-zero" — the payout DROP caused by taking one worker's rate away is measured,
//      and the cell, the unvalued-hours line and the drop are required to describe the
//      same person. A cell reading „1“ for the wrong reason fails here.
//
// IT MUTATES nfc_demo. A `pg_dump -Fc` goes to /tmp before the first UPDATE, the restore is
// in a `finally`, and the run ends by comparing every table's row count with the counts
// taken before it started. A probe killed mid-run skips its finally — so the dump on disk,
// and not the finally, is the actual guarantee.
//
// No new dependency: demo/cdp.mjs, Node, psql, and the Chrome already on the machine.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8093";
const DB = process.env.DEMO_DB ?? "nfc_demo";
const SHOTS = "/tmp/money/shots";
const DUMP = "/tmp/money/nfc_demo-before-money.dump";
const DEADLINE_MS = 8 * 60 * 1000;
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-money: refusing to run against "${host}" — loopback only.`);
  process.exit(1);
}
// This script UPDATEs rows. The one database it may ever touch is the throwaway one — the
// same refusal demo/seed.sql, demo/make-admin.mjs and demo/shoot-states.mjs make.
if (DB !== "nfc_demo") {
  console.error(`check-money: refusing to write to "${DB}" — nfc_demo only.`);
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });
mkdirSync("/tmp/money", { recursive: true });

const sql = (q) => execFileSync("psql", ["-d", DB, "-tAc", q], { encoding: "utf8" }).trim();
const exec = (q) =>
  execFileSync("psql", ["-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", q], { encoding: "utf8" });

const TABLES = sql(
  "SELECT string_agg(table_name, ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
).split(" ");
const fingerprint = () => TABLES.map((t) => `${t} ${sql(`SELECT count(*) FROM ${t}`)}`).join("\n");
const RATES_BEFORE = sql("SELECT string_agg(id || '=' || hourly_rate_cents, ',' ORDER BY id) FROM workers");
const BEFORE = fingerprint();
execFileSync("pg_dump", ["-Fc", "-f", DUMP, DB]);
console.log(`check-money: dump -> ${DUMP}`);

const failures = [];
function assert(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------------------
// THE INDEPENDENT ORACLE for „how much of this period has not happened“.
//
// Deliberately NOT web/lib/period.ts. Vienna Y-M-D comes from Intl ('en-CA' formats as
// ISO), and two calendar days are subtracted as UTC midnights, which have no daylight
// saving to get wrong. A period ends at the START of its exclusive last day, so `to` is
// itself the first day NOT in the period.
// ---------------------------------------------------------------------------------------
const VIENNA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayNumber = (at) => {
  const [y, m, d] = VIENNA.format(at).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const viennaMidnight = (y, m, d) => {
  // Binary-search-free: try both plausible offsets and keep the instant whose Vienna
  // rendering is the day asked for. Vienna is UTC+1 or UTC+2 and never anything else.
  for (const offset of [1, 2]) {
    const at = new Date(Date.UTC(y, m - 1, d, -offset));
    if (dayNumber(at) === Date.UTC(y, m - 1, d) / 86_400_000) return at;
  }
  throw new Error(`no Vienna midnight for ${y}-${m}-${d}`);
};

const NOW = new Date();
const [ty, tm, td] = VIENNA.format(NOW).split("-").map(Number);
/** `to` (exclusive) of every period this check names, as a Vienna midnight instant. */
const PERIOD_END = {
  thisMonth: viennaMidnight(ty, tm + 1, 1),
  thisQuarter: viennaMidnight(ty, Math.floor((tm - 1) / 3) * 3 + 4, 1),
  thisYear: viennaMidnight(ty + 1, 1, 1),
  lastMonth: viennaMidnight(ty, tm, 1),
};
/** Whole Vienna days of the period that lie after today, i.e. have not happened at all. */
const unhappenedDays = (period) => Math.max(0, dayNumber(PERIOD_END[period]) - (dayNumber(NOW) + 1));
const stillRunning = (period) => PERIOD_END[period].getTime() > NOW.getTime();

console.log(
  `check-money: today is ${VIENNA.format(NOW)} in Vienna. ` +
    `Days not yet happened — thisYear ${unhappenedDays("thisYear")}, ` +
    `thisQuarter ${unhappenedDays("thisQuarter")}, thisMonth ${unhappenedDays("thisMonth")}, ` +
    `lastMonth ${unhappenedDays("lastMonth")}.`,
);

// ---------------------------------------------------------------------------------------
// Reading the screen. Everything below reads RENDERED, VISIBLE text: `offsetParent` is
// required, because a sentence inside a collapsed <details> is a sentence nobody reads and
// `document.body.textContent` cannot tell the two apart.
// ---------------------------------------------------------------------------------------
const READ = `(() => {
  const vis = (el) => el && (el.offsetParent !== null || el === document.body)
  const cells = [...document.querySelectorAll('.answer .cell')].map((c) => ({
    k: (c.querySelector('.k')?.textContent ?? '').trim(),
    v: (c.querySelector('.v')?.textContent ?? '').trim(),
    calm: c.querySelector('.v')?.classList.contains('calm') === true,
    sub: (c.querySelector('.sub')?.textContent ?? '').trim(),
  }))
  const bullets = [...document.querySelectorAll('.callout li, .note p, .notice')]
    .filter(vis)
    .map((el) => el.textContent.replace(/\\s+/g, ' ').trim())
  const rows = [...document.querySelectorAll('table.data-table tbody tr')].map((tr) => ({
    head: (tr.querySelector('th')?.textContent ?? '').trim(),
    tds: [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\\s+/g, ' ').trim()),
  }))
  const foot = [...document.querySelectorAll('table.data-table tfoot tr td, table.data-table tfoot tr th')]
    .map((td) => td.textContent.replace(/\\s+/g, ' ').trim())
  return {
    cells,
    bullets,
    rows,
    foot,
    text: (document.querySelector('main') ?? document.body).innerText.replace(/\\s+/g, ' ').trim(),
  }
})()`;

/** „3.638,26 €“ / „267,25“ -> a number. German digits, one place, no second opinion. */
function de(text) {
  const match = /-?\d[\d.]*(?:,\d+)?/.exec(text ?? "");
  if (match === null) return null;
  return Number(match[0].replace(/\./g, "").replace(",", "."));
}
const cell = (screen, key) => screen.cells.find((c) => c.k === key) ?? { k: key, v: "", sub: "" };
const says = (screen, needle) => screen.bullets.some((b) => b.includes(needle));

async function read(page, path, label) {
  await page.goto(`${BASE}${path}`, { settle: 900 });
  await page.waitFor(`document.querySelectorAll('.answer .cell').length > 0`, { label });
  await sleep(500);
  const screen = await page.eval(READ);
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${label}.png`, Buffer.from(data, "base64"));
  return screen;
}

async function signIn(page) {
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor(`location.pathname === '/'`, { label: "signed in" });
  await sleep(600);
}

async function main() {
  const { child, port } = await launchChrome({ port: 9744, width: 1680, height: 1000 });
  const page = await attach(port);
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 1680,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await signIn(page);

    // ---- A1 · /pl/ ---------------------------------------------------------------------
    console.log("\n=== A1 · /pl/ books revenue for days that have not happened ===");
    for (const period of ["thisYear", "thisQuarter", "thisMonth"]) {
      const days = unhappenedDays(period);
      const screen = await read(page, `/pl/?period=${period}`, `pl-${period}`);
      const margin = cell(screen, "Marge");
      console.log(`  · ${period}: Marge ${margin.v} — sub „${margin.sub}“`);
      assert(
        `pl ${period}: the method block names the ${days} days that have not happened`,
        says(screen, "läuft noch") && says(screen, String(days)),
        screen.bullets.find((b) => b.includes("läuft noch")) ?? "(no such sentence)",
      );
      assert(
        `pl ${period}: it says revenue is counted for all of them and labour only to now`,
        says(screen, "ganzen Zeitraum") && says(screen, "zu hoch"),
      );
      assert(
        `pl ${period}: the margin cell itself carries the warning, not only the block below`,
        margin.sub.includes("zu hoch") && margin.sub.includes(String(days)),
        `sub = „${margin.sub}“`,
      );
      assert(`pl ${period}: the inflated margin cell is not styled calm`, margin.calm === false);
    }

    // THE NEGATIVE TWIN. A closed period must carry NONE of it.
    const closed = await read(page, "/pl/?period=lastMonth", "pl-lastMonth");
    console.log(`  · lastMonth: Marge ${cell(closed, "Marge").v}`);
    assert(
      "pl lastMonth (closed period): no future-days sentence anywhere on the screen",
      !closed.text.includes("läuft noch"),
      closed.bullets.find((b) => b.includes("läuft noch")) ?? "",
    );
    assert(
      "pl lastMonth: the margin cell's sub is the baseline alone",
      !cell(closed, "Marge").sub.includes("zu hoch"),
      `sub = „${cell(closed, 'Marge').sub}“`,
    );

    // ---- A1 · /analytics/ --------------------------------------------------------------
    console.log("\n=== A1 · /analytics/ divides the same monthly contract by the same period ===");
    const ana = await read(page, "/analytics/?period=thisYear", "analytics-thisYear");
    const under = cell(ana, "Unter der vereinbarten Zeit");
    console.log(`  · thisYear: „Unter der vereinbarten Zeit“ ${under.v} — sub „${under.sub}“`);
    assert(
      `analytics thisYear: the standing block names the ${unhappenedDays("thisYear")} days that have not happened`,
      says(ana, "läuft noch") && says(ana, String(unhappenedDays("thisYear"))),
      ana.bullets.find((b) => b.includes("läuft noch")) ?? "(no such sentence)",
    );
    assert(
      "analytics thisYear: the „Unter der vereinbarten Zeit“ cell says the difference is not readable yet",
      under.sub.includes("nicht aussagekräftig") &&
        under.sub.includes(String(unhappenedDays("thisYear"))),
      `sub = „${under.sub}“`,
    );
    const anaClosed = await read(page, "/analytics/?period=lastMonth", "analytics-lastMonth");
    assert(
      "analytics lastMonth (closed period): no future-days sentence",
      !anaClosed.text.includes("läuft noch"),
    );

    // ---- A2 · /payroll/ ----------------------------------------------------------------
    // Three data states, in one browser session, each read off the rendered screen.
    console.log("\n=== A2 · /payroll/ „Nicht gezählt“ counts what is actually missing ===");

    const RICH = sql(
      `SELECT s.worker_id FROM shifts s JOIN workers w ON w.id = s.worker_id
        WHERE w.hourly_rate_cents <> 0 AND s.end_time IS NOT NULL
          AND NOT (s.auto_closed AND s.corrected_at IS NULL)
          AND s.start_time >= date_trunc('month', now() AT TIME ZONE 'Europe/Vienna' - interval '1 month')
          AND s.start_time <  date_trunc('month', now() AT TIME ZONE 'Europe/Vienna')
        GROUP BY s.worker_id ORDER BY SUM(s.end_time - s.start_time) DESC LIMIT 1`,
    );
    const richName = sql(`SELECT name FROM workers WHERE id = ${RICH}`);
    const noRateNames = sql(
      "SELECT string_agg(name, ', ' ORDER BY name) FROM workers WHERE hourly_rate_cents = 0",
    );

    // STATE 1 — nfc_demo as seeded: two workers ship with no rate.
    const seeded = await read(page, "/payroll/?period=lastMonth", "payroll-seeded");
    const seededPay = de(cell(seeded, "Auszuzahlen").v);
    const seededExcluded = cell(seeded, "Nicht gezählt");
    const seededHours = cell(seeded, "Stunden");
    const seededNoRateRows = seeded.rows.filter((r) => r.tds.some((td) => td.includes("Kein Stundensatz")));
    console.log(
      `  · as seeded (${noRateNames} have no rate): Auszuzahlen ${cell(seeded, "Auszuzahlen").v}, ` +
        `Stunden ${seededHours.v} („${seededHours.sub}“), Nicht gezählt ${seededExcluded.v} („${seededExcluded.sub}“)`,
    );
    assert(
      "payroll: „Nicht gezählt“ counts the rate-less PEOPLE, not only the blocked shifts",
      Number(seededExcluded.v) >= seededNoRateRows.length && seededNoRateRows.length > 0,
      `cell = ${seededExcluded.v}, rows with „Kein Stundensatz“ = ${seededNoRateRows.length}`,
    );
    assert(
      "payroll: its sub-line names them as people, in the words the rows use",
      seededExcluded.sub.includes("ohne Stundensatz"),
      `sub = „${seededExcluded.sub}“`,
    );
    // The hours cell and the amount cell must reconcile FROM THE SCREEN (journey D14).
    const unvaluedShown = de(seededHours.sub.replace(/^[^0-9]*/, ""));
    const unvaluedRows = seededNoRateRows.reduce((sum, r) => sum + (de(r.tds[0]) ?? 0), 0);
    assert(
      "payroll: the „Stunden“ sub-line names the hours that carry no amount",
      unvaluedShown !== null && Math.abs(unvaluedShown - unvaluedRows) < 0.02,
      `sub = „${seededHours.sub}“ vs ${unvaluedRows.toFixed(2)} in the unvalued rows`,
    );

    // STATE 2 — every worker rated, in a month with no open and no unresolved shift.
    // The negative twin: the cell must be able to say „nothing“, or it says nothing at all.
    exec("UPDATE workers SET hourly_rate_cents = 1450 WHERE hourly_rate_cents = 0");
    const rated = await read(page, "/payroll/?period=lastMonth", "payroll-all-rated");
    const ratedExcluded = cell(rated, "Nicht gezählt");
    const ratedHours = cell(rated, "Stunden");
    console.log(
      `  · every worker rated: Auszuzahlen ${cell(rated, "Auszuzahlen").v}, ` +
        `Stunden ${ratedHours.v} („${ratedHours.sub}“), Nicht gezählt ${ratedExcluded.v} („${ratedExcluded.sub}“)`,
    );
    assert(
      "payroll (nothing excluded): the cell is 0 and calm",
      ratedExcluded.v === "0" && ratedExcluded.calm === true,
      `v = „${ratedExcluded.v}“, calm = ${ratedExcluded.calm}`,
    );
    assert(
      "payroll (nothing excluded): the sub-line says so and names no person",
      !ratedExcluded.sub.includes("ohne Stundensatz"),
      `sub = „${ratedExcluded.sub}“`,
    );
    assert(
      "payroll (nothing excluded): the „Stunden“ sub-line says nothing extra",
      ratedHours.sub === "Nur Schichten mit bestätigter Endzeit",
      `sub = „${ratedHours.sub}“`,
    );
    const ratedPay = de(cell(rated, "Auszuzahlen").v);

    // STATE 3 — the busiest earner loses their rate. The gallery's own evidence.
    exec(`UPDATE workers SET hourly_rate_cents = 0 WHERE id = ${RICH}`);
    const norate = await read(page, "/payroll/?period=lastMonth", "payroll-norate-busiest");
    const noratePay = de(cell(norate, "Auszuzahlen").v);
    const norateExcluded = cell(norate, "Nicht gezählt");
    const norateHours = cell(norate, "Stunden");
    const drop = (ratedPay ?? 0) - (noratePay ?? 0);
    console.log(
      `  · ${richName} (the busiest) made rate-less: Auszuzahlen ${cell(norate, "Auszuzahlen").v} ` +
        `— ${drop.toFixed(2)} € less — Stunden ${norateHours.v} („${norateHours.sub}“), ` +
        `Nicht gezählt ${norateExcluded.v} („${norateExcluded.sub}“)`,
    );
    assert(
      "payroll: money left the payout, so the count must not still read 0",
      drop > 100 && Number(norateExcluded.v) > 0,
      `${drop.toFixed(2)} € missing, cell = „${norateExcluded.v}“`,
    );
    assert(
      "payroll: the count is exactly the number of people it excluded",
      Number(norateExcluded.v) === 1,
      `cell = „${norateExcluded.v}“ for one rate-less worker and no blocked shift`,
    );
    assert(
      "payroll: the cell is no longer calm while a wage is missing",
      norateExcluded.calm === false,
    );
    // The hours are unchanged and the amount is not — which is precisely what the sub-line
    // has to explain, or the two headline numbers cannot be reconciled.
    assert(
      "payroll: the hours total did not move, only the amount did",
      de(norateHours.v) === de(ratedHours.v),
      `${norateHours.v} vs ${ratedHours.v}`,
    );
    const norateUnvalued = de(norateHours.sub.replace(/^[^0-9]*/, ""));
    const richRow = norate.rows.find((r) => r.head.includes(richName));
    assert(
      "payroll: the „Stunden“ sub-line names exactly that person's hours",
      norateUnvalued !== null && Math.abs(norateUnvalued - (de(richRow?.tds[0] ?? "") ?? -1)) < 0.02,
      `sub = „${norateHours.sub}“, row = ${richRow?.tds[0] ?? "(no row)"}`,
    );
    assert(
      "payroll: the caveat prose and the per-row column are untouched",
      says(norate, "kein Stundensatz hinterlegt") &&
        (richRow?.tds ?? []).some((td) => td.includes("Kein Stundensatz")) &&
        (richRow?.tds ?? []).some((td) => td.includes("Nicht bewertet")),
    );
  } finally {
    page.close();
    child.kill();
  }
}

const timer = setTimeout(() => {
  console.error("check-money: deadline exceeded");
  process.exit(1);
}, DEADLINE_MS);
timer.unref?.();

let crashed = null;
try {
  await main();
} catch (error) {
  crashed = error;
} finally {
  // ---- the proof that the database came back --------------------------------------------
  execFileSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "-d", DB, DUMP], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const after = fingerprint();
  const ratesAfter = sql("SELECT string_agg(id || '=' || hourly_rate_cents, ',' ORDER BY id) FROM workers");
  console.log("\n--- nfc_demo, before | after ---");
  const b = BEFORE.split("\n");
  const a = after.split("\n");
  let drift = 0;
  for (let i = 0; i < Math.max(b.length, a.length); i++) {
    if (b[i] !== a[i]) drift++;
    console.log(`  ${b[i] === a[i] ? "ok  " : "DRIFT"} ${b[i] ?? "(missing)"}  ->  ${a[i] ?? "(missing)"}`);
  }
  // Row counts alone would not notice a rate left at 0 — the exact column this check
  // rewrites. So the rates are fingerprinted too, and this is the assertion that says so.
  assert("nfc_demo: every hourly rate is back where it was", ratesAfter === RATES_BEFORE, `${RATES_BEFORE} -> ${ratesAfter}`);
  assert("nfc_demo: every table matches the pre-run row count", drift === 0);
  console.log("");
  if (crashed !== null) {
    console.error(crashed);
    process.exit(1);
  }
  if (failures.length > 0) {
    console.log(`${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`all green. screenshots in ${SHOTS}`);
}
