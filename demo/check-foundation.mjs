// The runnable check for the redesign foundation.
//
//   «stack»  (see backlog/docs/DEMO.md — seeded nfc_demo + the API on 127.0.0.1:8082)
//   node demo/check-foundation.mjs            # asserts, screenshots into /tmp/ts-demo/foundation
//   node demo/check-foundation.mjs --keep     # leave the temporary harness route in place
//
// WHY THIS EXISTS. Two things in the foundation rot silently, and this project has already
// paid for both of them:
//
//   1. FOCUS RESTORATION. `lastFocus.focus()` works right up until the save removes the row
//      that opened the drawer. Then lastFocus is detached, .focus() is a silent no-op, and
//      the keyboard user is dumped on <body> at the top of the document. Nothing on screen
//      changes, so no screenshot and no "does the drawer close" test can see it.
//
//   2. CARD CAPTIONS ON A PHONE. ResponsiveTableLabels captions cards BY CELL POSITION. An
//      off-by-one captions a timestamp "Objekt" — readable, and false. The file's own
//      comment records that this shipped, and that EVERY AUTOMATED ASSERTION STAYED GREEN
//      while it was wrong, because the assertions counted labelled cells instead of reading
//      them. This script therefore runs BOTH probes and prints both: the count probe (weak,
//      stays green through the bug) and the text probe (compares the label TEXT to the
//      header TEXT). If the count probe ever disagrees with the text probe, believe the text.
//
// Everything here is bounded: every wait has a timeout and the whole run has a deadline. A
// check that blocks forever is not a slow test, it is a test that cannot fail and looks
// exactly like progress.
//
// No new dependency: demo/cdp.mjs, Node, and the Chrome that is already on the machine.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8082";
const REPO = new URL("..", import.meta.url).pathname;
const WEB = `${REPO}web`;
const HARNESS_DIR = `${WEB}/app/foundation-check`;
const SHOTS = "/tmp/ts-demo/foundation";
const KEEP = process.argv.includes("--keep");
const DEADLINE_MS = 5 * 60 * 1000;

/**
 * How many links the sidebar carries, READ FROM web/lib/nav.ts and never written here.
 *
 * This was the literal `12` from before decision-39 cut the sidebar to NINE, so the phone
 * assertion below failed on a screen that was obeying an accepted decision — a check that
 * is red for a superseded reason is a check nobody reads. Same regex as demo/audit-phone.mjs
 * and for the same reason: this is a plain node script with no TypeScript loader, and the
 * account group is written on one line so `^\s*\{ href:` undercounts it by one.
 */
const NAV_SOURCE = readFileSync(`${WEB}/lib/nav.ts`, "utf8");
const NAV_COUNT = (
  NAV_SOURCE.slice(
    NAV_SOURCE.indexOf("export const NAV_GROUPS"),
    NAV_SOURCE.indexOf("export const OFF_NAV_ROUTES"),
  ).match(/href:/g) ?? []
).length;
if (NAV_COUNT < 2) {
  throw new Error(`check-foundation: read ${NAV_COUNT} nav entries out of web/lib/nav.ts`);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

// Never the live server. A hostname check, not a comment.
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-foundation: refusing to run against "${host}" — loopback only.`);
  process.exit(1);
}

const failures = [];
const notes = [];
const ok = (name, extra = "") => console.log(`  ok   ${name}${extra ? `  ${extra}` : ""}`);
function assert(name, condition, detail = "") {
  if (condition) ok(name, detail);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------------------
// The temporary harness route. No screen has been migrated to <Drawer> yet, so there is
// nothing in the shipped app to drive. It is written, built, driven and DELETED — a page
// called foundation-check must never reach a router the director uses.
// ---------------------------------------------------------------------------------------
const HARNESS = `'use client'

// TEMPORARY. Written and deleted by demo/check-foundation.mjs. If you are reading this in
// git, something crashed between the build and the cleanup: delete the directory.
import { useState } from 'react'
import { ConfirmModal } from '@/components/ConfirmModal'
import { Drawer } from '@/components/Drawer'
import { Field } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { StateBadge } from '@/components/StateBadge'

export default function FoundationCheck() {
  const [drawer, setDrawer] = useState<'plain' | 'vanishing' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [openerGone, setOpenerGone] = useState(false)

  return (
    <>
      <PageHeader title="Foundation check" question="Halten Fokus und Kartenbeschriftung?" />

      <button type="button" id="opener-plain" className="btn btn-primary" onClick={() => setDrawer('plain')}>
        Schicht korrigieren
      </button>
      {openerGone ? null : (
        <button
          type="button"
          id="opener-vanishing"
          className="btn btn-ghost"
          onClick={() => setDrawer('vanishing')}
        >
          Schicht bestaetigen
        </button>
      )}
      <button type="button" id="opener-confirm" className="btn btn-ghost" onClick={() => setConfirm(true)}>
        Zugangscode widerrufen
      </button>

      <table className="data-table">
        <caption className="visually-hidden">Foundation check table</caption>
        <thead>
          <tr>
            <th scope="col">Objekt</th>
            <th scope="col">Beginn</th>
            <th scope="col">Ende</th>
            <th scope="col">Zustand</th>
          </tr>
        </thead>
        <tbody>
          <tr className="is-unres" id="row-unres">
            <th scope="row">Arsenalstrasse 11</th>
            <td>06:00</td>
            <td>14:00</td>
            <td><StateBadge state="unres" label="Nicht bestaetigt" /></td>
          </tr>
          <tr className="is-open" id="row-open">
            <th scope="row">Donaufelder Strasse 1</th>
            <td>09:12</td>
            <td>—</td>
            <td><StateBadge state="open" label="Laeuft" /></td>
          </tr>
        </tbody>
      </table>

      <Drawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title="Schicht korrigieren"
        step="Selim Kaya · 11.08.2026"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDrawer(null)}>
              Abbrechen
            </button>
            <button
              type="button"
              id="drawer-save"
              className="btn btn-primary"
              onClick={() => {
                // The save that removes the row which opened the drawer. This is the case
                // the naive lastFocus.focus() cannot survive.
                if (drawer === 'vanishing') setOpenerGone(true)
                setDrawer(null)
              }}
            >
              Speichern
            </button>
          </>
        }
      >
        <Field id="check-start" label="Beginn" required help="Wiener Ortszeit.">
          <input type="text" defaultValue="06:00" required />
        </Field>
        <Field id="check-end" label="Ende" optional error="">
          <input type="text" defaultValue="14:00" />
        </Field>
      </Drawer>

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)}
        title="Zugangscode widerrufen?"
        body="Der Code funktioniert danach sofort nicht mehr."
        confirmLabel="Widerrufen"
        destructive
      />
    </>
  )
}
`;

function writeHarness() {
  mkdirSync(HARNESS_DIR, { recursive: true });
  writeFileSync(`${HARNESS_DIR}/page.tsx`, HARNESS);
}

function removeHarness() {
  rmSync(HARNESS_DIR, { recursive: true, force: true });
  rmSync(`${WEB}/out/foundation-check`, { recursive: true, force: true });
}

/**
 * THIS FUNCTION OVERWRITES web/out FOR EVERY OTHER CHECK IN THIS DIRECTORY, and the build
 * it leaves behind is the one they all read. That made it a trap: `pnpm build` with no
 * NEXT_PUBLIC_GOOGLE_MAPS_KEY in the environment produces a static export whose
 * `MAPS_API_KEY` is `''`, which puts HomeMap into its `noKey` state — no script tag, no
 * canvas, no pins, forever. Nothing warns; the map region simply says „für diesen Build ist
 * kein Kartenschlüssel hinterlegt", which is a TRUE sentence about a build nobody meant to
 * make. demo/check-filters.mjs and demo/check-ia-greyscale.mjs then timed out waiting for
 * pins that could never appear, and the failure pointed at them rather than at here.
 *
 * So the key is carried through when the caller has one, and the run says out loud which
 * kind of build it is leaving on disk. Not fetched from `psst`: this file must keep working
 * with no secret store, and a check is not a place to reach for credentials on its own.
 */
function build(label) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";
  process.stdout.write(`  … next build (${label})${key === "" ? " — NO MAPS KEY" : " — with maps key"}\n`);
  execFileSync("pnpm", ["build"], {
    cwd: WEB,
    stdio: "pipe",
    env: { ...process.env, NEXT_PUBLIC_GOOGLE_MAPS_KEY: key },
  });
}

// ---------------------------------------------------------------------------------------
const KEYS = {
  Tab: { windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" },
  Escape: { windowsVirtualKeyCode: 27, key: "Escape", code: "Escape" },
};

async function press(page, name, { shift = false } = {}) {
  const k = KEYS[name];
  const modifiers = shift ? 8 : 0;
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k, modifiers });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...k, modifiers });
  await sleep(60);
}

/**
 * Resize, and PROVE the resize took. The first version of this script asserted "no
 * horizontal scroll at 390px" against a 1303px viewport, because the override had not
 * applied and window.innerWidth was never read back. Every one of those assertions passed,
 * and none of them was a check.
 */
async function setViewport(page, width, height) {
  // `mobile: false`. With mobile emulation on, Chrome hands this page a 1304px layout
  // viewport regardless of the width asked for, so every media query is evaluated at
  // DESKTOP width and every phone assertion passes without ever seeing a phone. Measured,
  // not guessed: mobile:true -> innerWidth 1304, mobile:false -> innerWidth 390.
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

/** Where is focus, described well enough to read in a failure message. */
const WHERE_FOCUS = `(() => {
  const a = document.activeElement
  if (!a) return 'null'
  return [a.tagName, a.id ? '#' + a.id : '', a.className ? '.' + String(a.className).split(' ').join('.') : ''].join('')
})()`;

/**
 * THE TWO PROBES, side by side, on whatever tables are on screen.
 *
 * count: how many <td>s carry a data-label. This is the probe that stayed green while every
 *        card was captioned with the wrong column.
 * text:  every labelled cell's data-label compared to the TEXT of the header in the same
 *        position. This is the probe that catches it.
 */
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

// ---------------------------------------------------------------------------------------
async function main() {
  mkdirSync(SHOTS, { recursive: true });
  removeHarness();
  writeHarness();
  build("with the harness route");

  // A per-run debugging port. launchChrome polls /json/version and takes whatever answers,
  // so a Chrome left over from an earlier run answers first and this script then drives a
  // browser it does not own — with that browser's leftover emulation still applied. That is
  // how the first version of this file measured "390px" against a 1303px viewport.
  const port0 = 9400 + (process.pid % 500);
  const { child, port } = await launchChrome({ port: port0, width: 1440, height: 900 });
  const page = await attach(port);

  try {
    // ---- sign in -----------------------------------------------------------------------
    await page.goto(`${BASE}/login/`, { settle: 700 });
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
    await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
    await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: "the dashboard" });

    // ---- 1. theme, applied before first paint -------------------------------------------
    const html = readFileSync(`${WEB}/out/index.html`, "utf8");
    const scriptAt = html.indexOf("data-theme");
    const firstBundleAt = html.indexOf("<script src");
    assert(
      "theme: the resolver is inline in <head>, ahead of every bundle",
      scriptAt !== -1 && (firstBundleAt === -1 || scriptAt < firstBundleAt),
      `inline at ${scriptAt}, first bundle at ${firstBundleAt}`,
    );

    for (const [stored, expected] of [
      ["light", "light"],
      ["dark", "dark"],
    ]) {
      await page.eval(`localStorage.setItem('nfcts.theme', '${stored}')`);
      await page.goto(`${BASE}/`, { settle: 500 });
      const attr = await page.eval(`document.documentElement.getAttribute('data-theme')`);
      assert(`theme: stored "${stored}" paints ${expected}`, attr === expected, `got "${attr}"`);
    }

    // "System" with no OS answer available must be DARK, not light.
    await page.eval(`localStorage.removeItem('nfcts.theme')`);
    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await page.goto(`${BASE}/`, { settle: 500 });
    assert(
      "theme: system + OS dark → dark",
      (await page.eval(`document.documentElement.getAttribute('data-theme')`)) === "dark",
    );
    await page.send("Emulation.setEmulatedMedia", { features: [] });

    // ---- 2. overlay: focus in, trapped, restored ----------------------------------------
    await page.goto(`${BASE}/foundation-check/`, { settle: 600 });

    await page.eval(`document.getElementById('opener-plain').focus()`);
    await page.eval(`document.getElementById('opener-plain').click()`);
    await page.waitFor(`document.querySelector('.drawer')`, {
      timeout: 5000,
      label: "the drawer to open",
    });
    assert(
      "overlay: focus moves INTO the drawer on open",
      await page.eval(`!!document.querySelector('.drawer')?.contains(document.activeElement)`),
      await page.eval(WHERE_FOCUS),
    );

    // 14 real Tab presses: more than there are controls, so a leak shows up.
    for (let i = 0; i < 14; i++) await press(page, "Tab");
    assert(
      "overlay: Tab never leaves the drawer",
      await page.eval(`!!document.querySelector('.drawer')?.contains(document.activeElement)`),
      await page.eval(WHERE_FOCUS),
    );
    for (let i = 0; i < 4; i++) await press(page, "Tab", { shift: true });
    assert(
      "overlay: Shift+Tab never leaves the drawer",
      await page.eval(`!!document.querySelector('.drawer')?.contains(document.activeElement)`),
      await page.eval(WHERE_FOCUS),
    );

    assert(
      "overlay: the page behind does not scroll while open",
      (await page.eval(`document.body.style.overflow`)) === "hidden",
    );

    await page.screenshot(`${SHOTS}/drawer-dark.png`);

    await press(page, "Escape");
    await sleep(250);
    assert(
      "overlay: Escape closes the drawer",
      !(await page.eval(`!!document.querySelector('.drawer')`)),
    );
    assert(
      "overlay: focus RETURNS to the control that opened it",
      (await page.eval(`document.activeElement?.id`)) === "opener-plain",
      await page.eval(WHERE_FOCUS),
    );
    assert(
      "overlay: body scroll is released on close",
      (await page.eval(`document.body.style.overflow`)) === "",
      `overflow="${await page.eval(`document.body.style.overflow`)}"`,
    );

    // ---- 3. THE NEGATIVE CASE: the opener is gone by the time the drawer closes ---------
    await page.eval(`document.getElementById('opener-vanishing').focus()`);
    await page.eval(`document.getElementById('opener-vanishing').click()`);
    await page.waitFor(`document.querySelector('.drawer')`, {
      timeout: 5000,
      label: "the second drawer",
    });
    await page.eval(`document.getElementById('drawer-save').click()`);
    await sleep(300);
    const landed = await page.eval(WHERE_FOCUS);
    assert(
      "overlay: opener removed by the save → focus lands on #main-content, never <body>",
      (await page.eval(`document.activeElement?.id`)) === "main-content",
      `focus landed on ${landed}`,
    );
    assert(
      "overlay: …and the opener really was removed (otherwise the case above is vacuous)",
      !(await page.eval(`!!document.getElementById('opener-vanishing')`)),
    );

    // ---- 4. the 3px state rule actually PAINTS ------------------------------------------
    const rule = await page.eval(`(() => {
      const cell = (id) => getComputedStyle(document.querySelector('#' + id + ' > *:first-child')).borderLeftColor
      const width = getComputedStyle(document.querySelector('#row-unres > *:first-child')).borderLeftWidth
      return { unres: cell('row-unres'), open: cell('row-open'), width }
    })()`);
    assert(
      "state rule: the 3px left rule is painted on the first CELL",
      rule.width === "3px" && rule.unres !== "rgba(0, 0, 0, 0)",
      JSON.stringify(rule),
    );
    assert(
      "state rule: unresolved and open are different colours",
      rule.unres !== rule.open,
      JSON.stringify(rule),
    );

    // ---- 5. phone: captions, and no sideways page --------------------------------------
    await setViewport(page, 390, 844);

    for (const [path, label] of [
      ["/foundation-check/", "harness"],
      ["/workers/", "workers"],
      ["/shifts/", "shifts"],
      ["/payroll/", "payroll"],
    ]) {
      await page.goto(`${BASE}${path}`, { settle: 1200 });
      // Bounded: a screen that never renders a table is a failure, not a hang.
      const probe = await page.eval(CAPTION_PROBE);
      assert(
        `captions[${label}]: every data-label matches the header in its own column`,
        probe.mismatches.length === 0,
        probe.mismatches.slice(0, 4).join(" | "),
      );
      notes.push(
        `${label}: ${probe.tables} table(s), ${probe.cells} cells, ${probe.count} labelled ` +
          `(count probe: ${probe.count > 0 ? "GREEN" : "no data"}; text probe: ` +
          `${probe.mismatches.length === 0 ? "GREEN" : `RED ×${probe.mismatches.length}`})`,
      );

      const scroll = await page.eval(
        `({ w: document.documentElement.scrollWidth, v: window.innerWidth })`,
      );
      if (scroll.v !== 390) throw new Error(`the 390px viewport was lost: ${scroll.v}px`);
      assert(
        `layout[${label}]: no horizontal page scroll at 390px`,
        scroll.w <= scroll.v + 1,
        JSON.stringify(scroll),
      );
      await page.screenshot(`${SHOTS}/phone-${label}.png`);
    }

    // 360px is the narrowest handset that matters.
    await setViewport(page, 360, 780);
    await page.goto(`${BASE}/shifts/`, { settle: 1000 });
    const narrow = await page.eval(
      `({ w: document.documentElement.scrollWidth, v: window.innerWidth })`,
    );
    assert(
      "layout[shifts]: no horizontal page scroll at 360px",
      narrow.w <= narrow.v + 1,
      JSON.stringify(narrow),
    );
    const navLinks = await page.eval(
      `document.querySelectorAll('nav.sidebar a.nav-link').length`,
    );
    assert(
      `nav: the sidebar is still a reachable strip on a phone, all ${NAV_COUNT} routes`,
      navLinks === NAV_COUNT,
      `${navLinks} links, web/lib/nav.ts declares ${NAV_COUNT}`,
    );
    await page.screenshot(`${SHOTS}/phone-360-shifts.png`);

    // ---- 6. desktop stills, for looking at ----------------------------------------------
    await page.send("Emulation.clearDeviceMetricsOverride");
    for (const [path, name] of [
      ["/", "dashboard"],
      ["/workers/", "workers"],
      ["/shifts/", "shifts"],
      ["/payroll/", "payroll"],
      ["/reinigung/", "portal"],
    ]) {
      await page.goto(`${BASE}${path}`, { settle: 900 });
      await page.screenshot(`${SHOTS}/desktop-${name}.png`);
    }
    assert(
      "portal: /reinigung/ is still LIGHT — nobody approved darkening a client's page",
      (await page.eval(
        `getComputedStyle(document.querySelector('.portal')).backgroundColor`,
      )) === "rgb(250, 250, 250)",
      await page.eval(`getComputedStyle(document.querySelector('.portal')).backgroundColor`),
    );

    await page.eval(`localStorage.setItem('nfcts.theme', 'light')`);
    await page.goto(`${BASE}/workers/`, { settle: 900 });
    await page.screenshot(`${SHOTS}/desktop-workers-light.png`);
    await page.eval(`localStorage.setItem('nfcts.theme', 'dark')`);
  } finally {
    page.close();
    child.kill();
    if (!KEEP) {
      removeHarness();
      build("without the harness route");
    }
  }

  console.log("");
  for (const note of notes) console.log(`  note ${note}`);
  console.log(`\n  screenshots: ${SHOTS}`);
  if (failures.length > 0) {
    console.error(`\ncheck-foundation: ${failures.length} FAILURE(S)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\ncheck-foundation: OK");
}

const bail = setTimeout(() => {
  console.error("check-foundation: hit the 5 minute deadline — bailing out.");
  if (existsSync(HARNESS_DIR) && !KEEP) removeHarness();
  process.exit(1);
}, DEADLINE_MS);
bail.unref?.();

await main();
clearTimeout(bail);
