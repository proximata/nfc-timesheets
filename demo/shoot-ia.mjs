// The VISUAL pass for the IA round (decisions 37/38/39): every screen, four configurations,
// plus every SEEDED state that only exists if somebody creates it.
//
//   «stack» on PORT 8080 — the Maps browser key is referrer-locked to 127.0.0.1:8080 and
//   nothing else on this machine, so a run on 8082 proves the degraded path five times and
//   the working one never.
//
//   cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY="$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)" \
//     NEXT_PUBLIC_API_BASE_URL="" NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build && cd ..
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR="$PWD/web/out" \
//     node demo/demo-server.mjs &
//   node demo/shoot-ia.mjs
//
// It is the same instrument as demo/shoot-redesign.mjs and deliberately so: the weight
// question is a BEFORE/AFTER question, and changing the tape measure between the two
// readings would make the answer unfalsifiable. What is added here is the state list —
// the panels, the filter chips and the seven map states — because those states do not
// exist until something creates them, and a screen nobody photographed is a screen nobody
// looked at.
//
// SHOOT_OUT points it at another directory so the SAME script can be run inside a git
// worktree of an older commit. That is the only honest before/after: two pictures, not a
// picture and a memory of one. `IA_BASELINE=1` restricts it to the routes that exist in
// both trees and skips every state that needs the new query-parameter contract.
//
// It ASSERTS NOTHING about taste. It captures, it measures the four things a screenshot
// cannot say (horizontal overflow, control heights in CSS px, whether the sidebar was
// deleted at 390px, caption TEXT vs header TEXT), and it exits 0. The verdict is a human
// looking at docs/media/ia/.
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { attach, launchChrome, sleep } from "./cdp.mjs";
import { WEIGHT } from "./weight-probe.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
const DB = process.env.DEMO_DB ?? "nfc_demo";
const OUT = process.env.SHOOT_OUT
  ? process.env.SHOOT_OUT.replace(/\/?$/, "/")
  : new URL("../docs/media/ia/", import.meta.url).pathname;
const BASELINE = process.env.IA_BASELINE === "1";
const DEADLINE_MS = 25 * 60 * 1000;
const started = Date.now();

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`shoot-ia: refusing to shoot "${host}" — loopback only.`);
  process.exit(1);
}
// This script UPDATEs rows to seed the map's empty states. The one database it may ever
// touch is the throwaway one — the same refusal demo/seed.sql makes, for the same reason.
if (DB !== "nfc_demo") {
  console.error(`shoot-ia: refusing to write to "${DB}" — nfc_demo only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const sql = (q) => execFileSync("psql", ["-d", DB, "-tAc", q], { encoding: "utf8" }).trim();

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

/**
 * The routes. NINE in the sidebar since decision-39, THREE off-nav that still exist and are
 * still reachable, and the two that render without the admin shell. `baseline: false` marks
 * a route that did not exist, or was not reachable the same way, before this round.
 */
const SCREENS = [
  { path: "/", name: "home" },
  { path: "/shifts/", name: "shifts" },
  { path: "/material-requests/", name: "material-requests" },
  { path: "/workers/", name: "workers" },
  { path: "/locations/", name: "locations" },
  { path: "/clients/", name: "clients" },
  { path: "/payroll/", name: "payroll" },
  { path: "/pl/", name: "pl" },
  { path: "/account/", name: "account" },
  { path: "/contracts/", name: "contracts", offNav: true },
  { path: "/analytics/", name: "analytics", offNav: true },
  { path: "/inventory/", name: "inventory", offNav: true },
  { path: "/login/", name: "login", noShell: true },
  { path: "/reinigung/", name: "portal", noShell: true },
];

const CONFIGS = [
  { w: 1680, h: 1000, theme: "dark", mobile: false },
  { w: 1680, h: 1000, theme: "light", mobile: false },
  { w: 390, h: 844, theme: "dark", mobile: true },
  { w: 390, h: 844, theme: "light", mobile: true },
].filter((c) => !process.env.IA_CONFIG || `${c.w}-${c.theme}` === process.env.IA_CONFIG);

/**
 * `IA_ONLY=workers,shifts` — a comma-separated screen list, so one finding can be re-proved
 * in forty seconds instead of fourteen minutes. It restricts the SCREENS list only; the
 * seeded states have their own names and are skipped unless named here too.
 */
const ONLY = process.env.IA_ONLY ? new Set(process.env.IA_ONLY.split(",")) : null;

const MAX_H = 3600;
/** Screens whose truth lives at the bottom: a tfoot total, a reconciliation line. */
const BOTTOM_SHOT = new Set(["payroll", "pl", "analytics", "shifts", "inventory", "home"]);

mkdirSync(OUT, { recursive: true });

const report = { base: BASE, at: new Date().toISOString(), baseline: BASELINE, shots: [], findings: [] };
const finding = (severity, screen, config, text) => {
  report.findings.push({ severity, screen, config, text });
  console.log(`  ${severity === "fail" ? "FAIL" : severity === "warn" ? "warn" : "note"}  ${screen} ${config}  ${text}`);
};

async function shoot(page, file, { width, height = null }) {
  const metrics = await page.send("Page.getLayoutMetrics");
  const contentH = Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height);
  const clipH = height ?? Math.min(contentH, MAX_H);
  const { data } = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: clipH, scale: 1 },
  });
  writeFileSync(`${OUT}${file}`, Buffer.from(data, "base64"));
  return { file, contentH, clipped: clipH < contentH };
}

/**
 * Viewport-only shot. Needed for two different things, and the second one cost an hour:
 *
 *  - overlays are `position: fixed` and do not scroll, so a full-page clip photographs the
 *    page UNDER the drawer plus whatever the drawer happens to overlap in the first screen;
 *  - THE MAP DOES NOT SURVIVE `captureBeyondViewport`. Measured, not theorised: the first
 *    pass of this script produced a home screen with a 600px BLACK RECTANGLE where the map
 *    is, while the same page in the same browser reported 5 `.map-pin`s and 40 tile <img>s.
 *    `captureBeyondViewport: true` resizes the compositor surface to the full document and
 *    re-rasterises; Google's tiles and our OverlayView pins are both gone by the time the
 *    frame is taken. Anything containing a map is therefore shot from the viewport, and a
 *    full-page shot of the home screen is only ever trusted for its HEIGHT.
 *
 * AND THE ORDER MATTERS, which is the part that nearly slipped through. The damage is not
 * confined to the one frame: once `captureBeyondViewport` has run, the map STAYS blank in
 * every subsequent capture of that page — the second pass of this script took the viewport
 * shot after the full-page shot and produced a second set of black rectangles that looked
 * exactly like a broken map. So on a map screen the viewport shot is taken FIRST.
 */
async function shootViewport(page, file) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}${file}`, Buffer.from(data, "base64"));
  return { file, viewport: true };
}

/** True for every screen that draws a map: those get viewport shots, see above. */
const hasMap = (name) => name === "home" || name.startsWith("home-");

/**
 * The measurements a screenshot cannot make. Identical to shoot-redesign.mjs's probe so the
 * before/after numbers are comparable, plus `weight` — the three numbers the owner's
 * complaint was phrased in (demo/review-weight.mjs), taken here so the weight reading and
 * the picture come from the same page load rather than two runs that may have raced
 * different data.
 */
const PROBE = `(() => {
  const de = document.documentElement
  const vw = de.clientWidth

  const overflow = { scrollWidth: de.scrollWidth, layoutWidth: vw, culprits: [] }
  if (de.scrollWidth > vw + 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (r.right > vw + 1 || r.left < -1) {
        overflow.culprits.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          left: Math.round(r.left), right: Math.round(r.right),
          text: (el.textContent || '').trim().slice(0, 40),
        })
      }
      if (overflow.culprits.length >= 12) break
    }
  }

  const small = []
  for (const el of document.querySelectorAll('a[href], button, select, input:not([type=hidden]), [role=button], summary')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (getComputedStyle(el).visibility === 'hidden') continue
    if (r.height >= 43.5) continue
    small.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 50),
      h: Math.round(r.height * 10) / 10, w: Math.round(r.width),
      text: ((el.getAttribute('aria-label') || el.textContent || '').trim()).slice(0, 40),
    })
  }

  const side = document.querySelector('nav.side, .side, [data-nav], nav[aria-label]')
  const nav = side
    ? (() => {
        const cs = getComputedStyle(side)
        const r = side.getBoundingClientRect()
        return {
          found: true, display: cs.display, visibility: cs.visibility,
          w: Math.round(r.width), h: Math.round(r.height),
          links: [...side.querySelectorAll('a[href]')].map((a) => new URL(a.href).pathname),
        }
      })()
    : { found: false }

  // THE CAPTION TEXT PROBE. label TEXT vs the header TEXT of the column the cell sits in.
  // Counting labelled cells is the probe that stayed green through the exact bug this
  // exists to catch, so nothing here counts.
  const tables = []
  for (const table of document.querySelectorAll('table.data-table')) {
    const headings = [...table.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim())
    const rows = [...table.querySelectorAll('tbody tr')]
    const mismatches = []
    let labelled = 0
    for (const row of rows.slice(0, 40)) {
      const cells = [...row.children]
      cells.forEach((cell, i) => {
        const label = cell.getAttribute('data-label')
        if (label === null) return
        labelled++
        if (label !== headings[i]) mismatches.push({ i, label, header: headings[i] ?? '(no header at this index)' })
      })
      if (cells.length !== headings.length && headings.length > 0) {
        mismatches.push({ i: -1, label: 'ROW WIDTH ' + cells.length, header: 'HEAD WIDTH ' + headings.length })
      }
    }
    tables.push({
      cls: (table.className || '').toString(),
      caption: (table.querySelector('caption')?.textContent || '').trim().slice(0, 60),
      headings, rows: rows.length, labelled, mismatches: mismatches.slice(0, 8),
    })
  }

  // Card inside a card: does this element PAINT A SURFACE, and does its nearest
  // surface-painting ancestor paint one too? Overlays excluded — a drawer over a list is
  // the design.
  const CONTAINER = 'div, section, article, aside, ul, ol, details, form, fieldset'
  const paintsSurface = (el) => {
    if (!el.matches(CONTAINER)) return false
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const bg = cs.backgroundColor
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return false
    const radius = Number.parseFloat(cs.borderTopLeftRadius) || 0
    const bw = Number.parseFloat(cs.borderTopWidth) || 0
    if (radius < 4 && bw < 1 && (!cs.boxShadow || cs.boxShadow === 'none')) return false
    const r = el.getBoundingClientRect()
    return r.width > 200 && r.height > 60
  }
  const nested = []
  for (const el of [...document.querySelectorAll('main *')].filter(paintsSurface)) {
    if (el.closest('.drawer, .modal, dialog, table, .map-region, .map-info')) continue
    let outer = el.parentElement
    while (outer && !paintsSurface(outer)) outer = outer.parentElement
    if (!outer || outer.closest('.drawer, .modal, dialog, table, .map-region, .map-info')) continue
    nested.push({
      inner: el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 40),
      outer: outer.tagName.toLowerCase() + '.' + (outer.className || '').toString().slice(0, 40),
      sameBg: getComputedStyle(el).backgroundColor === getComputedStyle(outer).backgroundColor,
      text: (el.textContent || '').trim().slice(0, 40),
    })
    if (nested.length >= 10) break
  }

  return {
    theme: de.getAttribute('data-theme'),
    title: (document.querySelector('h1')?.textContent || '').trim(),
    question: (document.querySelector('h1')?.parentElement?.textContent || '').trim().slice(0, 200),
    // The three weight numbers, from demo/weight-probe.mjs — ONE definition, so the before
    // reading and the after reading cannot be taken with two different rulers.
    weight: ${WEIGHT},
    mapStatus: (document.querySelector('.map-region')?.innerText || '').trim().slice(0, 220) || null,
    pins: document.querySelectorAll('.map-pin').length,
    chips: [...document.querySelectorAll('.filter-chip, .chip, [class*=chip]')].map((c) => (c.innerText || '').trim().slice(0, 60)),
    overflow, small, nav, tables, nested,
  }
})()`;

async function signIn(page) {
  await page.goto(`${BASE}/login/`, { settle: 600 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, {
    timeout: 15000,
    label: "the sign-in button",
  });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { label: "dashboard after sign-in", timeout: 20000 });
  await sleep(800);
}

/** Bounded wait for a screen to have painted something other than a skeleton. */
async function settled(page, name, tag) {
  try {
    await page.waitFor(
      `document.querySelectorAll('table.data-table tbody tr, .row, .empty-state, form, .note, .list').length > 0`,
      { timeout: 10000, label: `${name} content` },
    );
  } catch {
    finding("warn", name, tag, "nothing rendered within 10s");
  }
  await sleep(600);
}

/** One capture + probe, recorded in the report. */
async function capture(page, name, tag, cfg, extra = {}) {
  const shot = await shoot(page, `${name}-${tag}.png`, { width: cfg.w });
  const i = report.shots.length;
  report.shots.push({ ...shot, screen: name, config: tag, ...extra });
  const probe = await page.eval(PROBE);
  report.shots[i].probe = probe;

  if (probe.theme !== cfg.theme) finding("fail", name, tag, `data-theme is "${probe.theme}", asked for "${cfg.theme}"`);
  if (probe.overflow.scrollWidth > probe.overflow.layoutWidth + 1) {
    finding("fail", name, tag,
      `horizontal scroll: ${probe.overflow.scrollWidth}px > ${probe.overflow.layoutWidth}px. ` +
        probe.overflow.culprits.map((c) => `<${c.tag} class="${c.cls}" right=${c.right} "${c.text}">`).join(" | "));
  }
  for (const t of probe.tables) {
    if (t.mismatches.length > 0) {
      finding("fail", name, tag,
        `card captions disagree with headers in "${t.cls}" (${t.caption}): ` +
          t.mismatches.map((m) => `cell[${m.i}] label="${m.label}" header="${m.header}"`).join(" | "));
    }
  }
  if (cfg.mobile && probe.small.length > 0) {
    finding("warn", name, tag,
      `${probe.small.length} control(s) under 44px: ` +
        probe.small.slice(0, 6).map((s) => `${s.tag}.${s.cls} ${s.h}px "${s.text}"`).join(" | "));
  }
  if (probe.nested.length > 0) {
    finding("warn", name, tag,
      `${probe.nested.length} surface(s) inside another surface: ` +
        probe.nested.slice(0, 5).map((n) => `${n.inner} in ${n.outer}${n.sameBg ? " (SAME bg — pure chrome)" : ""}`).join(" | "));
  }
  console.log(
    `  ${(`${name}-${tag}`).padEnd(42)} ${String(shot.contentH).padStart(6)}px  read=${String(probe.weight.read).padStart(3)}  boxes=${probe.weight.boxes}  h1="${probe.title}"`,
  );
  return probe;
}

// ---------------------------------------------------------------------------------------
// Seeded state. Every one of these EXISTS ONLY IF SOMETHING MAKES IT EXIST, which is the
// whole reason they are here: nobody photographs a state they have to create first.
// ---------------------------------------------------------------------------------------
const uuid = BASELINE ? null : sql("SELECT id FROM locations WHERE active AND lat IS NOT NULL ORDER BY name LIMIT 1");
const uuidUnpinned = BASELINE ? null : sql("SELECT id FROM locations WHERE active AND lat IS NULL ORDER BY name LIMIT 1");
const GHOST = "00000000-0000-4000-8000-000000000000";

/** [file suffix, url, what to do once it is loaded, which configs] */
const STATES = BASELINE
  ? []
  : [
      { name: "home-panel", url: `/?location=${uuid}`, note: "Objektpanel / pin info box, real building" },
      { name: "home-panel-ghost", url: `/?location=${GHOST}`, note: "well-formed uuid naming nothing" },
      { name: "home-panel-unpinned", url: `/?location=${uuidUnpinned}`, note: "building with no coordinates" },
      { name: "shifts-filtered", url: `/shifts/?location=${uuid}&period=all`, note: "one building, chip removable" },
      { name: "shifts-unresolved", url: "/shifts/?period=all&state=unresolved", note: "the triage filter" },
      { name: "worker-panel", url: "/workers/?worker=1", note: "worker as an object" },
      { name: "payroll-filtered", url: `/payroll/?location=${uuid}&period=thisYear`, note: "payroll scoped to a building" },
      { name: "pl-filtered", url: `/pl/?location=${uuid}&period=thisYear`, note: "margin scoped to a building" },
      { name: "analytics-filtered", url: `/analytics/?location=${uuid}`, note: "off-nav, reached with its filter" },
      { name: "contracts-filtered", url: `/contracts/?location=${uuid}`, note: "off-nav, reached with its filter" },
      { name: "materials-filtered", url: "/material-requests/?status=decide", note: "materials, one status" },
      { name: "locations-notag", url: "/locations/?state=noTag", note: "buildings with no tag" },
    ];

for (const [index, cfg] of CONFIGS.entries()) {
  const tag = `${cfg.w}-${cfg.theme}`;
  console.log(`\n=== ${tag} ===`);
  const { child, port } = await launchChrome({
    port: await freePort(9520 + index * 12),
    width: cfg.w,
    height: cfg.h,
  });
  const page = await attach(port);
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: cfg.w, height: cfg.h, deviceScaleFactor: 1, mobile: cfg.mobile,
    });
    await page.goto(`${BASE}/login/`, { settle: 300 });
    await page.eval(`localStorage.setItem('nfcts.theme', ${JSON.stringify(cfg.theme)})`);
    await signIn(page);

    // Guard: this script's screen list against the sidebar's own hrefs. The previous pass
    // silently skipped /payroll/ on a product that exists to pay people.
    const navHrefs = await page.eval(`[...document.querySelectorAll('nav a[href]')].map((a) => new URL(a.href).pathname)`);
    const missing = [...new Set(navHrefs)].filter((h) => !SCREENS.some((s) => s.path === h));
    if (missing.length > 0) throw new Error(`sidebar offers screens this script never shoots: ${missing.join(", ")}`);
    console.log(`  sidebar offers ${new Set(navHrefs).size} destination(s)`);

    for (const screen of SCREENS) {
      if (ONLY && !ONLY.has(screen.name)) continue;
      if (Date.now() - started > DEADLINE_MS) throw new Error("run deadline exceeded");
      await page.goto(`${BASE}${screen.path}`, { settle: 1500 });
      if (screen.name === "home" && !BASELINE) {
        // The map is asynchronous and billed per construction. Give it its own bounded
        // wait so the picture is of a settled map and not of a loading sentence.
        try {
          await page.waitFor(`document.querySelectorAll('.map-pin').length > 0 || /Kartenschlüssel|abgelehnt|erreichbar|Koordinaten/.test(document.querySelector('.map-region')?.innerText || '')`,
            { timeout: 20000, label: "the map settling" });
        } catch { finding("warn", "home", tag, "map region never settled within 20s"); }
        await sleep(2500);
      }
      await settled(page, screen.name, tag);
      if (hasMap(screen.name)) {
        report.shots.push({ ...(await shootViewport(page, `${screen.name}-${tag}-top.png`)), screen: screen.name, config: tag, top: true });
      }
      const shot = await capture(page, screen.name, tag, cfg);
      if (BOTTOM_SHOT.has(screen.name) && report.shots[report.shots.length - 1].clipped) {
        await page.eval("window.scrollTo(0, document.documentElement.scrollHeight)");
        await sleep(700);
        report.shots.push({ ...(await shootViewport(page, `${screen.name}-${tag}-bottom.png`)), screen: screen.name, config: tag, bottom: true });
        await page.eval("window.scrollTo(0, 0)");
        await sleep(200);
      }
      void shot;
    }

    // ---- seeded states -----------------------------------------------------------------
    for (const state of STATES) {
      if (ONLY && !ONLY.has(state.name)) continue;
      if (Date.now() - started > DEADLINE_MS) throw new Error("run deadline exceeded");
      await page.goto(`${BASE}${state.url}`, { settle: 1800 });
      if (state.name.startsWith("home-")) {
        try {
          await page.waitFor(`document.querySelectorAll('.map-pin').length > 0 || document.querySelector('.drawer') || /Kartenschlüssel|abgelehnt|erreichbar|Koordinaten/.test(document.querySelector('.map-region')?.innerText || '')`,
            { timeout: 20000, label: `${state.name} settling` });
        } catch { finding("warn", state.name, tag, "never settled within 20s"); }
        await sleep(2200);
      }
      await settled(page, state.name, tag);
      if (hasMap(state.name)) {
        report.shots.push({ ...(await shootViewport(page, `${state.name}-${tag}-top.png`)), screen: state.name, config: tag, top: true });
      }
      await capture(page, state.name, tag, cfg, { seeded: state.note, url: state.url });
      // An overlay is position:fixed; a full-page clip photographs the page UNDER it and
      // the drawer only where it happens to overlap the first viewport. So when one is
      // open, also take the viewport shot, which is what the director actually sees.
      if (await page.eval(`!!document.querySelector('.drawer, dialog[open], .map-info')`)) {
        report.shots.push({ ...(await shootViewport(page, `${state.name}-${tag}-overlay.png`)), screen: state.name, config: tag, overlay: true });
      }
    }

    // ---- the map's degraded states, on the DESKTOP dark run only ------------------------
    // Four of the seven are browser-side and are produced by breaking things for real:
    // Google's own gm_authFailure, and Chrome refusing the request the way an ad blocker,
    // a corporate proxy or an aeroplane does. Shooting them in all four configurations
    // would be twelve more near-identical pictures of a sentence.
    if (!BASELINE && !ONLY && cfg.w === 1680 && cfg.theme === "dark") {
      // gm_authFailure — fires AFTER new Map() succeeded, so what is on screen at that
      // moment is Google's grey box under Google's own alert. Covering it is not enough.
      await page.goto(`${BASE}/`, { settle: 2500 });
      try { await page.waitFor(`document.querySelectorAll('.map-pin').length > 0`, { timeout: 20000 }); } catch {}
      await sleep(1500);
      await page.eval("window.gm_authFailure && window.gm_authFailure()");
      await sleep(1500);
      await shootViewport(page, `home-map-blocked-${tag}-top.png`);
      await capture(page, "home-map-blocked", tag, cfg, { seeded: "gm_authFailure fired — key rejected or quota" });

      // The script blocked at the NETWORK layer.
      await page.send("Network.enable");
      await page.send("Network.setBlockedURLs", { urls: ["*maps.googleapis.com*"] });
      await page.goto(`${BASE}/`, { settle: 3000 });
      await sleep(3500);
      await shootViewport(page, `home-map-offline-${tag}-top.png`);
      await capture(page, "home-map-offline", tag, cfg, { seeded: "maps.googleapis.com blocked by the browser" });
      await page.send("Network.setBlockedURLs", { urls: [] });

      // No coordinates anywhere — production, today. Reverted below, in finally.
      // EVERY ROW, not only the pinned ones. The first version saved the five rows that had
      // coordinates, then set `geocode_status = 'no_key'` on ALL SIX — so the unpinned
      // building came back with `no_key` instead of the NULL that means „noch nie abgefragt",
      // and three of the four configurations were shot against a demo database that had been
      // quietly altered. demo/check-map-home.mjs's own teardown guard is what caught it.
      // NULL is encoded as the empty string and decoded back to NULL below.
      const savedCoords = sql(
        "SELECT coalesce(string_agg(id::text || '|' || coalesce(lat::text,'') || '|' || coalesce(lng::text,'') || '|' || coalesce(geocode_status,''), ';'), '') FROM locations",
      );
      try {
        sql("UPDATE locations SET lat = NULL, lng = NULL, geocode_status = 'no_key'");
        await page.goto(`${BASE}/`, { settle: 3000 });
        await sleep(2500);
        await shootViewport(page, `home-map-nopins-${tag}-top.png`);
        await capture(page, "home-map-nopins", tag, cfg, { seeded: "every coordinate NULL — production today" });

        // No active building at all — day zero, before anything is set up.
        // `id::text`. `string_agg` has no uuid overload, and the error it raises arrives
        // AFTER the coordinates have been NULLed — which is exactly why the restore is in a
        // `finally` and not at the end of the happy path. It fired here on the first run.
        const savedActive = sql("SELECT coalesce(string_agg(id::text, ';'), '') FROM locations WHERE active");
        try {
          sql("UPDATE locations SET active = false");
          await page.goto(`${BASE}/`, { settle: 3000 });
          await sleep(2000);
          await shootViewport(page, `home-empty-${tag}-top.png`);
          await capture(page, "home-empty", tag, cfg, { seeded: "no active building — day zero" });
        } finally {
          if (savedActive) sql(`UPDATE locations SET active = true WHERE id IN ('${savedActive.split(";").join("','")}')`);
        }
      } finally {
        for (const row of savedCoords.split(";").filter(Boolean)) {
          const [id, lat, lng, status] = row.split("|");
          sql(
            `UPDATE locations SET lat = ${lat === "" ? "NULL" : lat}, lng = ${lng === "" ? "NULL" : lng}, ` +
              `geocode_status = ${status === "" ? "NULL" : `'${status}'`} WHERE id = '${id}'`,
          );
        }
        const back = Number(sql("SELECT count(*) FROM locations WHERE lat IS NOT NULL"));
        console.log(`  restored coordinates on ${back} building(s)`);
        if (back === 0) finding("fail", "harness", tag, "coordinates were NOT restored — reseed nfc_demo before trusting anything");
      }
    }
  } finally {
    page.close();
    child.kill();
  }
}

writeFileSync(`${OUT}report.json`, `${JSON.stringify(report, null, 2)}\n`);
const fails = report.findings.filter((f) => f.severity === "fail").length;
const warns = report.findings.filter((f) => f.severity === "warn").length;
console.log(`\nshoot-ia: ${report.shots.length} images -> ${OUT}`);
console.log(`shoot-ia: ${fails} fail, ${warns} warn, report.json written. NOW LOOK AT THE IMAGES.`);
