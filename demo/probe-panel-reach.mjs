// HOW FAR DOWN AN OPEN PANEL ITS CROSS-LINKS SIT.
//
//   node demo/probe-panel-reach.mjs            # against http://127.0.0.1:8080
//
// THE QUESTION IT ANSWERS. Defect V1 of the last round was the map info box hiding 8 of 8
// cross-links below its own fold. That box was fixed. The DRAWER — the same `<BuildingFacts>`
// in a different frame, plus `<WorkerPanel>` — was never measured, and it puts its
// „Verknüpfungen" list AFTER a ten-row shift history. On a 390x844 phone that is the
// stairwell case decision-28 exists for: the director opens a worker to close their shift
// (JOURNEYS D5) and the control is a thousand pixels down.
//
// So this opens each panel and reports, per viewport: where the links heading is, how many
// links are reachable without scrolling the panel, and how far the panel has to scroll before
// the first one appears.
//
// It is a PROBE and not a check: it prints geometry and exits 0, exactly like
// demo/probe-fold.mjs. Whatever assertion this earns belongs in demo/check-map-home.mjs or
// demo/check-filters.mjs, where it can go red on a regression.
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
const REACH = `(() => {
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
  // „Weiter zu" is messages.*.panelLinksHeading. Matched on the STRING, because the panel
  // has no id and a positional guess ("the last h3") would keep passing after a reorder.
  const heading = [...panel.querySelectorAll('h3, h2')]
    .find((h) => /Weiter zu|Verkn|Links/i.test(h.textContent || ''))
  const links = [...panel.querySelectorAll('a[href]')]
  const visible = links.filter((a) => {
    const r = a.getBoundingClientRect()
    return r.height > 0 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1
  })
  const linksAfterHeading = heading
    ? links.filter((a) => heading.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)
    : []
  const firstAfter = linksAfterHeading[0] ?? null
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
    linksVisibleNow: visible.length,
    crossLinksVisibleNow: visible.filter((a) =>
      linksAfterHeading.includes(a)).length,
    firstCrossLinkTop: firstAfter
      ? Math.round(firstAfter.getBoundingClientRect().top - s.top + scroller.scrollTop)
      : null,
    firstCrossLinkText: firstAfter ? firstAfter.textContent.trim().slice(0, 40) : null,
  }
})()`;

const CONFIGS = [
  { w: 1680, h: 1000, mobile: false },
  { w: 390, h: 844, mobile: true },
];

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
    await page.goto(`${BASE}/login/`, { settle: 700 });
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
    await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
    await page.waitFor("location.pathname === '/'", { timeout: 20000 });
    await sleep(1500);

    // The Objektliste opens a panel with a BUTTON, not a link, so the uuid is not in any
    // href to read: the row is clicked and the uuid is taken back out of the URL the app
    // wrote. Nothing here has to know a uuid, so nothing here goes stale when the seed does.
    await page.eval(`(() => {
      const row = [...document.querySelectorAll('table.objects-table tbody tr')]
        .find((tr) => /Keine Koordinaten/.test(tr.textContent || ''))
      const btn = row && [...row.querySelectorAll('button')]
        .find((b) => /Öffnen/.test(b.textContent || ''))
      if (btn) btn.click()
      return !!btn
    })()`);
    await sleep(900);
    const unpinnedSearch = await page.eval("location.search");

    console.log(`\n=== ${cfg.w}x${cfg.h} ===`);
    for (const [label, url] of [
      ["worker panel  /workers/?worker=1", "/workers/?worker=1"],
      // The building DRAWER, not the info box: a building with no coordinates can have no
      // pin, so `/` falls back to the drawer for it. That is the rendering on every phone.
      ["building drawer (unpinned)", `/${unpinnedSearch || "?location=none"}`],
    ]) {
      await page.goto("about:blank", { settle: 60 });
      await page.goto(`${BASE}${url.startsWith("/") ? url : `/${url}`}`, { settle: 2600 });
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
      if (r.firstCrossLinkTop !== null) {
        const need = Math.max(0, r.firstCrossLinkTop - (r.clientHeight - 40));
        console.log(
          `    first cross-link \u201e${r.firstCrossLinkText}\u201c at y=${r.firstCrossLinkTop} ` +
            `-> ${need === 0 ? "already visible" : `needs ${need}px of scrolling`}`,
        );
      }
    }
  } finally {
    page.close();
    child.kill("SIGKILL");
  }
}
