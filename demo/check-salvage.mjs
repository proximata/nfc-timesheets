// THE FOUR THINGS 590077f FIXED THAT NOBODY HAD EVER LOOKED AT IN A BROWSER.
//
//   «stack»  seeded nfc_demo + the API serving a build of these screens (loopback only)
//   DEMO_BASE=http://127.0.0.1:8080 node demo/check-salvage.mjs
//
// 590077f was salvaged from a run whose agents died before verifying it. Its own commit
// message says so: „NOT yet verified in a browser“. Two later runs then died trying. What
// follows is the part of that verification NO existing check in this tree performs. The
// parts that ARE covered elsewhere are named here rather than duplicated:
//
//   V1 links visible after one press   demo/check-map-home.mjs §5   (9 of 9, nothing scrolled)
//   V2 chip escapable at 390px         demo/check-map-home.mjs §390 (✕ at 383px, 44x44)
//   F2 Escape from the info box        demo/audit-map-a11y.mjs §2   (opener-present path)
//   F3 contrast, both themes           demo/audit-contrast.mjs + demo/audit-map-contrast.mjs
//   F4 15 mangles x 23 param/screen    demo/audit-params.mjs §1
//
// WHAT IS LEFT, AND WHY EACH ONE COULD NOT BE ANSWERED BY THOSE:
//
//   A · V1 KEYBOARD. Every existing assertion presses the disclosure with `element.click()`,
//       which is a DOM method call, not an input event. It cannot distinguish a <button>
//       from a <div onclick>, and it proves nothing at all about Enter or Space. The owner's
//       answer in IA-PLAN §9.3 is „expandable/collapsible“ — a control a keyboard cannot
//       operate does not satisfy that. So: a real Input.dispatchMouseEvent at the control's
//       own coordinates, and a real Enter and a real Space, each measured separately.
//
//   B · THE FOLD WITH NO COORDINATES. demo/probe-fold.mjs walks the landing screen, but only
//       on the seeded portfolio, where five of six buildings are pinned. PRODUCTION HAS ONE
//       BUILDING AND `lat IS NULL` — IA-PLAN §9's correction says so in as many words. The
//       question „does the landing screen answer its question above the fold“ therefore has
//       a second, more important answer that has never been measured. Both are measured
//       here, at both widths, and the screen must answer in BOTH.
//
//   C · F1 ESCAPE FROM A PANEL NOBODY OPENED. demo/probe-focus-restore.mjs and
//       demo/audit-map-a11y.mjs both CLICK an opener first, so both measure „focus returns
//       to the opener". The shape that shipped broken is the other one: a URL pasted into
//       the address bar (`/?location=…`, `/workers/?worker=…` — decision-38's whole point is
//       that these are shareable). There is no opener in that document. `document.activeElement`
//       on a fresh document IS `<body>`, so the naive guard restores focus to exactly the
//       place it exists to avoid. Three surfaces, each opened ONLY by its URL.
//
//   D · F4 CASE AND ENCODING, EVERY UUID PARAMETER. audit-params §2b tests an uppercased
//       uuid on `/` alone. decision-21 puts a uuid in the TAG URI, and a uuid travels through
//       mail clients, spreadsheets and phone keyboards that change case and percent-encode
//       punctuation. Eight screens read a uuid parameter; three variants each.
//
// EVERY MEASUREMENT IS GEOMETRY OR AN INPUT EVENT, never a DOM query standing in for one.
// „Visible“ means a rectangle inside the viewport AND `offsetParent !== null`, so a link
// behind a closed disclosure scores as what it is: not on the screen.
//
// IT MUTATES nfc_demo for section B (lat/lng := NULL). A `pg_dump -Fc` goes to /tmp before
// the first UPDATE, the restore is in a `finally`, and the run ends by comparing every
// table's row count AND every coordinate with the values taken before it started. A probe
// killed mid-run skips its finally — so the dump on disk, and not the finally, is the
// actual guarantee.
//
// No new dependency: demo/cdp.mjs, Node, psql, and the Chrome already on the machine.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
const DB = process.env.DEMO_DB ?? "nfc_demo";
const DUMP = "/tmp/salvage/nfc_demo-before-salvage.dump";
const SHOTS = "/tmp/salvage/shots";
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

/** TASK-179 AC#1, reused: on an 844px phone the first fact belongs in the top two thirds. */
const FIRST_FACT_MAX_Y = 560;

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-salvage: refusing to run against "${host}" — loopback only.`);
  process.exit(1);
}
// Section B UPDATEs rows. The one database it may ever touch is the throwaway one — the
// same refusal demo/seed.sql, demo/make-admin.mjs and demo/check-reach.mjs make.
if (DB !== "nfc_demo") {
  console.error(`check-salvage: refusing to write to "${DB}" — nfc_demo only.`);
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });

const sql = (q) => execFileSync("psql", ["-d", DB, "-tAc", q], { encoding: "utf8" }).trim();
const exec = (q) =>
  execFileSync("psql", ["-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", q], { encoding: "utf8" });

const TABLES = sql(
  "SELECT string_agg(table_name, ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
).split(" ");
const rowCounts = () => TABLES.map((t) => `${t} ${sql(`SELECT count(*) FROM ${t}`)}`).join("\n");
// Row counts alone would not notice a coordinate set back to the wrong number, and this
// file's whole mutation IS coordinates. So the coordinates are fingerprinted too — the same
// lesson demo/check-money.mjs learned about hourly rates.
const coords = () =>
  sql("SELECT string_agg(id || '=' || coalesce(lat::text,'-') || ',' || coalesce(lng::text,'-'), ' ' ORDER BY id) FROM locations");
const COUNTS_BEFORE = rowCounts();
const COORDS_BEFORE = coords();
execFileSync("pg_dump", ["-Fc", "-f", DUMP, DB]);
console.log(`check-salvage: dump -> ${DUMP}`);

const failures = [];
function assert(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}
const note = (line) => console.log(`  ·    ${line}`);

// ---------------------------------------------------------------------------------------
// Reading the screen.
// ---------------------------------------------------------------------------------------

/** The disclosure on the info box, and how many of its links are ON THE SCREEN right now. */
const BOX = `(() => {
  const box = document.querySelector('.map-info')
  if (box === null) return { found: false }
  const shown = (el) => el !== null && el.offsetParent !== null
  const r = box.getBoundingClientRect()
  const toggle = box.querySelector('.map-info-expand')
  const t = toggle === null ? null : toggle.getBoundingClientRect()
  const links = [...box.querySelectorAll('.panel-links-out a[href]')]
  const inside = links.filter((a) => {
    const lr = a.getBoundingClientRect()
    return shown(a) && lr.height > 0 && lr.top >= r.top - 1 && lr.bottom <= r.bottom + 1
  })
  // TWO different questions, and conflating them is how the first version of this file
  // reported a defect that was not there. „Inside the box“ is about clipping. „Inside the
  // VIEWPORT“ is about whether the reader can see it. The links must satisfy both; the
  // PAGE's own scroll offset satisfies neither and is reported, not scored: opening the
  // URL /?location=<id> deliberately scrolls the map into view, which is the app doing its
  // job. (No backticks in here — this whole function is inside a template literal.)
  const onScreen = inside.filter((a) => {
    const lr = a.getBoundingClientRect()
    return lr.top >= 0 && lr.bottom <= window.innerHeight && lr.left >= 0 && lr.right <= window.innerWidth
  })
  return {
    found: true,
    linkTotal: links.length,
    linkVisible: inside.length,
    linkOnScreen: onScreen.length,
    toggle: toggle === null ? null : {
      tag: toggle.tagName,
      text: toggle.textContent.replace(/\\s+/g, ' ').trim(),
      expanded: toggle.getAttribute('aria-expanded'),
      controls: toggle.getAttribute('aria-controls'),
      h: Math.round(t.height),
      // The centre, in viewport coordinates — where a real mouse would be put.
      x: Math.round(t.left + t.width / 2),
      y: Math.round(t.top + t.height / 2),
      shown: shown(toggle),
      // Native semantics, which is what makes Enter and Space work at all.
      native: toggle.tagName === 'BUTTON' && toggle.getAttribute('type') === 'button',
    },
    boxTop: Math.round(r.top),
    boxBottom: Math.round(r.bottom),
    viewportH: window.innerHeight,
    boxOnScreen: r.top >= 0 && r.bottom <= window.innerHeight,
    docScrolled: Math.round(window.scrollY),
  }
})()`;

/** What is above the fold on the landing screen, in viewport coordinates, scrolled to top. */
const ABOVE_FOLD = `(() => {
  const shown = (el) => el !== null && el.offsetParent !== null
  const fold = window.innerHeight
  const out = []
  const add = (label, el) => {
    if (!shown(el)) return
    const r = el.getBoundingClientRect()
    if (r.height === 0) return
    out.push({ label, top: Math.round(r.top), bottom: Math.round(r.bottom), above: r.top < fold })
  }
  add('h1', document.querySelector('h1'))
  add('answer band', document.querySelector('.answer'))
  add('map region heading', document.querySelector('#map-region-heading'))
  add('map canvas', document.querySelector('.map-canvas'))
  add('map sentence', document.querySelector('.map-region .note, .map-region .empty-state'))
  for (const panel of document.querySelectorAll('.list')) {
    const h = panel.querySelector('h2')
    if (h !== null) add('PANEL ' + h.textContent.replace(/\\s+/g, ' ').trim(), panel)
  }
  const rows = [...document.querySelectorAll('table.objects-table tbody tr')]
  const first = rows[0] ? rows[0].querySelector('th') : null
  const firstR = first === null ? null : first.getBoundingClientRect()
  return {
    fold,
    landmarks: out,
    aboveFold: out.filter((o) => o.above).map((o) => o.label),
    rowCount: rows.length,
    rowsWhollyAbove: rows.filter((tr) => tr.getBoundingClientRect().bottom <= fold).length,
    firstFactY: firstR === null ? null : Math.round(firstR.top),
    firstFactText: first === null ? null : first.childNodes[0].textContent.replace(/\\s+/g, ' ').trim(),
    // The whole question, in one string: can the reader see a building and its state without
    // moving anything? An empty portfolio answers with a sentence and a way forward instead.
    mainText: document.querySelector('main').innerText.replace(/[ \\t]+/g, ' ').trim(),
  }
})()`;

/** Where focus ended up, told apart carefully: BODY is the failure this exists to catch. */
const LANDED = `(() => {
  const a = document.activeElement
  return {
    tag: a === null ? 'null' : a.tagName,
    id: a === null ? '' : a.id,
    onBody: a === null || a === document.body || a === document.documentElement,
    onMain: a !== null && a.id === 'main-content',
    text: a === null ? '' : (a.getAttribute('aria-label') || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 48),
  }
})()`;

async function key(page, code, vk, text) {
  await page.send("Input.dispatchKeyEvent", {
    type: text === undefined ? "rawKeyDown" : "keyDown",
    windowsVirtualKeyCode: vk,
    code,
    key: code === "Space" ? " " : code,
    ...(text === undefined ? {} : { text }),
  });
  await page.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    windowsVirtualKeyCode: vk,
    code,
    key: code === "Space" ? " " : code,
  });
}
const escape = (page) => key(page, "Escape", 27);
const tab = (page) => key(page, "Tab", 9);

/** A REAL mouse press at a point, not `element.click()`. */
async function mouse(page, x, y) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

async function signIn(page, w, h, mobile) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: w, height: h, deviceScaleFactor: 1, mobile,
  });
  await page.goto(`${BASE}/login/`, { settle: 400 });
  await page.eval(`localStorage.setItem('nfcts.theme', 'dark')`);
  await page.goto(`${BASE}/login/`, { settle: 600 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { timeout: 15000 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 20000 });
  await sleep(600);
}

const PINNED = sql("SELECT id FROM locations WHERE lat IS NOT NULL AND active ORDER BY name LIMIT 1");
const UNPINNED = sql("SELECT id FROM locations WHERE lat IS NULL AND active ORDER BY name LIMIT 1");
const WORKER = sql("SELECT id FROM workers WHERE active ORDER BY id LIMIT 1");

let chrome = null;
let page = null;
try {
  // =====================================================================================
  console.log("\n=== A · V1: the disclosure is operable by MOUSE and by KEYBOARD ===");
  // The defect was „0 of 8 links visible and no way to see them“. The shipped answer is a
  // disclosure. A disclosure that only a synthetic `.click()` can open is the same defect
  // wearing a button's clothes, so both input paths are driven for real.
  chrome = await launchChrome({ port: 9460, width: 1680, height: 1000 });
  page = await attach(chrome.port);
  await signIn(page, 1680, 1000, false);

  await page.goto(`${BASE}/?location=${PINNED}`, { settle: 2500 });
  await sleep(2500);

  const rest = await page.eval(BOX);
  assert("fixture: the info box is on the pin at 1680x1000", rest.found === true);
  assert(
    "V1: at rest the disclosure is on screen, is a real target and says HOW MANY links",
    rest.toggle !== null && rest.toggle.shown === true && rest.toggle.h >= 44 &&
      rest.toggle.expanded === "false" && /\d/.test(rest.toggle.text),
    rest.toggle === null ? "no .map-info-expand at all" :
      `„${rest.toggle.text}“ ${rest.toggle.h}px aria-expanded=${rest.toggle.expanded}`,
  );
  // Stated, not hidden: zero links are visible until it is pressed. That is the owner's
  // answer in IA-PLAN §9.3 („expandable/collapsible“), and it is only defensible because
  // the control names the count. Recorded as a number so a regression to a bare chevron,
  // or to no control at all, is visible in this log.
  note(`V1: links visible at rest = ${rest.linkVisible} of ${rest.linkTotal} — behind the disclosure, by design`);
  // The box is put on screen BY the app (it scrolls the map region into view when a URL
  // names a building). What must be true is that the reader then has to do nothing at all:
  // the box is wholly inside the viewport as delivered. `restScroll` is kept so that every
  // later assertion can require the page not to move AGAIN when the control is pressed.
  const restScroll = rest.docScrolled;
  assert(
    "V1: the app puts the box on screen itself — the box is wholly inside the viewport at rest",
    rest.boxOnScreen === true,
    `box top=${rest.boxTop} bottom=${rest.boxBottom} of viewport ${rest.viewportH}, page auto-scrolled ${restScroll}px`,
  );
  assert(
    "V1: the disclosure is a native <button type=button> with aria-expanded + aria-controls",
    rest.toggle !== null && rest.toggle.native === true && rest.toggle.controls !== null,
    rest.toggle === null ? "(none)" : `${rest.toggle.tag} controls=${rest.toggle.controls}`,
  );

  // --- MOUSE, for real: a press and a release at the control's own centre. ---------------
  if (rest.toggle !== null) {
    await mouse(page, rest.toggle.x, rest.toggle.y);
    await sleep(700);
    const byMouse = await page.eval(BOX);
    assert(
      "V1 MOUSE: a real press at the control's coordinates reveals every link, on screen",
      byMouse.found === true && byMouse.linkTotal > 0 &&
        byMouse.linkVisible === byMouse.linkTotal && byMouse.linkOnScreen === byMouse.linkTotal &&
        byMouse.docScrolled === restScroll,
      `${byMouse.linkOnScreen ?? 0} of ${byMouse.linkTotal ?? 0} inside the viewport, ` +
        `${byMouse.linkVisible ?? 0} unclipped by the box, page moved ${(byMouse.docScrolled ?? 0) - restScroll}px`,
    );
    // Put it back, with the mouse, so the keyboard case starts from the same place.
    const t2 = byMouse.toggle;
    if (t2 !== null) await mouse(page, t2.x, t2.y);
    await sleep(500);
  }

  // --- KEYBOARD: ENTER. -------------------------------------------------------------------
  const closedAgain = await page.eval(BOX);
  assert(
    "V1: the mouse closed it again — one control, both directions",
    closedAgain.found === true && closedAgain.linkVisible === 0 &&
      closedAgain.toggle !== null && closedAgain.toggle.expanded === "false",
    `visible ${closedAgain.linkVisible ?? "?"}, aria-expanded=${closedAgain.toggle?.expanded ?? "?"}`,
  );
  const focused = await page.eval(`(() => {
    const b = document.querySelector('.map-info-expand')
    if (b === null) return false
    b.focus()
    return document.activeElement === b
  })()`);
  assert("V1 KEYBOARD: the disclosure can take focus", focused === true);
  // NOT guarded by `focused`. A control that cannot take focus must make the two assertions
  // below GO RED, not disappear from the log — a skipped assertion is the same shape of lie
  // as a green one, and this project has already shipped seven checks whose subject was
  // simply missing. The keys are dispatched at the document either way.
  {
    await key(page, "Enter", 13, "\r");
    await sleep(700);
    const byEnter = await page.eval(BOX);
    assert(
      "V1 KEYBOARD: ENTER reveals every link, inside the viewport, with nothing scrolled",
      byEnter.found === true && byEnter.linkTotal > 0 &&
        byEnter.linkVisible === byEnter.linkTotal && byEnter.linkOnScreen === byEnter.linkTotal &&
        byEnter.docScrolled === restScroll,
      `${byEnter.linkOnScreen ?? 0} of ${byEnter.linkTotal ?? 0} inside the viewport, ` +
        `${byEnter.linkVisible ?? 0} unclipped by the box, page moved ${(byEnter.docScrolled ?? 0) - restScroll}px`,
    );

    // --- KEYBOARD: SPACE, which is the other half of the button contract. -----------------
    await page.eval(`document.querySelector('.map-info-expand')?.focus()`);
    await key(page, "Space", 32, " ");
    await sleep(700);
    const bySpace = await page.eval(BOX);
    assert(
      "V1 KEYBOARD: SPACE toggles it back — the other half of the <button> contract",
      bySpace.found === true && bySpace.linkVisible === 0 && bySpace.toggle?.expanded === "false",
      `visible ${bySpace.linkVisible ?? "?"} of ${bySpace.linkTotal ?? "?"}, aria-expanded=${bySpace.toggle?.expanded ?? "?"}`,
    );
    // The reason this is a separate assertion: Space on a NON-button scrolls the document.
    // A <div onclick> would satisfy „the links appeared“ under a synthetic click and fail
    // exactly here, which is the whole point of driving real key events.
    assert(
      "V1 KEYBOARD: …and SPACE did not scroll the page instead, which is what it does to a div",
      bySpace.docScrolled === restScroll,
      `page moved ${bySpace.docScrolled - restScroll}px on Space`,
    );
  }
  await page.screenshot(`${SHOTS}/v1-infobox-1680.png`);

  // =====================================================================================
  console.log("\n=== C · F1: Escape from a panel opened by the URL and NOTHING else ===");
  // No opener exists in these documents. `<body>` is the wrong answer and it is the default
  // one, so each surface is measured separately rather than trusting one to speak for three.
  const urlOpened = [
    ["the building DRAWER (a building with no coordinates)", `/?location=${UNPINNED}`, ".drawer"],
    ["the WORKER panel", `/workers/?worker=${WORKER}`, ".drawer"],
    ["the map INFO BOX (a pinned building)", `/?location=${PINNED}`, ".map-info"],
  ];
  for (const [what, url, selector] of urlOpened) {
    await page.goto(`${BASE}${url}`, { settle: 2600 });
    await sleep(1800);
    const opened = await page.eval(`!!document.querySelector('${selector}')`);
    assert(`F1 fixture: ${what} opens from the URL alone`, opened === true, url);
    if (opened !== true) continue;
    // Focus must be somewhere sensible BEFORE Escape too — a panel that opens with focus
    // still on <body> has already lost the keyboard reader.
    const before = await page.eval(LANDED);
    assert(
      `F1: ${what} — opening it from a URL moves focus off <body>`,
      before.onBody === false,
      `${before.tag}${before.id ? `#${before.id}` : ""} „${before.text}“`,
    );
    await escape(page);
    await sleep(700);
    const closed = await page.eval(`!document.querySelector('${selector}')`);
    assert(`F1: ${what} — Escape closes it`, closed === true);
    const where = await page.eval(LANDED);
    const landed = `${where.tag}${where.id ? `#${where.id}` : ""} „${where.text}“`;
    // There is no opener to return to, so `#main-content` — the skip link's own target — is
    // the only correct landing. BODY is the defect.
    assert(
      `F1: ${what} — focus lands on #main-content, never on <body>`,
      where.onBody === false && where.onMain === true,
      landed,
    );
  }

  // =====================================================================================
  console.log("\n=== D · F4: an uuid that changed case or got percent-encoded on the way ===");
  // decision-21 puts a uuid in the tag URI. It then travels through mail clients, phone
  // keyboards and spreadsheets. Three variants, on every screen that reads one.
  const UUID_SCREENS = [
    ["/", "location"],
    ["/shifts/", "location"],
    ["/contracts/", "location"],
    ["/locations/", "open"],
    ["/material-requests/", "location"],
    ["/payroll/", "location"],
    ["/pl/", "location"],
    ["/analytics/", "location"],
  ];
  const mixedCase = PINNED.split("").map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c)).join("");
  // Percent-encoding of characters that need none. A URL parser must decode it back; a
  // string comparison against the raw parameter must not.
  const encoded = PINNED.replace(/-/g, "%2D");
  const OTHER = sql(`SELECT name FROM locations WHERE id <> '${PINNED}' AND active ORDER BY name`)
    .split("\n").filter((s) => s !== "");
  const WANTED = sql(`SELECT name FROM locations WHERE id = '${PINNED}'`);

  // A SCREEN CARRIES A RESOLVED OBJECT IN ONE OF THREE WAYS, and the first version of this
  // section knew about only the first, so it reported two screens as saying nothing while
  // both were saying it loudly:
  //   a CHIP          /, /shifts/, /payroll/, /pl/, /analytics/, /material-requests/
  //   a <select>      /contracts/ — „Aus dem Objektpanel geöffnet: die Auswahl unten steht
  //                   bereits auf diesem Objekt“, and the option is the building's name
  //   a FORM FIELD    /locations/?open= — the edit drawer is headed „Objekt bearbeiten“ and
  //                   the object is named in the pre-filled name input, not in the heading
  // All three are read. Reading only the chip is how a check goes red on working software.
  const SHAPE = `(() => {
    const shown = (el) => el !== null && el.offsetParent !== null
    const chips = [...document.querySelectorAll('.filter-chip-text')].filter(shown)
      .map((c) => c.textContent.replace(/\\s+/g, ' ').trim())
    const panel = document.querySelector('.drawer, .map-info')
    const selected = [...document.querySelectorAll('select')]
      .filter((s) => s.selectedIndex >= 0 && /^[0-9a-f-]{36}$/i.test(s.value))
      .map((s) => s.options[s.selectedIndex].text.trim())
    const fields = [...document.querySelectorAll('.drawer input[type=text], .drawer input:not([type])')]
      .map((i) => i.value.trim()).filter((v) => v !== '')
    return {
      chips, selected, fields,
      rows: document.querySelectorAll('table tbody tr').length,
      panelName: panel === null ? null : (panel.getAttribute('aria-label')
        || (panel.querySelector('h2, h3') === null ? '' : panel.querySelector('h2, h3').textContent.trim())),
      text: document.querySelector('main').innerText.replace(/\\s+/g, ' ').trim(),
    }
  })()`;

  /**
   * Navigate and wait until the screen STOPS CHANGING, rather than sleeping a guessed
   * number of milliseconds. `/locations/?open=` takes ~3.5 s to mount its drawer; a fixed
   * 2 s wait photographed the screen before it had answered and called that silence. A
   * settle loop cannot be tuned wrong in the direction that invents a defect.
   */
  const settled = async (url) => {
    await page.goto(`${BASE}${url}`, { settle: 900 });
    let last = "";
    let stable = 0;
    for (let i = 0; i < 60 && stable < 3; i++) {
      await sleep(200);
      const now = await page.eval(
        "document.querySelector('main').innerText.length + ':' + document.querySelectorAll('.drawer,.map-info,.filter-chip-text').length",
      );
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
    return page.eval(SHAPE);
  };

  for (const [path, param] of UUID_SCREENS) {
    const seen = [];
    let clean = true;
    for (const [variant, value] of [
      ["lower", PINNED], ["UPPER", PINNED.toUpperCase()], ["MiXeD", mixedCase], ["%2D", encoded],
    ]) {
      const shape = await settled(`${path}?${param}=${value}`);
      // THE ONE THING THAT MAY NEVER HAPPEN: another object's data under this id. Named,
      // not inferred — every channel the screen could answer through is checked against the
      // names of every OTHER building, so „it looked like the baseline“ cannot pass for it.
      const says = [
        ...shape.chips,
        ...shape.selected,
        ...shape.fields,
        shape.panelName ?? "",
      ];
      if (says.some((s) => OTHER.some((n) => s.includes(n)))) clean = false;
      const named = says.some((s) => s.includes(WANTED));
      const unknown = shape.chips.some((c) => /unbekannt|unknown/i.test(c)) ||
        /verweist auf einen Datensatz/.test(shape.text);
      seen.push(`${variant}:${named ? "named" : unknown ? "unknown" : "silent"}`);
    }
    assert(
      `F4 ${path} ?${param}= — no case or encoding variant EVER shows another object`,
      clean === true,
      seen.join(" "),
    );
    // Silence is its own defect: a value the screen cannot resolve must say so rather than
    // render the unfiltered screen as though the filter had been honoured.
    assert(
      `F4 ${path} ?${param}= — every variant either names the building or says it is unknown`,
      seen.every((s) => !s.endsWith(":silent")),
      seen.join(" "),
    );
  }
  // The self-test: if the lower-case case did not actually name the building, everything
  // above compared two identical nothings.
  {
    const shape = await settled(`/?location=${PINNED}`);
    assert(
      "F4 self-test: the plain lower-case uuid really does name its building",
      (shape.panelName ?? "").includes(WANTED) || shape.chips.some((c) => c.includes(WANTED)),
      `panel=„${shape.panelName ?? "-"}“ chips=${JSON.stringify(shape.chips)}`,
    );
  }

  page.close();
  chrome.child.kill("SIGKILL");
  chrome = null;
  page = null;

  // =====================================================================================
  console.log("\n=== B · THE FOLD, with coordinates and with production's NULLs ===");
  // Production is one building, `lat IS NULL`, `geocode_status = 'no_key'` (IA-PLAN §9's
  // verified correction). The landing screen has to answer its question in that state too,
  // and that state has never been on the fold probe.
  for (const [w, h, mobile, tag] of [[1680, 1000, false, "1680"], [390, 844, true, "390"]]) {
    for (const [state, mutate] of [
      ["pinned (seeded)", null],
      ["NO COORDINATES (production today)", "UPDATE locations SET lat = NULL, lng = NULL"],
    ]) {
      if (mutate !== null) exec(mutate);
      const c = await launchChrome({ port: w === 390 ? 9462 : 9461, width: w, height: h });
      const p = await attach(c.port);
      try {
        await signIn(p, w, h, mobile);
        await p.goto(`${BASE}/`, { settle: 2600 });
        await sleep(2200);
        await p.eval("window.scrollTo(0, 0)");
        await sleep(300);
        const fold = await p.eval(ABOVE_FOLD);
        console.log(`\n  --- ${tag}px · ${state} · fold at ${fold.fold}px ---`);
        for (const l of fold.landmarks) {
          console.log(`      ${l.above ? "ABOVE" : "below"}  y=${String(l.top).padStart(5)}  ${l.label}`);
        }
        console.log(`      first fact y=${fold.firstFactY} „${fold.firstFactText}“ · rows wholly above the fold ${fold.rowsWhollyAbove}/${fold.rowCount}`);

        // Vacuity guard: the mutation has to have actually landed, or the second half of
        // this table is the first half printed twice.
        if (mutate !== null) {
          assert(
            `${tag}px · fixture: the coordinates really are NULL — no map canvas is drawn`,
            fold.landmarks.every((l) => l.label !== "map canvas"),
            fold.landmarks.map((l) => l.label).join(" | "),
          );
          assert(
            `${tag}px · no coordinates: the map region says so in a sentence, not a grey frame`,
            /Koordinaten/.test(fold.mainText),
            (fold.mainText.match(/[^.]*Koordinaten[^.]*\./) ?? ["(no sentence about coordinates)"])[0].trim().slice(0, 140),
          );
        } else {
          assert(
            `${tag}px · fixture: the seeded portfolio really is pinned — a map is drawn`,
            tag === "390" || fold.landmarks.some((l) => l.label === "map canvas"),
            fold.landmarks.map((l) => l.label).join(" | "),
          );
        }

        // THE QUESTION, in both states: is a BUILDING AND ITS STATE readable without moving
        // anything? On the phone the answer band alone is not enough — the whole point of
        // TASK-179 was that the first fact sat at y=759 of 844.
        assert(
          `${tag}px · ${state}: the answer band is above the fold`,
          fold.aboveFold.includes("answer band"),
          fold.aboveFold.join(" | "),
        );
        assert(
          `${tag}px · ${state}: at least one building is WHOLLY above the fold`,
          fold.rowsWhollyAbove >= 1,
          `${fold.rowsWhollyAbove} of ${fold.rowCount} rows, first fact at y=${fold.firstFactY}`,
        );
        if (tag === "390") {
          assert(
            `${tag}px · ${state}: the first fact is inside the top two thirds (<= ${FIRST_FACT_MAX_Y}px)`,
            fold.firstFactY !== null && fold.firstFactY <= FIRST_FACT_MAX_Y,
            `y=${fold.firstFactY} of ${fold.fold}`,
          );
        }
        await p.screenshot(`${SHOTS}/fold-${tag}-${mutate === null ? "pinned" : "nocoords"}.png`);
      } finally {
        p.close();
        c.child.kill("SIGKILL");
        if (mutate !== null) {
          execFileSync("pg_restore", ["--clean", "--if-exists", "-d", DB, DUMP], { stdio: "ignore" });
        }
      }
    }
  }
} finally {
  if (page !== null) page.close();
  if (chrome !== null) chrome.child.kill("SIGKILL");
  // Belt and braces: restore unconditionally, then PROVE it rather than announce it.
  try {
    execFileSync("pg_restore", ["--clean", "--if-exists", "-d", DB, DUMP], { stdio: "ignore" });
  } catch {
    /* already clean */
  }
}

console.log("\n--- nfc_demo, before | after ---");
const countsAfter = rowCounts();
const coordsAfter = coords();
for (const [i, line] of COUNTS_BEFORE.split("\n").entries()) {
  const now = countsAfter.split("\n")[i];
  // `sessions` grows by this file's own sign-ins and is expected to differ.
  if (line.startsWith("sessions ")) {
    console.log(`  ·    ${line}  ->  ${now}   (this run's own logins; they expire)`);
    continue;
  }
  assert(`${line}  ->  ${now}`, line === now);
}
assert(
  "nfc_demo: every coordinate is back where it was",
  COORDS_BEFORE === coordsAfter,
  COORDS_BEFORE === coordsAfter ? `${COORDS_BEFORE.split(" ").length} locations unchanged` : `${COORDS_BEFORE}\n         -> ${coordsAfter}`,
);

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILED:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nall green. screenshots in ${SHOTS}`);
