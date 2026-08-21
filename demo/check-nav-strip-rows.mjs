// LOOK-PHONE.md #1 — THE FINDING RANKED HIGHEST COST: at <=767px `.app-shell` redeclares
// `grid-template-areas` with FOUR rows (header / sidebar+tools / content / footer) but, until
// this check existed, never redeclared `grid-template-rows` to match. The desktop rule's
// three explicit tracks (`auto minmax(0,1fr) auto`) still applied in order to the new
// four-row layout: header=auto, the NAV STRIP=minmax(0,1fr) — the flexible track meant for
// content — content=auto (the fourth row, implicit, `grid-auto-rows: auto`), footer=auto.
// The nav strip grew to fill the screen; content shrank to its own height and was pushed
// toward the bottom, which reads as a blank or near-blank page on every phone load.
//
//   DEMO_BASE=http://127.0.0.1:8092 node demo/check-nav-strip-rows.mjs
//
// Pure layout geometry — no seeding, no database, works against whatever nfc_demo holds.
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8092";
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-nav-strip-rows: refusing "${host}" — loopback only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

let failures = 0;
const assert = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
};

async function setViewport(page, width, height) {
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  const actual = await page.eval("window.innerWidth");
  if (actual !== width) throw new Error(`viewport override did not take: asked for ${width}px, got ${actual}px`);
}

async function main() {
  const { child, port } = await launchChrome({ port: 9720 + (process.pid % 200), width: 390, height: 844 });
  const page = await attach(port);
  try {
    await page.goto(`${BASE}/login/`, { settle: 700 });
    await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: "sign-in button" });
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
    await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
    await page.waitFor("location.pathname === '/'", { timeout: 15000, label: "the dashboard" });

    for (const path of ["/", "/tags/", "/payroll/"]) {
      await setViewport(page, 390, 844);
      await page.goto(`${BASE}${path}`, { settle: 900 });
      await page.waitFor(`document.querySelector('.app-shell') && document.querySelector('h1')`, {
        timeout: 15000,
        label: "the shell and its heading",
      });
      await sleep(200);

      const geom = await page.eval(`(() => {
        const shell = document.querySelector('.app-shell')
        const cs = getComputedStyle(shell)
        const rows = cs.gridTemplateRows.split(' ').map((v) => Math.round(Number.parseFloat(v)))
        const h1 = document.querySelector('h1')
        const h1Rect = h1 ? h1.getBoundingClientRect() : null
        return { rows, rowCount: rows.length, h1Y: h1Rect ? Math.round(h1Rect.top) : null, viewportH: window.innerHeight }
      })()`);

      console.log(`  ${path}  rows=${JSON.stringify(geom.rows)}  h1.y=${geom.h1Y}  viewport=${geom.viewportH}px`);

      assert(`${path}: the shell computes FOUR grid rows at <=767px, matching its four areas`, geom.rowCount === 4, JSON.stringify(geom.rows));
      if (geom.rowCount === 4) {
        const [, navRow, contentRow] = geom.rows;
        // The regression: the nav strip (row 2) took the flexible track and grew to fill
        // most of the screen. A real nav strip is a couple of buttons — comfortably under
        // 100px — never the majority of an 844px phone.
        assert(`${path}: the nav strip row is a strip, not most of the screen`, navRow < 100, `nav row = ${navRow}px`);
        // The regression's other half: content shrank to auto and got pushed down. It must
        // be the DOMINANT row — this is what "the content area gets the remaining space"
        // means on a page whose content still fits.
        assert(`${path}: the content row is the dominant one, not the nav strip`, contentRow > navRow, `content ${contentRow}px vs nav ${navRow}px`);
      }
      // The regression's most visible symptom: the heading pushed far down the page. A
      // healthy phone load puts it in the first ~150px, right under the collapsed header +
      // nav strip.
      assert(`${path}: the h1 is near the top of the page, not floating mid-screen`, geom.h1Y !== null && geom.h1Y < 200, `h1 at y=${geom.h1Y}`);
    }
  } finally {
    child.kill("SIGKILL");
  }

  console.log(failures ? `\ncheck-nav-strip-rows: FAIL (${failures})` : "\ncheck-nav-strip-rows: all checks green");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
