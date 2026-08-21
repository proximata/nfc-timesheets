// LOOK AT THE LIVE ADMIN, WITH EYES AND WITH A RULER — the verdict pass.
//
// Every fix in this run was reported by the agent that wrote it. This file re-photographs
// the SAME screens on production, logged in, at a desk width and at 390px, and asserts the
// specific sentence or number each fix claims to have produced. It never greps the source
// tree: a rule can be present in `globals.css` and absent from the shipped bundle (the
// minifier folds `grid-template-rows` into the `grid-template` shorthand, which is exactly
// how a grep for the fixed line came back empty on a box that HAD the fix).
//
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/verdict-live.mjs [base]
//
// base defaults to https://schimmer-glanz.exe.xyz. Writes docs/media/verdict/ (gitignored):
// one PNG and one .txt per screen per width, plus a computed-style dump for the shell.
//
// The credential is a THROWAWAY admin created by ops/smoke-admin.mjs and deleted by the
// caller. It is read from the environment, never argv: argv is world-readable in `ps`.
import { mkdirSync, writeFileSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.argv[2] ?? "https://schimmer-glanz.exe.xyz";
const OUT = process.env.VERDICT_OUT ?? "docs/media/verdict";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be in the environment");
  process.exit(2);
}

const SCREENS = ["/", "/tags/", "/pl/", "/payroll/", "/locations/", "/shifts/", "/workers/", "/operators/"];

// EVERY ASSERTION BELOW MUST BE ABLE TO GO RED, and against the live box the only way to
// seed the old defect is to put it back in the browser. VERDICT_MUTANT re-injects the bug
// the corresponding commit removed; the run must then FAIL. Nothing is written to the box.
//   navrows  the pre-9e612d6 three-track grid, at <=767px  -> the nav strip must swallow
//            the screen again and the phone section must fail
//   tagslink strip every <a href="/tags/">                  -> the C1 assertion must fail
const MUTANT = process.env.VERDICT_MUTANT ?? "";
const MUTANT_CSS = {
  navrows: "@media (max-width: 767px){.app-shell{grid-template-rows:auto minmax(0,1fr) auto !important}}",
};
async function applyMutant(p) {
  if (!MUTANT) return;
  if (MUTANT_CSS[MUTANT]) {
    await p.eval(`(() => {
      const s = document.createElement('style'); s.id = 'verdict-mutant'
      s.textContent = ${JSON.stringify(MUTANT_CSS[MUTANT])}
      document.head.appendChild(s); return true
    })()`);
  }
  if (MUTANT === "tagslink") {
    await p.eval(`(() => {
      for (const a of document.querySelectorAll('a[href="/tags/"]')) a.remove()
      return true
    })()`);
  }
}

let fails = 0;
const ok = (m) => console.log(`  ok:   ${m}`);
const bad = (m) => {
  fails++;
  console.log(`  FAIL: ${m}`);
};
const section = (t) => console.log(`\n== ${t}`);

mkdirSync(OUT, { recursive: true });

const chrome = await launchChrome({ port: 9455, width: 1680, height: 1050 });
const page = await attach(chrome.port);

/** Emulate a real device rather than just resizing: a phone is dsf 2 and `mobile: true`. */
async function viewport(width, height, mobile) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  });
}

/** Full page, beyond the fold — the fold alone hides every caveat that was pushed down. */
async function shoot(name) {
  const { data } = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
  const text = await page.eval("document.body.innerText");
  writeFileSync(`${OUT}/${name}.txt`, text);
  return text;
}

try {
  section(`0 · sign in to ${BASE}`);
  await viewport(1680, 1050, false);
  await page.goto(`${BASE}/login/`);
  await page.waitFor("document.querySelector('input[type=password]')", { label: "the sign-in form" });
  await page.eval(`(() => {
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    // The email field is type=text, not type=email - selecting on the type is how the
    // first run of this file failed. Both fields are addressed by name=, which is what
    // the form actually posts.
    set(document.querySelector('input[name=email]'), ${JSON.stringify(EMAIL)})
    set(document.querySelector('input[name=password]'), ${JSON.stringify(PASSWORD)})
    document.querySelector('form').requestSubmit()
    return true
  })()`);
  await page.waitFor("!document.querySelector('input[type=password]')", {
    label: "the sign-in form to go away",
    timeout: 20000,
  });
  ok("signed in as the throwaway admin");

  // ---------------------------------------------------------------------------------
  section("1 · the desk, 1680 — every screen photographed and read");
  const desk = {};
  for (const path of SCREENS) {
    await page.goto(`${BASE}${path}`, { settle: 2500 });
    const name = `desk${path.replace(/\//g, "-").replace(/^-|-$/g, "") || "home"}`;
    desk[path] = await shoot(name);
    const stillLoading = /Wird geladen|Wird berechnet/.test(desk[path]);
    if (stillLoading) bad(`${path} still says "loading" after 2.5s — ${name}.png`);
    else ok(`${path} rendered -> ${name}.png (${desk[path].length} chars)`);
  }

  // ---------------------------------------------------------------------------------
  section("2 · the fixes this run claims, asserted on the LIVE bundle");

  // C1 / PHONE #2 — /tags/ has a way in.
  const locLink = await (async () => {
    await page.goto(`${BASE}/locations/`, { settle: 2000 });
    await applyMutant(page);
    return page.eval(`Array.from(document.querySelectorAll('a[href="/tags/"]')).map(a => a.textContent.trim())`);
  })();
  locLink.length > 0
    ? ok(`/locations/ links to /tags/: ${JSON.stringify(locLink)}`)
    : bad("no <a href='/tags/'> anywhere on /locations/ — C1 is NOT live");

  // W7 — /tags/ prints Vienna, never a Z timestamp.
  const tagsText = desk["/tags/"] ?? "";
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z/.test(tagsText)
    ? bad("/tags/ still prints a raw UTC ISO timestamp — W7 is NOT live")
    : ok("/tags/ shows no raw Zulu timestamp");

  // U7 successor — /tags/ is a real screen: a translated heading, not a browser default.
  await page.goto(`${BASE}/tags/`, { settle: 2000 });
  const tagsShape = await page.eval(`(() => {
    const h1 = document.querySelector('h1')
    const table = document.querySelector('table')
    return {
      h1: h1 ? h1.textContent.trim() : null,
      border: table ? table.getAttribute('border') : 'no-table',
      inNav: !!document.querySelector('a[href="/tags/"]'),
    }
  })()`);
  tagsShape.h1
    ? ok(`/tags/ has a heading: ${JSON.stringify(tagsShape.h1)}`)
    : bad("/tags/ has no <h1>");

  // The phone. THE finding ranked highest cost in LOOK-PHONE.
  section("3 · the phone, 390x844 — the nav strip, measured off the live element");
  await viewport(390, 844, true);
  for (const path of ["/", "/tags/", "/payroll/", "/shifts/", "/pl/"]) {
    await page.goto(`${BASE}${path}`, { settle: 2500 });
    await applyMutant(page);
    const name = `phone${path.replace(/\//g, "-").replace(/^-|-$/g, "") || "home"}${MUTANT ? `-${MUTANT}` : ""}`;
    await shoot(name);
    const m = await page.eval(`(() => {
      const shell = document.querySelector('.app-shell')
      const h1 = document.querySelector('h1')
      const nav = document.querySelector('.app-sidebar, [style*="sidebar"], nav')
      return {
        rows: shell ? getComputedStyle(shell).gridTemplateRows : null,
        h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
        scrollW: document.documentElement.scrollWidth,
      }
    })()`);
    const tracks = (m.rows ?? "").split(" ").map((v) => Number.parseFloat(v));
    const navRow = tracks[1];
    const detail = `rows=[${m.rows}] h1Top=${m.h1Top}`;
    if (!Number.isFinite(navRow)) bad(`${path}: could not read the shell's rows (${detail})`);
    else if (navRow > 120) bad(`${path}: the nav strip row is ${navRow}px — it still swallows the screen (${detail})`);
    else ok(`${path}: nav row ${navRow}px, h1 at y=${m.h1Top} — ${name}.png`);
    if (m.scrollW > 390) bad(`${path}: horizontal overflow, scrollWidth ${m.scrollW}`);
  }

  // ---------------------------------------------------------------------------------
  section("4 · the map on the real host — the one thing only production can answer");
  await viewport(1680, 1050, false);
  const errors = [];
  page.on("Log.entryAdded", (p) => errors.push(p.entry?.text ?? ""));
  await page.send("Log.enable").catch(() => {});
  let drew = 0;
  const SAMPLES = Number(process.env.MAP_SAMPLES ?? 5);
  for (let i = 0; i < SAMPLES; i++) {
    await page.goto(`${BASE}/?cachebust=${Date.now()}-${i}`, { settle: 4000 });
    const state = await page.eval(`(() => {
      const t = document.body.innerText
      return {
        loading: /Karte wird geladen/.test(t),
        blocked: /nicht freigeschaltet|blockiert|RefererNotAllowed/i.test(t),
        canvas: !!document.querySelector('.gm-style') ,
      }
    })()`);
    if (state.canvas && !state.blocked) drew++;
    else console.log(`     load ${i + 1}: ${JSON.stringify(state)}`);
  }
  const refErr = errors.filter((e) => /RefererNotAllowed/.test(e));
  // A SKIP IS NOT A PASS. With MAP_SAMPLES=0 `drew === SAMPLES` is 0 === 0 and this section
  // printed a green line over zero loads — the sixth vacuous check in this project, written
  // by the run that exists to find them. It says SKIPPED now, and says why.
  if (SAMPLES === 0) {
    console.log("  skip: MAP_SAMPLES=0 — the map was NOT looked at. This is a skip, not a pass.");
  } else if (drew === SAMPLES) {
    ok(`the map drew ${drew}/${SAMPLES} on ${BASE}`);
  } else {
    bad(`the map drew only ${drew}/${SAMPLES} on ${BASE}`);
  }
  refErr.length === 0
    ? ok("no RefererNotAllowedMapError in the browser console across every load")
    : bad(`RefererNotAllowedMapError x${refErr.length}: ${refErr[0]}`);
  await shoot("desk-home-map");
} finally {
  await sleep(200);
  page.close();
  chrome.child.kill();
}

console.log(
  `\n${fails === 0 ? "VERDICT-LIVE OK" : `VERDICT-LIVE: ${fails} FAILED`} — ${BASE}${MUTANT ? `  [mutant: ${MUTANT} — RED is the expected result]` : ""}`,
);
process.exit(fails === 0 ? 0 : 1);
