// GREYSCALE: is every state still distinguishable when colour is taken away?
//
//   «stack» on :8080 with a Maps key (see demo/shoot-ia.mjs)
//   node demo/check-ia-greyscale.mjs
//
// The rule this enforces is decision-28's, phrased as the owner phrased it: colour is
// always the SECOND signal, so a greyscaled screenshot must stay readable. The five domain
// states and the map's pin states are checked, and each one is checked TWICE:
//
//   1. it carries a WORD of its own — not a word it shares with another state;
//   2. and if two states DO share a word, their colours must differ enough that the
//      difference survives Rec.709 luminance, which is what `ffmpeg -vf format=gray` does.
//
// (2) is why this is not just a string-equality test. A pill that says „Nicht bestätigt"
// in amber and a pill that says „Nicht bestätigt" in red are the same pill in greyscale,
// and a check that only compared words would call that fine.
//
// IT SCROLLS TO EACH STATE AND PHOTOGRAPHS IT. The pictures go to /tmp/ts-demo/ia-states
// and are greyscaled by the caller; the point of taking them here rather than in
// shoot-ia.mjs is that four of these states are not visible at rest — the corrected shift
// is row ~40 of 351, the excluded worker needs a period that HAS an exclusion, and the pin
// states need a map that has finished drawing.
//
// Every wait is bounded and the run has a deadline. Exits 1 on a failure.
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { assertMapKeyInBuild } from "./build-guard.mjs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-ia-greyscale: refusing to drive "${host}" — loopback only.`);
  process.exit(1);
}
// The pin block below cannot run on a keyless bundle: no key, no .map-pin, and the
// grey-pin assertion would pass over zero pins.
assertMapKeyInBuild();

const OUT = process.env.IA_STATES_OUT ?? "/tmp/ts-demo/ia-states/";
mkdirSync(OUT, { recursive: true });
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const DEADLINE = Date.now() + 10 * 60 * 1000;

const failures = [];
const assert = (what, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(`${what}${detail ? ` — ${detail}` : ""}`);
};

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

const { child, port } = await launchChrome({ port: await freePort(9600), width: 1680, height: 1000 });
const page = await attach(port);
const kill = setTimeout(() => {
  console.error("check-ia-greyscale: DEADLINE");
  child.kill("SIGKILL");
  process.exit(3);
}, 10 * 60 * 1000);

/**
 * Find an element whose own text contains `needle`, park it in the middle of the viewport
 * and photograph the viewport.
 *
 * `scrollIntoView` is NOT used and the reason is on the record: it silently succeeds on an
 * `overflow: hidden` ancestor and returns having moved nothing, which produced a green run
 * and a picture of the wrong part of the page. `window.scrollTo` against the element's
 * absolute offset moves the document or it does not, and the returned `top` says which.
 */
async function shootAt(name, needle, { selector = "*", nth = 0 } = {}) {
  const placed = await page.eval(`(() => {
    const needle = ${JSON.stringify(needle)}
    const hits = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) =>
      (el.textContent || '').includes(needle) && ![...el.children].some((c) => (c.textContent || '').includes(needle)))
    const el = hits[${nth}]
    if (!el) return { found: false, hits: hits.length }
    const y = el.getBoundingClientRect().top + window.scrollY
    window.scrollTo(0, Math.max(0, Math.round(y - window.innerHeight / 2)))
    return { found: true, scrolledTo: Math.round(window.scrollY), rowText: (el.closest('tr, li, .row') || el).innerText.split(String.fromCharCode(10)).join(' · ').slice(0, 200) }
  })()`);
  if (!placed.found) return placed;
  await sleep(500);
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}${name}.png`, Buffer.from(data, "base64"));
  return placed;
}

/** Rec.709 luminance — the exact transform `ffmpeg -vf format=gray` applies. */
const luma = (rgb) => {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m) return null;
  return Math.round(0.2126 * Number(m[0]) + 0.7152 * Number(m[1]) + 0.0722 * Number(m[2]));
};

async function login() {
  await page.goto(`${BASE}/login/`, { settle: 500 });
  await page.eval(`localStorage.setItem('nfcts.theme', 'dark')`);
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { timeout: 15000 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 20000 });
  await sleep(800);
}

/**
 * THE STATES THIS FILE IS ABOUT HAVE TO EXIST IN THE DATABASE BEFORE IT CAN LOOK AT THEM,
 * and two of them are the ones the OTHER audits destroy.
 *
 * demo/seed.sql creates two auto-closed, unresolved shifts — the „8-Stunden-Timer" state and
 * the only reason any pin says „prüfen". demo/audit-keyboard.mjs and demo/audit-overlays.mjs
 * drive the correction drawer for real, against the same nfc_demo database, and a correction
 * RESOLVES the shift. So running the audits in the order the README lists them leaves this
 * file with zero unresolved shifts, and it then reported
 *
 *     FAIL  state AUTO-CLOSED names the timer in words
 *     FAIL  a pin that needs attention says so in a word
 *
 * which reads as "the screens stopped saying it" and is nothing of the kind. Measured: the
 * seed's two unresolved shifts carried `corrected_at` timestamps from earlier the same
 * session.
 *
 * A PRECONDITION FAILURE IS STILL A FAILURE — never a skip, because a skip is how twelve map
 * assertions read as passes for a whole run. But it must not be REPORTED as a defect in the
 * thing it was going to measure. So the state of the fixture is established first, from the
 * same admin API the screens read, and named in the failure.
 */
async function fixtureState() {
  return page.eval(`(async () => {
    const r = await fetch('/admin/data?limit=2000', { credentials: 'include' })
    if (!r.ok) return { error: 'GET /admin/data ' + r.status }
    const d = await r.json()
    const shifts = d.shifts || []
    return {
      shifts: shifts.length,
      unresolved: shifts.filter((s) => s.auto_closed && !s.corrected_at).length,
      corrected: shifts.filter((s) => s.corrected_at).length,
      open: shifts.filter((s) => !s.end_time).length,
    }
  })()`);
}

const RESEED =
  'psql -d nfc_demo -v ON_ERROR_STOP=1 -f demo/seed.sql   ' +
  '(demo/audit-keyboard.mjs and demo/audit-overlays.mjs write to this database and RESOLVE ' +
  'the seed\u2019s unresolved shifts, so this check must run before them or after a reseed)';

try {
  await login();

  const fixture = await fixtureState();
  console.log(`\n  fixture: ${JSON.stringify(fixture)}`);
  // Asserted, not merely printed: without it the two assertions below are being run against
  // a database that cannot satisfy them, and a green run of THIS file would mean the seed
  // happened to be intact rather than that anything was proven.
  assert(
    "fixture: the demo database still has an UNRESOLVED auto-closed shift to look at",
    fixture.unresolved > 0,
    `${JSON.stringify(fixture)} \u2014 reseed: ${RESEED}`,
  );

  // ==== the five domain states, on /shifts/ and /workers/ and /payroll/ ==================
  await page.goto(`${BASE}/shifts/?period=all`, { settle: 1500 });
  await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 5`, { timeout: 20000 });
  await sleep(800);

  /**
   * Every distinct state word rendered in the shift log's STATUS column, with the colour it
   * is drawn in and that colour's greyscale luminance. Read out of the page, not listed
   * here: a list here would be a list of the words somebody remembered.
   */
  const shiftStates = await page.eval(`(() => {
    const seen = new Map()
    // .badge is what components/StateBadge.tsx emits. Written as the class the component
    // actually renders, checked against the component, because the first version of this
    // guessed .pill and reported TWO state words on a screen that renders four.
    // (No backticks in here: this string is itself a template literal.)
    for (const el of document.querySelectorAll('table.data-table tbody .badge, table.data-table tbody .shift-origin-manual')) {
      const word = (el.textContent || '').trim()
      if (!word) continue
      // KEYED ON WORD **AND** CLASS, and that is the whole point. Keyed on the word alone,
      // two different renderings that print the SAME word are deduplicated — so the pair
      // comparison below never sees them and the branch that exists to catch exactly that
      // can never fire. Proved: setting originManual to „Läuft" left this check GREEN until
      // the key was widened, which is the failure this file is supposed to be about.
      const key = word + '@@' + (el.className || '')
      if (seen.has(key)) continue
      const cs = getComputedStyle(el)
      seen.set(key, { word, cls: (el.className || '').toString(), color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor, weight: cs.fontWeight, style: cs.fontStyle })
    }
    return [...seen.values()]
  })()`);
  console.log(`\n  shift state words: ${shiftStates.map((s) => `„${s.word}"`).join(", ")}`);

  for (const s of shiftStates) s.luma = luma(s.color);
  for (let i = 0; i < shiftStates.length; i++) {
    for (let j = i + 1; j < shiftStates.length; j++) {
      const a = shiftStates[i];
      const b = shiftStates[j];
      const sameWord = a.word === b.word;
      // The text colour is not the only ink: a badge is drawn on its own background, and a
      // manual-origin cell differs by weight and style. All four are compared, and a pair is
      // only a failure when NOTHING survives the desaturation.
      const greyGap = Math.max(
        Math.abs((a.luma ?? 0) - (b.luma ?? 0)),
        Math.abs((luma(a.bg) ?? 0) - (luma(b.bg) ?? 0)),
      );
      const differentInk = a.weight !== b.weight || a.style !== b.style;
      assert(
        `greyscale: „${a.word}" and „${b.word}" are told apart by something other than colour`,
        !sameWord || greyGap >= 12 || differentInk,
        sameWord
          ? `identical words in .${a.cls} and .${b.cls}; greyscale gap only ${greyGap}, same weight/style`
          : "different words",
      );
    }
  }
  assert("shift log renders at least three distinct state words", shiftStates.length >= 3, `${shiftStates.length}`);

  // 1 · RUNNING
  const running = await shootAt("state-running", "Läuft", { selector: "td, .pill, span" });
  assert("state RUNNING is a word on screen", running.found === true, running.rowText ?? JSON.stringify(running));

  // 2 · AUTO-CLOSED, UNRESOLVED
  const unres = await shootAt("state-unresolved", "8-Stunden-Timer", { selector: "td, div, p, span" });
  assert(
    "state AUTO-CLOSED names the timer in words",
    unres.found === true,
    fixture.unresolved === 0
      ? `NOT A DEFECT: 0 unresolved shifts in the fixture. ${RESEED}`
      : (unres.rowText ?? JSON.stringify(unres)),
  );

  // 3 · CORRECTED — one row in 351. Not visible at rest, which is the point.
  const corrected = await shootAt("state-corrected", "Korrigiert", { selector: "td, .pill, span" });
  assert("state CORRECTED is reachable and is a word", corrected.found === true, corrected.rowText ?? JSON.stringify(corrected));

  // 4 · INACTIVE — a deactivated worker.
  await page.goto(`${BASE}/workers/`, { settle: 1500 });
  await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 2`, { timeout: 20000 });
  await sleep(600);
  // „Inaktiv – keine Anmeldung möglich", not „Deaktiviert": the button is the verb, the cell
  // is the state, and they are deliberately different strings. Read out of web/messages/de.json.
  const inactive = await shootAt("state-inactive", "Inaktiv", { selector: "td, .badge, span" });
  assert("state INACTIVE is a word, not a grey row", inactive.found === true, inactive.rowText ?? JSON.stringify(inactive));

  // 5 · EXCLUDED FROM PAYROLL — a worker with no hourly rate is NAMED and COUNTED, never
  //     priced at 0,00 €. Eight surfaces were aligned on this; it must survive greyscale
  //     as a sentence, not as a colour.
  await page.goto(`${BASE}/payroll/?period=all`, { settle: 1800 });
  await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 1`, { timeout: 20000 });
  await sleep(800);
  const excluded = await shootAt("state-excluded", "Stundensatz", { selector: "td, div, p, span, li" });
  assert("state EXCLUDED FROM PAYROLL is named in words", excluded.found === true, excluded.rowText ?? JSON.stringify(excluded));
  const zeroPriced = await page.eval(
    `[...document.querySelectorAll('table.data-table tbody td')].filter((td) => /^0,00\\s*€$/.test((td.textContent||'').trim())).length`,
  );
  assert("no rate-less worker is priced at 0,00 € anywhere on /payroll/", zeroPriced === 0, `${zeroPriced} cell(s) read exactly 0,00 €`);

  // ==== the pin states ==================================================================
  await page.goto(`${BASE}/`, { settle: 2000 });
  await page.waitFor(`document.querySelectorAll('.map-pin').length > 0`, { timeout: 25000, label: "pins" });
  await sleep(3000);
  const pins = await page.eval(`(() => [...document.querySelectorAll('.map-pin')].map((p) => {
    const label = p.querySelector('.map-pin-label') || p
    return {
      text: (p.innerText || '').split(String.fromCharCode(10)).join(' ').trim().slice(0, 80),
      glyphs: [...p.querySelectorAll('[aria-hidden=true]')].map((g) => (g.textContent||'').trim()).filter(Boolean),
      color: getComputedStyle(label).color,
      bg: getComputedStyle(label).backgroundColor,
      weight: getComputedStyle(label).fontWeight,
    }
  }))()`);
  console.log("");
  for (const p of pins) console.log(`  pin: ${JSON.stringify(p.text)}  glyphs=${JSON.stringify(p.glyphs)}`);
  assert(
    "every pin states its occupancy as a WORD, not only as a dot",
    pins.every((p) => /vor Ort/.test(p.text)),
    pins.map((p) => p.text).join(" | "),
  );
  assert(
    "a pin that needs attention says so in a word",
    pins.some((p) => /prüfen|bestätig/.test(p.text)),
    fixture.unresolved === 0
      ? `NOT A DEFECT: 0 unresolved shifts in the fixture, so no pin CAN say „prüfen". ${RESEED}`
      : pins.map((p) => p.text).join(" | "),
  );
  // The grey pin (decision-43 section 3) belongs in a file about colour being the second
  // signal, and was not in it: the pin block asserted occupancy and attention and said
  // nothing about „ohne Zone". An unzoned building drawn ONLY in grey would have passed
  // every line above.
  const unzonedPins = pins.filter((p) => /ohne Zone|no zone/i.test(p.text));
  const greyPins = await page.eval(
    `document.querySelectorAll('.map-pin[data-zone="unzoned"]').length`,
  );
  assert(
    "the map HAS an unzoned building drawn, or this proves nothing about grey",
    greyPins > 0,
    `${pins.length} pin(s), ${greyPins} carrying data-zone=unzoned`,
  );
  assert(
    "greyscale: every grey pin SAYS its state in a word (decision-43)",
    greyPins > 0 && unzonedPins.length === greyPins,
    `${greyPins} grey pin(s), ${unzonedPins.length} carrying the word — ${pins.map((p) => p.text).join(" | ")}`,
  );
  assert(
    "occupied and empty pins are not the same glyph",
    new Set(pins.flatMap((p) => p.glyphs)).size >= 2,
    JSON.stringify([...new Set(pins.flatMap((p) => p.glyphs))]),
  );
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}state-pins.png`, Buffer.from(data, "base64"));

  // The Objektliste's own state column, which is the keyboard-reachable rendering of the
  // same facts and must carry the same words.
  const listStates = await page.eval(`(() => [...document.querySelectorAll('table.objects-table tbody tr')].map((tr) => ({
    name: (tr.querySelector('th')?.innerText || '').split(String.fromCharCode(10))[0],
    onSite: (tr.children[1]?.innerText || '').split(String.fromCharCode(10)).join(' · '),
    check: (tr.children[3]?.innerText || '').split(String.fromCharCode(10)).join(' · '),
  })))()`);
  console.log("");
  for (const r of listStates) console.log(`  row: ${r.name} | ${r.onSite} | ${r.check}`);
  assert(
    "the Objektliste says occupancy in words on every row",
    listStates.every((r) => /vor Ort/.test(r.onSite)),
    JSON.stringify(listStates.map((r) => r.onSite)),
  );
  assert(
    "the Objektliste's ‚nothing to check' cell is a phrase and never empty",
    listStates.every((r) => r.check.trim().length > 0),
    JSON.stringify(listStates.map((r) => r.check)),
  );
  await shootAt("state-objektliste", "vor Ort", { selector: "td" });
  if (Date.now() > DEADLINE) throw new Error("deadline");
} finally {
  clearTimeout(kill);
  page.close();
  child.kill("SIGKILL");
}

console.log(`\ncheck-ia-greyscale: ${failures.length === 0 ? "PASS" : `${failures.length} FAILURE(S)`} — images in ${OUT}`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
