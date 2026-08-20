// The LOOK pass: every admin screen, at the two DESKTOP widths the director actually uses,
// in both themes, photographed twice — the fold (what the eye lands on) and the whole page.
//
//   cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY="$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)" \
//     NEXT_PUBLIC_API_BASE_URL="" NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build && cd ..
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR="$PWD/web/out" \
//     node demo/demo-server.mjs &
//   node demo/shoot-look.mjs
//
// PORT 8080 IS NOT A PREFERENCE. The Maps browser key is referrer-locked to 127.0.0.1:8080
// and the production host. On any other port the home map draws zero pins and looks exactly
// like a defect; that has been misdiagnosed twice in this repo.
//
// Why a new script rather than a flag on demo/shoot-ia.mjs: shoot-ia is a BEFORE/AFTER tape
// measure for the IA round and changing what it photographs would make its two readings
// incomparable. This one has a different question — "does a human reading this screen learn
// the right thing first" — and a different config matrix (1680 AND 1280, no phone).
//
// It ASSERTS ALMOST NOTHING. It captures, it records the four things a photograph cannot say
// (horizontal overflow, the h1, the first datum, caption-vs-header on card layouts), and it
// exits 0. The verdict is a human reading docs/media/look/ and writing backlog/docs/LOOK.md.
//
// READ-ONLY against the database. Row-count and money states that need an UPDATE live in
// demo/shoot-look-states.mjs, which dumps first.
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
const OUT = process.env.SHOOT_OUT
  ? process.env.SHOOT_OUT.replace(/\/?$/, "/")
  : new URL("../docs/media/look/", import.meta.url).pathname;

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`shoot-look: refusing to shoot "${host}" — loopback only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

/**
 * All FOURTEEN admin screens, plus the three that render without the admin shell.
 * `/tags/` and `/operators/` are off-nav and have never been photographed by anything.
 * `/404.html` is hit as a file: the demo server answers an unknown path with JSON, while
 * production (server.js:235) serves 404.html for an HTML request. Same bytes either way.
 */
const SCREENS = [
  { path: "/", name: "01-home", map: true },
  { path: "/shifts/", name: "02-shifts", bottom: true },
  { path: "/material-requests/", name: "03-materials", bottom: true },
  { path: "/workers/", name: "04-workers" },
  { path: "/locations/", name: "05-locations", bottom: true },
  { path: "/clients/", name: "06-clients" },
  { path: "/payroll/", name: "07-payroll", bottom: true },
  { path: "/pl/", name: "08-pl", bottom: true },
  { path: "/account/", name: "09-account" },
  { path: "/contracts/", name: "10-contracts" },
  { path: "/analytics/", name: "11-analytics", bottom: true },
  { path: "/inventory/", name: "12-inventory", bottom: true },
  { path: "/operators/", name: "13-operators" },
  { path: "/tags/", name: "14-tags" },
  { path: "/login/", name: "15-login", noShell: true },
  { path: "/reinigung/", name: "16-portal", noShell: true },
  { path: "/404.html", name: "17-notfound" },
];

const CONFIGS = [
  { w: 1680, h: 1000, theme: "dark" },
  { w: 1680, h: 1000, theme: "light" },
  { w: 1280, h: 800, theme: "dark" },
  { w: 1280, h: 800, theme: "light" },
].filter((c) => !process.env.LOOK_CONFIG || `${c.w}-${c.theme}` === process.env.LOOK_CONFIG);

const ONLY = process.env.LOOK_ONLY ? new Set(process.env.LOOK_ONLY.split(",")) : null;
const MAX_H = 4200;
const DEADLINE_MS = 30 * 60 * 1000;
const started = Date.now();

mkdirSync(OUT, { recursive: true });
const report = { base: BASE, at: new Date().toISOString(), shots: [], findings: [] };
const finding = (severity, screen, config, text) => {
  report.findings.push({ severity, screen, config, text });
  console.log(`  ${severity.toUpperCase().padEnd(4)} ${screen} ${config}  ${text}`);
};

async function freePort(from) {
  for (let port = from; port < from + 80; port++) {
    const ok = await new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error(`no free debugging port in ${from}..${from + 80}`);
}

/** The fold. What the director sees before touching the wheel — the whole question here. */
async function shootFold(page, file) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}${file}`, Buffer.from(data, "base64"));
  return { file, fold: true };
}

/**
 * The whole page. NEVER on a screen that draws a map: `captureBeyondViewport` re-rasterises
 * the compositor surface and Google's tiles and our pins are gone by the time the frame is
 * taken — and worse, they stay gone for every later capture on that page. shoot-ia.mjs
 * learned this the expensive way; the fold shot is therefore always taken first.
 */
async function shootFull(page, file, width) {
  const metrics = await page.send("Page.getLayoutMetrics");
  const contentH = Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height);
  const clipH = Math.min(contentH, MAX_H);
  const { data } = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: clipH, scale: 1 },
  });
  writeFileSync(`${OUT}${file}`, Buffer.from(data, "base64"));
  return { file, contentH, clipped: clipH < contentH };
}

/**
 * What a photograph cannot say. Deliberately small: this run's verdict comes from eyes, and
 * a probe that reports 40 numbers invites reporting the numbers instead of the picture.
 *
 * `firstDatum` is the one measurement that matters to the brief's third question. It walks
 * the rendered text of <main> in document order and reports what comes before the first
 * thing that looks like a figure — a count, a duration, a euro amount, a date. "Prose above
 * the first datum" is a named failure of this project.
 */
const PROBE = `(() => {
  const de = document.documentElement
  const vw = de.clientWidth
  const main = document.querySelector('main') || document.body

  const overflow = { scrollWidth: de.scrollWidth, layoutWidth: vw, culprits: [] }
  if (de.scrollWidth > vw + 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (r.right > vw + 1 || r.left < -1) {
        overflow.culprits.push({ tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,60), right: Math.round(r.right), text: (el.textContent||'').trim().slice(0,40) })
      }
      if (overflow.culprits.length >= 8) break
    }
  }

  const DATUM = /(\\d+[.,]\\d{2}\\s*€|€\\s*\\d|\\b\\d{1,3}:\\d{2}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d+\\s*(Std|h|Schicht|Objekt|Mitarbeit))/
  const words = []
  let wordsBeforeDatum = null
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || el.closest('.visually-hidden') || el.matches('script, style')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const t = (n.textContent || '').trim()
    if (t === '') continue
    words.push(t)
    if (wordsBeforeDatum === null && DATUM.test(t)) {
      wordsBeforeDatum = words.slice(0, -1).join(' ').split(/\\s+/).filter(Boolean).length
    }
  }

  // Card layout only exists under 768px, but the probe is free and a regression here once
  // captioned a timestamp "Objekt" while every assertion stayed green.
  const tables = []
  for (const table of document.querySelectorAll('table')) {
    const headings = [...table.querySelectorAll('thead th')].map((th) => (th.textContent||'').trim())
    const mismatches = []
    for (const row of [...table.querySelectorAll('tbody tr')].slice(0, 30)) {
      const cells = [...row.children]
      cells.forEach((cell, i) => {
        const label = cell.getAttribute('data-label')
        if (label !== null && label !== headings[i]) mismatches.push({ i, label, header: headings[i] ?? '(none)' })
      })
    }
    tables.push({ cls: (table.className||'').toString().slice(0,40), headings, rows: table.querySelectorAll('tbody tr').length, mismatches: mismatches.slice(0,5) })
  }

  // Every raw uuid printed anywhere a human reads. A tag URI on /locations/ is one on
  // purpose (decision-21); anything else is an internal token shown to a person.
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
  const uuids = [...new Set(((main.innerText||'').match(UUID) || []))]
  // ...and every raw snake_case token, which is what an untranslated error code looks like.
  const TOKEN = /\\b[a-z]{3,}_[a-z_]{3,}\\b/g
  const tokens = [...new Set(((main.innerText||'').match(TOKEN) || []))]

  return {
    theme: de.getAttribute('data-theme'),
    h1: (document.querySelector('h1')?.textContent||'').trim(),
    firstText: words.slice(0, 12),
    wordsBeforeDatum,
    contentH: Math.ceil(de.scrollHeight),
    overflow, tables, uuids, tokens,
  }
})()`;

async function signIn(page) {
  await page.goto(`${BASE}/login/`, { settle: 600 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: "the sign-in button" });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { label: "dashboard after sign-in", timeout: 20000 });
  await sleep(800);
}

async function capture(page, name, tag, cfg, { map = false, bottom = false } = {}) {
  const fold = await shootFold(page, `${name}-${tag}-fold.png`);
  report.shots.push({ ...fold, screen: name, config: tag });
  const probe = await page.eval(PROBE);

  if (!map) {
    const full = await shootFull(page, `${name}-${tag}-full.png`, cfg.w);
    report.shots.push({ ...full, screen: name, config: tag, probe });
    if (bottom && full.clipped) {
      await page.eval("window.scrollTo(0, document.documentElement.scrollHeight)");
      await sleep(600);
      report.shots.push({ ...(await shootFold(page, `${name}-${tag}-bottom.png`)), screen: name, config: tag, bottom: true });
      await page.eval("window.scrollTo(0, 0)");
      await sleep(200);
    }
  } else {
    report.shots[report.shots.length - 1].probe = probe;
    // A map screen still has truth below the fold; scroll to it rather than re-rasterise.
    await page.eval("window.scrollTo(0, document.documentElement.scrollHeight)");
    await sleep(700);
    report.shots.push({ ...(await shootFold(page, `${name}-${tag}-bottom.png`)), screen: name, config: tag, bottom: true });
    await page.eval("window.scrollTo(0, 0)");
    await sleep(400);
  }

  if (probe.theme !== cfg.theme && !name.includes("portal")) {
    finding("fail", name, tag, `data-theme is "${probe.theme}", asked for "${cfg.theme}"`);
  }
  if (probe.overflow.scrollWidth > probe.overflow.layoutWidth + 1) {
    finding("fail", name, tag, `horizontal scroll ${probe.overflow.scrollWidth}px > ${probe.overflow.layoutWidth}px: ` +
      probe.overflow.culprits.map((c) => `<${c.tag} class="${c.cls}" "${c.text}">`).join(" | "));
  }
  for (const t of probe.tables) {
    if (t.mismatches.length > 0) finding("fail", name, tag, `card captions disagree with headers: ` +
      t.mismatches.map((m) => `cell[${m.i}] "${m.label}" vs "${m.header}"`).join(" | "));
  }
  if (probe.uuids.length > 0) finding("note", name, tag, `${probe.uuids.length} raw uuid(s) on screen: ${probe.uuids.slice(0,3).join(", ")}`);
  if (probe.tokens.length > 0) finding("note", name, tag, `raw snake_case token(s) on screen: ${probe.tokens.slice(0,5).join(", ")}`);
  console.log(`  ${`${name}-${tag}`.padEnd(34)} ${String(probe.contentH).padStart(5)}px  words-before-first-datum=${probe.wordsBeforeDatum ?? "NO DATUM"}  h1="${probe.h1}"`);
  return probe;
}

for (const [index, cfg] of CONFIGS.entries()) {
  const tag = `${cfg.w}-${cfg.theme}`;
  console.log(`\n=== ${tag} ===`);
  const { child, port } = await launchChrome({ port: await freePort(9700 + index * 12), width: cfg.w, height: cfg.h });
  const page = await attach(port);
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: cfg.w, height: cfg.h, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${BASE}/login/`, { settle: 300 });
    await page.eval(`localStorage.setItem('nfcts.theme', ${JSON.stringify(cfg.theme)})`);

    // The signed-OUT screens first, because signing in is what makes them unreachable.
    for (const screen of SCREENS.filter((s) => s.name === "15-login")) {
      await page.goto(`${BASE}${screen.path}`, { settle: 1200 });
      await capture(page, screen.name, tag, cfg);
    }

    await signIn(page);

    for (const screen of SCREENS) {
      if (screen.name === "15-login") continue;
      if (ONLY && !ONLY.has(screen.name)) continue;
      if (Date.now() - started > DEADLINE_MS) throw new Error("run deadline exceeded");
      await page.goto(`${BASE}${screen.path}`, { settle: 1500 });
      if (screen.map) {
        try {
          await page.waitFor(`document.querySelectorAll('.map-pin').length > 0 || /Kartenschlüssel|abgelehnt|erreichbar|Koordinaten/.test(document.querySelector('.map-region')?.innerText || '')`,
            { timeout: 20000, label: "the map settling" });
        } catch { finding("warn", screen.name, tag, "map region never settled within 20s"); }
        await sleep(2500);
      }
      await sleep(500);
      await capture(page, screen.name, tag, cfg, screen);
    }
  } finally {
    page.close();
    child.kill();
  }
}

writeFileSync(`${OUT}report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nshoot-look: ${report.shots.length} shot(s) -> ${OUT}`);
console.log(`shoot-look: ${report.findings.length} machine finding(s); the verdict is in the pictures.`);
