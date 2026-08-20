// The runnable check for the three REPORT screens: /payroll/, /pl/, /analytics/.
//
//   «stack»  seeded nfc_demo + the API serving a build of these screens (loopback only)
//   DEMO_BASE=http://127.0.0.1:8092 node demo/check-reports.mjs
//
// WHY THIS EXISTS, and why it asserts these particular things:
//
//   1. A REVIEW ONCE CAUGHT /payroll/ SHOWING A TOTAL AND A ROW LIST THAT DISAGREED. The
//      redesign puts a third copy of that number on screen (the answer band), so the first
//      assertion compares the band, the table footer and the sum of the rows, to the cent.
//   2. THE CAVEATS ARE THE SCREEN. „Priced at today's rate", the reconciliation line and the
//      named exclusions are the difference between a payroll screen and a payroll screen you
//      can defend in a wage dispute. They are asserted as VISIBLE text (offsetParent), not as
//      text present somewhere in the DOM — a caveat inside a collapsed disclosure is a caveat
//      nobody reads, and `document.body.textContent` cannot tell the two apart.
//   3. THE CSV EXPORT FAILS SILENTLY when the object URL is revoked too early (Safari) or the
//      anchor is detached (Firefox). So the check DOWNLOADS the file through the protocol and
//      compares its first two lines, instead of trusting the success message the page prints
//      either way. It is then parsed with a real RFC-4180 reader and every numeric column is
//      read back AS A GERMAN EXCEL WOULD READ IT (demo/excel-de.mjs) — the file is semicolon
//      separated, so `10.500` hours are ten thousand five hundred on the accountant's
//      machine, silently, right-aligned and summing perfectly.
//   4. CARD CAPTIONS ON A PHONE are matched by CELL POSITION. Every automated assertion in
//      this repo stayed green through a bug that captioned a timestamp "Objekt", because the
//      assertions counted labelled cells instead of reading them. Both probes run here.
//
// Everything is bounded: every wait has a timeout and the run has a deadline. A check that
// blocks forever is not a slow test, it is a test that cannot fail.
//
// No new dependency: demo/cdp.mjs, Node, and the Chrome already on the machine.
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";
import { oracleFailures, parseCsv, readsAsDe } from "./excel-de.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8092";
const SHOTS = "/tmp/ts-demo/b3-reports";
const DOWNLOADS = "/tmp/ts-demo/b3-downloads";
const DEADLINE_MS = 6 * 60 * 1000;

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

// Never the live server. A hostname check, not a comment.
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-reports: refusing to run against "${host}" — loopback only.`);
  process.exit(1);
}

const failures = [];
function assert(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

/** Resize, and PROVE the resize took: `mobile:true` hands the page a 1304px layout viewport. */
async function setViewport(page, width, height) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(250);
  const actual = await page.eval("window.innerWidth");
  if (actual !== width) {
    throw new Error(`viewport override did not take: asked for ${width}px, got ${actual}px`);
  }
}

async function setTheme(page, theme) {
  await page.eval(`localStorage.setItem('nfcts.theme', ${JSON.stringify(theme)})`);
}

/**
 * Text that a person can actually see, not text that merely exists in the DOM.
 *
 * `checkVisibility`, not `offsetParent`: the content of a CLOSED `<details>` is skipped via
 * `content-visibility`, which does NOT null out `offsetParent` — so an offsetParent probe
 * reports the payroll caveats as visible while they sit inside a collapsed disclosure. That
 * was measured on this very page, and it is the difference between this check and a check
 * that cannot fail. `.visually-hidden` text still counts as present, deliberately: it is
 * announced, and this probe is about whether a FACT reaches the reader.
 */
const VISIBLE_TEXT = `(() => {
  const out = []
  const seen = { contentVisibilityAuto: true, opacityProperty: false, visibilityProperty: true }
  const walk = (node) => {
    for (const el of node.children) {
      if (!el.checkVisibility(seen)) continue
      if (el.children.length === 0) out.push((el.textContent || '').trim())
      else walk(el)
    }
  }
  walk(document.body)
  return out.join('\\n')
})()`;

const WHERE_FOCUS = `(() => {
  const a = document.activeElement
  if (!a) return 'null'
  return [a.tagName, a.className ? '.' + String(a.className).split(' ').join('.') : '', '|', (a.textContent||'').trim().slice(0,40)].join('')
})()`;

/** The two card-caption probes, side by side. Believe the text one. */
const CAPTION_PROBE = `(() => {
  const out = { count: 0, cells: 0, mismatches: [], tables: 0 }
  for (const table of document.querySelectorAll('table.data-table')) {
    const headings = [...table.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim())
    if (headings.length === 0) continue
    out.tables++
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.children]
      cells.forEach((cell, i) => {
        if (cell.tagName !== 'TD') return
        out.cells++
        const label = cell.getAttribute('data-label')
        if (label === null) return
        out.count++
        const expected = headings[i]
        if (label !== expected) {
          out.mismatches.push(
            'row "' + (row.querySelector('th')?.textContent || '?').trim() + '" col ' + i +
            ': labelled "' + label + '" but the header there is "' + expected + '"'
          )
        }
      })
    }
  }
  return out
})()`;

const KEYS = {
  Escape: { windowsVirtualKeyCode: 27, key: "Escape", code: "Escape" },
  Tab: { windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" },
};

async function press(page, name, { shift = false } = {}) {
  const k = KEYS[name];
  const modifiers = shift ? 8 : 0;
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k, modifiers });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...k, modifiers });
  await sleep(120);
}

/** Money as a NUMBER of cents, from the German formatting on screen. */
function centsOf(text) {
  const m = String(text).match(/-?[\d.]+,\d{2}/);
  if (m === null) return null;
  return Math.round(Number(m[0].replace(/\./g, "").replace(",", ".")) * 100);
}

/** Any German-formatted number on screen (`1.234,50` -> 1234.5). null when there is none. */
function deNum(text) {
  const m = String(text).match(/-?[\d.]+(?:,\d+)?/);
  return m === null ? null : Number(m[0].replace(/\./g, "").replace(",", "."));
}

async function main() {
  rmSync(SHOTS, { recursive: true, force: true });
  rmSync(DOWNLOADS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(DOWNLOADS, { recursive: true });

  const port0 = 9600 + (process.pid % 300);
  const { child, port } = await launchChrome({ port: port0, width: 1680, height: 1000 });
  const page = await attach(port);

  try {
    await setViewport(page, 1680, 1000);
    await page.goto(`${BASE}/login/`, { settle: 700 });
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
    await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
    await page.waitFor("location.pathname === '/'", { timeout: 15000, label: "the dashboard" });

    // =====================================================================================
    // /payroll/
    // =====================================================================================
    console.log("\n/payroll/");
    await page.goto(`${BASE}/payroll/`, { settle: 1200 });
    await page.waitFor("document.querySelector('table.data-table tfoot')", {
      timeout: 15000,
      label: "the payroll table",
    });

    // 1. The band, the footer and the rows are the same number.
    const money = await page.eval(`(() => {
      const band = document.querySelector('.answer .cell .v')?.textContent ?? ''
      const foot = [...document.querySelectorAll('table.data-table tfoot td')].map((td) => td.textContent.trim())
      const rows = [...document.querySelectorAll('table.data-table tbody tr')].map((tr) =>
        [...tr.children].map((c) => c.textContent.trim()))
      return { band, foot, rows }
    })()`);
    const bandCents = centsOf(money.band);
    const footCents = centsOf(money.foot.at(-2) ?? "");
    const rowCents = money.rows
      .map((r) => centsOf(r[3]) ?? 0)
      .reduce((a, b) => a + b, 0);
    assert(
      "payroll: answer band = table footer",
      bandCents !== null && bandCents === footCents,
      `band ${bandCents}, footer ${footCents}`,
    );
    assert(
      "payroll: table footer = sum of the visible rows",
      footCents === rowCents,
      `footer ${footCents}, rows ${rowCents}`,
    );

    // 2. The caveats.
    //
    // THESE TWO MOVED, AND THE CHECK DID NOT FOLLOW. app/payroll/page.tsx ships the two
    // standing limitations inside a `<details class="callout">` that is CLOSED on load —
    // deliberately, and its own comment says why: open, they put the prose the redesign
    // took off the top of the screen back at the bottom of it. So a plain „is this string
    // among the visible text" assertion has been red since the redesign, for a screen that
    // is behaving as designed, which is how a check stops being read.
    //
    // Reconciled rather than deleted, because the fact is still load-bearing: past hours
    // are priced at TODAY's rate, and a payslip dispute turns on it. What the design
    // actually promises is ONE PRESS, so that is what is measured — the disclosure is a
    // real control that names itself, the sentence is inside it, and after a real press it
    // is on the screen. A tooltip, a `title=`, or a deleted <li> all fail this.
    const disclosure = await page.eval(`(() => {
      const d = [...document.querySelectorAll('details.callout')]
        .find((x) => /zum heutigen Satz bewertet/.test(x.textContent || ''))
      if (!d) return { found: false }
      const s = d.querySelector('summary')
      const r = s ? s.getBoundingClientRect() : null
      return {
        found: true,
        openOnLoad: d.open,
        summary: s ? s.textContent.replace(/\\s+/g, ' ').trim() : null,
        summaryShown: !!(s && s.offsetParent !== null && r.height > 0),
        summaryH: r ? Math.round(r.height) : null,
      }
    })()`);
    assert(
      "payroll: the rate-history caveat is on the page, inside a disclosure that names itself",
      disclosure.found === true && disclosure.summaryShown === true && (disclosure.summary ?? "") !== "",
      `found=${disclosure.found} summary=„${disclosure.summary ?? ""}" ${disclosure.summaryH}px`,
    );
    // Read the screen AS DELIVERED, before anything is pressed. Reading it after a press
    // and a re-close was the first version of this block, and it made the twin below
    // untestable: `details open` in the markup still measured as folded, because the probe
    // had closed it itself. The state that matters is the one on load.
    const asDelivered = await page.eval(VISIBLE_TEXT);
    assert(
      "payroll: the disclosure ships CLOSED — the caveat is folded until pressed",
      disclosure.openOnLoad === false &&
        !asDelivered.includes("vergangene Stunden werden daher zum heutigen Satz bewertet"),
      `open on load=${disclosure.openOnLoad}`,
    );
    // …and what may NOT be folded is the money. The counted, named exclusion and the
    // reconciliation sentence are visible with nothing pressed, or this screen is lying by
    // omission about a bank transfer.
    assert(
      "payroll: the reconciliation sentence is NOT behind the disclosure",
      asDelivered.includes("auf dieser Seite fehlt nichts") ||
        asDelivered.includes("Die Summe des Servers für diesen Zeitraum beträgt"),
      "not visible with the callout closed",
    );
    // Open it the way a reader does, then require BOTH sentences to be visible text.
    await page.eval(`(() => {
      const d = [...document.querySelectorAll('details.callout')]
        .find((x) => /zum heutigen Satz bewertet/.test(x.textContent || ''))
      if (d) d.open = true
      return !!d
    })()`);
    await sleep(250);
    const openedText = await page.eval(VISIBLE_TEXT);
    assert(
      "payroll: …and one press puts the rate-history caveat on the screen",
      openedText.includes("vergangene Stunden werden daher zum heutigen Satz bewertet"),
    );
    assert(
      "payroll: …and the attribution rule with it",
      openedText.includes("Eine Schicht zählt in dem Zeitraum, in dem sie begonnen hat"),
    );
    await page.eval(`(() => {
      const d = [...document.querySelectorAll('details.callout')]
        .find((x) => /zum heutigen Satz bewertet/.test(x.textContent || ''))
      if (d) d.open = false
      return true
    })()`);
    // Everything below still reads the CLOSED screen, which is the one the director sees.
    const payrollText = asDelivered;
    const reconcileOk = payrollText.includes("auf dieser Seite fehlt nichts");
    const reconcileBad = payrollText.includes("Die Summe des Servers für diesen Zeitraum beträgt");
    assert(
      "payroll: exactly ONE reconciliation branch is on screen",
      reconcileOk !== reconcileBad,
      `ok=${reconcileOk} mismatch=${reconcileBad}`,
    );
    assert(
      "payroll: the exclusion state is named either way",
      payrollText.includes("Keine Schicht in diesem Zeitraum ist offen") ||
        /bestätigt werden, bevor diese Summe endgültig ist|noch offen und (hat|haben) keine Endzeit/.test(
          payrollText,
        ),
    );
    assert(
      "payroll: the screen states its question",
      payrollText.includes("Was ist diesen Monat auszuzahlen?"),
    );

    // 3. The CSV actually downloads, and its bytes are the agreed ones.
    await page.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: DOWNLOADS,
      eventsEnabled: true,
    });
    await page.clickText("CSV herunterladen", { selector: "button" });
    let files = [];
    for (let i = 0; i < 60 && files.length === 0; i++) {
      await sleep(150);
      files = readdirSync(DOWNLOADS).filter((f) => f.endsWith(".csv"));
    }
    assert("payroll: the CSV export produced a file", files.length === 1, files.join(","));
    if (files.length === 1) {
      const csv = readFileSync(`${DOWNLOADS}/${files[0]}`, "utf8");
      const lines = csv.split("\r\n");
      // A REAL RFC-4180 READER, not a `split(';')`: the note column can hold a semicolon,
      // and a quoted cell split by hand shifts every column after it by one.
      const rows = parseCsv(csv);
      const header = rows[0];
      const dataRows = rows.slice(1, -1);
      const totalRow = rows.at(-1);
      // THE FILENAME IS THE ACCOUNTANT'S FILING KEY, and the shape regex that used to be
      // here could not tell July from June. app/payroll/page.tsx says it in its own words:
      // the period starts at VIENNA MIDNIGHT, which is 22:00 or 23:00 UTC the day BEFORE,
      // so `range.from.slice(0, 10)` names July's payroll `payroll-2026-06-30.csv`. That
      // string matches /^payroll-\d{4}-\d{2}-\d{2}\.csv$/ perfectly. So the date is pinned
      // to a value computed HERE, from Intl in Europe/Vienna, and never imported from
      // web/lib — a check that re-runs the implementation agrees with it about every wrong
      // answer. /payroll/ with no query is `lastMonth` (page.tsx:151), whose range starts
      // at Vienna midnight on the 1st.
      const [vy, vm] = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Vienna",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .format(new Date())
        .split("-")
        .map(Number);
      const prev = vm === 1 ? { y: vy - 1, m: 12 } : { y: vy, m: vm - 1 };
      const expectedCsvName = `payroll-${prev.y}-${String(prev.m).padStart(2, "0")}-01.csv`;
      assert(
        "payroll: the CSV filename is the VIENNA business date of the period start",
        files[0] === expectedCsvName,
        `got ${files[0]}, expected ${expectedCsvName}`,
      );
      assert("payroll: the CSV keeps its UTF-8 BOM", csv.charCodeAt(0) === 0xfeff);
      assert(
        "payroll: the CSV header is unchanged (7 semicolon columns, audit + reason columns last)",
        lines[0] ===
          "\uFEFFMitarbeiter;Stunden;Stundensatz (Cent);Betrag (Cent);Betrag (EUR);Von Hand erfasst (Schichten);Hinweis",
        JSON.stringify(lines[0]),
      );

      // =================================================================================
      // WHAT AN AUSTRIAN EXCEL READS. The file is semicolon separated, which commits it to
      // the rest of the German locale: decimal `,`, thousands `.`. Under those rules the
      // export used to state hours a THOUSAND TIMES too high (`10.500` is a well-formed
      // thousands group) and amounts that were not numbers at all (`3638.26` is not a
      // valid group, so Excel files it as text and the column totals 0,00). Neither has a
      // visible symptom, so both are asserted rather than eyeballed.
      // =================================================================================
      assert(
        "payroll: the German-Excel model itself still behaves, or nothing below means anything",
        oracleFailures().length === 0,
        oracleFailures().join(" | "),
      );
      // Column 0 is a name and column 6 a sentence; 1..5 are the numbers.
      const NUMERIC = [1, 2, 3, 4, 5];
      const misread = [];
      for (const row of [...dataRows, totalRow]) {
        for (const i of NUMERIC) {
          const read = readsAsDe(row[i]);
          if (read.kind !== "number" && read.kind !== "empty") {
            misread.push(`"${row[0]}" col ${i} = ${JSON.stringify(row[i])} reads as ${read.kind}`);
          }
        }
      }
      assert(
        "payroll: every numeric cell is a NUMBER to a German Excel (never text, never a date)",
        misread.length === 0,
        misread.join(" | "),
      );
      // THE 1000x CATCH, and the only assertion that can see it: the hours that reach the
      // accountant must be the hours on the director's screen. Kind alone cannot catch this
      // — `10.500` IS a number over there, it is just the wrong one.
      const hoursDrift = dataRows
        .map((row, i) => ({
          name: row[0],
          file: readsAsDe(row[1]).value,
          screen: deNum(money.rows[i]?.[1] ?? ""),
        }))
        .filter((r) => r.screen === null || Math.abs(r.file - r.screen) > 0.005);
      assert(
        "payroll: the hours a German Excel reads are the hours on screen, row for row",
        dataRows.length > 0 && hoursDrift.length === 0,
        hoursDrift.map((r) => `${r.name}: file ${r.file}, screen ${r.screen}`).join(" | "),
      );
      const hoursSum = dataRows.reduce((sum, row) => sum + (readsAsDe(row[1]).value ?? 0), 0);
      assert(
        "payroll: and they add up to the file's own total row over there too",
        Math.abs(hoursSum - readsAsDe(totalRow[1]).value) < 0.005,
        `rows ${hoursSum}, total ${readsAsDe(totalRow[1]).value}`,
      );
      // The file must agree with ITSELF: half the columns in one convention and half in the
      // other is its own bug. Cents x 100 is the euro column, as Excel reads both.
      const centsVsEuro = [...dataRows, totalRow]
        .filter((row) => readsAsDe(row[3]).kind === "number")
        .filter((row) => Math.abs(readsAsDe(row[4]).value * 100 - readsAsDe(row[3]).value) > 0.5);
      assert(
        "payroll: Betrag (EUR) x 100 = Betrag (Cent) as a German Excel reads them",
        centsVsEuro.length === 0,
        centsVsEuro.map((row) => `${row[0]}: ${row[4]} vs ${row[3]}`).join(" | "),
      );
      assert(
        "payroll: the CSV total row totals the same cents as the screen",
        readsAsDe(totalRow[3]).value === footCents,
        `csv ${totalRow[3]}, screen ${footCents}`,
      );

      // THE FILE MUST SAY WHAT THE SCREEN SAYS, and what both used to say is GONE.
      //
      // /payroll/ printed „ein Betrag wird nicht berechnet - auch nicht 0,00 EUR" for a
      // worker with no rate, and the export used to ship `Ana Ilic;10.500;0;0;0.00;0` under
      // it. decision-41 removed the state: `workers.hourly_rate_cents` lost its DEFAULT and
      // gained CHECK (> 0) in migration 006, and the migration REFUSED to apply until the
      // one rate-less row in production was dealt with by a human.
      //
      // So the assertion is inverted rather than deleted. Every row that reports hours must
      // now report an amount too, and no row may carry the old copy: a file that starts
      // saying „Kein Stundensatz" again is a file whose constraint has been dropped.
      const noRateRows = dataRows.filter((cells) => cells.join(";").includes("Kein Stundensatz"));
      assert(
        "payroll: no CSV row claims a worker has no rate - the state is unrepresentable",
        noRateRows.length === 0,
        noRateRows.map((c) => c.join(";")).join(" | "),
      );
      const withHours = dataRows.filter((c) => readsAsDe(c[1]).value > 0);
      assert(
        "payroll: the seeded period really contains paid hours",
        withHours.length > 0,
        "without them, every assertion below passes vacuously",
      );
      assert(
        "payroll: every row with hours carries a rate AND an amount",
        withHours.every((c) => readsAsDe(c[2]).value > 0 && readsAsDe(c[3]).value > 0),
        withHours.map((c) => c.join(";")).join(" | "),
      );
      // THE „Hinweis" COLUMN STAYS. Only the no-rate contribution to it went: it still
      // carries decision-10's exclusions, and a file that lost the column entirely would be
      // a file where a blank money cell has no explanation.
      assert(
        "payroll: the CSV still has its Hinweis column",
        header.length >= 7 && header[6].length > 0,
        JSON.stringify(header),
      );
      // The general form, so a future column shuffle cannot reintroduce it elsewhere: no
      // row may report hours worked and an amount of zero in the same breath.
      const pricedAtZero = dataRows.filter((c) => readsAsDe(c[1]).value > 0 && c[3] === "0");
      assert(
        "payroll: no CSV row prices real hours at zero",
        pricedAtZero.length === 0,
        pricedAtZero.map((c) => c.join(";")).join(" | "),
      );
      // The total row's note is now about decision-10 ALONE: shifts whose end time nobody
      // confirmed, and shifts still running. Empty is a legitimate answer here (nothing was
      // excluded), which is why this asserts the two states rather than a fixed string.
      assert(
        "payroll: the CSV total row explains an exclusion, or has nothing to explain",
        totalRow[6] === "" || /Schicht/.test(totalRow[6]),
        JSON.stringify(totalRow.join(";")),
      );
    }

    for (const theme of ["dark", "light"]) {
      await setTheme(page, theme);
      await page.goto(`${BASE}/payroll/`, { settle: 1200 });
      await page.screenshot(`${SHOTS}/payroll-1680-${theme}.png`);
    }

    // =====================================================================================
    // /pl/
    // =====================================================================================
    console.log("\n/pl/");
    await setTheme(page, "dark");
    await page.goto(`${BASE}/pl/`, { settle: 1400 });
    await page.waitFor("document.querySelector('.answer')", { timeout: 15000, label: "the P&L band" });
    const plText = await page.eval(VISIBLE_TEXT);
    assert("pl: the screen states its question", plText.includes("Verdienen wir an diesem Objekt?"));
    assert(
      "pl: the baseline state is stated on the page, not only in the drawer",
      /Es ist keine Zielmarge gesetzt|Aktuelle Zielmarge/.test(plText),
    );
    assert(
      "pl: every methodology line is visible",
      plText.includes("Materialkosten werden anteilig nach den in jedem Objekt geleisteten") &&
        plText.includes("Schichten, deren Endzeit noch nicht bestätigt ist"),
    );
    assert(
      "pl: an unassessable building is not reported as a pass",
      !/Nicht beurteilbar/.test(plText) || !plText.includes("Alle Objekte konnten beurteilt werden"),
    );
    // LABOUR NOBODY CAN PRICE. `SUM(secs * hourly_rate_cents / 3600)` valued a rate-less
    // worker at 0, so ten and a half hours moved a building's hours from 48:00 to 58:30 and
    // its margin by NOTHING — and margin is what opens a conversation about a client's
    // contract. The hours are excluded from the cost, as on /payroll/, and NAMED here.
    // SCOPED TO THE RESULT TABLE BY ITS CAPTION. /pl/ now carries TWO tables - the revenue
    // ledger above and the result below - and `querySelectorAll('table.data-table')`
    // silently read the ledger's columns as the result's. The caption is the only thing that
    // tells them apart without hard-coding an order.
    const labourRows = await page.eval(`(() => {
      const table = [...document.querySelectorAll('table.data-table')]
        .find((t) => /Umsatz, Kosten und Marge|Revenue, cost and margin/.test(t.querySelector('caption')?.textContent ?? ''))
      if (!table) return null
      return [...table.querySelectorAll('tbody tr')].map((r) => ({
        name: (r.children[0]?.textContent ?? '').trim(),
        revenue: (r.children[2]?.textContent ?? '').trim(),
        labour: (r.children[3]?.textContent ?? '').trim(),
      }))
    })()`);
    assert(
      "pl: the result table is found by its caption, not by its position",
      labourRows !== null && labourRows.length > 0,
      JSON.stringify(labourRows),
    );
    const labourCells = (labourRows ?? []).map((r) => r.labour);

    // THE „no rate" CASE IS GONE AND ITS COPY WENT WITH IT (decision-41).
    //
    // What used to be asserted here: a building whose only hours were worked by somebody
    // with no rate showed „Nicht bewertet" instead of 0,00 EUR, and a MIXED building showed
    // a real amount plus a note naming the hours it could not price. Migration 006 made a
    // wage of 0 unrepresentable, so `labour_seconds` and `labour_cents` now describe the
    // same seconds and there is nothing left to disclaim.
    //
    // Inverted rather than deleted: every building with hours must state an amount, and no
    // building may carry the old copy. A cell that says „nicht bewertet" again is a cell
    // whose constraint has been dropped.
    const euroAmount = new RegExp(String.raw`\d[.,]\d\d\s*€`);
    const zeroEuro = new RegExp(String.raw`(^|[^\d])0,00\s*€`);
    assert(
      "pl: the euro-amount regex really matches an amount, or the next assertions are vacuous",
      euroAmount.test("701,56 €") && zeroEuro.test("0,00 €") && !zeroEuro.test("10,00 €"),
    );
    const stillUnpriced = labourCells.filter((t) => /nicht bewertet|ohne Stundensatz/i.test(t));
    assert(
      "pl: no labour cell claims an hour nobody could price",
      stillUnpriced.length === 0,
      JSON.stringify(stillUnpriced),
    );
    const withHours = labourCells.filter((t) => /\d+:\d\d/.test(t));
    assert(
      "pl: the seeded period really contains buildings with hours",
      withHours.length > 0,
      `labour cells: ${JSON.stringify(labourCells)}`,
    );
    assert(
      "pl: every building with hours states an amount for them",
      withHours.every((t) => euroAmount.test(t)),
      JSON.stringify(withHours),
    );
    // The two buildings the old fixture used, now carrying real amounts. Found BY NAME, so
    // a change that deletes the rows rather than the copy cannot pass vacuously.
    const MIXED_BUILDING = "Aerztezentrum Landstrasse";
    const SOLE_WORKER_BUILDING = "Studiohaus Neubaugasse";
    const mixedRow = (labourRows ?? []).find((r) => r.name.includes(MIXED_BUILDING));
    const soleRow = (labourRows ?? []).find((r) => r.name.includes(SOLE_WORKER_BUILDING));
    assert(
      "pl: both seeded buildings are on the report",
      mixedRow !== undefined && soleRow !== undefined,
      `rows: ${JSON.stringify((labourRows ?? []).map((r) => r.name))}`,
    );
    assert(
      "pl: the building cleaned by ONE person now states a real cost, not a refusal",
      soleRow !== undefined && euroAmount.test(soleRow.labour) && !zeroEuro.test(soleRow.labour),
      JSON.stringify(soleRow),
    );

    // *** THE ASSERTION decision-42 EXISTS FOR ***
    //
    // A month nobody has typed a payment for is UNKNOWN. Not 0,00 EUR, which would report a
    // paying client as a total loss, and not the contract value, which would report money
    // that may never have arrived. A TYPED 0 is a different, real answer and is shown as an
    // amount - both branches must be on the same screen or one of them is untested.
    const revenueCells = (labourRows ?? []).map((r) => r.revenue);
    const notEntered = revenueCells.filter((t) => /Nicht eingetragen/.test(t));
    assert(
      "pl: a building with no revenue typed says so, and never 0,00 €",
      notEntered.length > 0 && notEntered.every((t) => !zeroEuro.test(t)),
      JSON.stringify(revenueCells),
    );
    // „vereinbart" beside „erhalten": the question the contract/revenue split buys.
    assert(
      "pl: the row names the AGREED figure beside the received one",
      revenueCells.some((t) => /Vereinbart/.test(t)),
      JSON.stringify(revenueCells),
    );

    // The method block must still carry the limitation that SURVIVED decision-41 - there is
    // no rate history, so raising a wage still re-values last March - and must NOT carry the
    // one that did not.
    const method = await page.eval(`(() => {
      const items = [...document.querySelectorAll('.callout li')].map((el) => el.textContent.trim())
      return {
        items,
        rateHistory: items.some((t) => /Satzhistorie/.test(t)),
        deadUnpriced: items.filter((t) => /kein(e)? Stundens(atz|ätze) hinterlegt/.test(t)),
      }
    })()`);
    assert(
      "pl: the method still names the missing RATE HISTORY (it survived decision-41)",
      method.rateHistory,
      JSON.stringify(method.items),
    );
    assert(
      "pl: …and no longer claims anybody's hours are unpriced",
      method.deadUnpriced.length === 0,
      JSON.stringify(method.deadUnpriced),
    );

    // The one write: the drawer opens, traps focus, and Escape returns focus to its opener.
    // FOCUS then click. `element.click()` on its own leaves `document.activeElement` on
    // <body>, and then "focus was restored to <body>" is the HARNESS's doing rather than the
    // hook's — a false failure that looks exactly like the real one useOverlay exists to stop.
    await page.eval(`(() => {
      const b = document.querySelector('.topline-action button')
      b.setAttribute('id','pl-opener'); b.focus(); b.click()
    })()`);
    await page.waitFor("document.querySelector('.drawer')", { timeout: 5000, label: "the baseline drawer" });
    const inDrawer = await page.eval(
      `document.querySelector('.drawer')?.contains(document.activeElement) === true`,
    );
    assert("pl: focus moves INTO the baseline drawer", inDrawer, await page.eval(WHERE_FOCUS));
    // The entry animation is 200ms. Screenshot before it lands and the image shows a drawer
    // half way across the screen with no scrim, which is not a state any user sees.
    await sleep(500);
    await page.screenshot(`${SHOTS}/pl-drawer-1680-dark.png`);
    // An invalid percentage must say so on the field, not swallow the save.
    await page.type("#pl-baseline-form input", "abc", { perChar: 0 });
    await page.clickText("Zielmarge speichern", { selector: ".drawer footer button" });
    await sleep(400);
    const drawerError = await page.eval(
      `document.querySelector('.drawer .field-error')?.textContent?.trim() ?? ''`,
    );
    assert("pl: an invalid baseline is refused with a named error", drawerError.length > 0, drawerError);
    await page.screenshot(`${SHOTS}/pl-drawer-invalid-1680-dark.png`);
    await press(page, "Escape");
    const gone = await page.eval(`document.querySelector('.drawer') === null`);
    assert("pl: Escape closes the drawer", gone);
    const restored = await page.eval(`document.activeElement?.id === 'pl-opener'`);
    assert("pl: focus is restored to the control that opened it", restored, await page.eval(WHERE_FOCUS));

    for (const theme of ["dark", "light"]) {
      await setTheme(page, theme);
      await page.goto(`${BASE}/pl/`, { settle: 1400 });
      await page.screenshot(`${SHOTS}/pl-1680-${theme}.png`);
    }

    // =====================================================================================
    // /analytics/
    // =====================================================================================
    console.log("\n/analytics/");
    await setTheme(page, "dark");
    await page.goto(`${BASE}/analytics/`, { settle: 1600 });
    await page.waitFor("document.querySelector('table.data-table tbody tr')", {
      timeout: 15000,
      label: "the buildings table",
    });
    const anText = await page.eval(VISIBLE_TEXT);
    assert("analytics: the screen states its question", anText.includes("Wo geht die Zeit hin?"));
    // /analytics/ LOST ITS MAP (decision-39 §2): `/` has the one map in the admin. What had
    // to survive is the FACT the map rendered - whether a building could be located at all,
    // in words, with the three genuinely different reasons and the retry.
    assert(
      "analytics: no second map came back",
      (await page.eval(`!document.querySelector('.map-canvas')`)) === true,
    );
    assert(
      "analytics: every building's geocode state is still named in words",
      /Auf der Karte|Nie verortet|Konnte nicht verortet werden/.test(anText),
    );
    assert(
      "analytics: …and a building that could not be located can still be retried from its row",
      (await page.eval(
        `[...document.querySelectorAll('table.data-table button')].some((b) => b.textContent.includes('Erneut verorten'))
         || !/Nie verortet|Konnte nicht verortet/.test(document.body.innerText)`,
      )) === true,
    );
    assert(
      "analytics: the table-is-complete note is visible",
      anText.includes("Diese Tabelle enthält jedes Objekt"),
    );
    const counts = await page.eval(`(() => {
      const cells = [...document.querySelectorAll('.answer .cell')].map((c) => ({
        k: c.querySelector('.k').textContent.trim(), v: c.querySelector('.v').textContent.trim() }))
      return { cells, rows: document.querySelectorAll('table.data-table tbody tr').length }
    })()`);
    const buildingsCell = counts.cells.find((c) => c.k === "Objekte");
    assert(
      "analytics: the band counts BUILDINGS, and the table has that many rows",
      buildingsCell !== undefined && Number(buildingsCell.v) === counts.rows,
      `band ${buildingsCell?.v}, rows ${counts.rows}`,
    );

    // The detail drawer, opened from the row button, closed with Escape.
    await page.eval(`(() => {
      const b = document.querySelectorAll('table.data-table tbody tr td:last-child button')[0]
      b.setAttribute('id','an-opener'); b.focus(); b.click()
    })()`);
    await page.waitFor("document.querySelector('.drawer')", { timeout: 5000, label: "the detail drawer" });
    const anInDrawer = await page.eval(
      `document.querySelector('.drawer')?.contains(document.activeElement) === true`,
    );
    assert("analytics: focus moves into the detail drawer", anInDrawer, await page.eval(WHERE_FOCUS));
    const anDrawerText = await page.eval(
      `document.querySelector('.drawer')?.textContent ?? ''`,
    );
    assert(
      "analytics: the drawer states why there is no photo, rather than showing a grey box",
      /Kein Foto/.test(anDrawerText) || /building-photo/.test(await page.eval(`document.querySelector('.drawer')?.innerHTML ?? ''`)),
    );
    assert(
      "analytics: the drawer keeps the exclusion line",
      /Nicht gezählt/.test(anDrawerText),
    );
    await sleep(500);
    await page.screenshot(`${SHOTS}/analytics-drawer-1680-dark.png`);
    await press(page, "Escape");
    assert(
      "analytics: Escape closes the detail drawer and focus returns to the row button",
      await page.eval(`document.querySelector('.drawer') === null && document.activeElement?.id === 'an-opener'`),
      await page.eval(WHERE_FOCUS),
    );

    for (const theme of ["dark", "light"]) {
      await setTheme(page, theme);
      await page.goto(`${BASE}/analytics/`, { settle: 1600 });
      await page.screenshot(`${SHOTS}/analytics-1680-${theme}.png`);
    }

    // =====================================================================================
    // Phone: 390px both themes, then 360px for the no-sideways-scroll floor.
    // =====================================================================================
    console.log("\nphone");
    for (const [path, name] of [
      ["/payroll/", "payroll"],
      ["/pl/", "pl"],
      ["/analytics/", "analytics"],
    ]) {
      for (const theme of ["dark", "light"]) {
        await setTheme(page, theme);
        await setViewport(page, 390, 900);
        await page.goto(`${BASE}${path}`, { settle: 1500 });
        await page.screenshot(`${SHOTS}/${name}-390-${theme}.png`);
        if (theme === "dark") {
          const probe = await page.eval(CAPTION_PROBE);
          assert(
            `${name}: card captions match their columns (${probe.count}/${probe.cells} cells, ${probe.tables} tables)`,
            probe.mismatches.length === 0,
            probe.mismatches.slice(0, 3).join(" | "),
          );
        }
      }
      await setTheme(page, "dark");
      await setViewport(page, 360, 780);
      await page.goto(`${BASE}${path}`, { settle: 1500 });
      const scroll = await page.eval(
        `({ doc: document.documentElement.scrollWidth, win: window.innerWidth })`,
      );
      assert(
        `${name}: no horizontal scroll at 360px`,
        scroll.doc <= scroll.win,
        JSON.stringify(scroll),
      );
      await page.screenshot(`${SHOTS}/${name}-360-dark.png`);
      await setViewport(page, 1680, 1000);
    }
  } finally {
    page.close();
    child.kill();
  }

  console.log(`\nscreenshots: ${SHOTS}`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nall checks green");
}

const bell = setTimeout(() => {
  console.error(`check-reports: exceeded ${DEADLINE_MS}ms — giving up rather than hanging.`);
  process.exit(2);
}, DEADLINE_MS);
bell.unref?.();

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
