// HOW FAR DOWN AN OPEN PANEL ITS CROSS-LINKS SIT — on EVERY panel that carries any.
//
//   node demo/probe-panel-reach.mjs            # against http://127.0.0.1:8080
//
// THE QUESTION IT ANSWERS. Defect V1 of the last round was the map info box hiding 8 of 8
// cross-links below its own fold. That box was fixed. The DRAWER — the same `<BuildingFacts>`
// in a different frame, plus `<WorkerPanel>` — was never measured, and it put its
// „Weiter zu" list AFTER a ten-row shift history. On a 390x844 phone that is the
// stairwell case decision-28 exists for: the director opens a worker to close their shift
// (JOURNEYS D5) and the control is a thousand pixels down.
//
// SO IT MEASURES ALL FOUR, not the two that were already known. The complete list of
// surfaces in this admin that hold a list of links OUT of the object they describe:
//
//   /workers/?worker=<id>       <WorkerPanel>            3 links
//   /?location=<unpinned uuid>  <BuildingFacts> drawer   6+ links
//   /?location=<pinned uuid>    <BuildingFacts> info box 6+ links, behind a disclosure
//   /analytics/ row -> drawer   four cross-links, under a twelve-row trend table
//
// Everything else that opens an overlay — /shifts/ correction, /locations/, /workers/ edit,
// /clients/, /contracts/, /inventory/, /material-requests/, /pl/ — is a FORM or a read-only
// detail and carries no links out (`rg '<Link' -A0` inside each <Drawer> block: only
// materials, and that one is a hint inside a field, not a list). If a fifth ever appears it
// belongs in SURFACES below, or it ships unmeasured, which is how the last two got here.
//
// THE ONE OTHER LIST OF CROSS-LINKS IN THE ADMIN, and why it is not measured here.
// `/pl/` prints `ul.panel-links` inside every flagged building's callout — four links, each
// carrying that building and this period. It is NOT a panel: no fixed position, no overflow
// of its own, no disclosure. It scrolls with the document, which is the property the four
// surfaces above lack and the whole reason they can trap a link. Measured anyway, on a
// baseline high enough to flag every building (2026-08-18, `pl_margin_baseline_bp` = 9990,
// removed again afterwards):
//
//   1680x1000  first callout y=590, its first link y=823, 3 of 4 links in the first screen
//    390x844   first callout y=868, its first link y=1269, one ordinary page scroll down
//   both widths: every one of the four links is a 44px target and carries ?location= (+period)
//
// So: below the fold on a phone, but below it the way a paragraph three screens down is —
// reachable by the scrollbar the reader already has, and directly under the argument it
// belongs to. That is not defect V1 and it is not fixed by reordering anything.
//
// It is a PROBE and not a check: it prints geometry and exits 0, exactly like
// demo/probe-fold.mjs. The assertions that go red on a regression are in
// demo/check-reach.mjs.
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(BASE).hostname)) {
  console.error("probe-panel-reach: loopback only.");
  process.exit(1);
}
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

/**
 * The scrolling box is the OVERLAY, not the window: a drawer is `position: fixed` with its
 * own overflow. Measuring against `window.innerHeight` would report every link as visible on
 * a tall document, which is the shape of mistake this file exists to avoid.
 */
export const REACH = `(() => {
  const panel = document.querySelector('.drawer, .map-info')
  if (!panel) return { found: false }
  const box = panel.getBoundingClientRect()
  // The element that actually scrolls: the panel itself, or the tallest scrolling child.
  // The 100px floor is not cosmetic: without it this picked a 1px clipping wrapper and
  // reported „1px visible of 21px content" for the building drawer, which would have made
  // every number below meaningless while still looking like a measurement.
  const scroller = [panel, ...panel.querySelectorAll('*')]
    .filter((el) => el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 100)
    .sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? panel
  const s = scroller.getBoundingClientRect()
  // „Weiter zu" is *.panelLinksHeading, in all three panels since TASK-177 gave /analytics/
  // the same heading the other two already had. Matched on the STRING, because a panel has
  // no id and a positional guess ("the last h3") would keep passing after a reorder.
  const heading = [...panel.querySelectorAll('h3, h2')]
    .find((h) => /Weiter zu|Go to|Verkn|Links/i.test(h.textContent || ''))
  const links = [...panel.querySelectorAll('a[href]')]
  // Visible means: inside the scroller's own rectangle AND not inside a closed disclosure.
  // offsetParent catches the second — the info box hides its link face with [hidden],
  // which is exactly the state a naive rectangle test would score as „reachable".
  const shown = (el) => el.offsetParent !== null
  const visible = links.filter((a) => {
    const r = a.getBoundingClientRect()
    return shown(a) && r.height > 0 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1
  })
  // THE CROSS-LINKS ARE THE LIST, not „every link after the heading". That looser reading
  // was in this file until the links moved above the history: with the list first, every
  // link in the ten-row table below counted as a cross-link and the number went up for the
  // wrong reason. panel-links-out is the documented hook (components/BuildingFacts.tsx);
  // the panels that carry only one such list are matched by the fallback.
  const lists = [...panel.querySelectorAll('ul.panel-links')]
  const outList = panel.querySelector('ul.panel-links-out') ?? lists[lists.length - 1] ?? null
  const linksAfterHeading = outList ? [...outList.querySelectorAll('a[href]')] : []
  const firstAfter = linksAfterHeading[0] ?? null
  // The info box is a DISCLOSURE: its links are one press away rather than one scroll away,
  // so the thing that has to be reachable is the button, and the count on it is the label.
  const expander = panel.querySelector('.map-info-expand')
  const expanderRect = expander ? expander.getBoundingClientRect() : null
  return {
    found: true,
    panel: panel.className,
    scrollTop: Math.round(scroller.scrollTop),
    scrollHeight: Math.round(scroller.scrollHeight),
    clientHeight: Math.round(scroller.clientHeight),
    boxHeight: Math.round(box.height),
    headingTop: heading ? Math.round(heading.getBoundingClientRect().top - s.top + scroller.scrollTop) : null,
    headingText: heading ? heading.textContent.trim() : null,
    links: links.length,
    linksAfterHeading: linksAfterHeading.length,
    linkListFound: outList !== null,
    linksVisibleNow: visible.length,
    crossLinksVisibleNow: visible.filter((a) =>
      linksAfterHeading.includes(a)).length,
    // The LABELS, not just the count. A panel whose link list is data-dependent (the worker
     // panel grows from 2 links to 5 when the person has an open shift and an unconfirmed
     // one) can satisfy every count-based assertion in its SHORTEST form and still bury the
     // one link the journey is about. Naming them is what lets a caller ask for the link by
     // its job — „Offene Schicht schließen“, JOURNEYS D5 — instead of by its index.
    crossLinkTexts: linksAfterHeading.map((a) => a.textContent.replace(/\s+/g, ' ').trim()),
    crossLinkTextsVisible: linksAfterHeading
      .filter((a) => visible.includes(a))
      .map((a) => a.textContent.replace(/\s+/g, ' ').trim()),
    firstCrossLinkTop: firstAfter
      ? Math.round(firstAfter.getBoundingClientRect().top - s.top + scroller.scrollTop)
      : null,
    firstCrossLinkText: firstAfter ? firstAfter.textContent.trim().slice(0, 40) : null,
    firstCrossLinkShown: firstAfter ? shown(firstAfter) : null,
    expander: expander ? expander.textContent.replace(/\\s+/g, ' ').trim() : null,
    expanderOpen: expander ? expander.getAttribute('aria-expanded') === 'true' : null,
    expanderReachable: expanderRect
      ? expanderRect.height > 0 && expanderRect.top >= s.top - 1 && expanderRect.bottom <= s.bottom + 1
      : null,
    // Focus order must match visual order (TASK-177 AC4). The panel's own tab stops, in DOM
    // order, reduced to „is the first cross-link before or after the history table".
    linksBeforeHistory: outList && panel.querySelector('table.data-table')
      ? (outList.compareDocumentPosition(panel.querySelector('table.data-table')) &
          Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      : null,
    historyRows: panel.querySelectorAll('table.data-table tbody tr').length,
  }
})()`;

/** Open the building drawer from the Objektliste and hand back the `?location=` it wrote. */
const OPEN_UNPINNED = `(() => {
  const row = [...document.querySelectorAll('table.objects-table tbody tr')]
    .find((tr) => /Keine Koordinaten/.test(tr.textContent || ''))
  const btn = row && [...row.querySelectorAll('button')]
    .find((b) => /Öffnen/.test(b.textContent || ''))
  if (btn) btn.click()
  return !!btn
})()`;

/** The same, for a building that HAS coordinates — the one the info box can live on. */
const OPEN_PINNED = `(() => {
  const row = [...document.querySelectorAll('table.objects-table tbody tr')]
    .find((tr) => !/Keine Koordinaten/.test(tr.textContent || ''))
  const btn = row && [...row.querySelectorAll('button')]
    .find((b) => /Öffnen/.test(b.textContent || ''))
  if (btn) btn.click()
  return !!btn
})()`;

/** /analytics/ opens its drawer from a row button, same shape as the Objektliste. */
const OPEN_ANALYTICS = `(() => {
  const btn = [...document.querySelectorAll('table.data-table tbody tr button')]
    .find((b) => b.offsetParent !== null)
  if (btn) btn.click()
  return !!btn
})()`;

export const CONFIGS = [
  { w: 1680, h: 1000, mobile: false },
  { w: 390, h: 844, mobile: true },
];

export async function signIn(page) {
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 20000 });
  await sleep(1500);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const cfg of CONFIGS) {
    const { child, port } = await launchChrome({
      port: cfg.w === 390 ? 9791 : 9790,
      width: cfg.w,
      height: cfg.h,
    });
    const page = await attach(port);
    try {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: cfg.w,
        height: cfg.h,
        deviceScaleFactor: 1,
        mobile: cfg.mobile,
      });
      await signIn(page);

      // The Objektliste opens a panel with a BUTTON, not a link, so the uuid is not in any
      // href to read: the row is clicked and the uuid is taken back out of the URL the app
      // wrote. Nothing here has to know a uuid, so nothing here goes stale when the seed does.
      await page.eval(OPEN_UNPINNED);
      await sleep(900);
      const unpinnedSearch = await page.eval("location.search");
      await page.goto(`${BASE}/`, { settle: 2600 });
      await page.eval(OPEN_PINNED);
      await sleep(900);
      const pinnedSearch = await page.eval("location.search");

      console.log(`\n=== ${cfg.w}x${cfg.h} ===`);
      const surfaces = [
        ["worker panel  /workers/?worker=1", "/workers/?worker=1", null],
        // The building DRAWER, not the info box: a building with no coordinates can have no
        // pin, so `/` falls back to the drawer for it. That is the rendering on every phone.
        ["building drawer (unpinned)", `/${unpinnedSearch || "?location=none"}`, null],
        // The building INFO BOX: a pinned building on a desktop. At 390 the map is collapsed
        // by default, so the very same URL renders the drawer instead — that is the shipped
        // behaviour (HomeMap `infoOnPin`), and printing which one answered is the point.
        ["building info box (pinned)", `/${pinnedSearch || "?location=none"}`, null],
        ["analytics drawer", "/analytics/", OPEN_ANALYTICS],
      ];
      for (const [label, url, open] of surfaces) {
        await page.goto("about:blank", { settle: 60 });
        await page.goto(`${BASE}${url.startsWith("/") ? url : `/${url}`}`, { settle: 2600 });
        if (open !== null) {
          await page.eval(open);
          await sleep(900);
        }
        await sleep(1200);
        const r = await page.eval(REACH);
        if (!r.found) {
          console.log(`  ${label}: NO PANEL OPENED (${url})`);
          continue;
        }
        console.log(`  ${label}  [${r.panel}]`);
        console.log(
          `    scroller ${r.clientHeight}px visible of ${r.scrollHeight}px content` +
            `${r.scrollHeight > r.clientHeight ? ` -> ${r.scrollHeight - r.clientHeight}px hidden` : " (fits)"}`,
        );
        console.log(
          `    links: ${r.links} total, ${r.linksAfterHeading} under \u201e${r.headingText ?? "(no links heading)"}\u201c at y=${r.headingTop}`,
        );
        console.log(
          `    reachable WITHOUT scrolling: ${r.linksVisibleNow}/${r.links} links, ` +
            `${r.crossLinksVisibleNow}/${r.linksAfterHeading} cross-links`,
        );
        if (r.expander !== null) {
          console.log(
            `    disclosure \u201e${r.expander}\u201c ${r.expanderOpen ? "open" : "closed"}, ` +
              `${r.expanderReachable ? "reachable without scrolling" : "BELOW THE BOX'S OWN FOLD"}`,
          );
        }
        if (r.historyRows > 0) {
          console.log(
            `    history: ${r.historyRows} rows, links ${r.linksBeforeHistory ? "BEFORE" : "after"} the table`,
          );
        }
        if (r.firstCrossLinkTop !== null) {
          const need = Math.max(0, r.firstCrossLinkTop - (r.clientHeight - 40));
          console.log(
            `    first cross-link \u201e${r.firstCrossLinkText}\u201c at y=${r.firstCrossLinkTop} ` +
              `-> ${need === 0 && r.firstCrossLinkShown ? "already visible" : r.firstCrossLinkShown ? `needs ${need}px of scrolling` : "behind a closed disclosure"}`,
          );
        }
      }
    } finally {
      page.close();
      child.kill("SIGKILL");
    }
  }
}
