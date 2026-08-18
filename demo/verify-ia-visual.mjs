// The VISUAL verifier's own instrument. It exists because two numbers in the builders'
// own artefacts disagree with each other, and a disagreement between two readings of the
// same page is not something a screenshot can settle.
//
//   node demo/verify-ia-visual.mjs
//
// It answers three questions the build reports could not:
//
//  1. WHAT IS THE FIRST DATUM ON THE HOME SCREEN. demo/shoot-ia.mjs recorded
//     `read: 0, firstDatumY: 0`; demo/measure-ia-weight.mjs recorded `read: 5` for the same
//     route, the same commit, the same ruler (demo/weight-probe.mjs, imported by both). One
//     of them is measuring a thing that is not there. `read = 0` on a screen that visibly
//     carries „Muss ich gerade etwas tun?" above its answer band is the exact failure the
//     ruler's own header warns about, so it is the reading under suspicion. This dumps
//     every candidate the walker considered, with its box and its ancestry, so the answer
//     is a list of elements and not an opinion.
//
//  2. WHAT ACTUALLY OVERFLOWS 390px ON /?location=<unknown-uuid>. The shoot reported
//     `scrollWidth 443 > 390` and then named three NAV elements — but the nav is off-canvas
//     on every 390px screen in the run and only this one overflows, so the nav is a
//     passenger. The culprit walker stops at twelve and the real one is not in the first
//     twelve. This one walks EVERY element, sorts by how far past the edge it reaches, and
//     reports the widest unbreakable text node.
//
//  3. IS THE PIN LEGIBLE WITHOUT COLOUR. Not "is there a shape" — the actual computed
//     glyph, per state, read out of the DOM, so the greyscale check has something to
//     compare against rather than a human squinting at a 12px circle.
//
// It writes docs/media/ia/verify.json and exits non-zero only on (1) and (2), which are
// facts. Taste is reported, never gated.
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { attach, launchChrome, sleep } from "./cdp.mjs";
import { WEIGHT } from "./weight-probe.mjs";

const AFTER = process.env.AFTER_BASE ?? "http://127.0.0.1:8080";
const BEFORE = process.env.BEFORE_BASE ?? "http://127.0.0.1:8083";
for (const base of [AFTER, BEFORE]) {
  const host = new URL(base).hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
    console.error(`verify-ia-visual: refusing to drive "${host}" — loopback only.`);
    process.exit(1);
  }
}
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const OUT = new URL("../docs/media/ia/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const out = { at: new Date().toISOString(), after: AFTER, before: BEFORE, checks: [] };
let failed = 0;
const record = (ok, name, detail) => {
  out.checks.push({ ok, name, detail });
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const ok = await new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error("no free debugging port");
}

/** Every element the weight walker would consider a datum, with why it was or was not one. */
const FIRST_DATUM = `(() => {
  const main = document.querySelector('#main-content, main') || document.body
  const rows = []
  for (const el of main.querySelectorAll('table, .figure, .answer, [class*=figure], [class*=answer]')) {
    const r = el.getBoundingClientRect()
    const inMap = !!el.closest('.map-region, .gm-style')
    rows.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 70),
      w: Math.round(r.width), h: Math.round(r.height),
      y: Math.round(r.top + window.scrollY),
      inMap,
      zeroBox: r.width < 1 || r.height < 1,
      counted: !(r.width < 1 || r.height < 1) && !inMap,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
      parents: (() => { const p = []; let n = el.parentElement
        while (n && n !== document.body && p.length < 6) { p.push(n.tagName.toLowerCase() + (n.className ? '.' + n.className.toString().split(' ')[0] : '')); n = n.parentElement }
        return p.join(' < ') })(),
    })
  }
  rows.sort((a, b) => a.y - b.y)
  const counted = rows.filter((r) => r.counted)
  return { rows: rows.slice(0, 14), firstCounted: counted[0] ?? null, prose: (() => {
    const firstY = counted.length ? Math.min(...counted.map((r) => r.y)) : Infinity
    const list = []
    for (const el of main.querySelectorAll('p, li, .note, .hint')) {
      if (el.closest('table') || el.closest('.map-region, .gm-style')) continue
      if (el.getBoundingClientRect().top + window.scrollY >= firstY) continue
      if (!el.offsetParent) continue
      list.push((el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 70))
    }
    return list })() }
})()`;

/** Every element that reaches past the viewport edge, worst first. No cap of twelve. */
const OVERFLOW = `(() => {
  const de = document.documentElement
  const vw = de.clientWidth
  const all = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (r.right <= vw + 1 && r.left >= -1) continue
    // Off-canvas by design: a translated drawer is not an overflow, it is a closed drawer.
    const t = cs.transform
    const offCanvas = t && t !== 'none' && /matrix\\(1, 0, 0, 1, -/.test(t)
    all.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 60),
      left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
      over: Math.round(r.right - vw),
      offCanvas,
      overflowX: cs.overflowX, position: cs.position, transform: t === 'none' ? null : t.slice(0, 40),
      wordBreak: cs.wordBreak, whiteSpace: cs.whiteSpace,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 70),
      leaf: el.children.length === 0,
    })
  }
  all.sort((a, b) => b.over - a.over)
  return { scrollWidth: de.scrollWidth, vw, count: all.length, worst: all.slice(0, 10),
    // The element that is BOTH past the edge and has no child past the edge: the actual
    // thing that is too wide, rather than every ancestor that contains it.
    leaves: all.filter((e) => e.leaf).slice(0, 6) }
})()`;

/** The pin, as the DOM describes it: glyph, aria, and the non-colour signal. */
const PINS = `(() => {
  return [...document.querySelectorAll('.map-pin')].map((p) => ({
    text: (p.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
    aria: p.getAttribute('aria-label') || p.querySelector('[aria-label]')?.getAttribute('aria-label') || null,
    cls: (p.className || '').toString().slice(0, 60),
    bg: getComputedStyle(p).backgroundColor,
    glyph: [...p.querySelectorAll('*')].map((c) => (c.textContent || '').trim()).filter((t) => t && t.length <= 3),
    box: (() => { const r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })(),
  }))
})()`;

async function signIn(page, base) {
  await page.goto(`${base}/login/`, { settle: 400 });
  await page.eval(`localStorage.setItem('nfcts.theme', 'dark')`);
  await page.goto(`${base}/login/`, { settle: 600 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { timeout: 15000 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 20000 });
  await sleep(700);
}

async function settleMap(page) {
  try {
    await page.waitFor(
      `document.querySelectorAll('.map-pin').length > 0 || /Kartenschl|abgelehnt|erreichbar|Koordinaten/.test(document.querySelector('.map-region')?.innerText || '')`,
      { timeout: 20000 },
    );
  } catch {}
  await sleep(2500);
}

const { child, port } = await launchChrome({ port: await freePort(9700), width: 1680, height: 1000 });
const page = await attach(port);
const kill = setTimeout(() => {
  console.error("verify-ia-visual: DEADLINE");
  child.kill("SIGKILL");
  process.exit(3);
}, 10 * 60 * 1000);

try {
  // ---- 1. the first datum on the home screen -------------------------------------------
  console.log("\n=== 1. what is the first datum on /? ===");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
  await signIn(page, AFTER);
  await page.goto(`${AFTER}/`, { settle: 1500 });
  await settleMap(page);

  const datum = await page.eval(FIRST_DATUM);
  const weightNow = await page.eval(WEIGHT);
  out.home = { datum, weight: weightNow };
  console.log(`  weight now: px=${weightNow.px} read=${weightNow.read} boxes=${weightNow.boxes} firstDatumY=${weightNow.firstDatumY}`);
  console.log(`  first counted datum: ${datum.firstCounted ? `<${datum.firstCounted.tag} class="${datum.firstCounted.cls}"> ${datum.firstCounted.w}x${datum.firstCounted.h} @y=${datum.firstCounted.y} "${datum.firstCounted.text}"` : "NONE"}`);
  for (const r of datum.rows) {
    console.log(`    ${r.counted ? "datum" : "skip "} y=${String(r.y).padStart(5)} ${String(r.w)}x${String(r.h)} <${r.tag} class="${r.cls}">${r.inMap ? " [in map]" : ""}${r.zeroBox ? " [0-box]" : ""}  "${r.text}"`);
  }
  console.log(`  prose above it: ${JSON.stringify(datum.prose)}`);

  // A home screen whose first datum sits at y=0 is a broken reading: the h1 and its
  // question line are above the band, and they are not zero pixels tall.
  const h1y = await page.eval(`Math.round(document.querySelector('h1').getBoundingClientRect().top + window.scrollY)`);
  record(
    !(weightNow.firstDatumY !== null && weightNow.firstDatumY < h1y),
    "the home screen's first datum is below its own h1",
    `firstDatumY=${weightNow.firstDatumY}, h1 at y=${h1y}`,
  );
  record(
    weightNow.read > 0,
    "the home screen counts the prose above its first datum",
    `read=${weightNow.read} words: ${JSON.stringify(datum.prose)}`,
  );

  // ---- 2. the 390px overflow on the ghost panel ----------------------------------------
  console.log("\n=== 2. what overflows 390px on /?location=<unknown> ===");
  const GHOST = "00000000-0000-4000-8000-000000000000";
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(300);

  const overflowOf = async (url, label) => {
    await page.goto(`${AFTER}${url}`, { settle: 2000 });
    await settleMap(page);
    const o = await page.eval(OVERFLOW);
    console.log(`  ${label.padEnd(28)} scrollWidth=${o.scrollWidth} vw=${o.vw} past-edge=${o.count}`);
    for (const e of o.leaves) {
      console.log(`      leaf +${String(e.over).padStart(4)}px  <${e.tag} class="${e.cls}"> w=${e.w} ws=${e.whiteSpace} wb=${e.wordBreak}  "${e.text}"`);
    }
    for (const e of o.worst.slice(0, 4)) {
      console.log(`      worst +${String(e.over).padStart(4)}px <${e.tag} class="${e.cls}"> w=${e.w}${e.offCanvas ? " [off-canvas]" : ""}  "${e.text.slice(0, 50)}"`);
    }
    return o;
  };

  const ghost = await overflowOf(`/?location=${GHOST}`, "ghost uuid");
  const plain = await overflowOf("/", "plain home");
  out.overflow = { ghost, plain };
  record(ghost.scrollWidth <= ghost.vw + 1, "/?location=<unknown> does not scroll sideways at 390px", `scrollWidth=${ghost.scrollWidth} vw=${ghost.vw}`);
  record(plain.scrollWidth <= plain.vw + 1, "/ does not scroll sideways at 390px", `scrollWidth=${plain.scrollWidth} vw=${plain.vw}`);

  // ---- 3. the pins, without colour ------------------------------------------------------
  console.log("\n=== 3. the pins as the DOM describes them ===");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${AFTER}/`, { settle: 1500 });
  await settleMap(page);
  const pins = await page.eval(PINS);
  out.pins = pins;
  for (const p of pins) console.log(`    ${p.box.w}x${p.box.h}  glyph=${JSON.stringify(p.glyph)}  bg=${p.bg}  aria=${JSON.stringify(p.aria)}  "${p.text}"`);
  const colourless = pins.filter((p) => p.glyph.length > 0 || (p.text && p.text.length > 0));
  record(pins.length === 0 || colourless.length === pins.length,
    "every pin carries a non-colour signal (glyph or text)",
    `${colourless.length}/${pins.length}`);

  // ---- 4. the nav, before and after ------------------------------------------------------
  console.log("\n=== 4. sidebar destinations, before vs after ===");
  const navOf = async (base) => {
    await page.goto(`${base}/`, { settle: 1400 });
    return page.eval(`[...new Set([...document.querySelectorAll('nav a[href]')].map((a) => new URL(a.href).pathname))]`);
  };
  const navAfter = await navOf(AFTER);
  await signIn(page, BEFORE);
  const navBefore = await navOf(BEFORE);
  out.nav = { before: navBefore, after: navAfter };
  console.log(`    before (${navBefore.length}): ${navBefore.join(" ")}`);
  console.log(`    after  (${navAfter.length}): ${navAfter.join(" ")}`);
  record(navBefore.length > navAfter.length, "the sidebar lost destinations", `${navBefore.length} → ${navAfter.length}`);
} finally {
  clearTimeout(kill);
  page.close();
  child.kill("SIGKILL");
}

writeFileSync(`${OUT}verify.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nverify-ia-visual: ${failed} failed check(s). -> ${OUT}verify.json`);
process.exit(failed > 0 ? 1 : 0);
