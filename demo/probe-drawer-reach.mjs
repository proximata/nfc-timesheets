// WHERE the building drawer's 902px go at 390px, block by block.
//
// check-reach.mjs asserts the COUNT (`5/7 cross-links`). A count says the surface is
// broken; it does not say which pixels to reclaim, and „NOTHING TRUE may be deleted to
// lighten a screen" means the fix has to come out of spacing, not out of facts. This
// prints the ledger the fix is chosen from.
//
// It is a PROBE and not a check: it prints geometry and exits 0, like probe-panel-reach.mjs
// and probe-fold.mjs. The assertion that goes red on a regression lives in check-reach.mjs.
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(BASE).hostname)) {
  console.error("probe-drawer-reach: loopback only.");
  process.exit(1);
}
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

const OPEN_UNPINNED = `(() => {
  const row = [...document.querySelectorAll('table.objects-table tbody tr')]
    .find((tr) => /Keine Koordinaten/.test(tr.textContent || ''))
  const btn = row && [...row.querySelectorAll('button')].find((b) => /Öffnen/.test(b.textContent || ''))
  if (btn) btn.click()
  return !!btn
})()`;

const BLOCKS = `(() => {
  const panel = document.querySelector('.drawer')
  if (!panel) return { found: false }
  const scroller = [panel, ...panel.querySelectorAll('*')]
    .filter((el) => el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 100)
    .sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? panel
  const s = scroller.getBoundingClientRect()
  const rel = (el) => {
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top - s.top + scroller.scrollTop), h: Math.round(r.height) }
  }
  // Direct children of the scroller: the panel's own top-level blocks.
  const blocks = [...scroller.children].map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: el.className || '(none)',
    ...rel(el),
    text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 56),
  }))
  const out = panel.querySelector('ul.panel-links-out')
  const links = out ? [...out.children].map((li) => ({
    ...rel(li),
    mb: getComputedStyle(li).marginBottom,
    text: (li.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 44),
  })) : []
  const metrics = panel.querySelector('dl.panel-metrics')
  const rows = metrics ? [...metrics.children].map((el) => ({
    tag: el.tagName.toLowerCase(), ...rel(el),
    text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 48),
  })) : []
  return {
    found: true,
    scrollHeight: Math.round(scroller.scrollHeight),
    clientHeight: Math.round(scroller.clientHeight),
    gap: getComputedStyle(out ?? panel).gap,
    blocks, rows, links,
  }
})()`;

const { child, port } = await launchChrome({ port: 9781, width: 390, height: 844 });
try {
  const page = await attach(port);
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 20000 });
  await sleep(2500);
  await page.eval(OPEN_UNPINNED);
  await sleep(1400);

  const b = await page.eval(BLOCKS);
  if (!b.found) {
    console.log("no drawer opened");
  } else {
    console.log(`scroller ${b.clientHeight}px visible of ${b.scrollHeight}px  -> ${b.scrollHeight - b.clientHeight}px hidden`);
    console.log(`\n--- top-level blocks ---`);
    for (const x of b.blocks) console.log(`  y=${String(x.top).padStart(4)} h=${String(x.h).padStart(4)}  ${x.tag}.${x.cls}  ${x.text}`);
    console.log(`\n--- dl.panel-metrics rows ---`);
    for (const x of b.rows) console.log(`  y=${String(x.top).padStart(4)} h=${String(x.h).padStart(3)}  <${x.tag}> ${x.text}`);
    console.log(`\n--- ul.panel-links-out (gap ${b.gap}) ---`);
    for (const x of b.links) console.log(`  y=${String(x.top).padStart(4)} h=${String(x.h).padStart(3)} mb=${x.mb}  ${x.text}  ${x.top + x.h <= b.clientHeight ? "ON" : "OFF"}`);
  }
} finally {
  child.kill("SIGKILL");
}
