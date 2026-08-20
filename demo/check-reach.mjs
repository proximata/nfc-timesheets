// The runnable check for the THREE reachability findings in backlog/docs/STATE-GALLERY.md
// §2(b) — B1, B2 and B3. „Can the director actually get anywhere."
//
//   «stack»  seeded nfc_demo + the API serving a build of these screens (loopback only)
//   DEMO_BASE=http://127.0.0.1:8080 node demo/check-reach.mjs
//
// B1 / TASK-177 — THE WORKER PANEL'S CROSS-LINKS WERE UNREACHABLE. 0 of 3 without scrolling
// at 1680, and 950px of scrolling away on a 390px phone, because „Weiter zu" sat under a
// ten-row shift history. The building drawer, which puts the same list BEFORE its history,
// reported 6 of 6. The difference was ordering and nothing else. The same shape was then
// found unmeasured in the /analytics/ drawer, under a twelve-row trend table, and it is
// fixed and measured here too.
//
// B2 / TASK-178 — DAY ZERO HAD NO WAY FORWARD. On an empty database `/` said „sobald ein
// Objekt angelegt ist" and offered no link to the screen that creates one; the map region
// borrowed `mapNoPins` and printed „0 Objekte haben keine Koordinaten, daher gibt es nichts
// zu zeichnen", which contradicts itself; and „Zurzeit ist niemand eingestempelt." was
// printed three times. This is the first screen the Vienna client sees next week.
//
// B3 / TASK-179 — AT 390px THE FIRST FACT WAS AT y=759 OF 844. Darstellung, Sprache and
// Abmelden held the top of the phone screen, and 175 controls on /shifts/ were under 44px.
//
// WHAT MAKES THESE ASSERTIONS ABLE TO FAIL, which is the only property that matters:
//
//   1. EVERY MEASUREMENT IS GEOMETRY OFF THE RENDERED SCREEN, not a DOM query. „Reachable"
//      means a rectangle inside the SCROLLER's rectangle — a drawer is `position: fixed`
//      with its own overflow, so measuring against `window.innerHeight` reports every link
//      as visible on a tall document and is the exact mistake this file exists to catch.
//      „Visible" additionally requires `offsetParent`, so a link behind a closed disclosure
//      or inside a `visually-hidden` block scores as what it is: not on the screen.
//   2. EVERY POSITIVE HAS A NEGATIVE TWIN. „the empty dashboard offers a link to /locations/"
//      is worth nothing without „and the POPULATED one does not", which is the assertion
//      that fails if somebody renders the empty state unconditionally. Same for the map's
//      zero-building sentence, which must NOT appear on a portfolio of six.
//   3. THE VACUITY GUARD IS EXPLICIT. A panel that did not open, a screen whose table never
//      arrived and a database that was not actually emptied each FAIL here rather than
//      skipping. Seven checks in this project have been green because their subject was
//      missing.
//   4. FOUR CONFIGURATIONS. 1680 and 390, dark and light — the same grid the state gallery
//      was shot on, because a fold is a function of width and a contrast bug is not.
//
// IT MUTATES nfc_demo for section B. A `pg_dump -Fc` goes to /tmp before the first DELETE,
// the restore is in a `finally`, and the run ends by comparing every table's row count with
// the counts taken before it started. A probe killed mid-run skips its finally — so the dump
// on disk, and not the finally, is the actual guarantee.
//
// No new dependency: demo/cdp.mjs, Node, psql, and the Chrome already on the machine.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMapKeyInBuild } from "./build-guard.mjs";
import { attach, launchChrome, sleep } from "./cdp.mjs";
import { REACH } from "./probe-panel-reach.mjs";

// THE MAP ASSERTIONS BELOW ARE ABOUT COPY, AND A KEYLESS BUNDLE REWRITES THAT COPY.
// `day zero: the zero-building case has its own sentence` reads the map region's note. With
// no NEXT_PUBLIC_GOOGLE_MAPS_KEY in the build, HomeMap renders its `noKey` note instead — a
// TRUE sentence about a build nobody meant to make — and this file fails four times naming
// the wrong thing. demo/check-foundation.mjs rebuilds web/out and passes the key through
// only if the CALLER had one, so running it without the key in the environment silently
// disarms every map assertion in this directory. Fail here, with the fix, rather than
// reporting a copy defect that is really a build defect (VERIFY-FINAL §1.1's whole lesson).
assertMapKeyInBuild();

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
const DB = process.env.DEMO_DB ?? "nfc_demo";
const SHOTS = "/tmp/reach/shots";
const DUMP = "/tmp/reach/nfc_demo-before-reach.dump";
const DEADLINE_MS = 20 * 60 * 1000;
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

/** TASK-179 AC#1. 844px phone; the first building name has to be inside the top two thirds. */
const FIRST_FACT_MAX_Y = 560;
/** WCAG 2.5.5 target size. The brand link is the one stated exception (WCAG 2.5.8 inline). */
const TOUCH_MIN = 44;
/** TASK-179 AC#5. /shifts/ measured 175 undersized controls at 390px. */
const SHIFTS_SMALL_MAX = 20;

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-reach: refusing to run against "${host}" — loopback only.`);
  process.exit(1);
}
// This script DELETEs rows. The one database it may ever touch is the throwaway one — the
// same refusal demo/seed.sql, demo/make-admin.mjs and demo/shoot-states.mjs make.
if (DB !== "nfc_demo") {
  console.error(`check-reach: refusing to write to "${DB}" — nfc_demo only.`);
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });

const sql = (q) => execFileSync("psql", ["-d", DB, "-tAc", q], { encoding: "utf8" }).trim();
const exec = (q) =>
  execFileSync("psql", ["-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", q], { encoding: "utf8" });

const TABLES = sql(
  "SELECT string_agg(table_name, ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
).split(" ");
const fingerprint = () => TABLES.map((t) => `${t} ${sql(`SELECT count(*) FROM ${t}`)}`).join("\n");
const BEFORE = fingerprint();
execFileSync("pg_dump", ["-Fc", "-f", DUMP, DB]);
console.log(`check-reach: dump -> ${DUMP}`);

const failures = [];
function assert(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------------------
// Reading the screen. Everything reads RENDERED GEOMETRY. `offsetParent !== null` is the
// „is on the screen" test throughout: a sentence inside a closed <details>, behind a
// [hidden] disclosure face or inside a .visually-hidden block is a sentence nobody reads,
// and `textContent` cannot tell the three apart.
// ---------------------------------------------------------------------------------------

/** The landing screen, top to bottom, in document pixels. */
const FOLD = `(() => {
  const shown = (el) => el !== null && el.offsetParent !== null
  const y = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY)
  const answer = document.querySelector('.answer')
  const rows = [...document.querySelectorAll('table.objects-table tbody tr')]
  const first = rows[0]?.querySelector('th') ?? null
  const brand = document.querySelector('.brand')
  const small = [...document.querySelectorAll('a[href], button, select, input, textarea, summary')]
    .filter(shown)
    .filter((el) => el.getBoundingClientRect().height < ${TOUCH_MIN})
    .map((el) => ({
      h: Math.round(el.getBoundingClientRect().height),
      brand: el.classList.contains('brand'),
      text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
    }))
  return {
    fold: window.innerHeight,
    headerHeight: Math.round(document.querySelector('.app-header')?.getBoundingClientRect().height ?? -1),
    brandTop: brand ? y(brand) : null,
    answerTop: answer ? y(answer) : null,
    answerBottom: answer ? Math.round(answer.getBoundingClientRect().bottom + window.scrollY) : null,
    rowCount: rows.length,
    firstFactY: first ? y(first) : null,
    firstFactText: first ? first.childNodes[0]?.textContent?.trim() ?? '' : null,
    firstRowBottom: rows[0] ? Math.round(rows[0].getBoundingClientRect().bottom + window.scrollY) : null,
    small,
    smallCount: small.length,
    smallNonBrand: small.filter((s) => !s.brand).length,
  }
})()`;

/** The three settings controls, and the disclosure that may or may not be hiding them. */
const TOOLS = `(() => {
  const shown = (el) => el !== null && el.offsetParent !== null
  const rect = (el) => (el === null ? null : {
    top: Math.round(el.getBoundingClientRect().top),
    left: Math.round(el.getBoundingClientRect().left),
    h: Math.round(el.getBoundingClientRect().height),
    mid: Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2),
  })
  const toggle = document.querySelector('.header-tools-toggle')
  const theme = document.querySelector('.theme-switcher select')
  const locale = document.querySelector('.locale-switcher select')
  const logout = document.querySelector('.header-actions button:not(.header-tools-toggle)')
  const brand = document.querySelector('.brand')
  const nav = document.querySelector('.sidebar')
  return {
    toggleShown: shown(toggle),
    toggleExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
    toggleH: toggle ? Math.round(toggle.getBoundingClientRect().height) : null,
    themeShown: shown(theme), localeShown: shown(locale), logoutShown: shown(logout),
    themeInDom: theme !== null, localeInDom: locale !== null, logoutInDom: logout !== null,
    brand: rect(brand), theme: rect(theme), logout: rect(logout),
    navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
    toolsTop: toggle || theme ? Math.round((toggle ?? theme).getBoundingClientRect().top) : null,
  }
})()`;

/** Sentences the reader can actually see, plus the whole visible text of <main>. */
const SAID = `(() => {
  const shown = (el) => el !== null && el.offsetParent !== null
  const main = document.querySelector('main')
  const empties = [...document.querySelectorAll('.empty-state')].filter(shown)
  return {
    text: main ? main.innerText.replace(/[ \\t]+/g, ' ').trim() : '',
    mapNote: (() => {
      const p = document.querySelector('.map-region .note')
      return p === null ? null : { shown: shown(p), text: p.textContent.replace(/\\s+/g, ' ').trim() }
    })(),
    empties: empties.map((el) => ({
      text: el.textContent.replace(/\\s+/g, ' ').trim(),
      links: [...el.querySelectorAll('a[href]')].filter(shown).map((a) => ({
        href: a.getAttribute('href'),
        text: a.textContent.trim(),
        h: Math.round(a.getBoundingClientRect().height),
      })),
    })),
    objectsTableRows: document.querySelectorAll('table.objects-table tbody tr').length,
    panels: document.querySelectorAll('.list').length,
  }
})()`;

// JOURNEYS D5's worker: somebody with an OPEN shift, which is what puts „Offene Schicht
// schließen“ in the panel. Read out of the database rather than hardcoded, because which
// row that is depends on the seed.
const D5_WORKER = sql(
  "SELECT w.id FROM workers w JOIN shifts s ON s.worker_id = w.id WHERE s.end_time IS NULL ORDER BY w.id LIMIT 1",
);

const OPEN_UNPINNED = `(() => {
  const row = [...document.querySelectorAll('table.objects-table tbody tr')]
    .find((tr) => /Keine Koordinaten/.test(tr.textContent || ''))
  const btn = row && [...row.querySelectorAll('button')].find((b) => /Öffnen/.test(b.textContent || ''))
  if (btn) btn.click()
  return !!btn
})()`;
const OPEN_PINNED = `(() => {
  const row = [...document.querySelectorAll('table.objects-table tbody tr')]
    .find((tr) => !/Keine Koordinaten/.test(tr.textContent || ''))
  const btn = row && [...row.querySelectorAll('button')].find((b) => /Öffnen/.test(b.textContent || ''))
  if (btn) btn.click()
  return !!btn
})()`;
const OPEN_ANALYTICS = `(() => {
  const btn = [...document.querySelectorAll('table.data-table tbody tr button')]
    .find((b) => b.offsetParent !== null)
  if (btn) btn.click()
  return !!btn
})()`;

const CONFIGS = [
  { w: 1680, h: 1000, mobile: false, theme: "dark", port: 9761 },
  { w: 1680, h: 1000, mobile: false, theme: "light", port: 9762 },
  { w: 390, h: 844, mobile: true, theme: "dark", port: 9763 },
  { w: 390, h: 844, mobile: true, theme: "light", port: 9764 },
];

async function shoot(page, label) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${label}.png`, Buffer.from(data, "base64"));
}

async function signIn(page, theme) {
  await page.goto(`${BASE}/login/`, { settle: 400 });
  await page.eval(`localStorage.setItem('nfcts.theme', ${JSON.stringify(theme)})`);
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 20000 });
  await sleep(2200);
}

/** Open a panel, measure it, and FAIL rather than skip when it did not open. */
async function panel(page, tag, url, { open = null, settle = 2600 } = {}) {
  await page.goto("about:blank", { settle: 60 });
  await page.goto(`${BASE}${url}`, { settle });
  if (open !== null) {
    const clicked = await page.eval(open);
    assert(`${tag}: the control that opens the panel exists`, clicked === true);
    await sleep(900);
  }
  await sleep(900);
  const r = await page.eval(REACH);
  assert(`${tag}: a panel is open and measurable`, r.found === true, r.found ? "" : `nothing at ${url}`);
  if (!r.found) return null;
  assert(
    `${tag}: it carries a list of links out of the object`,
    r.linkListFound === true && r.linksAfterHeading > 0,
    `${r.linksAfterHeading} cross-links found`,
  );
  // EVERY PANEL, EVERY WIDTH: if it folds, the fold is drawn. Asserted HERE rather than at
  // each call site because it is the one rule that holds for all four surfaces, and because
  // the surface that was worst is not the one anybody was looking at — /analytics/ hides
  // 145px at 1680 and the worker panel hides 1289px at 390, both in silence, while the
  // measured failure everyone was chasing was the building drawer's 135px.
  // A panel that FITS passes vacuously (`folds <= 2`), so this never asks a short panel to
  // paint a cue for a fold it does not have.
  assert(
    `${tag}: if it folds, the fold is DRAWN, not silent`,
    r.foldCued === true,
    `folds ${r.folds}px, cue ${r.foldCued ? "drawn" : "MISSING"}`,
  );
  return r;
}

// =========================================================================================
async function seededPass(cfg, page) {
  const tag = `${cfg.w}·${cfg.theme}`;

  // ---- B1 · every panel that carries cross-links ---------------------------------------
  console.log(`\n--- ${tag} · B1 panel reach ---`);

  const worker = await panel(page, `${tag} worker panel`, "/workers/?worker=1");
  if (worker !== null) {
    console.log(
      `  · worker panel: ${worker.crossLinksVisibleNow}/${worker.linksAfterHeading} cross-links on screen, ` +
        `first at y=${worker.firstCrossLinkTop} in a ${worker.clientHeight}px scroller of ${worker.scrollHeight}px`,
    );
    assert(
      `${tag} worker panel: at least one cross-link is reachable WITHOUT scrolling`,
      worker.crossLinksVisibleNow > 0,
      `${worker.crossLinksVisibleNow}/${worker.linksAfterHeading}, first needs ${Math.max(0, worker.firstCrossLinkTop - (worker.clientHeight - 40))}px`,
    );
    assert(
      `${tag} worker panel: the FIRST cross-link needs no scrolling at all (JOURNEYS D5)`,
      worker.firstCrossLinkTop !== null && worker.firstCrossLinkTop < worker.clientHeight - 40,
      `y=${worker.firstCrossLinkTop} of ${worker.clientHeight}px`,
    );
    // TASK-177 AC#3 and AC#4: the history is intact, and it is SECOND.
    assert(
      `${tag} worker panel: the ten-row history is still there and still complete`,
      worker.historyRows === 10,
      `${worker.historyRows} rows`,
    );
    assert(
      `${tag} worker panel: focus order matches visual order — links before the history`,
      worker.linksBeforeHistory === true,
    );
    await shoot(page, `worker-panel-${cfg.w}-${cfg.theme}`);
  }

  // THE SAME PANEL IN THE STATE THE FIX WAS WRITTEN FOR. worker=1 has no open shift and
  // nothing unconfirmed, so its list is the SHORTEST the component can render: two links.
  // JOURNEYS D5 is the other one — „ich konnte nicht ausstempeln“ — and it needs the panel
  // of somebody who has an open shift, which grows the list to five and pushes the last
  // link 200px further down. Measuring only worker=1 would have reported this surface green
  // for a state the director never opens it in. The person is chosen by their DATA, so
  // reseeding cannot silently turn this back into the short case; if nobody is in that
  // state the fixture assertion below fails rather than skipping.
  if (D5_WORKER !== "") {
    const d5 = await panel(page, `${tag} worker panel · D5`, `/workers/?worker=${D5_WORKER}`);
    if (d5 !== null) {
      console.log(
        `  · worker panel D5 (worker ${D5_WORKER}): ${d5.crossLinksVisibleNow}/${d5.linksAfterHeading} on screen — ` +
          d5.crossLinkTexts.join(" | "),
      );
      // The one link the journey exists for. Named, not counted: a count cannot tell the
      // difference between five links and the right five links.
      const closer = d5.crossLinkTexts.find((s) => /Offene Schicht/i.test(s)) ?? null;
      assert(
        `${tag} worker panel · D5: the open shift has a „Offene Schicht schließen“ link at all`,
        closer !== null,
        closer ?? d5.crossLinkTexts.join(" | "),
      );
      assert(
        `${tag} worker panel · D5: …and it is on screen WITHOUT scrolling`,
        closer !== null && d5.crossLinkTextsVisible.includes(closer),
        `visible: ${d5.crossLinkTextsVisible.join(" | ")}`,
      );
      // The long list must not push the history off the surface either.
      assert(
        `${tag} worker panel · D5: the ten-row history survives the longer link list`,
        d5.historyRows === 10 && d5.linksBeforeHistory === true,
        `${d5.historyRows} rows, links first=${d5.linksBeforeHistory}`,
      );
      await shoot(page, `worker-panel-d5-${cfg.w}-${cfg.theme}`);
    }
  }

  const drawer = await panel(page, `${tag} building drawer`, "/", { open: OPEN_UNPINNED });
  if (drawer !== null) {
    console.log(
      `  · building drawer: ${drawer.crossLinksVisibleNow}/${drawer.linksAfterHeading} cross-links on screen` +
        `, folds ${drawer.folds}px (cue ${drawer.foldCued ? "drawn" : "MISSING"})`,
    );
    // THE LIST IS THERE AND IT IS FOUND FIRST, at every width. This half is the part of
    // TASK-177 that is about DISCOVERY rather than about pixels: a cross-link list whose
    // heading and first entry are below the cut is a list nobody knows exists.
    assert(
      `${tag} building drawer: the link list ANNOUNCES itself — heading and first link above the cut`,
      drawer.headingTop !== null &&
        drawer.firstCrossLinkShown === true &&
        drawer.firstCrossLinkTop !== null &&
        drawer.firstCrossLinkTop + TOUCH_MIN <= drawer.clientHeight &&
        drawer.linksAfterHeading >= 6,
      `heading y=${drawer.headingTop}, first link y=${drawer.firstCrossLinkTop} of ${drawer.clientHeight}px, ${drawer.linksAfterHeading} links`,
    );
    if (cfg.w >= 1024) {
      // THE NO-REGRESSION TWIN, on the width where it is achievable. A 1000px-tall drawer
      // holds the whole list with room to spare (measured: 7/7, content 902px), so
      // anything less here is a real regression and stays a hard failure.
      assert(
        `${tag} building drawer: ALL of its cross-links are still reachable without scrolling`,
        drawer.crossLinksVisibleNow === drawer.linksAfterHeading && drawer.linksAfterHeading >= 6,
        `${drawer.crossLinksVisibleNow}/${drawer.linksAfterHeading}`,
      );
    } else {
      // AT 390px "all of them without scrolling" IS NOT ACHIEVABLE, and asserting it was
      // asserting that the panel must delete a fact. The arithmetic, measured on this
      // seed: the body's scrollport is 767px, and the panel's irreducible content is five
      // fact rows (366px) + the as-of caveat (36px) + the heading (19px) + seven 44px
      // cross-links (308px) = 729px BEFORE a single margin — and 817px on a building that
      // also has an open material request and a client, which is nine links and is the
      // ordinary case, not the corner. The only ways to satisfy it are to drop a true
      // sentence or to shrink a 44px touch target below TOUCH_MIN.
      //
      // So the panel scrolls on a phone, and what is asserted is that the scroll is
      // VISIBLE. An uncued fold is defect V1 — macOS draws no overlay scrollbar until a
      // gesture starts, so the cut row reads as the end of the list.
      assert(
        `${tag} building drawer: it folds on a phone, and the fold is DRAWN, not silent`,
        drawer.foldCued === true,
        `folds ${drawer.folds}px, cue ${drawer.foldCued ? "drawn" : "MISSING"}`,
      );
    }
  }

  // The info box lives on a PIN, and a pin needs a drawn map, which needs a desktop: on a
  // phone the very same URL renders the drawer (HomeMap `infoOnPin`). Both are asserted —
  // whichever answered has to be reachable, and which one answered is printed.
  const box = await panel(page, `${tag} building info box`, "/", { open: OPEN_PINNED, settle: 3400 });
  if (box !== null) {
    const isBox = box.panel.includes("map-info");
    console.log(
      `  · pinned building rendered as ${isBox ? "the info box on the pin" : "the drawer"}: ` +
        `${box.crossLinksVisibleNow}/${box.linksAfterHeading} cross-links on screen` +
        (box.expander === null ? "" : `, disclosure „${box.expander}"`),
    );
    if (isBox) {
      assert(
        `${tag} info box: the disclosure that holds the links is reachable without scrolling`,
        box.expanderReachable === true && box.expander !== null,
        `„${box.expander}"`,
      );
      assert(
        `${tag} info box: the disclosure names how many links are behind it`,
        /\d/.test(box.expander ?? "") && box.linksAfterHeading > 0,
        `„${box.expander}" over ${box.linksAfterHeading} links`,
      );
      // Press it. A disclosure whose links are still unreachable when open is defect V1.
      await page.eval(
        `(() => { const b = document.querySelector('.map-info-expand'); if (b) b.click(); return !!b })()`,
      );
      await sleep(700);
      const opened = await page.eval(REACH);
      assert(
        `${tag} info box: pressing it puts cross-links on the screen`,
        opened.crossLinksVisibleNow > 0,
        `${opened.crossLinksVisibleNow}/${opened.linksAfterHeading}`,
      );
      await shoot(page, `info-box-open-${cfg.w}-${cfg.theme}`);
    } else {
      assert(
        `${tag} pinned building (drawer fallback): its cross-links are reachable`,
        box.crossLinksVisibleNow > 0,
        `${box.crossLinksVisibleNow}/${box.linksAfterHeading}`,
      );
    }
  }

  const analytics = await panel(page, `${tag} analytics drawer`, "/analytics/", {
    open: OPEN_ANALYTICS,
  });
  if (analytics !== null) {
    console.log(
      `  · analytics drawer: ${analytics.crossLinksVisibleNow}/${analytics.linksAfterHeading} cross-links on screen, ` +
        `${analytics.historyRows} trend rows`,
    );
    assert(
      `${tag} analytics drawer: at least one cross-link is reachable WITHOUT scrolling`,
      analytics.crossLinksVisibleNow > 0,
      `${analytics.crossLinksVisibleNow}/${analytics.linksAfterHeading}`,
    );
    assert(
      `${tag} analytics drawer: the links come before the trend table, not under it`,
      analytics.linksBeforeHistory === true,
    );
    assert(
      `${tag} analytics drawer: the trend table is still there`,
      analytics.historyRows > 0,
      `${analytics.historyRows} rows`,
    );
  }

  // ---- B2 negative twins · a POPULATED portfolio must not print day-zero prose ----------
  console.log(`\n--- ${tag} · B2 negative twins (six buildings, 351 shifts) ---`);
  await page.goto(`${BASE}/`, { settle: 3000 });
  const home = await page.eval(SAID);
  assert(
    `${tag} populated /: the Objektliste is a table, not an empty state (vacuity guard)`,
    home.objectsTableRows > 0,
    `${home.objectsTableRows} rows`,
  );
  assert(
    `${tag} populated /: NO „Erstes Objekt anlegen" link — the empty state is conditional`,
    !home.empties.some((e) => e.links.some((l) => l.href?.includes("/locations/"))),
  );
  assert(
    `${tag} populated /: the map sentence is the coordinates one, not the zero-building one`,
    home.mapNote !== null &&
      !home.mapNote.text.includes("noch kein Objekt angelegt") &&
      !/\b0 Objekte?\b/.test(home.mapNote.text),
    `„${home.mapNote?.text ?? "(no sentence)"}"`,
  );

  // ---- B3 · the fold and the touch targets ---------------------------------------------
  console.log(`\n--- ${tag} · B3 the fold at ${cfg.w}px ---`);
  const fold = await page.eval(FOLD);
  const tools = await page.eval(TOOLS);
  await shoot(page, `home-${cfg.w}-${cfg.theme}`);
  console.log(
    `  · header ${fold.headerHeight}px · answer band y=${fold.answerTop} · ` +
      `first building name „${fold.firstFactText}" at y=${fold.firstFactY} of ${fold.fold}`,
  );
  assert(
    `${tag}: the Objektliste actually rendered rows (vacuity guard)`,
    fold.rowCount > 0 && fold.firstFactY !== null,
    `${fold.rowCount} rows`,
  );

  if (cfg.w === 390) {
    assert(
      `390 ${cfg.theme}: the first building name is above y=${FIRST_FACT_MAX_Y}`,
      fold.firstFactY !== null && fold.firstFactY < FIRST_FACT_MAX_Y,
      `y=${fold.firstFactY}`,
    );
    // JOURNEYS D4: the daily check is the answer band AND a building, on one phone screen.
    assert(
      `390 ${cfg.theme}: the answer band and a building row are both on the first screen (D4)`,
      fold.answerBottom !== null && fold.answerBottom <= fold.fold && fold.firstFactY < fold.fold,
      `answer ends ${fold.answerBottom}, first name ${fold.firstFactY}, fold ${fold.fold}`,
    );
    assert(
      `390 ${cfg.theme}: no control on / is under ${TOUCH_MIN}px except the brand link`,
      fold.smallNonBrand === 0,
      fold.small
        .filter((s) => !s.brand)
        .map((s) => `${s.h}px „${s.text}"`)
        .join(" · "),
    );
    // TASK-179 AC#2: moved and collapsed, never deleted.
    assert(
      `390 ${cfg.theme}: all three settings controls are still in the page`,
      tools.themeInDom && tools.localeInDom && tools.logoutInDom,
    );
    assert(
      `390 ${cfg.theme}: they are NOT holding the top of the screen`,
      !tools.themeShown && !tools.localeShown && !tools.logoutShown,
      `theme ${tools.themeShown}, locale ${tools.localeShown}, logout ${tools.logoutShown}`,
    );
    assert(
      `390 ${cfg.theme}: the disclosure that holds them sits in the NAV row, not above the brand`,
      tools.toggleShown === true && tools.toolsTop !== null && tools.toolsTop >= tools.navTop - 2,
      `toggle at y=${tools.toolsTop}, nav at y=${tools.navTop}`,
    );
    assert(
      `390 ${cfg.theme}: the disclosure is itself a ${TOUCH_MIN}px target`,
      (tools.toggleH ?? 0) >= TOUCH_MIN,
      `${tools.toggleH}px`,
    );
    // Press it. „Reachable" means reachable, not present. Guarded rather than assumed: when
    // the disclosure does not exist the assertions above have already gone red, and a crash
    // here would take the whole day-zero pass down with it and hide twenty more results.
    const pressed = await page.eval(
      `(() => { const b = document.querySelector('.header-tools-toggle'); if (b) b.click(); return !!b })()`,
    );
    await sleep(400);
    const opened = await page.eval(TOOLS);
    await shoot(page, `home-settings-open-390-${cfg.theme}`);
    assert(
      `390 ${cfg.theme}: pressing it puts Darstellung, Sprache and Abmelden on the screen`,
      pressed === true && opened.themeShown && opened.localeShown && opened.logoutShown,
      `pressed ${pressed}, theme ${opened.themeShown}, locale ${opened.localeShown}, logout ${opened.logoutShown}`,
    );
    assert(
      `390 ${cfg.theme}: and it says so — aria-expanded follows the panel`,
      opened.toggleExpanded === "true",
      `aria-expanded="${opened.toggleExpanded}"`,
    );
    // Escape must dismiss it. A disclosure that can only be closed with a mouse is a trap.
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);
    const closed = await page.eval(TOOLS);
    assert(
      `390 ${cfg.theme}: Escape closes it again`,
      closed.themeShown === false && closed.toggleExpanded === "false",
      `theme ${closed.themeShown}, aria-expanded="${closed.toggleExpanded}"`,
    );
  } else {
    // TASK-179 AC#3: at the desk NOTHING changed — the three controls are on the header
    // row, no disclosure exists, and they are still vertically centred with the brand.
    assert(
      `1680 ${cfg.theme}: Darstellung, Sprache and Abmelden are on screen with nothing pressed`,
      tools.themeShown && tools.localeShown && tools.logoutShown,
      `theme ${tools.themeShown}, locale ${tools.localeShown}, logout ${tools.logoutShown}`,
    );
    assert(
      `1680 ${cfg.theme}: there is no disclosure to press`,
      tools.toggleShown === false,
    );
    assert(
      `1680 ${cfg.theme}: they share the brand's row — one header line, as before`,
      tools.brand !== null && tools.theme !== null && Math.abs(tools.brand.mid - tools.theme.mid) <= 2,
      `brand mid ${tools.brand?.mid}, theme mid ${tools.theme?.mid}`,
    );
    // 69px is the MEASURED height of the header row before any of this changed — 12px of
    // padding, a 44px `.button-secondary` („Abmelden", the tallest thing in it), 12px, and
    // the bottom border. It is quoted rather than derived so that a header that grows a
    // second line, or loses its padding, is a failure and not a new baseline.
    assert(
      `1680 ${cfg.theme}: the header row is exactly as tall as it was — 69px, one line`,
      fold.headerHeight === 69,
      `${fold.headerHeight}px against 69px before the change`,
    );
  }

  // /shifts/ — the population of undersized row links, and D5's tappable row.
  await page.goto(`${BASE}/shifts/`, { settle: 3000 });
  const shifts = await page.eval(FOLD);
  const rowLink = await page.eval(`(() => {
    const a = [...document.querySelectorAll('table.data-table tbody a[href*="worker="]')]
      .find((el) => el.offsetParent !== null)
    return a === undefined ? null : Math.round(a.getBoundingClientRect().height)
  })()`);
  console.log(`  · /shifts/: ${shifts.smallCount} controls under ${TOUCH_MIN}px, row link ${rowLink}px`);
  assert(
    `${tag} /shifts/: the table rendered (vacuity guard)`,
    rowLink !== null,
    "no worker link in any row",
  );
  if (cfg.w === 390) {
    assert(
      `390 ${cfg.theme} /shifts/: fewer than ${SHIFTS_SMALL_MAX} controls under ${TOUCH_MIN}px`,
      shifts.smallCount < SHIFTS_SMALL_MAX,
      `${shifts.smallCount}: ${shifts.small.slice(0, 5).map((s) => `${s.h}px „${s.text}"`).join(" · ")}`,
    );
    assert(
      `390 ${cfg.theme} /shifts/: a shift row's link is a ${TOUCH_MIN}px target (D5)`,
      (rowLink ?? 0) >= TOUCH_MIN,
      `${rowLink}px`,
    );
  }
}

// =========================================================================================
async function emptyPass(cfg, page) {
  const tag = `${cfg.w}·${cfg.theme}`;
  console.log(`\n--- ${tag} · B2 day zero (nothing created, nothing tapped) ---`);

  await page.goto(`${BASE}/`, { settle: 3200 });
  const home = await page.eval(SAID);
  await shoot(page, `empty-home-${cfg.w}-${cfg.theme}`);

  // VACUITY GUARD, first: if the database was not actually emptied, everything below is a
  // measurement of the seeded screen wearing the empty screen's assertions.
  assert(
    `${tag} day zero: the database really is empty — no Objektliste rows`,
    home.objectsTableRows === 0 && home.empties.length > 0,
    `${home.objectsTableRows} rows, ${home.empties.length} empty states`,
  );

  const objectsEmpty = home.empties.find((e) => e.text.includes("kein aktives Objekt")) ?? null;
  assert(
    `${tag} day zero: the Objektliste still says what the emptiness MEANS`,
    objectsEmpty !== null && objectsEmpty.text.length >= 40,
    `„${objectsEmpty?.text ?? "(gone)"}"`,
  );
  assert(
    `${tag} day zero: and it offers the action it names — a link to where a building is made`,
    objectsEmpty !== null && objectsEmpty.links.some((l) => l.href === "/locations/"),
    objectsEmpty?.links.map((l) => `„${l.text}" -> ${l.href}`).join(" · ") ?? "(no links)",
  );
  if (cfg.w === 390) {
    assert(
      `390 ${cfg.theme} day zero: that link is a ${TOUCH_MIN}px target on a phone`,
      (objectsEmpty?.links.find((l) => l.href === "/locations/")?.h ?? 0) >= TOUCH_MIN,
      `${objectsEmpty?.links.find((l) => l.href === "/locations/")?.h}px`,
    );
  }

  // The map region. On a phone the map is collapsed by choice, so its sentence is not drawn
  // (HomeMap says why); the region is opened first, which is also the reader's own path.
  if (cfg.w === 390) {
    const shown = await page.eval(`(() => {
      const b = [...document.querySelectorAll('.map-region-head button')][0]
      if (b) b.click()
      return !!b
    })()`);
    assert(`${tag} day zero: the phone offers „Karte anzeigen"`, shown === true);
    await sleep(1200);
  }
  const mapNote = (await page.eval(SAID)).mapNote;
  console.log(`  · map region says: „${mapNote?.text ?? "(nothing)"}" (shown: ${mapNote?.shown})`);
  assert(
    `${tag} day zero: the map region says something, visibly`,
    mapNote !== null && mapNote.shown === true && mapNote.text.length > 20,
    `„${mapNote?.text ?? "(nothing)"}"`,
  );
  assert(
    `${tag} day zero: it does NOT claim „0 Objekte haben keine Koordinaten"`,
    mapNote !== null && !/\b0 (Objekte?|buildings?)\b/.test(mapNote.text),
    `„${mapNote?.text}"`,
  );
  assert(
    `${tag} day zero: the zero-building case has its own sentence`,
    mapNote !== null && mapNote.text.includes("noch kein Objekt angelegt"),
    `„${mapNote?.text}"`,
  );

  // The four panels: still four sentences, and „niemand eingestempelt" at most twice.
  await page.goto(`${BASE}/`, { settle: 3000 });
  const said = await page.eval(SAID);
  const restatements = said.text.split("Zurzeit ist niemand eingestempelt.").length - 1;
  console.log(`  · „Zurzeit ist niemand eingestempelt." is printed ${restatements}×`);
  assert(
    `${tag} day zero: „Zurzeit ist niemand eingestempelt." is printed at most twice`,
    restatements <= 2,
    `${restatements}×`,
  );
  assert(
    `${tag} day zero: it is still printed \u2014 the fact was not deleted to save the line`,
    restatements >= 1,
    `${restatements}×`,
  );
  // TASK-178 AC#4. No empty panel became a dash or a blank. The floor is a SENTENCE — more
  // than one word and more than a glyph — not a character count picked to fit what shipped:
  // „Nichts zu tun." is 14 characters and is a complete answer, „—" is one and is not.
  assert(
    `${tag} day zero: every empty panel still carries a sentence, none is a dash`,
    said.empties.length >= 4 &&
      said.empties.every((e) => e.text.length >= 12 && e.text.trim().split(/\s+/).length >= 3),
    said.empties.map((e) => `${e.text.length} chars: „${e.text.slice(0, 30)}"`).join(" · "),
  );

  // The other three day-zero dead ends found by the audit.
  for (const [path, needles] of [
    ["/shifts/?period=all", ["/locations/", "/workers/"]],
    ["/pl/?period=thisYear", ["/locations/"]],
    ["/payroll/", ["/locations/", "/workers/"]],
  ]) {
    await page.goto(`${BASE}${path}`, { settle: 3000 });
    const screen = await page.eval(SAID);
    const links = screen.empties.flatMap((e) => e.links.map((l) => l.href));
    console.log(`  · ${path}: empty states offer ${links.length ? links.join(", ") : "nothing"}`);
    assert(
      `${tag} day zero ${path}: the empty state still explains itself`,
      screen.empties.length > 0 && screen.empties.some((e) => e.text.length >= 40),
      screen.empties.map((e) => e.text.slice(0, 50)).join(" | ") || "(no empty state at all)",
    );
    for (const needle of needles) {
      assert(
        `${tag} day zero ${path}: it offers the way to ${needle}`,
        links.some((href) => href === needle),
        links.join(", ") || "(no link)",
      );
    }
  }
}

// =========================================================================================
async function main() {
  for (const cfg of CONFIGS) {
    const { child, port } = await launchChrome({ port: cfg.port, width: cfg.w, height: cfg.h });
    const page = await attach(port);
    try {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: cfg.w,
        height: cfg.h,
        deviceScaleFactor: 1,
        mobile: cfg.mobile,
      });
      await signIn(page, cfg.theme);
      await seededPass(cfg, page);
    } finally {
      page.close();
      child.kill("SIGKILL");
    }
  }

  // ---- and now the same screens with nothing in them ------------------------------------
  // FK order is not the obvious one: `locations` points AT `contacts` and `clients`, so the
  // buildings go before the people who own them. `admins` and `sessions` are kept, or the
  // browser is signed out and every picture below is the login screen.
  //
  // `zones` and `location_revenue` are here because MIGRATION 006 ADDED THEM, and adding
  // them to the schema without adding them to this list is what actually happened: the
  // whole day-zero pass -- every empty-state screen, which is the ONLY state the client's
  // database is in on onboarding day -- died on
  //   ERROR: update or delete on table "locations" violates foreign key constraint
  //          "zones_location_id_fkey"
  // and had done so silently since 006 was written. The guard below is the point of this
  // comment: a hand-kept delete order is a list that the NEXT migration breaks in exactly
  // the same way, so the list is now CHECKED against the database's own foreign keys
  // rather than trusted.
  const EMPTIED = [
    "shifts",
    "material_requests",
    "portal_grants",
    "location_contracts",
    "location_revenue",
    "zones",
    "locations",
    "contacts",
    "clients",
    "inventory_items",
    // Points at `workers`. It has never had a row in nfc_demo, so its absence from this
    // list was a DELETE waiting for the first fixture that seeds a worker session -- the
    // guard below found it on its first run, unseeded. Emptying it logs out a WORKER, not
    // the admin browser: `sessions` (which points at `admins`) is deliberately kept.
    "worker_sessions",
    // 007. Points at `workers` with ON DELETE SET NULL, and phone_identities_claims forbids
    // a row that claims nobody -- so `DELETE FROM workers` does not merely violate an FK
    // here, it drives the surviving row to (NULL, NULL) MID-STATEMENT and aborts. It must
    // therefore be emptied BEFORE `workers`, not merely be present in this list, which is
    // why position here is load-bearing and not alphabetical. Same fact ops/reset-w1.sql
    // §4 works around; found here by the guard below, on its second migration running.
    // `operators` is deliberately NOT emptied — it points at nothing this pass touches, and
    // day zero is about the director's screens, not about wiping an identity table.
    "phone_identities",
    "workers",
    "app_settings",
  ];
  // Every table that POINTS AT something this pass empties must itself be emptied, or the
  // DELETE raises 23503. Asked of the live catalogue, so migration 007 cannot forget it.
  // `sessions`/`worker_sessions` reference `admins`/`workers`: worker_sessions is caught
  // here and belongs in the list; `sessions` points at `admins`, which is deliberately kept.
  const referencing = sql(
    `SELECT DISTINCT c.conrelid::regclass::text
       FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.confrelid::regclass::text = ANY (ARRAY[${EMPTIED.map((t) => `'${t}'`).join(",")}])
        AND c.conrelid <> c.confrelid
      ORDER BY 1`,
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const missing = referencing.filter((t) => !EMPTIED.includes(t));
  assert(
    "day zero: the delete order covers every table that references an emptied one",
    missing.length === 0,
    missing.length === 0
      ? `${referencing.length} referencing table(s), all listed`
      : `${missing.join(", ")} -- a migration added a foreign key and this list did not follow it`,
  );

  console.log("\ncheck-reach: emptying nfc_demo for the day-zero pass");
  for (const table of EMPTIED) {
    exec(`DELETE FROM ${table}`);
  }
  assert(
    "day zero: nfc_demo really has no buildings and no workers (vacuity guard)",
    sql("SELECT count(*) FROM locations") === "0" && sql("SELECT count(*) FROM workers") === "0",
  );

  for (const cfg of CONFIGS) {
    const { child, port } = await launchChrome({ port: cfg.port + 20, width: cfg.w, height: cfg.h });
    const page = await attach(port);
    try {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: cfg.w,
        height: cfg.h,
        deviceScaleFactor: 1,
        mobile: cfg.mobile,
      });
      await signIn(page, cfg.theme);
      await emptyPass(cfg, page);
    } finally {
      page.close();
      child.kill("SIGKILL");
    }
  }
}

const timer = setTimeout(() => {
  console.error("check-reach: deadline exceeded");
  process.exit(1);
}, DEADLINE_MS);
timer.unref?.();

let crashed = null;
try {
  await main();
} catch (error) {
  crashed = error;
} finally {
  execFileSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "-d", DB, DUMP], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const after = fingerprint();
  console.log("\n--- nfc_demo, before | after ---");
  const b = BEFORE.split("\n");
  const a = after.split("\n");
  let drift = 0;
  for (let i = 0; i < Math.max(b.length, a.length); i++) {
    if (b[i] !== a[i]) drift++;
    console.log(`  ${b[i] === a[i] ? "ok  " : "DRIFT"} ${b[i] ?? "(missing)"}  ->  ${a[i] ?? "(missing)"}`);
  }
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
