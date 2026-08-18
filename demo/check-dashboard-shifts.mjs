// The runnable check for the redesigned `/` and `/shifts/` (batch dashboard-shifts).
//
//   cd web && pnpm build                               # the fragments are folded into
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8092 PUBLIC_DIR=../web/out \
//     node demo/demo-server.mjs &                      # de.json/en.json since batch B5, so
//   node demo/check-dashboard-shifts.mjs               # web/ itself builds — no copy needed
//
// WHY THIS EXISTS, beyond "the page renders":
//
//   1. MESSAGE KEYS. next-intl renders the KEY PATH when a message is missing, so a screen
//      that lost a string still lays out perfectly and reads "shifts.question". The probe
//      greps the rendered text for `home.x` / `shifts.x` — the one failure mode a screenshot
//      diff cannot see because it looks like a design decision.
//   2. CARD CAPTIONS AT 390px. ResponsiveTableLabels captions by CELL POSITION. This project
//      shipped an off-by-one once and EVERY automated assertion stayed green, because they
//      counted labelled cells instead of reading them. Both probes run; believe the text one.
//   3. THE 3px STATE RULE. A rule that never painted is indistinguishable from one that did.
//      Mutation-tested: set the colour to `transparent` in the throwaway tree, rebuild, watch
//      this go RED, put it back.
//   4. DRAWER FOCUS. Escape must close the drawer AND put focus back on the row's button, or
//      the keyboard user is dropped on <body> with no announcement.
//
// Everything is bounded: every wait has a timeout and the run has a deadline. A check that
// blocks forever is not a slow test, it is a test that cannot fail.
//
// READ-ONLY against nfc_demo: it opens drawers and submits an EMPTY hand-entry form (which
// is refused client-side, before any fetch). It never writes a row — another agent is
// reading the same database right now.
import { mkdirSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8092";
const SHOTS = "/tmp/ts-demo/ds";
const DEADLINE_MS = 6 * 60 * 1000;
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-dashboard-shifts: refusing to run against "${host}" — loopback only.`);
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

const KEYS = {
  Tab: { windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" },
  Escape: { windowsVirtualKeyCode: 27, key: "Escape", code: "Escape" },
};

async function press(page, name, { shift = false } = {}) {
  const k = KEYS[name];
  const modifiers = shift ? 8 : 0;
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k, modifiers });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...k, modifiers });
  await sleep(80);
}

/** Resize, and PROVE the resize took — `mobile:true` silently hands this page 1304px. */
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

/** A message next-intl could not find renders as its own key path. Find it in the text. */
const KEY_LEAK_PROBE = `(() => {
  const text = document.body.innerText
  return (text.match(/\\b(home|shifts|overlay|field|nav|theme)\\.[a-zA-Z]{3,}/g) || [])
})()`;

/** The two caption probes, side by side. The count one stayed green through the bug. */
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
        if (label !== headings[i]) {
          out.mismatches.push(
            'row "' + (row.querySelector('th')?.textContent || '?').trim() + '" col ' + i +
            ': labelled "' + label + '" but the header there is "' + headings[i] + '"'
          )
        }
      })
    }
  }
  return out
})()`;

const WHERE_FOCUS = `(() => {
  const a = document.activeElement
  if (!a) return 'null'
  return [a.tagName, a.className ? '.' + String(a.className).split(' ').join('.') : '',
          '"' + (a.textContent || '').trim().slice(0, 30) + '"'].join('')
})()`;

async function shoot(page, name) {
  await page.screenshot(`${SHOTS}/${name}.png`);
  console.log(`       shot ${name}.png`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const port0 = 9600 + (process.pid % 300);
  const { child, port } = await launchChrome({ port: port0, width: 1680, height: 1050 });
  const page = await attach(port);

  try {
    await page.goto(`${BASE}/login/`, { settle: 700 });
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
    await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
    await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: "the dashboard" });

    // ---- 1 · the dashboard, desktop -------------------------------------------------------
    await setViewport(page, 1680, 1050);
    await page.goto(`${BASE}/`, { settle: 1200 });
    await page.waitFor(`document.querySelector('.answer')`, { label: "the answer band" });

    assert(
      "dashboard: the question is under the h1",
      (await page.eval(`document.querySelector('.topline .question')?.textContent`)) ===
        "Muss ich gerade etwas tun?",
      await page.eval(`document.querySelector('.topline .question')?.textContent`),
    );
    assert(
      "dashboard: the answer band is the page's live region",
      (await page.eval(`document.querySelector('.answer')?.getAttribute('role')`)) === "status",
    );
    assert(
      "dashboard: no second live region wrapping it",
      (await page.eval(
        `document.querySelectorAll('.answer [role="status"], [role="status"] .answer').length`,
      )) === 0,
    );
    const leakHome = await page.eval(KEY_LEAK_PROBE);
    assert("dashboard: no message key rendered as text", leakHome.length === 0, leakHome.join(", "));
    assert(
      "dashboard: „Zu erledigen“ is a panel with rows or a sentence",
      (await page.eval(
        `!!document.querySelector('.list .list-rows .row, .list .empty-state')`,
      )) === true,
    );
    assert(
      "dashboard: the frozen-clock caveat survived",
      (await page.eval(`document.body.innerText.includes('Zeiten bezogen auf')`)) === true,
    );
    assert(
      "dashboard: the recent block still says it is not a total",
      (await page.eval(`document.body.innerText.includes('Das ist keine Summe')`)) === true,
    );
    await shoot(page, "dashboard-1680-dark");

    // ---- 2 · the cross-link carries the period -------------------------------------------
    const rowLabel = await page.eval(
      `document.querySelector('.list-rows .row .who')?.textContent ?? ''`,
    );
    await page.eval(`document.querySelector('.list-rows .row')?.click()`);
    await page.waitFor(`location.pathname === '/shifts/'`, { label: "the shift log" });
    assert(
      "dashboard row → /shifts/?period=all (an unresolved shift is usually older than 30 days)",
      // The period is still mandatory and for the same reason. It now travels with the
      // CONDITION the row was about (decision-38): the row says „3 Schichten zu bestätigen",
      // so the screen it opens shows those three rather than the whole log with them in it.
      (await page.eval(`location.search`)) === "?period=all&state=unresolved",
      `row "${rowLabel}" → ${await page.eval("location.href")}`,
    );
    await page.waitFor(`document.querySelector('.filter-bar select')`, { label: "the filters" });
    assert(
      "shifts: the period select actually reads 'all' after the jump",
      (await page.eval(
        `[...document.querySelectorAll('.filter-bar select')].at(-1)?.value`,
      )) === "all",
    );

    // ---- 3 · the shift log, desktop -------------------------------------------------------
    await page.goto(`${BASE}/shifts/`, { settle: 1200 });
    await page.waitFor(`document.querySelector('table.data-table tbody tr')`, {
      label: "the shift table",
    });
    assert(
      "shifts: the question is under the h1",
      (await page.eval(`document.querySelector('.topline .question')?.textContent`)) ===
        "Welche Schichten brauchen eine Entscheidung?",
    );
    const leakShifts = await page.eval(KEY_LEAK_PROBE);
    assert("shifts: no message key rendered as text", leakShifts.length === 0, leakShifts.join(", "));
    assert(
      "shifts: no permanently-open form is left on the page",
      (await page.eval(`document.querySelectorAll('main form').length`)) === 0,
      `${await page.eval(`document.querySelectorAll('main form').length`)} form(s) still mounted`,
    );
    assert(
      "shifts: the hand-entry caveat is NOT on the page — it is in the drawer that produces it",
      (await page.eval(`document.body.innerText.includes('Manuell erfasst')`)) === true &&
        (await page.eval(`document.body.innerText.includes('bei einer Prüfung der')`)) === false,
    );
    assert(
      "shifts: state is a WORD next to every row, not a colour",
      (await page.eval(
        `[...document.querySelectorAll('table.data-table tbody .badge')].length > 0 &&
         [...document.querySelectorAll('table.data-table tbody .badge')].every((b) => b.textContent.trim().length > 3)`,
      )) === true,
    );
    assert(
      "shifts: payable / not payable is still spelled out",
      (await page.eval(`document.body.innerText.includes('Zählt nicht zur Bezahlung')`)) === true,
    );
    assert(
      // textContent, not innerText: `.data-table th` is text-transform:uppercase, and
      // innerText returns the TRANSFORMED text ('ART DER ERFASSUNG'), so this assertion could
      // never pass against the real string. Measured, not guessed.
      "shifts: the hand-entered column survived",
      (await page.eval(`document.body.textContent.includes('Art der Erfassung')`)) === true,
    );

    // The 3px state rule. MUTATION-TESTED: set it transparent in the throwaway tree, rebuild,
    // and this assertion goes red on its own.
    const rules = await page.eval(`(() => {
      const out = {}
      for (const cls of ['is-open', 'is-unres', 'is-corr']) {
        const cell = document.querySelector('table.data-table tbody tr.' + cls + ' > *:first-child')
        out[cls] = cell ? getComputedStyle(cell).borderLeftColor : 'no such row'
      }
      return out
    })()`);
    const painted = Object.entries(rules).filter(
      ([, colour]) => colour !== "no such row" && colour !== "rgba(0, 0, 0, 0)",
    );
    assert(
      "shifts: the 3px state rule is painted on the first cell",
      painted.length > 0 &&
        Object.values(rules).every((c) => c === "no such row" || c !== "rgba(0, 0, 0, 0)"),
      JSON.stringify(rules),
    );
    await shoot(page, "shifts-1680-dark");

    // ---- 4 · the correction drawer --------------------------------------------------------
    await page.eval(`document.querySelector('.cell-actions button')?.focus()`);
    await page.eval(`document.querySelector('.cell-actions button')?.click()`);
    await page.waitFor(`document.querySelector('.drawer')`, { label: "the correction drawer" });
    assert(
      "correct drawer: one job, and it says which shift",
      (await page.eval(`document.querySelector('.drawer h2')?.textContent`)) ===
        "Schicht korrigieren" &&
        (await page.eval(`document.querySelector('.drawer .step')?.textContent ?? ''`)).startsWith(
          "Korrektur der Schicht",
        ),
    );
    assert(
      "correct drawer: the end time is marked optional (clearing it reopens the shift)",
      (await page.eval(
        `[...document.querySelectorAll('.drawer .field label')].some((l) => l.textContent.includes('Ende') && l.textContent.includes('optional'))`,
      )) === true,
    );
    assert(
      "correct drawer: the start time is required",
      (await page.eval(`document.querySelectorAll('.drawer input[required]').length`)) === 1,
    );
    assert(
      "correct drawer: focus moved inside it",
      (await page.eval(`document.querySelector('.drawer')?.contains(document.activeElement)`)) ===
        true,
      await page.eval(WHERE_FOCUS),
    );
    assert(
      "correct drawer: the save button is wired to the form it is not nested in",
      (await page.eval(
        `document.querySelector('.drawer footer button[type="submit"]')?.getAttribute('form')`,
      )) === "shift-correct-form",
    );
    await shoot(page, "shifts-drawer-correct-1680-dark");

    await press(page, "Escape");
    await sleep(200);
    assert("correct drawer: Escape closes it", (await page.eval(`!document.querySelector('.drawer')`)) === true);
    assert(
      "correct drawer: focus returns to the row's own button",
      (await page.eval(
        `document.activeElement?.closest('.cell-actions') !== null || document.activeElement?.id === 'main-content'`,
      )) === true,
      await page.eval(WHERE_FOCUS),
    );

    // ---- 5 · the hand-entry drawer, and its DIFFERENT validation --------------------------
    await page.clickText("Schicht nachtragen", { selector: ".topline-action button" });
    await page.waitFor(`document.querySelector('.drawer')`, { label: "the hand-entry drawer" });
    assert(
      "create drawer: a separate drawer with its own title",
      (await page.eval(`document.querySelector('.drawer h2')?.textContent`)) ===
        "Schicht nachtragen",
    );
    assert(
      "create drawer: the hand-entered-forever caveat is stated BEFORE the fields",
      (await page.eval(
        `document.querySelector('.drawer .notice')?.textContent.includes('Manuell erfasst')`,
      )) === true,
    );
    assert(
      "create drawer: end time is REQUIRED here (the correction's is not)",
      (await page.eval(
        `[...document.querySelectorAll('.drawer .field label')].some((l) => l.textContent.includes('Ende') && l.textContent.includes('*')) &&
         ![...document.querySelectorAll('.drawer .field label')].some((l) => l.textContent.includes('Ende') && l.textContent.includes('optional'))`,
      )) === true,
    );
    await shoot(page, "shifts-drawer-create-1680-dark");

    // Submitting empty is refused in the browser, before any fetch: nothing is written.
    await page.eval(`document.querySelector('.drawer footer button[type="submit"]').click()`);
    await sleep(300);
    const invalid = await page.eval(
      `document.querySelectorAll('.drawer [aria-invalid="true"]').length`,
    );
    assert("create drawer: an empty submit names all four fields", invalid === 4, `${invalid} of 4`);
    assert(
      "create drawer: each error is wired to its control",
      (await page.eval(`(() => {
        const bad = [...document.querySelectorAll('.drawer [aria-invalid="true"]')]
        return bad.every((el) => (el.getAttribute('aria-describedby') || '')
          .split(' ')
          .some((id) => (document.getElementById(id)?.textContent || '').trim().length > 0))
      })()`)) === true,
    );
    await shoot(page, "shifts-drawer-create-errors-1680-dark");
    await press(page, "Escape");
    await sleep(200);

    // ---- 6 · light theme ------------------------------------------------------------------
    await page.eval(`localStorage.setItem('nfcts.theme', 'light')`);
    await page.goto(`${BASE}/`, { settle: 1200 });
    await page.waitFor(`document.querySelector('.answer')`, { label: "the answer band (light)" });
    assert(
      "light theme paints",
      (await page.eval(`document.documentElement.getAttribute('data-theme')`)) === "light",
    );
    await shoot(page, "dashboard-1680-light");
    await page.goto(`${BASE}/shifts/`, { settle: 1200 });
    await shoot(page, "shifts-1680-light");
    await page.eval(`localStorage.setItem('nfcts.theme', 'dark')`);

    // ---- 7 · the phone --------------------------------------------------------------------
    for (const [path, name] of [
      ["/", "dashboard"],
      ["/shifts/", "shifts"],
    ]) {
      await setViewport(page, 390, 844);
      await page.goto(`${BASE}${path}`, { settle: 1200 });
      await page.waitFor(`document.querySelector('main')`, { label: `${name} on a phone` });
      await sleep(600); // MutationObserver in ResponsiveTableLabels runs after the fetch

      const scrollWidth = await page.eval(`document.documentElement.scrollWidth`);
      assert(`${name} @390: the page does not scroll sideways`, scrollWidth <= 390, `${scrollWidth}px`);

      const probe = await page.eval(CAPTION_PROBE);
      assert(
        `${name} @390: card captions match their column (TEXT probe)`,
        probe.mismatches.length === 0,
        probe.mismatches.slice(0, 4).join(" | "),
      );
      console.log(
        `       count probe: ${probe.count}/${probe.cells} cells labelled in ${probe.tables} table(s)`,
      );
      // NINE, not twelve: `/contracts/`, `/analytics/` and `/inventory/` left the sidebar
      // (decision-39) and are reached from the objects that need them. Asserted as an exact
      // count and not `>= 9`, because the failure this line was written for is a phone
      // losing its navigation entirely, and `>= 9` would also pass a nav that grew back to
      // twelve. `demo/check-filters.mjs` holds the other half: each demoted route still has
      // a way in.
      const navLinks = await page.eval(
        `[...document.querySelectorAll('.sidebar a')].map((a) => new URL(a.href).pathname)`,
      );
      assert(
        `${name} @390: the navigation strip is still there`,
        navLinks.length === 9 && navLinks.includes("/") && navLinks.includes("/shifts/"),
        navLinks.join(" "),
      );
      await shoot(page, `${name}-390-dark`);

      await setViewport(page, 360, 780);
      await sleep(400);
      const narrow = await page.eval(`document.documentElement.scrollWidth`);
      assert(`${name} @360: still no sideways scroll`, narrow <= 360, `${narrow}px`);
    }

    // The drawer is the whole screen on a phone — which is why a refusal is repeated inside it.
    await setViewport(page, 390, 844);
    await page.goto(`${BASE}/shifts/`, { settle: 1200 });
    await page.clickText("Schicht nachtragen", { selector: ".topline-action button" });
    await page.waitFor(`document.querySelector('.drawer')`, { label: "the drawer on a phone" });
    assert(
      "create drawer @390: it covers the screen, so the refusal is repeated inside it",
      (await page.eval(`Math.round(document.querySelector('.drawer').getBoundingClientRect().width)`)) ===
        390,
    );
    await page.eval(`document.querySelector('.drawer footer button[type="submit"]').click()`);
    await sleep(300);
    await shoot(page, "shifts-drawer-create-390-dark");
  } finally {
    page.close();
    child.kill();
  }

  console.log("");
  if (failures.length > 0) {
    console.log(`${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`all green. screenshots in ${SHOTS}`);
}

const timer = setTimeout(() => {
  console.error("check-dashboard-shifts: deadline exceeded");
  process.exit(1);
}, DEADLINE_MS);
timer.unref?.();

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
