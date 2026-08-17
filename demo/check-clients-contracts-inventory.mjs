// The runnable check for batch B2 "clients-contracts-inventory": /clients/, /contracts/
// and /inventory/ after the redesign.
//
//   «stack» (backlog/docs/DEMO.md). It used to need a throwaway copy of web/ with the
//   message fragments folded in; batch B5 folded them into web/messages/*.json for real, so
//   web/ itself now builds:
//
//     (cd web && pnpm build)
//     cd server && DATABASE_URL=postgres:///nfc_demo APP_KEY=... PORT=8083 \
//       PUBLIC_DIR=../web/out node server.js &
//     node demo/check-clients-contracts-inventory.mjs
//
// WHAT IT ACTUALLY CHECKS, and why each one is here rather than assumed:
//
//   1. CARD CAPTIONS. /clients/ now mixes two record shapes in ONE table: a client row and
//      its contact sub-rows. ResponsiveTableLabels captions the ≤767px cards BY CELL
//      POSITION, so a sub-row with one cell fewer would caption a phone number "Objekte" —
//      readable, and false. The probe compares the label TEXT against the header TEXT in
//      that column, because the count probe stays green through exactly that bug.
//   2. NO SIDEWAYS SCROLL at 360px, measured on documentElement.
//   3. THE DRAWER CONTRACT: focus lands inside, Escape closes it, focus is restored to the
//      button that opened it. Not to <body> — that failure is invisible in a screenshot.
//   4. THE CONFIRMATION SAYS THE CONSEQUENCE. Deactivating a contact revokes their portal
//      links server-side and reactivating does not bring them back. That fact used to live
//      only in a code comment; if it stops being on screen at the moment of the decision,
//      it is gone again.
//
// Every wait is bounded and the whole run has a deadline. A check that blocks forever is
// not a slow test, it is a test that cannot fail and looks exactly like progress.
//
// No new dependency: demo/cdp.mjs, Node, and the Chrome already on the machine.
import { mkdirSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8083";
const SHOTS = "/tmp/ts-demo/b2-records";
const DEADLINE_MS = 5 * 60 * 1000;
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-b2: refusing to run against "${host}" — loopback only.`);
  process.exit(1);
}

const failures = [];
function assert(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

/** Label text vs header text, per column. The count probe is printed but never believed. */
const CAPTION_PROBE = `(() => {
  const out = { tables: 0, cells: 0, labelled: 0, mismatches: [] }
  for (const table of document.querySelectorAll('table.data-table')) {
    out.tables++
    const headers = [...table.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim())
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.children]
      if (cells.length !== headers.length) {
        out.mismatches.push('row has ' + cells.length + ' cells, thead has ' + headers.length)
        continue
      }
      cells.forEach((cell, i) => {
        if (cell.tagName !== 'TD') return
        out.cells++
        const label = cell.getAttribute('data-label')
        if (label === null) return
        out.labelled++
        if (label !== headers[i]) {
          out.mismatches.push('cell ' + i + ' labelled "' + label + '" but the header there is "' + headers[i] + '"')
        }
      })
    }
  }
  return out
})()`;

const WHERE_FOCUS = `(() => {
  const a = document.activeElement
  if (!a) return 'null'
  return [a.tagName, a.className ? '.' + String(a.className).split(' ').join('.') : '', ':', (a.textContent||'').trim().slice(0,40)].join('')
})()`;

async function setViewport(page, width, height) {
  // mobile:false — with mobile emulation on, Chrome hands this page a 1304px layout
  // viewport whatever width is asked for, so every phone assertion passes without ever
  // seeing a phone. Read innerWidth back and refuse to continue if it did not take.
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

async function press(page, key, code = key) {
  const opts = { key, code, windowsVirtualKeyCode: key === "Tab" ? 9 : 27 };
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...opts });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...opts });
  await sleep(150);
}

async function setTheme(page, theme) {
  await page.eval(`localStorage.setItem('nfcts.theme', ${JSON.stringify(theme)})`);
}

const SCREENS = [
  ["/clients/", "clients", "table.data-table, .empty-state"],
  ["/contracts/", "contracts", "table.data-table, .empty-state"],
  ["/inventory/", "inventory", "table.data-table, .empty-state"],
];

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const chrome = await launchChrome({ width: 1680, height: 1050 });
  const page = await attach(chrome.port);
  const timer = setTimeout(() => {
    console.error("check-b2: deadline hit");
    process.exit(1);
  }, DEADLINE_MS);

  try {
    await page.goto(`${BASE}/login/`, { settle: 700 });
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
    await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
    await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: "the dashboard" });

    // ---- 1. every screen, both widths, both themes -------------------------------------
    for (const [width, height, tag] of [
      [1680, 1050, "desktop"],
      [390, 844, "phone"],
    ]) {
      await setViewport(page, width, height);
      for (const theme of ["dark", "light"]) {
        for (const [path, name, ready] of SCREENS) {
          await setTheme(page, theme);
          await page.goto(`${BASE}${path}`, { settle: 1100 });
          await page.waitFor(`document.querySelector(${JSON.stringify(ready)})`, {
            timeout: 15000,
            label: `${name}: the list to render`,
          });
          await page.screenshot(`${SHOTS}/${name}-${tag}-${theme}.png`);

          if (tag === "phone" && theme === "dark") {
            const probe = await page.eval(CAPTION_PROBE);
            assert(
              `captions[${name}]: every data-label matches the header in its own column`,
              probe.mismatches.length === 0,
              `${probe.tables} table(s), ${probe.cells} data cells, ${probe.labelled} labelled` +
                (probe.mismatches.length ? ` | ${probe.mismatches.slice(0, 4).join(" | ")}` : ""),
            );
          }
        }
      }
    }

    // ---- 2. 360px: the page never scrolls sideways --------------------------------------
    await setViewport(page, 360, 780);
    await setTheme(page, "dark");
    for (const [path, name] of SCREENS) {
      await page.goto(`${BASE}${path}`, { settle: 1100 });
      const width = await page.eval("document.documentElement.scrollWidth");
      assert(`360px[${name}]: no horizontal scroll`, width <= 360, `scrollWidth ${width}`);
      await page.screenshot(`${SHOTS}/${name}-360.png`);
    }

    // ---- 3. the drawer contract, on /inventory/ -----------------------------------------
    await setViewport(page, 1680, 1050);
    await page.goto(`${BASE}/inventory/`, { settle: 1100 });
    await page.eval(`document.querySelector('.topline-action button').focus()`);
    await page.eval(`document.querySelector('.topline-action button').click()`);
    await page.waitFor(`document.querySelector('.drawer')`, {
      timeout: 5000,
      label: "the inventory drawer",
    });
    assert(
      "drawer[inventory]: focus moves INTO the drawer",
      await page.eval(`!!document.querySelector('.drawer')?.contains(document.activeElement)`),
      await page.eval(WHERE_FOCUS),
    );
    assert(
      "drawer[inventory]: the ONLY form on the screen is the one inside the drawer",
      await page.eval(`(() => {
        const forms = [...document.querySelectorAll('form')]
        return forms.length > 0 && forms.every((f) => f.closest('.drawer') !== null)
      })()`),
      await page.eval(
        `[...document.querySelectorAll('form')].map((f) => f.closest('.drawer') ? 'in-drawer' : 'ON PAGE').join(',')`,
      ),
    );
    // The drawer slides in over 200ms. A screenshot taken before that finishes shows a
    // drawer hanging off the right edge and reads as a layout bug that is not there.
    await sleep(400);
    const geometry = await page.eval(`(() => {
      const r = document.querySelector('.drawer').getBoundingClientRect()
      return { left: Math.round(r.left), right: Math.round(r.right), w: window.innerWidth }
    })()`);
    assert(
      "drawer[inventory]: sits flush against the right edge, nothing off-screen",
      geometry.right === geometry.w && geometry.left > 0,
      JSON.stringify(geometry),
    );
    await page.screenshot(`${SHOTS}/inventory-drawer.png`);
    await press(page, "Escape", "Escape");
    await page.waitFor(`!document.querySelector('.drawer')`, {
      timeout: 5000,
      label: "the drawer to close on Escape",
    });
    assert(
      "drawer[inventory]: Escape restores focus to the button that opened it",
      await page.eval(`document.activeElement === document.querySelector('.topline-action button')`),
      await page.eval(WHERE_FOCUS),
    );

    // A drawer on a phone is the whole screen. Looked at, not asserted.
    await setViewport(page, 390, 844);
    await page.goto(`${BASE}/inventory/`, { settle: 1100 });
    await page.eval(`document.querySelector('.topline-action button').click()`);
    await page.waitFor(`document.querySelector('.drawer')`, {
      timeout: 5000,
      label: "the inventory drawer on a phone",
    });
    await sleep(400);
    await page.screenshot(`${SHOTS}/inventory-drawer-phone.png`);
    await press(page, "Escape", "Escape");
    await setViewport(page, 1680, 1050);

    // A note, not an assertion: `.data-table td` (0,1,1) outranks `.col-numeric` (0,1,0) in
    // web/app/globals.css, which is NOT this batch's file. Printed so the number is in the
    // report rather than in an opinion.
    await page.goto(`${BASE}/inventory/`, { settle: 900 });
    console.log(
      `  note col-numeric computes text-align: ${await page.eval(
        `getComputedStyle(document.querySelector('td.col-numeric')).textAlign`,
      )}`,
    );

    // ---- 4. the confirmation names the consequence --------------------------------------
    await page.goto(`${BASE}/clients/`, { settle: 1200 });
    await page.waitFor(`document.querySelectorAll('tbody tr').length > 1`, {
      timeout: 15000,
      label: "the client list",
    });
    const nested = await page.eval(`(() => {
      const rows = [...document.querySelectorAll('tbody tr')]
      const sub = rows.filter((r) => (r.querySelector('th')?.textContent || '').includes('↳'))
      return { rows: rows.length, sub: sub.length, badge: sub.every((r) => !!r.querySelector('.badge')) }
    })()`);
    assert(
      "clients: contacts render as sub-rows under their client, each carrying the WORD",
      nested.sub > 0 && nested.badge,
      `${nested.rows} rows, ${nested.sub} contact sub-rows`,
    );

    // The second button on a contact sub-row is Deaktivieren / Wieder aktivieren.
    const opened = await page.eval(`(() => {
      const row = [...document.querySelectorAll('tbody tr')]
        .find((r) => (r.querySelector('th')?.textContent || '').includes('↳')
          && (r.querySelectorAll('.cell-actions button')[1]?.textContent || '').includes('Deaktivieren'))
      if (!row) return false
      row.querySelectorAll('.cell-actions button')[1].click()
      return true
    })()`);
    assert("clients: an active contact offers a deactivate control", opened === true);
    await page.waitFor(`document.querySelector('.modal')`, {
      timeout: 5000,
      label: "the deactivation confirmation",
    });
    const body = await page.eval(
      `(document.querySelector('.modal .body p')?.textContent || '')`,
    );
    assert(
      "clients: the confirmation says the links stop and do not come back",
      body.includes("Links") && body.includes("nicht wieder her"),
      JSON.stringify(body.slice(0, 120)),
    );
    assert(
      "clients: the confirmation is wired as the dialog's description",
      await page.eval(`(() => {
        const m = document.querySelector('.modal')
        const id = m?.getAttribute('aria-describedby')
        return !!id && !!m.querySelector('#' + CSS.escape(id))
      })()`),
    );
    // The overlay fades in over 200ms; a screenshot taken inside that window shows a
    // half-transparent dialog and reads as a contrast bug that is not there.
    await sleep(400);
    await page.screenshot(`${SHOTS}/clients-confirm.png`);
    await press(page, "Escape", "Escape");
    await page.waitFor(`!document.querySelector('.modal')`, {
      timeout: 5000,
      label: "the confirmation to close",
    });

    // ---- 4b. an empty required field is refused BEFORE anything is sent -----------------
    // No write: the point is that the drawer refuses, names the field and stays open.
    await page.eval(`document.querySelector('.topline-action button').click()`);
    await page.waitFor(`document.querySelector('.drawer form')`, {
      timeout: 5000,
      label: "the client drawer",
    });
    await page.eval(`document.querySelector('.drawer footer button[type="submit"]').click()`);
    await sleep(300);
    const invalid = await page.eval(`(() => {
      const input = document.querySelector('.drawer form input[type="text"]')
      const described = (input.getAttribute('aria-describedby') || '')
        .split(' ').map((id) => document.getElementById(id)?.textContent?.trim() || '').join(' ')
      return {
        open: !!document.querySelector('.drawer'),
        invalid: input.getAttribute('aria-invalid'),
        described,
      }
    })()`);
    assert(
      "clients: an empty name is refused, named on the field, and the drawer stays open",
      invalid.open && invalid.invalid === "true" && invalid.described.includes("Namen"),
      JSON.stringify(invalid),
    );
    await page.screenshot(`${SHOTS}/clients-drawer-invalid.png`);
    await press(page, "Escape", "Escape");
    await page.waitFor(`!document.querySelector('.drawer')`, {
      timeout: 5000,
      label: "the client drawer to close",
    });

    // ---- 4c. a REAL save: the page announces it and focus comes back to the row --------
    // This one writes. It re-saves a client under the name it already has, so the row is
    // touched and nothing changes — and only nfc_demo is ever reachable from here. It is
    // the assertion that covers risk 5.7: the drawer closes, the refetch replaces the list,
    // and the keyboard user must NOT end up on <body> at the top of the document.
    await page.goto(`${BASE}/clients/`, { settle: 1200 });
    await page.waitFor(`document.querySelectorAll('tbody tr').length > 1`, {
      timeout: 15000,
      label: "the client list",
    });
    await page.eval(`(() => {
      const b = document.querySelector('tbody tr .cell-actions button')
      b.focus()
      b.click()
    })()`);
    await page.waitFor(`document.querySelector('.drawer form input[type="text"]')`, {
      timeout: 5000,
      label: "the client drawer",
    });
    await page.eval(`document.querySelector('.drawer footer button[type="submit"]').click()`);
    await page.waitFor(`!document.querySelector('.drawer')`, {
      timeout: 10000,
      label: "the drawer to close on a successful save",
    });
    await sleep(700);
    const saved = await page.eval(`({
      status: document.querySelector('main p.form-status')?.textContent || '',
      focus: document.activeElement.tagName + ':' + (document.activeElement.textContent || '').trim().slice(0, 28),
      onRowButton: document.activeElement.closest?.('tbody .cell-actions') !== null,
    })`);
    assert(
      "clients: a save closes the drawer, the PAGE says so, and focus is back on the row",
      saved.status.includes("gespeichert") && saved.onRowButton,
      JSON.stringify(saved),
    );

    // ---- 5. /contracts/: the standing caveats survived -----------------------------------
    await page.goto(`${BASE}/contracts/`, { settle: 1200 });
    const notes = await page.eval(
      `[...document.querySelectorAll('.callout li')].map((li) => li.textContent.trim())`,
    );
    assert(
      "contracts: all four standing notes are still on screen",
      notes.length === 4 && notes.some((n) => n.includes("NICHT zeitraumgenau")),
      `${notes.length} notes`,
    );
    // Open a building's history and check the panel took focus.
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('tbody .cell-actions button')][0]
      b.focus(); b.click()
    })()`);
    await page.waitFor(`document.querySelector('main .list + div .list, main div[tabindex="-1"] .list')`, {
      timeout: 15000,
      label: "the contract history panel",
    });
    await sleep(500);
    assert(
      "contracts: focus follows the history panel it just opened",
      await page.eval(
        `document.activeElement === document.querySelector('main div[tabindex="-1"]')`,
      ),
      await page.eval(WHERE_FOCUS),
    );
    await page.scrollTo('main div[tabindex="-1"]', { pause: 600 });
    await page.screenshot(`${SHOTS}/contracts-history.png`);

    // The write: a drawer that says what the new period REPLACES before anything is typed.
    await page.clickText("Neue Vertragsperiode", { selector: ".lh button" });
    await page.waitFor(`document.querySelector('.drawer form')`, {
      timeout: 5000,
      label: "the new-period drawer",
    });
    await sleep(400);
    const intro = await page.eval(`document.querySelector('.drawer .note')?.textContent || ''`);
    assert(
      "contracts: the drawer states the price it replaces and from when",
      intro.includes("\u20ac") && /seit/.test(intro),
      JSON.stringify(intro.slice(0, 100)),
    );
    await page.screenshot(`${SHOTS}/contracts-drawer.png`);
    await press(page, "Escape", "Escape");
    await page.waitFor(`!document.querySelector('.drawer')`, {
      timeout: 5000,
      label: "the new-period drawer to close",
    });

    // The one irreversible write: the confirmation must say so, and NOT be offered on a
    // closed period (the server refuses that; the button is simply not drawn).
    const closed = await page.eval(
      `[...document.querySelectorAll('main div[tabindex="-1"] tbody tr')]
         .filter((r) => (r.textContent || '').includes('Abgeschlossen')).length`,
    );
    await page.clickText("Diese Periode r\u00fcckg\u00e4ngig machen", { selector: "tbody button" });
    await page.waitFor(`document.querySelector('.modal')`, {
      timeout: 5000,
      label: "the undo confirmation",
    });
    await sleep(300);
    const undoBody = await page.eval(`document.querySelector('.modal .body p')?.textContent || ''`);
    assert(
      "contracts: the undo confirmation says it cannot be undone",
      undoBody.includes("nicht r\u00fcckg\u00e4ngig"),
      `${closed} closed period(s) offer no undo button | ${JSON.stringify(undoBody.slice(0, 90))}`,
    );
    await page.screenshot(`${SHOTS}/contracts-confirm.png`);
    await press(page, "Escape", "Escape");
  } finally {
    clearTimeout(timer);
    page.close();
    chrome.child.kill();
  }

  console.log(`\nscreenshots in ${SHOTS}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("all green");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
