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

    // 2. The caveats, as VISIBLE text.
    const payrollText = await page.eval(VISIBLE_TEXT);
    assert(
      "payroll: the rate-history caveat is visible (not merely in the DOM)",
      payrollText.includes("vergangene Stunden werden daher zum heutigen Satz bewertet"),
    );
    assert(
      "payroll: the attribution rule is visible",
      payrollText.includes("Eine Schicht zählt in dem Zeitraum, in dem sie begonnen hat"),
    );
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
      const dataRows = rows.slice(1, -1);
      const totalRow = rows.at(-1);
      assert("payroll: the CSV filename is Vienna-dated", /^payroll-\d{4}-\d{2}-\d{2}\.csv$/.test(files[0]), files[0]);
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

      // THE FILE MUST SAY WHAT THE SCREEN SAYS. /payroll/ prints „ein Betrag wird nicht
      // berechnet – auch nicht 0,00 €" for a worker with no rate; the export used to ship
      // `Ana Ilic;10.500;0;0;0.00;0` under it, and the accountant keeps the export. Rows
      // only — the header and the total row are not people.
      const noRateRows = dataRows.filter((cells) => cells[6]?.includes("Kein Stundensatz"));
      assert(
        "payroll: the seeded period really contains a worker with no rate",
        noRateRows.length > 0,
        "without one, every assertion below passes vacuously",
      );
      assert(
        "payroll: a worker with no rate carries NO amount in the CSV — not 0, not 0.00",
        noRateRows.every((c) => c[2] === "" && c[3] === "" && c[4] === ""),
        noRateRows.map((c) => c.join(";")).join(" | "),
      );
      assert(
        "payroll: and that row still names her and her real hours",
        noRateRows.every((c) => c[0].length > 0 && readsAsDe(c[1]).value > 0),
        noRateRows.map((c) => c.join(";")).join(" | "),
      );
      // The general form, so a future column shuffle cannot reintroduce it elsewhere: no
      // row may report hours worked and an amount of zero in the same breath.
      const pricedAtZero = dataRows.filter((c) => readsAsDe(c[1]).value > 0 && c[3] === "0");
      assert(
        "payroll: no CSV row prices real hours at zero",
        pricedAtZero.length === 0,
        pricedAtZero.map((c) => c.join(";")).join(" | "),
      );
      assert(
        "payroll: the CSV total row says why it is short",
        totalRow.join(";").includes("auch nicht 0,00"),
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
    const labourRows = await page.eval(`(() => {
      const rows = [...document.querySelectorAll('table.data-table tbody tr')]
      return rows.map((r) => ({
        name: (r.children[0]?.textContent ?? '').trim(),
        labour: (r.children[3]?.textContent ?? '').trim(),
      }))
    })()`);
    const labourCells = labourRows.map((r) => r.labour);
    const unpricedCells = labourCells.filter((text) => text.includes("ohne Stundensatz"));
    assert(
      "pl: the seeded period really contains labour nobody has priced",
      unpricedCells.length > 0,
      `labour cells: ${JSON.stringify(labourCells)}`,
    );
    assert(
      "pl: the labour cell names the hours it could NOT price, beside the amount",
      unpricedCells.every((text) => /nicht bewertet/.test(text) && /\d+:\d\d/.test(text)),
      JSON.stringify(unpricedCells),
    );
    // A building whose ONLY hours carry no rate must not print 0,00 € as its cost — that is
    // the same confident zero, one column to the left of the note that denies it. Built
    // with `new RegExp` on purpose: `/\d,\d\d/` written inside an array literal is a
    // literal backslash and matches nothing, which is a probe that cannot fail.
    const euroAmount = new RegExp(String.raw`\d[.,]\d\d\s*€`);
    const zeroEuro = new RegExp(String.raw`(^|[^\d])0,00\s*€`);
    assert(
      "pl: the euro-amount regex really matches an amount, or the next assertion is vacuous",
      euroAmount.test("701,56 €") && zeroEuro.test("0,00 €") && !zeroEuro.test("10,00 €"),
    );
    assert(
      "pl: a building whose whole labour is unpriced shows NO amount, not 0,00 €",
      unpricedCells.every((text) => !zeroEuro.test(text)),
      JSON.stringify(unpricedCells),
    );
    // THE MIXED BUILDING, and it is the realistic one.
    //
    // A building where the rate-less worker is the ONLY worker has `labour_cents = 0`, so a
    // change that only caveats a building whose WHOLE cost is missing still looks perfect
    // against it. The case the /pl/ defect was actually raised for is the other one: she
    // cleans alongside priced colleagues, the building shows a real amount, and the hours
    // behind that amount are silently short — 48:00 became 58:30 at an unchanged margin.
    // The seed carries both on purpose (demo/seed.sql § A worker whose hourly rate NOBODY
    // HAS SET).
    //
    // BOTH ROWS ARE FOUND BY NAME, not by filtering on the note itself. Selecting the
    // "mixed" rows with `text.includes('ohne Stundensatz')` looks equivalent and is not: the
    // exact change these assertions exist to catch is the one that DELETES that note, so the
    // filter empties, `.every()` on nothing is true, and the substantive assertion passes
    // vacuously while the building silently under-reports its cost. Measured: with the note
    // suppressed for any building that has priced labour, the filtered form stayed green.
    const MIXED_BUILDING = "Aerztezentrum Landstrasse";
    const WHOLLY_UNPRICED_BUILDING = "Studiohaus Neubaugasse";
    const mixedRow = labourRows.find((r) => r.name.includes(MIXED_BUILDING));
    const whollyRow = labourRows.find((r) => r.name.includes(WHOLLY_UNPRICED_BUILDING));
    assert(
      "pl: the seeded period really contains BOTH a mixed-rate building and a wholly unpriced one",
      mixedRow !== undefined && whollyRow !== undefined,
      `rows: ${JSON.stringify(labourRows.map((r) => r.name))}`,
    );
    assert(
      "pl: the MIXED building shows its amount AND names the hours it could not price",
      mixedRow !== undefined &&
        euroAmount.test(mixedRow.labour) &&
        /nicht bewertet/.test(mixedRow.labour) &&
        /\d+:\d\d/.test(mixedRow.labour),
      JSON.stringify(mixedRow),
    );
    assert(
      "pl: …and the wholly unpriced building states no amount at all",
      whollyRow !== undefined &&
        !euroAmount.test(whollyRow.labour) &&
        /Nicht bewertet/.test(whollyRow.labour),
      JSON.stringify(whollyRow),
    );
    // Read the <li> ITSELF, not VISIBLE_TEXT: that walker only collects elements with no
    // children, so a bullet containing a <Link> contributes the link's words and loses the
    // sentence around them. Visibility is still asserted, on the bullet.
    // BOTH plural branches, because the German inflects: one worker has „kein Stundensatz
    // hinterlegt“, several have „keine Stundensätze hinterlegt“. A finder that only knows the
    // singular passes today because the seed holds exactly one rate-less person, and stops
    // finding the bullet at all the day a second one appears — which is the day it matters.
    const methodUnpricedLabour = await page.eval(`(() => {
      const li = [...document.querySelectorAll('.callout li')]
        .find((el) => /kein(e)? Stundens(atz|ätze) hinterlegt/.test(el.textContent ?? ''))
      if (!li) return null
      return { text: li.textContent.trim(), visible: li.checkVisibility(), href: li.querySelector('a')?.getAttribute('href') ?? null }
    })()`);
    assert(
      "pl: the method says the cost is short, visibly, and links to the fix",
      methodUnpricedLabour !== null &&
        methodUnpricedLabour.visible &&
        methodUnpricedLabour.text.includes("auch nicht 0,00") &&
        methodUnpricedLabour.href === "/workers/",
      JSON.stringify(methodUnpricedLabour),
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
    assert(
      "analytics: the map's state is named in words",
      /Karte|Objekt(e)? auf der Karte|keine Karte|Kartenschlüssel/.test(anText),
    );
    assert(
      "analytics: the table-is-complete note is visible",
      anText.includes("Die Tabelle unter der Karte enthält jedes Objekt"),
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
