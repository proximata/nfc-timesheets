// "Is it lighter?" — measured the way the complaint was phrased, not the way source lines are.
//
//   BASE=http://127.0.0.1:8083 LABEL=before node demo/review-weight.mjs
//   BASE=http://127.0.0.1:8082 LABEL=after  node demo/review-weight.mjs
//
// The owner said: too much text, two stacked white containers, forces me to READ a whole
// screen instead of skimming it. So three numbers per screen, each mapping to one clause:
//
//   px      documentElement.scrollHeight — how much screen there is (not source lines)
//   read    WORDS of prose above the first datum — how much you must read before an answer
//   boxes   stacked surface containers in the main column — the "two white containers"
//
// Nothing here is a pass/fail. It is a before/after tape measure, and the images are the
// verdict. Broken on purpose during the review: the prose-word walker was pointed at
// <body> instead of #main-content and every screen jumped by the ~40 words of chrome, which
// is how I know it is reading something.
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8082";
const LABEL = process.env.LABEL ?? "after";
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

const SCREENS = [
  ["dashboard", "/"],
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

async function freePort(from) {
  for (let p = from; p < from + 60; p++) {
    const free = await new Promise((r) => {
      const s = createServer();
      s.once("error", () => r(false));
      s.once("listening", () => s.close(() => r(true)));
      s.listen(p, "127.0.0.1");
    });
    if (free) return p;
  }
  throw new Error("no free port");
}

const port = await freePort(9800);
const { child } = await launchChrome({ port, width: 1680, height: 1000 });
const page = await attach(port);
const kill = setTimeout(() => {
  console.error("review-weight: DEADLINE");
  child.kill("SIGKILL");
  process.exit(3);
}, 300_000);

await page.goto(`${BASE}/login/`, { settle: 600 });
await page.waitFor(`document.querySelector('form button[type="submit"]')`);
await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
await page.waitFor("location.pathname === '/'", { timeout: 20000 });
await sleep(600);

const MEASURE = `(() => {
  const main = document.querySelector('#main-content, main') || document.body
  // The first DATUM: a table, or a big figure. Whatever comes first vertically.
  const data = Array.from(main.querySelectorAll('table, .figure, .answer, [class*=figure], [class*=answer]'))
  const firstY = data.length
    ? Math.min(...data.map((el) => el.getBoundingClientRect().top + window.scrollY))
    : Infinity
  // Prose ABOVE that: paragraphs and list items, excluding anything inside the data itself.
  let words = 0
  for (const el of main.querySelectorAll('p, li, .note, .hint')) {
    if (el.closest('table')) continue
    if (el.getBoundingClientRect().top + window.scrollY >= firstY) continue
    if (!el.offsetParent) continue
    words += (el.innerText.trim().match(/\\S+/g) || []).length
  }
  // Stacked surface containers: elements in the main column that draw their own background
  // distinct from the page. This is the "two stacked white containers" literally.
  const pageBg = getComputedStyle(document.body).backgroundColor
  const boxes = Array.from(main.querySelectorAll('div, section, form, aside')).filter((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (r.width < 300 || r.height < 60) return false
    if (cs.backgroundColor === pageBg || cs.backgroundColor === 'rgba(0, 0, 0, 0)') return false
    // only top-level ones, so a card inside a card counts once for the outer
    return !el.parentElement?.closest('div,section,form,aside') ||
      getComputedStyle(el.parentElement.closest('div,section,form,aside')).backgroundColor === pageBg ||
      getComputedStyle(el.parentElement.closest('div,section,form,aside')).backgroundColor === 'rgba(0, 0, 0, 0)'
  }).length
  return {
    px: document.documentElement.scrollHeight,
    read: words,
    boxes,
    h1: document.querySelector('h1')?.textContent?.trim() ?? null,
  }
})()`;

const out = {};
for (const [name, path] of SCREENS) {
  await page.goto(`${BASE}${path}`, { settle: 1800 });
  try {
    await page.waitFor(`document.querySelectorAll('table tr, .figure, h1').length > 0`, {
      timeout: 12000,
      label: name,
    });
  } catch {}
  await sleep(400);
  out[name] = await page.eval(MEASURE);
  console.log(
    `${LABEL.padEnd(6)} ${name.padEnd(18)} px=${String(out[name].px).padStart(6)}  read=${String(out[name].read).padStart(4)}  boxes=${out[name].boxes}`,
  );
}
console.log(`\nJSON ${LABEL} ${JSON.stringify(out)}`);
clearTimeout(kill);
page.close();
child.kill("SIGKILL");
rmSync(`/tmp/rev-w-${port}`, { recursive: true, force: true });
