#!/usr/bin/env node
// TWO INSTRUMENTS, ONE SELECTOR, OPPOSITE ANSWERS — so neither is trusted until this runs.
//
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/probe-map-disagreement.mjs [base]
//
// `demo/verdict-live.mjs` § 4 reports `.gm-style` present on 5 of 5 loads of `/`.
// `demo/verdict-map.mjs`, minutes later, same box and same account, reports `gmStyle:false`
// and ZERO tile requests, three runs out of three. They ask the same question of the same
// DOM. One of them is wrong, and which one decides whether the client's landing screen has
// a map on it.
//
// The only structural difference between the two navigations is that verdict-live appends
// `?cachebust=<n>` and verdict-map does not. This walks BOTH, in one browser, one after the
// other, and prints what the page says about itself each time.
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.argv[2] ?? "https://schimmer-glanz.exe.xyz";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) process.exit(2);

const chrome = await launchChrome({ port: 9488, width: 1680, height: 1200 });
const page = await attach(chrome.port);
const tiles = [];
page.on("Network.requestWillBeSent", (p) => {
  const u = p.request?.url ?? "";
  if (/maps\.googleapis\.com/i.test(u)) tiles.push(u.slice(0, 80));
});

const read = async (label) => {
  const r = await page.eval(`(() => {
    const t = document.body.innerText
    return {
      gmStyle: !!document.querySelector('.gm-style'),
      canvas: document.querySelectorAll('.gm-style canvas, .gm-style img').length,
      mapText: (t.match(/Karte[^\\n]*\\n[^\\n]*/) || [''])[0].slice(0, 120),
      loading: /Karte wird geladen/.test(t),
      blocked: /nicht freigeschaltet|blockiert|RefererNotAllowed/i.test(t),
      url: location.pathname + location.search,
      scriptTags: Array.from(document.querySelectorAll('script[src*="maps.googleapis"]')).length,
    }
  })()`);
  console.log(`${label.padEnd(28)} ${JSON.stringify(r)}`);
  return r;
};

try {
  await page.goto(`${BASE}/login/`);
  await page.waitFor("document.querySelector('input[name=password]')");
  await page.eval(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(document.querySelector('input[name=email]'), ${JSON.stringify(EMAIL)})
    set(document.querySelector('input[name=password]'), ${JSON.stringify(PASSWORD)})
    document.querySelector('form').requestSubmit(); return true
  })()`);
  await page.waitFor("!document.querySelector('input[name=password]')", { timeout: 20000 });
  console.log(`signed in; maps script requests so far: ${tiles.length}`);

  // A. exactly what verdict-live does
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/?cachebust=${Date.now()}-${i}`, { settle: 4000 });
    await read(`A cachebust settle=4000 #${i + 1}`);
  }
  // B. exactly what verdict-map does
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/`, { settle: 1000 });
    await sleep(10000);
    await read(`B plain / settle=1000+10s #${i + 1}`);
  }
  // C. plain `/` but given the same long budget AND a reload, to separate "the URL" from
  //    "how the page got there".
  for (let i = 0; i < 2; i++) {
    await page.goto(`${BASE}/?probe=${i}`, { settle: 1000 });
    await sleep(10000);
    await read(`C /?probe settle=1000+10s #${i + 1}`);
  }
  console.log(`\nmaps.googleapis requests seen in total: ${tiles.length}`);
  for (const t of tiles.slice(0, 6)) console.log(`  ${t}`);
} finally {
  page.close();
  chrome.child.kill();
}
