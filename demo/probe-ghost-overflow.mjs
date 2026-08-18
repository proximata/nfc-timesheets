// WHAT IS 443 PIXELS WIDE ON /?location=<unknown-uuid> AT 390px.
//
// The shoot's culprit list names the sidebar, and the sidebar is innocent: it reaches
// right=696 on the PLAIN home screen too, where the document still measures exactly 390.
// Something clips it there and the same clip holds here. So the guilty element is the one
// that reaches ~443 — 53px past the edge — and it is nowhere near the top of a list sorted
// by how far past the edge things reach.
//
// This isolates it by asking a different question: which elements have a right edge in the
// 391..500 band, and of those, which is a LEAF whose own text will not wrap.
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(BASE).hostname)) {
  console.error("probe-ghost-overflow: loopback only.");
  process.exit(1);
}
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const GHOST = "00000000-0000-4000-8000-000000000000";

const BAND = `(() => {
  const de = document.documentElement
  const vw = de.clientWidth
  const rows = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (r.right <= vw + 1 || r.right > 560) continue
    rows.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 56),
      left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
      leaf: el.children.length === 0,
      inNav: !!el.closest('nav'),
      ws: cs.whiteSpace, wb: cs.wordBreak, ovf: cs.overflowX, minW: cs.minWidth,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      path: (() => { const p = []; let n = el
        while (n && n !== document.body && p.length < 7) { p.push(n.tagName.toLowerCase() + (n.className ? '.' + n.className.toString().trim().split(/\\s+/)[0] : '')); n = n.parentElement }
        return p.join(' < ') })(),
    })
  }
  rows.sort((a, b) => b.right - a.right)
  return { vw, scrollWidth: de.scrollWidth, rows }
})()`;

const { child, port } = await launchChrome({ port: 9788, width: 390, height: 844 });
const page = await attach(port);
try {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.goto(`${BASE}/login/`, { settle: 500 });
  await page.eval(`localStorage.setItem('nfcts.theme', 'dark')`);
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { timeout: 15000 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 20000 });
  await sleep(800);

  for (const [label, url] of [["ghost", `/?location=${GHOST}`], ["plain", "/"]]) {
    await page.goto(`${BASE}${url}`, { settle: 2500 });
    await sleep(2500);
    const b = await page.eval(BAND);
    console.log(`\n=== ${label}  scrollWidth=${b.scrollWidth} vw=${b.vw} — elements with right edge in 391..560 ===`);
    if (b.rows.length === 0) console.log("  (none)");
    for (const r of b.rows) {
      console.log(`  right=${String(r.right).padStart(4)} w=${String(r.w).padStart(4)} ${r.leaf ? "LEAF" : "    "} ${r.inNav ? "nav " : "MAIN"} <${r.tag} class="${r.cls}"> ws=${r.ws}`);
      console.log(`      "${r.text}"`);
      if (!r.inNav) console.log(`      ${r.path}`);
    }
    // The chip that names an unknown building is the only thing on this screen the plain
    // home screen does not have. Print it whatever its width, so the comparison is explicit.
    const chip = await page.eval(`(() => {
      const el = [...document.querySelectorAll('*')].find((e) => /unbekannt/.test(e.textContent || '') && ![...e.children].some((c) => /unbekannt/.test(c.textContent || '')))
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return { tag: el.tagName.toLowerCase(), cls: (el.className||'').toString(), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
        ws: cs.whiteSpace, wb: cs.wordBreak, text: (el.textContent||'').trim().slice(0, 120) }
    })()`);
    console.log(`  chip: ${chip ? JSON.stringify(chip) : "(none)"}`);
  }
} finally {
  page.close();
  child.kill("SIGKILL");
}
