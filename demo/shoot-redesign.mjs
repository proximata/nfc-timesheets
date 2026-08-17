// The VISUAL pass for the admin redesign: every screen, four configurations, LOOKED AT.
//
//   «stack»  (backlog/docs/DEMO.md §1 — seeded nfc_demo + the API serving web/out on :8082)
//   node demo/shoot-redesign.mjs                 # -> docs/media/redesign/*.png + report.json
//   node demo/shoot-redesign.mjs --only /shifts/  # one screen, all four configurations
//
// WHY THIS EXISTS AND WHY IT IS NOT A TEST. The lesson this repo paid for twice is that a
// layout assertion is nearly worthless: every automated check stayed GREEN while phone cards
// were captioned with the WRONG column, because the checks counted labelled cells instead of
// reading them. So this script does two separate things and keeps them separate:
//
//   1. it CAPTURES, so a human (or an agent with eyes) can look — that is the real verdict;
//   2. it MEASURES only the handful of things a screenshot genuinely cannot show:
//      horizontal overflow, control heights in CSS px, whether the sidebar was deleted at
//      390px, and the CAPTION TEXT PROBE (label text vs header text, never a count).
//
// It asserts nothing and exits 0 unless the harness itself broke. Findings go to
// docs/media/redesign/report.json and to stdout, and the images are the evidence.
//
// Bounded by construction: every wait has a timeout, and the whole run has a deadline. A
// check that blocks forever is not a slow check, it is a check that cannot fail and looks
// exactly like progress.
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

/**
 * A debugging port nothing else is already answering on.
 *
 * `launchChrome` polls `/json/version` until something replies, so if a Chrome from an
 * earlier run is still holding the port, the poll succeeds against THAT browser, the new
 * Chrome dies unable to bind, and this script drives a stranger's profile. The symptom was
 * `no clickable element containing: Anmelden` on a login page that demonstrably had the
 * button — because the page being driven was not the login page at all. Measured, not
 * theorised; it cost twenty minutes.
 */
async function freePort(from) {
  for (let port = from; port < from + 60; port++) {
    const ok = await new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error(`no free debugging port in ${from}..${from + 60}`);
}

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8082";
// SHOOT_OUT lets the same script shoot the PREVIOUS commit out of a git worktree into a
// different directory, which is the only honest way to compare weight: two pictures, not a
// picture and a memory of one.
const OUT = process.env.SHOOT_OUT
  ? `${process.env.SHOOT_OUT.replace(/\/?$/, "/")}`
  : new URL("../docs/media/redesign/", import.meta.url).pathname;
const DEADLINE_MS = 12 * 60 * 1000;
const started = Date.now();

// Never the live server. A hostname check, not a comment.
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`shoot-redesign: refusing to shoot "${host}" — loopback only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

const only = (() => {
  const i = process.argv.indexOf("--only");
  return i === -1 ? null : process.argv[i + 1];
})();

/**
 * Every screen the sidebar offers, plus the two that have no sidebar. Kept in step with
 * lib/nav.ts by reading the nav OUT OF THE PAGE at 1680px and refusing to continue if this
 * list is missing one — the same guard record-admin.mjs uses, for the same reason: the
 * previous pass silently skipped /payroll/ on a product that exists to pay people.
 */
const SCREENS = [
  { path: "/", name: "dashboard" },
  { path: "/shifts/", name: "shifts" },
  { path: "/material-requests/", name: "material-requests" },
  { path: "/workers/", name: "workers" },
  { path: "/locations/", name: "locations" },
  { path: "/clients/", name: "clients" },
  { path: "/contracts/", name: "contracts" },
  { path: "/inventory/", name: "inventory" },
  { path: "/payroll/", name: "payroll" },
  { path: "/pl/", name: "pl" },
  { path: "/analytics/", name: "analytics" },
  { path: "/account/", name: "account" },
  { path: "/login/", name: "login", noShell: true },
  { path: "/reinigung/", name: "portal", noShell: true },
];

const CONFIGS = [
  { w: 1680, h: 1000, theme: "dark", mobile: false },
  { w: 1680, h: 1000, theme: "light", mobile: false },
  { w: 390, h: 844, theme: "dark", mobile: true },
  { w: 390, h: 844, theme: "light", mobile: true },
];

/**
 * Tall screens are clipped. 341 seeded shifts make a 20 000px image that nothing can read,
 * and the question being answered ("does the eye land on the answer?") is answered in the
 * first screens-worth anyway. Screens whose TRUTH lives at the bottom — a tfoot totals row,
 * payroll's reconciliation line — additionally get a `-bottom` shot, listed below.
 */
const MAX_H = 3600;
const BOTTOM_SHOT = new Set(["payroll", "pl", "analytics", "shifts", "inventory"]);

mkdirSync(OUT, { recursive: true });

const report = { base: BASE, at: new Date().toISOString(), shots: [], findings: [] };
const finding = (severity, screen, config, text) => {
  report.findings.push({ severity, screen, config, text });
  console.log(`  ${severity === "fail" ? "FAIL" : severity === "warn" ? "warn" : "note"}  ${screen} ${config}  ${text}`);
};

/** Full-page PNG, clipped to MAX_H, at deviceScaleFactor 1 so the file is readable as-is. */
async function shoot(page, file, { width, full = true, height = null }) {
  const metrics = await page.send("Page.getLayoutMetrics");
  const contentH = Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height);
  const clipH = height ?? (full ? Math.min(contentH, MAX_H) : null);
  const params = { format: "png" };
  if (clipH) {
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width, height: clipH, scale: 1 };
  }
  const { data } = await page.send("Page.captureScreenshot", params);
  writeFileSync(`${OUT}${file}`, Buffer.from(data, "base64"));
  return { file, contentH, clipped: clipH !== null && clipH < contentH };
}

/**
 * The measurements a screenshot cannot make. All of it runs in the page and returns plain
 * data; the interesting one is `captions`, which compares the label TEXT a card prints
 * against the header TEXT it claims to be. Counting is the probe that stayed green through
 * this exact bug, so counting is not done here at all.
 */
const PROBE = `(() => {
  const de = document.documentElement
  // NOT window.innerWidth. Under CDP device-metrics emulation with mobile:true, an element
  // wider than the viewport makes innerWidth GROW to match it (measured: a 900px div on a
  // 390px screen reported innerWidth 900), so scrollWidth > innerWidth is a comparison
  // that can never be true and the probe reported "no horizontal scroll" for 14 screens
  // without ever being able to say anything else. documentElement.clientWidth and
  // visualViewport.width both stay at 390 and are therefore the honest layout width.
  const vw = de.clientWidth

  // 1. Horizontal overflow, and WHO caused it. scrollWidth alone names no culprit, and
  //    "the page scrolls sideways" with no element to blame is an unactionable finding.
  const overflow = { scrollWidth: de.scrollWidth, layoutWidth: vw, innerWidth: window.innerWidth, culprits: [] }
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

  // 2. Touch targets. 44px is the floor; measured in CSS px on the rendered box, not read
  //    off a stylesheet, because padding and line-height decide this and not min-height.
  const small = []
  for (const el of document.querySelectorAll('a[href], button, select, input:not([type=hidden]), [role=button], summary')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue          // genuinely hidden
    if (getComputedStyle(el).visibility === 'hidden') continue
    if (r.height >= 43.5) continue
    small.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 50),
      h: Math.round(r.height * 10) / 10,
      w: Math.round(r.width),
      text: ((el.getAttribute('aria-label') || el.textContent || '').trim()).slice(0, 40),
    })
  }

  // 3. Is the sidebar still THERE and reachable? Owner answer Q5: the prototype's
  //    display:none under 860px is a prototype artefact. Deleting navigation on a phone
  //    regresses the screen the owner uses standing in a building.
  const side = document.querySelector('nav.side, .side, [data-nav], nav[aria-label]')
  const nav = side
    ? (() => {
        const cs = getComputedStyle(side)
        const r = side.getBoundingClientRect()
        return {
          found: true, tag: side.tagName.toLowerCase(),
          cls: (side.className || '').toString(),
          display: cs.display, visibility: cs.visibility,
          overflowX: cs.overflowX,
          w: Math.round(r.width), h: Math.round(r.height),
          top: Math.round(r.top),
          links: side.querySelectorAll('a[href]').length,
          scrollable: side.scrollWidth > side.clientWidth + 1,
        }
      })()
    : { found: false }

  // 4. THE CAPTION TEXT PROBE. For every table, for every body row, for every cell that
  //    printed a data-label, does that label TEXT equal the header TEXT of the column the
  //    cell actually sits in? Mismatches are listed with both strings so the report says
  //    what it saw rather than a number.
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
        if (label !== headings[i]) {
          mismatches.push({ i, label, header: headings[i] ?? '(no header at this index)' })
        }
      })
      // Structural precondition for the whole mechanism: a row with a different number of
      // cells than the head has columns is how every card ends up one column off.
      if (cells.length !== headings.length && headings.length > 0) {
        mismatches.push({ i: -1, label: 'ROW WIDTH ' + cells.length, header: 'HEAD WIDTH ' + headings.length })
      }
    }
    tables.push({
      caption: (table.querySelector('caption')?.textContent || '').trim().slice(0, 60),
      headings, rows: rows.length, labelled, mismatches: mismatches.slice(0, 8),
      hasTfoot: !!table.querySelector('tfoot'),
    })
  }

  // 5. THE OWNER'S ACTUAL COMPLAINT: "two white containers making me read a whole screen".
  //    Expressed as a CLASS list this probe is worthless — it would only ever find the class
  //    names that happen to be in fashion this week, and .page-summary/.answer-band are
  //    already gone. So it asks the question the eye asks: does this element PAINT A SURFACE
  //    (its own background, plus a border or a corner radius), and does its nearest
  //    surface-painting ancestor paint one too? That is a card inside a card, whatever it is
  //    called. Overlays are excluded: a drawer sitting over a list is the design.
  // A CONTAINER, not a control: an <input> has its own background and border by definition
  //    and is not a card. Neither is a phone card produced by the row-to-card transform —
  //    that IS the design. Both were noise in the first version of this probe.
  const CONTAINER = 'div, section, article, aside, ul, ol, details, form, fieldset'
  const paintsSurface = (el) => {
    if (!el.matches(CONTAINER)) return false
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const bg = cs.backgroundColor
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return false
    const radius = Number.parseFloat(cs.borderTopLeftRadius) || 0
    const bw = Number.parseFloat(cs.borderTopWidth) || 0
    const shadow = cs.boxShadow && cs.boxShadow !== 'none'
    if (radius < 4 && bw < 1 && !shadow) return false
    const r = el.getBoundingClientRect()
    return r.width > 200 && r.height > 60
  }
  const nested = []
  const surfaces = [...document.querySelectorAll('main *')].filter(paintsSurface)
  for (const el of surfaces) {
    if (el.closest('.drawer, .modal, dialog, table')) continue
    let outer = el.parentElement
    while (outer && !paintsSurface(outer)) outer = outer.parentElement
    if (!outer || outer.closest('.drawer, .modal, dialog, table')) continue
    const inBg = getComputedStyle(el).backgroundColor
    const outBg = getComputedStyle(outer).backgroundColor
    nested.push({
      inner: el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 40),
      outer: outer.tagName.toLowerCase() + '.' + (outer.className || '').toString().slice(0, 40),
      sameBg: inBg === outBg,
      bg: inBg + ' in ' + outBg,
      text: (el.textContent || '').trim().slice(0, 40),
    })
    if (nested.length >= 10) break
  }

  return {
    theme: de.getAttribute('data-theme'),
    title: (document.querySelector('h1')?.textContent || '').trim(),
    question: (document.querySelector('h1')?.parentElement?.textContent || '').trim().slice(0, 160),
    overflow, small, nav, tables, nested,
    liveRegions: document.querySelectorAll('[aria-live]').length,
  }
})()`;

async function signIn(page) {
  await page.goto(`${BASE}/login/`, { settle: 600 });
  // Wait for the control rather than for a duration. A fixed settle was enough on one run
  // and not on the next, and "no clickable element containing: Anmelden" is a confusing way
  // to be told the page had not finished hydrating.
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

for (const [index, cfg] of CONFIGS.entries()) {
  const tag = `${cfg.w}-${cfg.theme}`;
  console.log(`\n=== ${tag} ===`);
  // One port AND one throwaway profile per configuration. Deriving the port from the width
  // gave the two 1680px runs the same profile directory, and the second one tried to delete
  // a directory the first Chrome had not finished releasing.
  const { child, port } = await launchChrome({
    port: await freePort(9420 + index * 10),
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

    // The theme is a stored preference read by an inline script before first paint, so it
    // has to be written to localStorage on the origin and the page reloaded. Explicit
    // 'dark'/'light', never 'system': the OS preference of the machine running this is not
    // part of the specification.
    await page.goto(`${BASE}/login/`, { settle: 300 });
    await page.eval(`localStorage.setItem('nfcts.theme', ${JSON.stringify(cfg.theme)})`);

    await signIn(page);

    // Guard: this script's screen list against the sidebar's own hrefs.
    const navHrefs = await page.eval(
      `[...document.querySelectorAll('nav a[href]')].map((a) => new URL(a.href).pathname)`,
    );
    const missing = [...new Set(navHrefs)].filter((h) => !SCREENS.some((s) => s.path === h));
    if (missing.length > 0) throw new Error(`sidebar offers screens this script never shoots: ${missing.join(", ")}`);

    for (const screen of SCREENS) {
      if (only && screen.path !== only) continue;
      if (Date.now() - started > DEADLINE_MS) throw new Error("run deadline exceeded");

      await page.goto(`${BASE}${screen.path}`, { settle: 1500 });
      // One bounded wait for the fetch to have produced something other than a skeleton.
      try {
        await page.waitFor(
          `document.querySelectorAll('table.data-table tbody tr, .row, .empty-state, form, .note').length > 0`,
          { timeout: 8000, label: `${screen.name} content` },
        );
      } catch {
        finding("warn", screen.name, tag, "no table row / row / empty-state / form appeared within 8s");
      }
      await sleep(500);

      const shot = await shoot(page, `${screen.name}-${tag}.png`, { width: cfg.w });
      report.shots.push({ ...shot, screen: screen.name, config: tag });
      // Remember WHERE the main shot landed. The probe used to be attached to
      // `shots[length - 1]`, which for the five screens that also get a `-bottom` image was
      // the bottom entry -- so /shifts/ appeared in report.json with title `undefined` and no
      // question line, on a screen that plainly has both.
      const mainShotIndex = report.shots.length - 1;
      if (shot.clipped) {
        finding("note", screen.name, tag, `page is ${shot.contentH}px tall; image clipped at ${MAX_H}px`);
      }

      if (BOTTOM_SHOT.has(screen.name) && shot.clipped) {
        await page.eval("window.scrollTo(0, document.documentElement.scrollHeight)");
        await sleep(600);
        const { data } = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${OUT}${screen.name}-${tag}-bottom.png`, Buffer.from(data, "base64"));
        report.shots.push({ file: `${screen.name}-${tag}-bottom.png`, screen: screen.name, config: tag, bottom: true });
        await page.eval("window.scrollTo(0, 0)");
        await sleep(200);
      }

      const probe = await page.eval(PROBE);
      report.shots[mainShotIndex].probe = probe;

      // ---- the four things a screenshot cannot say ----
      if (probe.theme !== cfg.theme) {
        finding("fail", screen.name, tag, `data-theme is "${probe.theme}", asked for "${cfg.theme}"`);
      }
      if (probe.overflow.scrollWidth > probe.overflow.layoutWidth + 1) {
        finding(
          "fail",
          screen.name,
          tag,
          `horizontal scroll: ${probe.overflow.scrollWidth}px > ${probe.overflow.layoutWidth}px. ` +
            probe.overflow.culprits.map((c) => `<${c.tag} class="${c.cls}" right=${c.right} "${c.text}">`).join(" | "),
        );
      }
      for (const t of probe.tables) {
        if (t.mismatches.length > 0) {
          finding(
            "fail",
            screen.name,
            tag,
            `card captions disagree with headers in table "${t.caption}": ` +
              t.mismatches.map((m) => `cell[${m.i}] label="${m.label}" header="${m.header}"`).join(" | "),
          );
        }
      }
      if (cfg.mobile && !screen.noShell) {
        // /login/ and /reinigung/ are rendered WITHOUT the admin shell on purpose, so "no
        // nav here" is the specification and not a finding.
        if (!probe.nav.found) {
          finding("fail", screen.name, tag, "no nav element found at 390px");
        } else if (probe.nav.display === "none" || probe.nav.visibility === "hidden") {
          finding("fail", screen.name, tag, `sidebar is ${probe.nav.display}/${probe.nav.visibility} at 390px (owner answer Q5 forbids this)`);
        }
        if (probe.small.length > 0) {
          finding(
            "warn",
            screen.name,
            tag,
            `${probe.small.length} control(s) under 44px: ` +
              probe.small.slice(0, 6).map((s) => `${s.tag}.${s.cls} ${s.h}px "${s.text}"`).join(" | "),
          );
        }
      }
      if (probe.nested.length > 0) {
        finding(
          "warn",
          screen.name,
          tag,
          `${probe.nested.length} surface(s) painted inside another surface: ` +
            probe.nested
              .slice(0, 5)
              .map((n) => `${n.inner} inside ${n.outer}${n.sameBg ? " (SAME background \u2014 pure chrome)" : ""}`)
              .join(" | "),
        );
      }
      if (!screen.noShell && !probe.question) {
        finding("warn", screen.name, tag, "no question line under the h1");
      }
      console.log(`  shot ${screen.name}-${tag}.png  ${shot.contentH}px  h1="${probe.title}"`);
    }
  } finally {
    page.close();
    child.kill();
  }
}

writeFileSync(`${OUT}report.json`, `${JSON.stringify(report, null, 2)}\n`);
const fails = report.findings.filter((f) => f.severity === "fail").length;
const warns = report.findings.filter((f) => f.severity === "warn").length;
console.log(`\nshoot-redesign: ${report.shots.length} images -> ${OUT}`);
console.log(`shoot-redesign: ${fails} fail, ${warns} warn, report.json written. NOW LOOK AT THE IMAGES.`);
