// The admin REDESIGN demo: seven captioned German segments, cut into one film.
//
//   node demo/record-redesign.mjs
//   DEMO_BASE=http://127.0.0.1:8082 node demo/record-redesign.mjs
//
// Prerequisites are backlog/docs/DEMO.md §1: a seeded `nfc_demo` and the API serving
// web/out on DEMO_BASE, same origin. Re-seed first or segment 2 opens on a worker it
// already created:
//
//   psql -q -d nfc_demo -f demo/seed.sql
//   DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs
//
// WHAT THIS IS FOR, AND HOW IT DIFFERS FROM record-admin.mjs. That one is a tour of all
// thirteen screens. This one answers ONE question — "did the redesign make the panel
// skimmable, and did it keep the six things that must never be lost" — so it walks
// journeys rather than screens, and every segment ends on the moment that matters.
//
// NOTHING HERE IS DRAWN. Every frame is headless Chrome rendering the built export against
// the demo database. No annotation, no speed-up, no cut inside a segment, no mock. The only
// post-processing is JPEG frames -> H.264, a scale, the dark house frame and the caption
// band, whose timings are MEASURED as the run goes.
//
// THE ASSERTIONS ARE THE POINT. Six load-bearing truths must survive the redesign, and a
// recording that quietly filmed their absence would be worse than no recording. Each is
// checked with `must()` at the moment the camera is on it, and the run DIES rather than
// narrating something that is not there. `must()` is what makes the negative case fail.
//
// ONE THING THE DEMO CANNOT SHOW, STATED HERE SO IT IS NOT LOOKED FOR: the correction
// drawer has NO reason/Grund field. There is no such column on `shifts` and no such key in
// messages/de.json — see backlog/docs/REDESIGN-REPORT.md §"what is missing". Segment 3
// therefore films what the drawer DOES carry, and its caption says so.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { captionDrawtexts, fitFontSize } from "./burnin.mjs";
import { attach, launchChrome, record, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8082";
const OUT = new URL("../docs/media/redesign-demo/", import.meta.url).pathname;
const WORK = "/tmp/ts-demo/redesign";
const PORT = Number(process.env.DEMO_PORT ?? 9361);
const FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";

// Never the live server. A hostname check, not a comment, because a comment has never
// stopped anybody. Same refusal as every other recorder here; `sh demo/check-guards.sh`
// runs it for real.
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`record-redesign: refusing to record against "${host}" — loopback only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

// The person invited on camera. Invented, like everyone in demo/seed.sql: an Austrian-
// sounding name at example.test, no phone number. An invented Austrian mobile number in a
// public repo is somebody's real number.
const NEW_WORKER = { name: "Bianca Reiter", email: "bianca@example.test", rate: "15,20" };

// The building whose tag URL is copied on camera. Named once: segment 5 compares the
// clipboard against THIS row's URL, and reading one row while clicking another's button is
// how the first cut went green on the wrong UUID.
const LOCATION = "Buerozentrum Handelskai";

mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

/**
 * Kill any headless Chrome still answering on this port, and WAIT for it to be gone.
 *
 * Two separate lessons:
 *  - a stray Chrome from an earlier run answers on the same port and `attach` drives THAT
 *    browser, with the previous run's viewport and cookies and no sign of it from the
 *    outside. It cost this repo a 390px pass that silently rendered at 1680.
 *  - `pkill` returns before the process has finished dying, and launchChrome's first act is
 *    to `rmSync` the profile directory Chrome is still writing to — ENOTEMPTY, on the very
 *    next run. So this polls until nothing matches instead of sleeping and hoping.
 */
function killStrayChrome() {
  for (let i = 0; i < 50; i++) {
    const alive = spawnSync("pgrep", ["-f", `remote-debugging-port=${PORT}`]).status === 0;
    if (!alive) return;
    spawnSync("pkill", ["-f", `remote-debugging-port=${PORT}`]);
    execFileSync("sleep", ["0.2"]);
  }
  throw new Error(`chrome on port ${PORT} will not die`);
}
killStrayChrome();

const { child, port } = await launchChrome({ width: 1680, height: 1050, port: PORT });
const page = await attach(port);

// The clipboard is the whole point of segment 5, and headless Chrome denies it by default:
// without this the tag URL button lands on its FALLBACK ("… konnte nicht kopiert werden"),
// which is honest software but the wrong thing to film. Granted to the demo origin only.
await page.send("Browser.grantPermissions", {
  origin: BASE,
  permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
});

// …and the permission ALONE is not enough. A headless page is never the focused document,
// and `navigator.clipboard.writeText` rejects with NotAllowedError on an unfocused one, so
// the tag-URL button landed on its manual-copy fallback every time. MEASURED, both ways:
//
//   focusEmulation=false  hasFocus=false  writeText=REJECTED: NotAllowedError
//   focusEmulation=true   hasFocus=true   writeText=ok
//
// The fallback is correct software and it is what a real user without clipboard permission
// would see — but it is not what this demo is of, and the difference is the harness, not
// the app. Segment 5 asserts the SUCCESS text and reads the clipboard back, so a silent
// regression to the fallback fails the run rather than being filmed.
await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });

/** The viewport, driven properly. `--window-size` does not resize the render in headless=new. */
const viewport = (width, height) =>
  page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });

// ---------------------------------------------------------------------------
// Captions, per segment, wall-clock stamped so a screen that took longer than expected
// keeps its caption for exactly as long as it was on camera.
// ---------------------------------------------------------------------------
let captions = [];
let t0 = 0;
const say = (text) => {
  const at = (Date.now() - t0) / 1000;
  captions.push({ at, text });
  console.log(`    ${at.toFixed(1)}s  ${text}`);
};

/**
 * The load-bearing assertion. `what` must be on the page, or the run stops.
 *
 * This is the difference between a recording and a verification. A probe whose negative
 * case cannot fail is not a probe, so every one of these was broken on purpose once and
 * shown to go red — see backlog/docs/REDESIGN-REPORT.md.
 */
async function must(what, why) {
  const there = await page.eval(
    `document.body.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(what)})`,
  );
  if (!there) throw new Error(`MISSING: ${why} — nothing on screen says "${what}"`);
  console.log(`    ok  ${why}`);
}

/** Same, for a thing that must be true of the DOM rather than of the text. */
async function mustBe(expression, why) {
  if (!(await page.eval(`!!(${expression})`))) throw new Error(`MISSING: ${why} — ${expression}`);
  console.log(`    ok  ${why}`);
}

async function signIn() {
  await page.goto(`${BASE}/login/`, { settle: 900 });
  // decision-20 + the login regression that locks the client out of their own panel:
  // this field is a USERNAME. If it ever becomes type="email" the browser starts
  // validating an address that is not one. Checked here, on camera, first.
  await mustBe(
    `document.querySelector('input[name="email"]').type === 'text' &&
     document.querySelector('input[name="email"]').autocomplete === 'username'`,
    'login is type="text" autoComplete="username", not an e-mail field',
  );
  await sleep(500);
  await page.type('input[name="email"]', ADMIN.email);
  await sleep(200);
  await page.type('input[name="password"]', ADMIN.password);
  await sleep(400);
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor(`location.pathname === '/'`, { label: "the dashboard after sign-in" });
  await sleep(1200);
}

// ---------------------------------------------------------------------------
// One segment = one screencast = one clip on disk. Recorded separately so the film can be
// re-cut, and so `clips/` in the demo library holds the pieces the final composites.
// ---------------------------------------------------------------------------
const segments = [];

async function segment({ key, title, width, height, drive }) {
  console.log(`\n── ${key} ── ${title}`);
  await viewport(width, height);
  await sleep(400);
  captions = [];
  const dir = `${WORK}/frames-${key}`;
  const result = await record(page, dir, async () => {
    t0 = Date.now();
    await drive();
  });
  segments.push({ key, title, width, height, dir, captions, seconds: result.seconds });
  console.log(`   ${result.frames} frames, ${result.seconds.toFixed(1)}s`);
}

// ===========================================================================
// 1. Dark by default: the sign-in, then a dashboard that leads with its answer.
// ===========================================================================
await segment({
  key: "01-anmeldung",
  title: "Anmeldung und Übersicht",
  width: 1680,
  height: 1050,
  async drive() {
    say("Dunkel als Standard. Die Anmeldung ist ein Benutzername, keine E-Mail-Adresse.");
    await signIn();
    say("Jeder Bildschirm stellt eine Frage. Hier: „Muss ich gerade etwas tun?“");
    await must("Muss ich gerade etwas tun?", "the dashboard leads with one question");
    await sleep(2600);
    // The answer BEFORE the evidence: four figures, then the list they came from. This is
    // the change the owner asked for — skim, do not read.
    say("Die Antwort steht oben: 3 Dinge zu erledigen, 1 Person gerade im Einsatz.");
    await must("Zu erledigen", "the dashboard answer card");
    await must("Gerade im Einsatz", "the running-shift card");
    await sleep(3800);
    say("Erst darunter die Belege — zwei unbestätigte Schichten und ein Objekt ohne Tag.");
    await page.eval("window.scrollTo({ top: 300, behavior: 'smooth' })");
    await sleep(3600);
    say("Der Zustand steht am Rand und im Wort, nicht nur in der Farbe.");
    await page.eval("window.scrollTo({ top: 640, behavior: 'smooth' })");
    await sleep(3600);
  },
});

// ===========================================================================
// 2. The invite, end to end. The enrolment code is the moment that matters: it is read
//    aloud down a phone, so it has to be on screen WITH its expiry at copy time.
// ===========================================================================
await segment({
  key: "02-mitarbeiter",
  title: "Mitarbeiter einladen",
  width: 1680,
  height: 1050,
  async drive() {
    await page.goto(`${BASE}/workers/`, { settle: 2000 });
    say("Mitarbeiter: „Wer arbeitet für uns, und wer kommt noch nicht rein?“");
    await must("Wer arbeitet für uns", "the workers question");
    await sleep(2600);

    say("Das Formular liegt in einer Schublade — die Liste bleibt die Seite.");
    await page.clickText("Mitarbeiter anlegen", { selector: "button" });
    await page.waitFor(`document.querySelector('[role="dialog"].drawer')`, { label: "the drawer" });
    await sleep(1400);

    // React generates the ids (`_R_1ilb_`) and they change between builds, so the three
    // fields being typed into are tagged by POSITION once and then typed by id. `type()`
    // needs a stable selector and a positional one would be re-evaluated per character.
    await page.eval(`(() => {
      const inputs = document.querySelectorAll('[role="dialog"] input')
      if (inputs.length < 4) throw new Error('create drawer has ' + inputs.length + ' inputs, expected 4+')
      inputs[0].id = 'demo-name'   // Name*
      inputs[1].id = 'demo-mail'   // E-Mail-Adresse (App-Anmeldung)
      inputs[3].id = 'demo-rate'   // Stundensatz
      return true
    })()`);
    await page.type("#demo-name", NEW_WORKER.name);
    await sleep(300);
    await page.type("#demo-mail", NEW_WORKER.email);
    await sleep(300);
    say("Name, App-Adresse, Stundensatz. Alles Weitere ist ausdrücklich optional.");
    await page.type("#demo-rate", NEW_WORKER.rate);
    await sleep(1800);

    await page.clickText("Mitarbeiter anlegen", { selector: '[role="dialog"] button' });
    await page.waitFor(
      `!document.querySelector('[role="dialog"]') &&
       document.body.textContent.includes(${JSON.stringify(NEW_WORKER.name)})`,
      { label: "the drawer closing onto the new worker" },
    );
    say("Gespeichert, Schublade zu, die neue Zeile steht in der Liste.");
    await sleep(2400);

    // THE MOMENT. Inline beside the row, never a modal, shown once, expiry visible at the
    // instant the code is copied — because that is when somebody writes it down.
    say("Jetzt der Zugangscode — das ist der Moment, der zählt.");
    await page.clickText(`Zugangscode erstellen von ${NEW_WORKER.name}`, { selector: "button" });
    await page.waitFor(
      `document.body.textContent.includes('Zugangscode für ${NEW_WORKER.name}')`,
      { label: "the enrolment code panel" },
    );
    await sleep(900);
    await page.eval(`(() => {
      const el = Array.from(document.querySelectorAll('*'))
        .find((e) => e.textContent.trim().startsWith('Zugangscode für'))
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return !!el
    })()`);
    await sleep(1600);

    await mustBe(
      `!document.querySelector('[role="dialog"]')`,
      "the enrolment code is an INLINE panel beside the row, not a modal",
    );
    await must(`Zugangscode für ${NEW_WORKER.name}`, "the code is shown");
    await must("Gültig bis", "the expiry is visible AT COPY TIME, not in a tooltip");
    await must("Zugangscode kopieren", "the code can be copied from here");
    say("Der Code steht neben der Zeile, nicht in einem Fenster darüber.");
    await sleep(3400);
    say("„Gültig bis“ steht daneben — die 5 Tage sieht man beim Vorlesen, nicht danach.");
    await sleep(4200);

    await page.clickText("Zugangscode kopieren", { selector: "button" });
    await page.waitFor(`document.body.textContent.includes('Zugangscode in die Zwischenablage kopiert')`, {
      label: "the copy confirmation",
    });
    say("Einmal angezeigt. Geht er verloren, wird einfach ein neuer erstellt.");
    await sleep(3200);
  },
});

// ===========================================================================
// 3. The correction drawer. TWO drawers exist and they are genuinely different; this films
//    the difference rather than asserting it in a document.
// ===========================================================================
await segment({
  key: "03-korrektur",
  title: "Schicht korrigieren",
  width: 1680,
  height: 1050,
  async drive() {
    await page.goto(`${BASE}/shifts/`, { settle: 2200 });
    say("Schichten: „Welche Schichten brauchen eine Entscheidung?“");
    await must("Welche Schichten brauchen eine Entscheidung", "the shifts question");
    await sleep(3000);

    // An AUTO-CLOSED shift on purpose: it is the only one that carries the notice
    // explaining what saving actually does to the payroll.
    say("Eine Schicht, die der 8-Stunden-Timer beendet hat. Sie zählt noch nicht.");
    await page.clickText("Korrigieren der Schicht von Elif Demir am 15.08.2026, 06:00", {
      selector: "button",
    });
    await page.waitFor(`document.querySelector('[role="dialog"].drawer')`, { label: "the drawer" });
    await sleep(1600);

    await must("Schicht korrigieren", "the CORRECT drawer, by name");
    say("„Schicht korrigieren“ — Beginn ist Pflicht, das Ende ausdrücklich nicht.");
    await mustBe(
      `(() => {
         const d = document.querySelector('[role="dialog"]')
         const ins = d.querySelectorAll('input[type="datetime-local"]')
         return ins.length === 2 && ins[0].required === true && ins[1].required === false
       })()`,
      "correct drawer: Beginn required, Ende OPTIONAL (a shift may still be running)",
    );
    await sleep(3800);

    // The honest bit. There is no free-text reason field anywhere in this drawer; what
    // there IS, is a statement of the consequence of pressing save. Filmed as it is.
    say("Statt eines Grundfelds sagt die Schublade, was das Speichern bewirkt:");
    await must("vom 8-Stunden-Timer beendet", "the drawer states why the shift is flagged");
    await must("Lohnabrechnung", "the drawer states the payroll consequence of saving");
    await sleep(4600);
    say("Sie gilt danach als bestätigt und ihre Stunden fließen in die Lohnabrechnung ein.");
    await sleep(4400);

    // The second drawer, so "two drawers, never one behind a mode flag" is a picture.
    await page.clickText("Abbrechen", { selector: '[role="dialog"] button' });
    await page.waitFor(`!document.querySelector('[role="dialog"]')`, { label: "the drawer closing" });
    await sleep(800);
    say("Nachtragen ist eine ANDERE Schublade, nicht dieselbe mit einem Schalter.");
    await page.clickText("Schicht nachtragen", { selector: "button" });
    await page.waitFor(`document.querySelector('[role="dialog"].drawer')`, { label: "the create drawer" });
    await sleep(1400);
    await must("Schicht nachtragen", "the CREATE drawer, by its own name");
    await mustBe(
      `(() => {
         const ins = document.querySelectorAll('[role="dialog"] input[type="datetime-local"]')
         return ins.length === 2 && ins[0].required === true && ins[1].required === true
       })()`,
      "create drawer: Ende is REQUIRED here — the difference that justifies two drawers",
    );
    say("Hier ist das Ende Pflicht: ein nachgetragener Tag ist immer schon vorbei.");
    await sleep(4200);
    await page.clickText("Abbrechen", { selector: '[role="dialog"] button' });
    await sleep(1000);
  },
});

// ===========================================================================
// 4. Payroll. The caveats are the honest part and they are not skipped past.
// ===========================================================================
await segment({
  key: "04-lohn",
  title: "Lohnabrechnung",
  width: 1680,
  height: 1050,
  async drive() {
    await page.goto(`${BASE}/payroll/`, { settle: 2400 });
    say("Lohnabrechnung: „Was ist diesen Monat auszuzahlen?“");
    await must("Was ist diesen Monat auszuzahlen", "the payroll question");
    await sleep(3000);

    say("Voriger Monat ist sauber — und die Seite sagt das, statt zu schweigen.");
    await must(
      "Die hier geladenen Schichten ergeben genau die Summe des Servers",
      "THE RECONCILIATION LINE: server total vs the rows actually on this page",
    );
    await sleep(4200);

    // The period switch has to CHANGE something or the caption is a lie: `lastMonth` is the
    // default and it is clean, so `thisMonth` is the period where the exclusions live.
    await page.select("#main-content select", "thisMonth");
    await page.waitFor(`document.body.textContent.includes('1. August')`, {
      label: "payroll recomputed for this month",
    });
    await sleep(1600);
    say("Dieser Monat — und jetzt fehlt etwas in der Summe.");
    await sleep(2800);

    say("Die Ausnahmen werden gezählt und benannt, nicht stillschweigend weggelassen.");
    await must("bestätigt werden", "unresolved auto-closed shifts named as a counted exclusion");
    await must("Nicht gezählt", "the excluded column exists on the answer row and the table");
    await page.eval("window.scrollTo({ top: 330, behavior: 'smooth' })");
    await sleep(4600);

    say("Jede Ausnahme ist verlinkt: „Jetzt bestätigen“ führt genau zu diesen Schichten.");
    await must("Jetzt bestätigen", "the exclusion links to the shifts that cause it");
    await sleep(4000);

    say("Und pro Zeile steht, was an ihr nicht gezählt wurde.");
    await page.eval("window.scrollTo({ top: 760, behavior: 'smooth' })");
    await sleep(4600);
  },
});

// ===========================================================================
// 5. The tag URL. This string gets written to a physical wall tag, so the copy has to work
//    and the UUID has to be the identity (decision-21).
// ===========================================================================
await segment({
  key: "05-tag",
  title: "Tag-URL kopieren",
  width: 1680,
  height: 1050,
  async drive() {
    await page.goto(`${BASE}/locations/`, { settle: 2400 });
    say("Objekte: „Welche Objekte betreuen wir, und welches Tag gehört dazu?“");
    await must("welches Tag gehört dazu", "the locations question");
    await sleep(3000);

    say("Diese Zeichenkette wird auf den NFC-Tag an der Wand geschrieben.");
    await page.eval(`(() => {
      const el = Array.from(document.querySelectorAll('td, code'))
        .find((e) => e.textContent.includes('/t?l='))
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return !!el
    })()`);
    await sleep(2000);

    // decision-21: the URI carries the location UUID, never the human short code. Asserted
    // as a SHAPE, so a slug creeping back in fails the run instead of being filmed.
    //
    // SCOPED TO THE ROW BEING COPIED, and that is not a detail. The first cut read the
    // first tag URL anywhere on the page while clicking Handelskai's button, so the
    // clipboard comparison below failed against a DIFFERENT building's UUID — six rows,
    // six URLs, all the right shape. A probe that matches any row proves nothing about the
    // row on camera; this is the same class of mistake as the card-label probe that stayed
    // green while every card was captioned with the wrong column.
    // The accessible name is the button's own TEXT, in a visually-hidden span — NOT an
    // aria-label. Matching on aria-label found zero buttons, and the cell's text is the URL
    // and that label and the UUID all run together, so the shape test has to be applied to
    // a LEAF element rather than to the cell.
    const tagUrl = await page.eval(`(() => {
      const wanted = 'Tag-URL kopieren von ${LOCATION}'
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim() === wanted)
      if (!btn) return null
      const cell = btn.closest('td, li, article')
      if (!cell) return null
      return Array.from(cell.querySelectorAll('*'))
        .filter((e) => e.children.length === 0)
        .map((e) => e.textContent.trim())
        .find((t) => /^https:\\/\\/[^ ]+\\/t\\?l=[0-9a-f-]{36}$/.test(t)) ?? null
    })()`);
    if (!tagUrl) {
      throw new Error(`MISSING: no tag URL of the shape https://…/t?l=<uuid> on ${LOCATION}'s row`);
    }
    console.log(`    ok  tag URI carries a UUID (decision-21): ${tagUrl}`);
    await must("schimmer-glanz.exe.xyz", "the tag host is the operator's, from ops/branding.json");
    await sleep(2600);

    say("Die Identität eines Objekts ist seine UUID — nie das Kürzel für Menschen.");
    await sleep(3800);

    say("Ein Klick kopiert sie, damit sie nicht abgetippt werden muss.");
    await page.clickText(`Tag-URL kopieren von ${LOCATION}`, { selector: "button" });
    await page.waitFor(`document.body.textContent.includes('in die Zwischenablage kopiert')`, {
      label: "the copy confirmation",
    });
    await sleep(1000);
    await must("in die Zwischenablage kopiert", "the copy SUCCEEDED, not the manual fallback");
    // Read the clipboard back: the confirmation is the app's claim, this is the evidence.
    const clip = await page.eval("navigator.clipboard.readText()");
    if (clip !== tagUrl) throw new Error(`clipboard holds "${clip}", the row shows "${tagUrl}"`);
    console.log(`    ok  clipboard really holds the tag URL`);
    say("Bestätigt — und die Zwischenablage enthält wirklich genau diese URL.");
    await sleep(3600);
  },
});

// ===========================================================================
// 6. 390px. The owner uses this in buildings, standing up, not at a desk.
// ===========================================================================
await segment({
  key: "06-telefon",
  title: "Dieselbe Arbeit am Telefon (390px)",
  width: 390,
  height: 844,
  async drive() {
    await page.goto(`${BASE}/`, { settle: 700 });
    await page.waitFor(`document.body.textContent.includes('Muss ich gerade etwas tun')`, {
      label: "the dashboard on the phone",
    });
    say("Dieselbe Verwaltung am Telefon, 390 Pixel breit.");
    await sleep(2800);

    // No horizontal scrolling anywhere. This was a real defect (543px of hidden width on
    // /workers/) and it is the one thing that makes a table useless standing up.
    say("Die Antwortkarten stapeln sich, sie schrumpfen nicht.");
    await mustBe(
      `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`,
      "/ at 390px: no horizontal scrolling",
    );
    await sleep(3000);
    await page.eval("window.scrollTo({ top: 520, behavior: 'smooth' })");
    await sleep(3000);

    // Caption stamped as soon as the new screen is genuinely on it, not after a long
    // settle: during a 2.6 s settle the PREVIOUS caption is still burned in, so the film
    // showed /workers/ under the payroll caption. Short settle, wait for the heading, then
    // speak — the caption still lands after the screen, never before it.
    await page.goto(`${BASE}/payroll/`, { settle: 700 });
    await page.waitFor(`document.body.textContent.includes('Was ist diesen Monat auszuzahlen')`, {
      label: "payroll on the phone",
    });
    say("Lohnabrechnung am Telefon: dieselbe Antwort, dieselben Ausnahmen.");
    await mustBe(
      `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`,
      "/payroll/ at 390px: no horizontal scrolling",
    );
    await must("Was ist diesen Monat auszuzahlen", "the same question on the phone");
    await sleep(3800);
    await page.eval("window.scrollTo({ top: 560, behavior: 'smooth' })");
    await sleep(3200);

    await page.goto(`${BASE}/workers/`, { settle: 700 });
    await page.waitFor(`document.body.textContent.includes('Wer arbeitet f\u00fcr uns')`, {
      label: "workers on the phone",
    });
    say("Mitarbeiter: keine seitliche Rolle, keine abgeschnittene Spalte.");
    await mustBe(
      `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`,
      "/workers/ at 390px: no horizontal scrolling — the 543px defect is gone",
    );
    await sleep(3000);
    await page.eval("window.scrollTo({ top: 700, behavior: 'smooth' })");
    await sleep(3200);
  },
});

// ===========================================================================
// 7. The light theme, through the control the owner actually has.
// ===========================================================================
await segment({
  key: "07-hell",
  title: "System / Dunkel / Hell",
  width: 1680,
  height: 1050,
  async drive() {
    await page.goto(`${BASE}/payroll/`, { settle: 2400 });
    say("Die Darstellung ist eine Einstellung im Kopf der Seite: System, Dunkel, Hell.");
    await mustBe(
      `(() => {
         const s = document.querySelector('.theme-switcher select')
         return s && Array.from(s.options).map((o) => o.value).join(',') === 'system,dark,light'
       })()`,
      "the theme control offers System / Dunkel / Hell",
    );
    await sleep(3400);

    say("Hell — dieselbe Seite, dieselbe Anordnung, ein Akzent.");
    await page.select(".theme-switcher select", "light");
    await sleep(2600);
    await must("Was ist diesen Monat auszuzahlen", "the light theme renders the same screen");
    await sleep(2600);
    await page.eval("window.scrollTo({ top: 330, behavior: 'smooth' })");
    await sleep(3800);
    say("Auch hell bleiben die Ausnahmen benannt und die Abstimmzeile stehen.");
    await sleep(3800);
    await page.eval("window.scrollTo({ top: 0, behavior: 'smooth' })");
    await sleep(1200);
    say("Und zurück auf Dunkel, dem Standard.");
    await page.select(".theme-switcher select", "dark");
    await sleep(3000);
  },
});

page.close();
child.kill();
killStrayChrome();

// ===========================================================================
// The cut. Seven clips, then one film.
// ===========================================================================
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
/** Length of an encoded file, in seconds. */
const seconds = (file) => {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-i", file, "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"],
    { encoding: "utf8" },
  ).trim();
  const n = Number(out);
  if (!Number.isFinite(n)) throw new Error(`ffprobe gave "${out}" for ${file}`);
  return n;
};

// The house frame: flat dark, one content card, a caption band under it, a title and
// progress dots above it. 1440 of content because that is the widest the 1680px capture can
// be shrunk to and still be read — the previous walkthrough went to 1152 (69%) and the
// payroll figures are the point of that screen.
const W = 1440;
const H = 900;
const TOP = 76;
const BOTTOM = 56;
const BG = "0x0B0C0E"; // the design system's base. Never pure black.
const ACCENT = "0x3B82F6";

/**
 * One segment, letterboxed into the content card on the house background AND HELD to the
 * length of the drive that produced it.
 *
 * The hold is the fix for the tail truncation described in demo/cdp.mjs: a screencast emits
 * no frames while nothing moves, so a segment that ends on a still screen encodes short and
 * its last captions land on the NEXT segment. The natural length is MEASURED off the concat
 * list rather than derived from it — the demuxer's handling of the final `duration` is not
 * dependable — and the encoded result is measured again and asserted below.
 */
function clipOf(seg) {
  const base = `${WORK}/base-${seg.key}.mp4`;
  const out = `${WORK}/clip-${seg.key}.mp4`;
  ff([
    "-f", "concat", "-safe", "0", "-i", `${seg.dir}/frames.txt`,
    "-vf", [
      // Fit inside the card without ever cropping: wide desktop captures land on width,
      // the 390px phone capture lands on height and keeps its phone shape.
      `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:${BG}`,
      "fps=12",
      "setsar=1",
    ].join(","),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-an",
    base,
  ]);

  // MEASURED off the encoded file, because `ffprobe` reports N/A for the duration of a
  // concat LIST — tried, and it produced a NaN that ffmpeg took as a filter argument.
  const natural = seconds(base);
  const hold = Math.max(0, seg.seconds - natural);
  console.log(
    `  ${seg.key}: drove ${seg.seconds.toFixed(1)}s, frames ${natural.toFixed(1)}s, hold ${hold.toFixed(1)}s`,
  );
  if (hold < 0.05) return base;

  // A held frame is a still picture, visibly. Nothing is sped up, cut or reordered.
  ff([
    "-i", base,
    "-vf", `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-an",
    out,
  ]);
  return out;
}

const clips = segments.map((seg) => {
  const file = clipOf(seg);
  console.log(`clip ${seg.key} ${seconds(file).toFixed(1)}s`);
  return file;
});

// Concatenate, then measure each clip so the captions and the dots land on the segment they
// describe. MEASURED off the encoded files, never off the `seconds` the recorder asked for:
// x264 rounds to whole frames and a tenth of a second of drift is a caption over the wrong
// screen.
const list = `${WORK}/list.txt`;
writeFileSync(list, `${clips.map((f) => `file '${f}'`).join("\n")}\n`);
const joined = `${WORK}/joined.mp4`;
ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);

let clock = 0;
const bounds = [];
const allCaptions = [];
for (const [i, seg] of segments.entries()) {
  const length = seconds(clips[i]);

  // Caption times are DRIVE-relative and clip length is what ffmpeg encoded; if the two
  // ever come apart again, a caption starts after its own segment has ended and is drawn
  // over the next one's footage — narrating the wrong screen, which is indistinguishable
  // from a lie. This is the assertion for the tail-truncation bug fixed in demo/cdp.mjs:
  // before that fix /payroll/ drove for 27.9 s and encoded to 15.4 s, and this throws.
  const last = seg.captions.at(-1);
  if (last && last.at >= length) {
    throw new Error(
      `segment ${seg.key}: last caption starts at ${last.at.toFixed(1)}s but the clip is ` +
        `only ${length.toFixed(1)}s — it would be drawn over the next segment. ("${last.text}")`,
    );
  }
  // The clip must be as long as the drive that produced it, or a caption stamped near the
  // end of the drive has nowhere to be drawn. Hard, not a warning: this is the check that
  // the tail hold in `clipOf` actually worked.
  if (Math.abs(length - seg.seconds) > 0.6) {
    throw new Error(
      `segment ${seg.key}: drove ${seg.seconds.toFixed(1)}s but encoded ${length.toFixed(1)}s ` +
        `— the tail hold did not land.`,
    );
  }

  bounds.push({ at: clock, until: clock + length, title: seg.title });
  // `until` is CAPPED AT THE SEGMENT BOUNDARY. Without it a segment's last caption runs
  // until the next segment's FIRST caption fires, which is a second or three after that
  // segment's footage has already started — so „die Zwischenablage enthält genau diese
  // URL“ sat over the opening of the phone segment. Found by tiling the encoded film.
  for (const c of seg.captions) {
    allCaptions.push({ at: clock + c.at, text: c.text, until: clock + length });
  }
  clock += length;
}
const total = clock;

const esc = (s) => s.replace(/'/g, "\u2019").replace(/[\\:]/g, (c) => `\\${c}`);

// The segment title, top left, and n/7, top right. Both change with the segment, so a frame
// pulled out of the middle of the film still says what it is of.
const titles = bounds.flatMap(({ at, until, title }, i) => {
  const enable = `gte(t,${at.toFixed(3)})*lt(t,${until.toFixed(3)})`;
  const size = fitFontSize(title, 24, W - 260);
  return [
    `drawtext=fontfile=${FONT}:expansion=none:text='${esc(`${i + 1}. ${title}`)}':` +
      `fontcolor=white:fontsize=${size}:x=28:y=20:enable='${enable}'`,
    `drawtext=fontfile=${FONT}:expansion=none:text='${i + 1}/${bounds.length}':` +
      `fontcolor=0x8A9099:fontsize=18:x=w-text_w-28:y=24:enable='${enable}'`,
  ];
});

// Progress dots. Seven of them, the current one filled with the one accent, the rest a
// hairline. Position and fill both carry it, so the row still reads with the colour removed.
const DOT = 8;
const GAP = 16;
const dotsWidth = bounds.length * DOT + (bounds.length - 1) * GAP;
const dots = bounds.flatMap((_, i) => {
  const x = Math.round((W - dotsWidth) / 2 + i * (DOT + GAP));
  const base = `drawbox=x=${x}:y=${TOP - 20}:w=${DOT}:h=${DOT}:color=0x3A4049:t=fill`;
  const on =
    `drawbox=x=${x - 2}:y=${TOP - 22}:w=${DOT + 4}:h=${DOT + 4}:color=${ACCENT}:t=fill:` +
    `enable='gte(t,${bounds[i].at.toFixed(3)})*lt(t,${bounds[i].until.toFixed(3)})'`;
  return [base, on];
});

// The standing banner. It rides in the TITLE bar under the segment name, because the
// bottom band belongs to the captions and an overlaid banner would sit on top of one.
const BANNER = "DEMO \u2014 lokale Datenbank, erfundene Daten, kein Live-Server";
const banner =
  `drawtext=fontfile=${FONT}:expansion=none:text='${esc(BANNER)}':` +
  `fontcolor=0x8A9099:fontsize=15:x=w-text_w-28:y=${TOP - 26}`;

const mp4 = `${OUT}admin-redesign.mp4`;
ff([
  "-i", joined,
  "-vf", [
    `pad=iw:ih+${TOP + BOTTOM}:0:${TOP}:${BG}`,
    ...titles,
    ...dots,
    banner,
    ...captionDrawtexts(allCaptions, total, { width: W, fontSize: 22, bottom: BOTTOM }),
  ].join(","),
  "-c:v", "libx264", "-preset", "slow", "-crf", "28",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
  mp4,
]);

// The clips, kept, because the demo library wants the pieces the final composites.
const clipDir = `${OUT}clips/`;
mkdirSync(clipDir, { recursive: true });
for (const [i, seg] of segments.entries()) {
  const out = `${clipDir}nfc-timesheets-redesign-${seg.key}.mp4`;
  ff([
    "-i", clips[i],
    "-vf", [
      `pad=iw:ih+${TOP + BOTTOM}:0:${TOP}:${BG}`,
      `drawtext=fontfile=${FONT}:expansion=none:text='${esc(`${i + 1}. ${seg.title}`)}':` +
        `fontcolor=white:fontsize=${fitFontSize(seg.title, 24, W - 260)}:x=28:y=20`,
      banner,
      ...captionDrawtexts(seg.captions, seconds(clips[i]), { width: W, fontSize: 22, bottom: BOTTOM }),
    ].join(","),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-an",
    out,
  ]);
  console.log(`clip -> ${out}`);
}

writeFileSync(
  `${OUT}segments.json`,
  `${JSON.stringify({ base: BASE, total, segments: bounds, captions: allCaptions }, null, 2)}\n`,
);

console.log(`\nwrote ${mp4} (${total.toFixed(1)}s, ${allCaptions.length} captions, ${bounds.length} segments)`);
