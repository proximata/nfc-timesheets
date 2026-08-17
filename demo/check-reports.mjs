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
//      either way.
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
      assert("payroll: the CSV filename is Vienna-dated", /^payroll-\d{4}-\d{2}-\d{2}\.csv$/.test(files[0]), files[0]);
      assert("payroll: the CSV keeps its UTF-8 BOM", csv.charCodeAt(0) === 0xfeff);
      assert(
        "payroll: the CSV header is unchanged (6 semicolon columns, manual-shift audit column last)",
        lines[0] ===
          "\uFEFFMitarbeiter;Stunden;Stundensatz (Cent);Betrag (Cent);Betrag (EUR);Von Hand erfasst (Schichten)",
        JSON.stringify(lines[0]),
      );
      assert(
        "payroll: the CSV total row totals the same cents as the screen",
        centsOf(`${(Number(lines.at(-1).split(";")[3]) / 100).toFixed(2).replace(".", ",")}`) ===
          footCents,
        `csv ${lines.at(-1)?.split(";")[3]}, screen ${footCents}`,
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
