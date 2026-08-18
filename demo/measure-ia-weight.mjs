// BEFORE and AFTER on the same tape measure, in one run, in one browser.
//
//   # after  : the working tree, built with the Maps key, served on :8080
//   # before : a git worktree of the pre-IA commit, built, served on :8083
//   node demo/measure-ia-weight.mjs
//   BEFORE_BASE=http://127.0.0.1:8083 AFTER_BASE=http://127.0.0.1:8080 node demo/measure-ia-weight.mjs
//
// WHY IT IS ONE RUN AND NOT TWO. The previous pass measured before and after in two
// separate invocations and compared the numbers afterwards. That is fine right up until
// something differs between the invocations that nobody wrote down — a different Chrome
// window size, a reseeded database, a screen that had not finished fetching. Here both
// origins are driven by the SAME browser, at the SAME viewport, against the SAME database,
// seconds apart, with the walker imported from demo/weight-probe.mjs so there is literally
// one copy of it.
//
// It prints a table and exits 0. It is a tape measure, not a gate: LIGHTER/SAME/HEAVIER is
// a judgement about a product, and a judgement does not belong in an exit code.
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { attach, launchChrome, sleep } from "./cdp.mjs";
import { WEIGHT } from "./weight-probe.mjs";

const BEFORE = process.env.BEFORE_BASE ?? "http://127.0.0.1:8083";
const AFTER = process.env.AFTER_BASE ?? "http://127.0.0.1:8080";
for (const base of [BEFORE, AFTER]) {
  const host = new URL(base).hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
    console.error(`measure-ia-weight: refusing to drive "${host}" — loopback only.`);
    process.exit(1);
  }
}
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const OUT = process.env.WEIGHT_OUT ?? new URL("../docs/media/ia/weight.json", import.meta.url).pathname;

/** Every route both trees have. The three off-nav ones were in the sidebar before. */
const SCREENS = [
  ["home", "/"],
  ["shifts", "/shifts/"],
  ["material-requests", "/material-requests/"],
  ["workers", "/workers/"],
  ["locations", "/locations/"],
  ["clients", "/clients/"],
  ["contracts", "/contracts/"],
  ["inventory", "/inventory/"],
  ["payroll", "/payroll/"],
  ["pl", "/pl/"],
  ["analytics", "/analytics/"],
  ["account", "/account/"],
];

const VIEWPORTS = [
  { w: 1680, h: 1000, mobile: false },
  { w: 390, h: 844, mobile: true },
];

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

const { child, port } = await launchChrome({ port: await freePort(9640), width: 1680, height: 1000 });
const page = await attach(port);
const kill = setTimeout(() => {
  console.error("measure-ia-weight: DEADLINE");
  child.kill("SIGKILL");
  process.exit(3);
}, 12 * 60 * 1000);

async function signIn(base) {
  await page.goto(`${base}/login/`, { settle: 500 });
  await page.eval(`localStorage.setItem('nfcts.theme', 'dark')`);
  await page.goto(`${base}/login/`, { settle: 700 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { timeout: 15000 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 20000 });
  await sleep(700);
}

/** One origin, one viewport, every screen. */
async function measure(base, cfg) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: cfg.w, height: cfg.h, deviceScaleFactor: 1, mobile: cfg.mobile,
  });
  await signIn(base);
  const out = {};
  for (const [name, path] of SCREENS) {
    await page.goto(`${base}${path}`, { settle: 1600 });
    try {
      await page.waitFor(`document.querySelectorAll('table.data-table tbody tr, .row, .empty-state, form, .list').length > 0`,
        { timeout: 10000, label: `${name} content` });
    } catch {}
    // The map is asynchronous AND it changes the page height, so a reading taken before it
    // has drawn understates the one screen the whole comparison is about.
    if (name === "home") {
      try {
        await page.waitFor(`!document.querySelector('.map-region') || document.querySelectorAll('.map-pin').length > 0 || /Kartenschl|abgelehnt|erreichbar|Koordinaten/.test(document.querySelector('.map-region').innerText)`,
          { timeout: 20000, label: "the map settling" });
      } catch {}
      await sleep(2500);
    }
    await sleep(400);
    out[name] = await page.eval(WEIGHT);
  }
  return out;
}

const result = { at: new Date().toISOString(), before: BEFORE, after: AFTER, viewports: {} };
try {
  for (const cfg of VIEWPORTS) {
    const tag = `${cfg.w}`;
    console.log(`\n=== ${tag}px ===`);
    const before = await measure(BEFORE, cfg);
    const after = await measure(AFTER, cfg);
    result.viewports[tag] = { before, after };
    console.log(
      `${"screen".padEnd(19)}${"px before".padStart(10)}${"after".padStart(8)}${"delta".padStart(9)}   read      boxes    verdict`,
    );
    for (const [name] of SCREENS) {
      const b = before[name];
      const a = after[name];
      const pct = Math.round(((a.px - b.px) / b.px) * 1000) / 10;
      // 3% is the band inside which a height difference is a rounding of the same layout,
      // not a change anybody would feel. Named here rather than left as a magic number.
      const verdict = Math.abs(pct) < 3 ? "SAME" : pct < 0 ? "LIGHTER" : "HEAVIER";
      console.log(
        name.padEnd(19) +
          String(b.px).padStart(10) +
          String(a.px).padStart(8) +
          `${pct > 0 ? "+" : ""}${pct}%`.padStart(9) +
          `   ${b.read}→${a.read}`.padEnd(10) +
          `${b.boxes}→${a.boxes}`.padEnd(9) +
          verdict,
      );
    }
  }
} finally {
  clearTimeout(kill);
  page.close();
  child.kill("SIGKILL");
}
writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nmeasure-ia-weight: written to ${OUT}`);
