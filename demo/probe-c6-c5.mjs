#!/usr/bin/env node
// Two of the clarity pass's claims came back RED on the live box after the deploy. Before
// filing either as a defect, find out whether the CHECK is wrong or the CODE is — this
// project has misread a skip as a pass AND as a failure inside one week.
//
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/probe-c6-c5.mjs [base]
//
// C6: `/login/` renders `{returnTo !== null && <p className="lede">{t('sessionExpired')}</p>}`
//     and `returnTo` comes from a `useState` INITIALISER reading window.location.search.
//     The URL on screen carried ?returnTo=… and the sentence was absent. Two candidate
//     explanations, and they need different fixes: a client-side navigation whose URL is not
//     yet committed when the initialiser runs (code), or my own read happening too early
//     (check). A DIRECT full page load of /login/?returnTo=… separates them.
//
// C5: the retry button was not found. `/locations/` has THREE `[role="status"]` elements and
//     `querySelector` returns the first, which is a drawer notice. Enumerate them all.
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.argv[2] ?? "https://schimmer-glanz.exe.xyz";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) process.exit(2);

const chrome = await launchChrome({ port: 9477, width: 1440, height: 900 });
const page = await attach(chrome.port);

try {
  // ---- C6, path A: a DIRECT load of the login URL, no client-side navigation involved.
  await page.goto(`${BASE}/login/?returnTo=%2Fpayroll%2F%3Fperiod%3D2026-07`, { settle: 2000 });
  const direct = await page.eval(`document.body.innerText`);
  console.log("C6/A direct load of /login/?returnTo=… :");
  console.log(`   sessionExpired sentence present: ${/abgelaufen/.test(direct)}`);
  console.log(`   ${JSON.stringify(direct.replace(/\\n+/g, " | ").slice(0, 240))}`);

  // ---- C6, path B: reach it the way a real expiry does — a live screen whose fetch 401s.
  await page.goto(`${BASE}/login/`, { settle: 1200 });
  await page.eval(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(document.querySelector('input[name=email]'), ${JSON.stringify(EMAIL)})
    set(document.querySelector('input[name=password]'), ${JSON.stringify(PASSWORD)})
    document.querySelector('form').requestSubmit(); return true
  })()`);
  await page.waitFor("!document.querySelector('input[type=password]')", { timeout: 20000 });
  await page.goto(`${BASE}/payroll/?period=2026-07`, { settle: 2500 });
  await page.send("Network.clearBrowserCookies");
  // Force the SPA to refetch without a full reload: this is a session that dies while he
  // is looking at the screen, which is the case C6 was written for.
  await page.eval(`(() => { const b = Array.from(document.querySelectorAll('button, a'))
      .find(e => /Aktualisieren|Erneut/.test(e.textContent)); if (b) { b.click(); return 'clicked ' + b.textContent.trim() }
    return 'no refresh control on /payroll/' })()`);
  await sleep(3000);
  const spa = await page.eval(`({ url: location.pathname + location.search, text: document.body.innerText.slice(0, 300) })`);
  console.log(`\nC6/B session dies in place: url=${spa.url}`);
  console.log(`   sessionExpired sentence present: ${/abgelaufen/.test(spa.text)}`);

  // ---- C6, path C: a fresh full load of a dead-session screen (what my verdict run did).
  await page.goto(`${BASE}/payroll/?period=2026-07`, { settle: 3000 });
  const c = await page.eval(`({ url: location.pathname + location.search, text: document.body.innerText.slice(0, 300) })`);
  console.log(`\nC6/C full load with no cookie: url=${c.url}`);
  console.log(`   sessionExpired sentence present: ${/abgelaufen/.test(c.text)}`);

  // ---- C5: enumerate EVERY role=status on a failed /locations/.
  await page.goto(`${BASE}/login/`, { settle: 1200 });
  await page.eval(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(document.querySelector('input[name=email]'), ${JSON.stringify(EMAIL)})
    set(document.querySelector('input[name=password]'), ${JSON.stringify(PASSWORD)})
    document.querySelector('form').requestSubmit(); return true
  })()`);
  await page.waitFor("!document.querySelector('input[type=password]')", { timeout: 20000 });
  await page.send("Network.setBlockedURLs", { urls: ["*/admin/*"] });
  for (const path of ["/locations/", "/payroll/"]) {
    await page.goto(`${BASE}${path}`, { settle: 3000 });
    const all = await page.eval(`Array.from(document.querySelectorAll('[role="status"]')).map((el, i) => ({
      i, text: el.innerText.trim().slice(0, 90), button: el.querySelector('button')?.innerText.trim() ?? null }))`);
    console.log(`\nC5 ${path} — ${all.length} [role=status] element(s):`);
    for (const s of all) console.log(`   [${s.i}] button=${JSON.stringify(s.button)} text=${JSON.stringify(s.text)}`);
  }
} finally {
  page.close();
  chrome.child.kill();
}
