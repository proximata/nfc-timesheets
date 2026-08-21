// WHAT A DIRECTOR SEES WHEN THE FETCH FAILS — in a browser, not in the source.
//
// Three reports disagree about this screen and the disagreement is the reason this file
// exists:
//   RELIABILITY.md fix #3  „12 admin screens said `Wird geladen…` for ever under a red error"
//                          — fixed, and demo/check-load-failure.mjs asserts it. But that
//                          check reads the SOURCE, by its own admission, because reproducing
//                          it meant stopping Postgres on production.
//   LOOK.md C5             offline shows the error AND „Wird berechnet…", with no retry
//                          — listed as NOT fixed, deferred into TASK-230.
//   LOOK.md greyscale      the one greyscale failure in 204 shots: `.form-error` desaturates
//                          DIMMER than the loading line beneath it.
//
// Both cannot be true. This drives the real bundle in a real browser with the API's own
// responses blocked at the network layer (`Network.setBlockedURLs` — no server is stopped,
// no database is touched), and reads back four things per screen:
//
//   error?    is a visible error on the screen at all
//   loading?  is a „loading" line visible AT THE SAME TIME (the contradiction)
//   grey      the error's luminance vs the loudest competing line, colour removed. The house
//             rule is that colour is the SECOND signal; if the error is dimmer than the line
//             that contradicts it, colour was the only signal and it pointed the wrong way.
//   retry     is there a control the director can press, or is „try again" an instruction
//             attached to nothing
//
//   DEMO_BASE=http://127.0.0.1:8092 node demo/verdict-failure.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8092";
const OUT = process.env.VERDICT_OUT ?? "docs/media/verdict/failure";
const ADMIN = {
  email: process.env.ADMIN_EMAIL ?? "demo@example.test",
  password: process.env.ADMIN_PASSWORD ?? "demo-nur-lokal-2026",
};
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`verdict-failure: refusing "${host}" — loopback only. Blocking a production`);
  console.error("fetch mid-session is a thing to do to a laptop, not to a client's box.");
  process.exit(1);
}

const SCREENS = ["/", "/payroll/", "/shifts/", "/pl/", "/locations/"];
const LOADING = /Wird geladen|Wird berechnet|werden geladen/i;

let fails = 0;
const ok = (m) => console.log(`  ok:   ${m}`);
const bad = (m) => {
  fails++;
  console.log(`  FAIL: ${m}`);
};

mkdirSync(OUT, { recursive: true });
const chrome = await launchChrome({ port: 9459, width: 1440, height: 1000 });
const page = await attach(chrome.port);

try {
  await page.goto(`${BASE}/login/`);
  await page.waitFor("document.querySelector('input[name=password]')");
  await page.eval(`(() => {
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(document.querySelector('input[name=email]'), ${JSON.stringify(ADMIN.email)})
    set(document.querySelector('input[name=password]'), ${JSON.stringify(ADMIN.password)})
    document.querySelector('form').requestSubmit()
    return true
  })()`);
  await page.waitFor("!document.querySelector('input[name=password]')", { timeout: 20000 });
  ok("signed in");

  // EVERY DATA CALL BLOCKED, the session cookie left alone. This is the stairwell: the page
  // ships (it is a static export), the data never arrives.
  await page.send("Network.setBlockedURLs", {
    urls: ["*/admin/*", "*/reports/*", "*/payroll*", "*/shifts*", "*/locations*"],
  });
  console.log("\n== every /admin/* response blocked at the network layer\n");

  for (const path of SCREENS) {
    await page.goto(`${BASE}${path}`, { settle: 4000 });
    const name = `fail${path.replace(/\//g, "-").replace(/^-|-$/g, "") || "home"}`;
    const { data } = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));

    const seen = await page.eval(`(() => {
      const vis = (el) => !!(el && el.offsetParent !== null)
      const lum = (el) => {
        const c = getComputedStyle(el).color.match(/[\\d.]+/g).map(Number)
        // Rec. 601 luma — the same weighting sips uses for a greyscale conversion.
        return Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
      }
      const all = Array.from(document.querySelectorAll('body *'))
        .filter((el) => vis(el) && el.children.length === 0 && el.textContent.trim().length > 3)
      const errEl = all.find((el) =>
        /nicht funktioniert|nicht erreichbar|fehlgeschlagen|Fehler/i.test(el.textContent))
      const loadEl = all.find((el) => /Wird geladen|Wird berechnet|werden geladen/i.test(el.textContent))
      const retry = Array.from(document.querySelectorAll('button, a'))
        .filter(vis)
        .find((el) => /erneut|nochmal|noch einmal|Aktualisieren|neu laden/i.test(el.textContent))
      return {
        error: errEl ? errEl.textContent.trim().slice(0, 90) : null,
        errorLum: errEl ? lum(errEl) : null,
        errorSize: errEl ? Math.round(Number.parseFloat(getComputedStyle(errEl).fontSize)) : null,
        loading: loadEl ? loadEl.textContent.trim().slice(0, 60) : null,
        loadingLum: loadEl ? lum(loadEl) : null,
        loadingSize: loadEl ? Math.round(Number.parseFloat(getComputedStyle(loadEl).fontSize)) : null,
        retry: retry ? retry.textContent.trim().slice(0, 40) : null,
      }
    })()`);
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(seen, null, 2));

    console.log(`  ${path}`);
    if (!seen.error) bad(`${path}: NO visible error at all after every fetch was blocked`);
    else ok(`${path}: error visible — „${seen.error}"`);

    if (seen.loading) {
      bad(`${path}: says „${seen.loading}" AT THE SAME TIME as the error (LOOK C5 / RELIABILITY #3)`);
      if (seen.errorLum !== null && seen.loadingLum !== null) {
        seen.errorLum >= seen.loadingLum
          ? ok(`${path}: …but with colour removed the error is not dimmer (${seen.errorLum} vs ${seen.loadingLum})`)
          : bad(`${path}: greyscale — the error is DIMMER than the loading line (${seen.errorLum} vs ${seen.loadingLum})`);
      }
    } else {
      ok(`${path}: no „loading" line contradicting the error`);
    }
    console.log(`        retry control: ${seen.retry ? `„${seen.retry}"` : "NONE — the only way back is a page reload"}`);
  }
} finally {
  await sleep(200);
  page.close();
  chrome.child.kill();
}

console.log(`\n${fails === 0 ? "VERDICT-FAILURE OK" : `VERDICT-FAILURE: ${fails} problem(s)`} — ${BASE}`);
process.exit(fails === 0 ? 0 : 1);
