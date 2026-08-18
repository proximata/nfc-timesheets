// IS THE DESKTOP PIN INFO BOX CLIPPING ITS OWN CROSS-LINKS?
//
// The picture says yes: `home-panel-1680-dark-overlay.png` ends on a row of half-height
// letter-tops. The owner's answer in IA-PLAN §9 was that the info box carries the numbers
// AND the cross-links, expandable — so "the links are below a fold with no scrollbar" and
// "the links are reachable by scrolling the box" are two very different verdicts, and only
// the DOM can tell them apart.
//
// Reports, per configuration: the box's own scroll geometry, whether an expand control
// exists, and how many of the cross-links are actually inside the visible rectangle.
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(BASE).hostname)) {
  console.error("probe-infobox: loopback only.");
  process.exit(1);
}
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

const BOX = `(() => {
  const box = document.querySelector('.map-info')
  if (!box) return { found: false }
  const cs = getComputedStyle(box)
  const r = box.getBoundingClientRect()
  const links = [...box.querySelectorAll('a[href]')].map((a) => {
    const lr = a.getBoundingClientRect()
    return {
      text: (a.textContent || '').trim().slice(0, 54),
      href: a.getAttribute('href'),
      top: Math.round(lr.top), bottom: Math.round(lr.bottom), h: Math.round(lr.height),
      // Inside the box's painted rectangle, fully?
      visible: lr.top >= r.top - 1 && lr.bottom <= r.bottom + 1 && lr.height > 0,
      clipped: lr.top < r.bottom && lr.bottom > r.bottom,
    }
  })
  // Anything that could reveal the rest: a <details>, a toggle, a scrollable ancestor.
  const expander = box.querySelector('details, summary, [aria-expanded], button[class*=expand], button[class*=more]')
  const scrollables = []
  for (const el of [box, ...box.querySelectorAll('*')]) {
    const s = getComputedStyle(el)
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2) {
      scrollables.push({ cls: (el.className||'').toString().slice(0,44), scrollH: el.scrollHeight, clientH: el.clientHeight, overflowY: s.overflowY })
    }
  }
  return {
    found: true,
    rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) },
    maxHeight: cs.maxHeight, overflowY: cs.overflowY,
    scrollH: box.scrollHeight, clientH: box.clientHeight,
    boxScrolls: box.scrollHeight > box.clientHeight + 2,
    scrollables,
    expander: expander ? { tag: expander.tagName.toLowerCase(), cls: (expander.className||'').toString().slice(0,40), text: (expander.textContent||'').trim().slice(0,40) } : null,
    linkCount: links.length,
    visibleLinks: links.filter((l) => l.visible).length,
    clippedLinks: links.filter((l) => l.clipped).length,
    links,
    tail: (box.innerText || '').trim().split('\\n').slice(-3),
  }
})()`;

const configs = [
  { w: 1680, h: 1000, mobile: false, tag: "1680" },
  { w: 390, h: 844, mobile: true, tag: "390" },
];

for (const cfg of configs) {
  const { child, port } = await launchChrome({ port: cfg.w === 390 ? 9791 : 9790, width: cfg.w, height: cfg.h });
  const page = await attach(port);
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: cfg.w, height: cfg.h, deviceScaleFactor: 1, mobile: cfg.mobile });
    await page.goto(`${BASE}/login/`, { settle: 500 });
    await page.eval(`localStorage.setItem('nfcts.theme', 'dark')`);
    await page.goto(`${BASE}/login/`, { settle: 700 });
    await page.waitFor(`document.querySelector('form button[type="submit"]')`, { timeout: 15000 });
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
    await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
    await page.waitFor("location.pathname === '/'", { timeout: 20000 });
    await sleep(800);

    const uuid = process.env.LOC_UUID;
    await page.goto(`${BASE}/?location=${uuid}`, { settle: 2500 });
    await sleep(3000);
    const box = await page.eval(BOX);
    console.log(`\n=== ${cfg.tag}px ===`);
    if (!box.found) {
      console.log("  no .map-info in the DOM (phone renders the bottom sheet instead)");
    } else {
      console.log(`  box ${box.rect.w}x${box.rect.h} top=${box.rect.top} bottom=${box.rect.bottom}`);
      console.log(`  max-height=${box.maxHeight} overflow-y=${box.overflowY} scrollHeight=${box.scrollH} clientHeight=${box.clientH} scrolls=${box.boxScrolls}`);
      console.log(`  scrollable descendants: ${JSON.stringify(box.scrollables)}`);
      console.log(`  expander: ${JSON.stringify(box.expander)}`);
      console.log(`  links ${box.visibleLinks}/${box.linkCount} fully visible, ${box.clippedLinks} sliced by the box edge`);
      for (const l of box.links) console.log(`     ${l.visible ? "vis " : l.clipped ? "CUT " : "HID "} top=${String(l.top).padStart(4)} h=${String(l.h).padStart(3)}  ${l.text}  -> ${l.href}`);
      console.log(`  last lines rendered: ${JSON.stringify(box.tail)}`);
    }
  } finally {
    page.close();
    child.kill("SIGKILL");
  }
}
