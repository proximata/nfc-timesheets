// Records the admin panel walkthrough and the stills that go with it.
//
//   node demo/record-admin.mjs            # video + stills into docs/media/
//   DEMO_BASE=http://127.0.0.1:8082 node demo/record-admin.mjs
//
// Prerequisites are in backlog/docs/DEMO.md: a seeded nfc_demo database and the API
// serving web/out on DEMO_BASE. It refuses to run against anything that is not a
// loopback address — see the guard below.
//
// EVERY SCREEN IN THE SIDEBAR IS IN HERE, and that is the point of this pass. The
// previous recording covered eight paths and silently skipped /payroll/, /clients/ and
// /inventory/ — payroll being, on a product that exists to pay people, the screen that
// matters most. The list of screens is therefore ASSERTED against lib/nav.ts rather than
// kept in somebody's head: leave one out and the run fails before it records anything.
//
// Everything on screen comes out of the demo database. Nothing is drawn, annotated,
// composited or sped up. The only post-processing is JPEG frames -> H.264, a scale, and
// the caption band, whose timings are MEASURED as the run goes rather than guessed.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { captionFilter } from "./burnin.mjs";
import { attach, launchChrome, record, sleep } from "./cdp.mjs";
import { writePng } from "./png.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8082";
const OUT = new URL("../docs/media/", import.meta.url).pathname;
const WORK = "/tmp/ts-demo/frames-admin";

// The demo must never be pointed at the live server. This is the guard for that, and it
// is a hostname check rather than a comment, because a comment has never stopped anybody.
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`record-admin: refusing to record against "${host}" — loopback only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

mkdirSync(OUT, { recursive: true });

const { child, port } = await launchChrome({ width: 1680, height: 1000 });
const page = await attach(port);

// ---------------------------------------------------------------------------
// Captions. Burned into the frames, not written in a README, because a video travels
// away from the text that came with it. `say()` stamps wall-clock, so a screen that took
// longer than expected keeps its caption for exactly as long as it was on screen.
// ---------------------------------------------------------------------------
const captions = [];
let t0 = 0;
const say = (text) => {
  const at = (Date.now() - t0) / 1000;
  captions.push({ at, text });
  console.log(`  ${at.toFixed(1)}s  ${text}`);
};

/** Every screen the sidebar offers. Ticked off as the walkthrough visits it. */
const visited = new Set();
async function open(label, path) {
  await page.clickText(label, { selector: "nav a" });
  await page.waitFor(`location.pathname === ${JSON.stringify(path)}`, { label });
  visited.add(path);
  await sleep(900);
}

/**
 * Scroll to whatever element carries `text`, WAIT FOR THE SCROLL, and only then stamp the
 * caption. Two separate lessons, both from watching the frames back:
 *
 *  - a silent miss narrated an empty screen, so a text that is not on the page throws;
 *  - a caption stamped BEFORE a smooth scroll is a caption describing the screen the
 *    viewer has not been shown yet. Three seconds of "look at this" over something else
 *    is indistinguishable from a lie.
 */
async function show(text, caption, pause) {
  const found = await page.eval(`(() => {
    const hit = Array.from(document.querySelectorAll('td, li, p'))
      .find((el) => el.textContent.includes(${JSON.stringify(text)}))
    if (hit) hit.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return !!hit
  })()`);
  if (!found) throw new Error(`nothing on screen says "${text}" — ${caption}`);
  await sleep(1600);
  say(caption);
  await sleep(pause);
}

/** Sign in the way the director does: two fields and a button, not an injected cookie. */
async function signIn() {
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.type('input[name="email"]', ADMIN.email);
  await sleep(200);
  await page.type('input[name="password"]', ADMIN.password);
  await sleep(400);
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor(`location.pathname === '/'`, { label: "the dashboard after sign-in" });
  await sleep(1200);
}

const result = await record(page, WORK, async () => {
  t0 = Date.now();

  // 1. Sign in. decision-20: email + password, no PIN.
  say("Admin panel, German, served by the same process as the API");
  await signIn();

  // 2. Übersicht — what needs attention now: someone clocked in, two shifts the 8h timer
  //    closed that nobody has confirmed (decision-10), a building with no shifts at all.
  visited.add("/");
  say("Uebersicht: who is on site, and what is holding up the payroll");
  await page.scrollTo("h2, [id]", { pause: 1600 });
  await page.eval("window.scrollTo({ top: 260, behavior: 'smooth' })");
  await sleep(2600);
  await page.eval("window.scrollTo({ top: 900, behavior: 'smooth' })");
  await sleep(2600);

  // 3. Schichten — the log itself, and the two auto-closed rows that are excluded from pay.
  await open("Schichten", "/shifts/");
  say("Schichten: every clock-in, filterable, exportable");
  await page.scrollTo("#shift-list-heading", { pause: 3000 });
  await page.eval("window.scrollBy({ top: 520, behavior: 'smooth' })");
  await sleep(3000);

  // 4. Mitarbeiter — rates, and the enrolment code an Android worker signs in with.
  await open("Mitarbeiter", "/workers/");
  say("Mitarbeiter: hourly rates, and the enrolment code Android signs in with");
  await page.scrollTo("#workers-list-heading", { pause: 3400 });
  await page.eval("window.scrollBy({ top: 420, behavior: 'smooth' })");
  await sleep(2800);

  // 5. Objekte — buildings, the tag URL that is written to the NFC tag, and the
  //    read-only client link. The link is MINTED ON CAMERA and opened at the end.
  await open("Objekte", "/locations/");
  say("Objekte: address, client, contract, and the URL written on the NFC tag");
  await page.scrollTo("#locations-list-heading", { pause: 3200 });
  await page.eval("window.scrollBy({ top: 380, behavior: 'smooth' })");
  await sleep(2600);

  say("A read-only link for the client contact person, minted here");
  await page.clickText("Mit Petra Aigner teilen");
  await page.waitFor(`document.body.textContent.includes('Link für Petra Aigner')`, {
    label: "the fresh client link",
  });
  await sleep(1000);
  // block 'start' and not 'center': the panel is taller than a third of the viewport, so
  // centring it pushed the URL — the one thing this shot is of — off the top edge.
  await page.scrollTo(".share-panel", { pause: 4200, block: "start" });
  const portalUrl = await page.eval(`document.querySelector('.share-panel code').textContent`);

  // 6. Kunden — clients and the people at them. Skipped by the previous recording.
  await open("Kunden", "/clients/");
  say("Kunden: the companies under contract, and who is reported to");
  await page.scrollTo("table", { pause: 3400 });
  await page.eval(`(() => {
    const h = Array.from(document.querySelectorAll('h2'))
      .find((e) => e.textContent.includes('Alle Ansprechpersonen'))
    if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return !!h
  })()`);
  await sleep(3600);

  // 7. Produkte & Geräte — the catalogue every material request is mapped onto. Also
  //    skipped by the previous recording.
  await open("Produkte & Geräte", "/inventory/");
  say("Produkte & Geraete: the catalogue, with a unit cost per line");
  await page.scrollTo("#inventory-list-heading", { pause: 3000 });
  await page.eval("window.scrollBy({ top: 420, behavior: 'smooth' })");
  await sleep(3000);

  // 8. Materialanforderungen — THE LIFECYCLE, driven one state at a time on camera:
  //    eingereicht -> genehmigt -> bestellt -> geliefert. Each click is a real POST.
  await open("Materialanforderungen", "/material-requests/");
  say("Materialanforderungen: what the crew asked for, in their own words");
  await page.scrollTo("#materials-queue-heading", { pause: 3400 });

  say("The lifecycle, one real click at a time. 1/3: genehmigen");
  await page.clickText("Genehmigen – Anforderung von Elif Demir");
  await sleep(3000);
  say("2/3: als bestellt markieren — the cost lands in THIS month");
  await page.clickText("Als bestellt markieren – Anforderung von Elif Demir");
  await sleep(3000);
  say("3/3: als geliefert markieren");
  await page.clickText("Als geliefert markieren – Anforderung von Elif Demir");
  await sleep(3400);

  // "Nur offene" is the default and it HIDES anything delivered — including the request
  // just walked to the end of the lifecycle. The two states this section is about only
  // exist on delivered rows, so the filter has to be opened first. Found by looking at
  // the recorded frames: the first cut scrolled to elements that were not in the DOM.
  say("Show the finished ones too - the default list hides them");
  await page.select("#main-content select", "all");
  await sleep(2400);

  await show("noch nicht abgeholt", "Delivered - but the app has NOT picked it up yet", 4600);
  await show(
    "vom Mitarbeiter gesehen",
    "Admin 'delivered' and worker 'seen' are two different events",
    4600,
  );
  say("There is no push here. The app polls, and the panel says exactly that.");
  await sleep(4000);

  // 9. Lohnabrechnung — the money that is actually paid out, and the reason it is not the
  //    naive sum. The screen the previous recording left out entirely.
  await open("Lohnabrechnung", "/payroll/");
  say("LOHNABRECHNUNG: hours and pay per worker, for one pay period");
  await page.waitFor(`document.querySelector('#payroll-result-heading')`, { label: "payroll" });
  await sleep(2600);
  await page.eval("window.scrollTo({ top: 380, behavior: 'smooth' })");
  await sleep(4400);
  say("Last month is clean, and the panel says so rather than staying silent");
  await page.eval("window.scrollTo({ top: 700, behavior: 'smooth' })");
  await sleep(4400);

  // The period switch is the point of this beat, so it has to CHANGE something. The
  // payroll default is already `lastMonth` (a rolling window is not a pay period), and
  // the two unresolved auto-closed shifts are dated this month — so this month is the
  // period where the exclusions actually appear. Selecting `lastMonth` here, as the first
  // cut did, changed nothing at all and the caption would have been a lie.
  await page.eval("window.scrollTo({ top: 0, behavior: 'smooth' })");
  await sleep(900);
  // `#main-content select` and not `select`: the app header carries the locale switcher,
  // which is earlier in the DOM and would swallow this.
  await page.select("#main-content select", "thisMonth");
  // Caption AFTER the table has actually been recomputed, not before it.
  await page.waitFor(`document.body.textContent.includes('1. August')`, {
    label: "payroll recomputed for this month",
  });
  await sleep(1400);
  say("This month instead - and now something IS missing from the total");
  await sleep(3600);
  await show(
    "bestätigt werden",
    "Two shifts the 8-hour timer closed: excluded, counted, named and linked",
    5000,
  );
  await page.eval("window.scrollTo({ top: 1000, behavior: 'smooth' })");
  await sleep(4000);

  // 10. Gewinn & Verlust — first ungraded (and it says so), then with 12% typed in.
  await open("Gewinn & Verlust", "/pl/");
  say("Gewinn & Verlust per building: revenue, labour, material, margin");
  await page.waitFor(`document.querySelector('#pl-result-heading')`, { label: "the P&L table" });
  await page.scrollTo("#pl-result-heading", { pause: 4000 });
  say("No target margin yet, so nothing is graded — it does not invent one");
  await page.scrollTo("#pl-baseline-heading", { pause: 2400 });
  await page.type('input[type="text"], #pl-baseline-heading ~ * input', "12");
  await sleep(600);
  await page.clickText("Zielmarge speichern");
  await sleep(2000);
  say("12% target: three buildings are now flagged, one of them loses money");
  await page.scrollTo("#pl-result-heading", { pause: 4400 });

  // 11. Vertragsverwaltung — a price with a start date, and the period it replaced still
  //     on file with an end date rather than deleted (decision-28).
  await open("Vertragsverwaltung", "/contracts/");
  say("Vertragsverwaltung: the price per building, and its history");
  await page.scrollTo("#contracts-buildings-heading", { pause: 2600 });
  await page.clickText("Verlauf und Änderung von Buerozentrum Handelskai");
  say("A price change ends the old row, it never overwrites it (decision-28)");
  await sleep(4600);

  // 12. Objektauswertung — hours worked against hours agreed, plus the honest statement
  //     that this build carries no Google Maps key.
  await open("Objektauswertung", "/analytics/");
  say("Objektauswertung: hours worked against hours agreed, per building");
  await page.eval("window.scrollTo({ top: 760, behavior: 'smooth' })");
  await sleep(3600);
  say("This build has no Google Maps key, and says so instead of drawing nothing");
  await page.eval("window.scrollTo({ top: 1400, behavior: 'smooth' })");
  await sleep(3600);

  // 13. The client portal — the one page somebody outside the company ever sees. Opened
  //     with the link that was minted on camera at step 5.
  say("The client portal, opened with the link minted three minutes ago");
  await page.goto(portalUrl, { settle: 3000 });
  await page.waitFor(`document.body.textContent.includes('Reinigungsnachweis')`, {
    label: "the client portal",
  });
  await sleep(3000);
  say("Date, first name, duration. Nothing else leaves the company.");
  await page.eval("window.scrollTo({ top: 420, behavior: 'smooth' })");
  await sleep(4400);
});

console.log(`captured ${result.frames} frames over ${result.seconds.toFixed(1)}s`);

// ---------------------------------------------------------------------------
// The completeness assertion. lib/nav.ts is the sidebar; if a screen is added there and
// not here, this run fails rather than quietly shipping another incomplete walkthrough.
// ---------------------------------------------------------------------------
// Read as text, not imported: lib/nav.ts is TypeScript and this file is plain Node. One
// regex over the PRIMARY_NAV block beats a transpiler in the dependency budget.
// Anchored on the DECLARATION, not on the first mention of the name: the doc comment
// above PRIMARY_NAV talks about FUTURE_NAV, so slicing between the two names gave an
// empty string and an assertion that could never fail.
const navSource = readFileSync(new URL("../web/lib/nav.ts", import.meta.url), "utf8");
const primary = /PRIMARY_NAV: readonly NavItem\[\] = \[([\s\S]*?)\]/.exec(navSource)?.[1] ?? "";
const navPaths = [...primary.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
if (navPaths.length === 0) throw new Error("could not read PRIMARY_NAV out of web/lib/nav.ts");

const missed = navPaths.filter((p) => !visited.has(p));
if (missed.length > 0) {
  console.error(`record-admin: the walkthrough never opened ${missed.join(", ")} — incomplete.`);
  page.close();
  child.kill();
  process.exit(1);
}
console.log(`covered all ${navPaths.length} sidebar screens plus the client portal`);

// ---------------------------------------------------------------------------
// Stills. Taken AFTER the walkthrough so the 12% target margin is already saved and the
// P&L still shows a graded table rather than five "nicht beurteilbar" rows.
// ---------------------------------------------------------------------------
const stills = [
  { path: "/", name: "admin-dashboard", scroll: 0 },
  { path: "/payroll/", name: "admin-payroll", scroll: 620 },
  { path: "/material-requests/", name: "admin-material-requests", scroll: 900 },
  { path: "/pl/", name: "admin-pl", scroll: 1250 },
  { path: "/clients/", name: "admin-clients", scroll: 620 },
  { path: "/inventory/", name: "admin-inventory", scroll: 700 },
  {
    path: "/contracts/",
    name: "admin-contracts",
    // The list alone shows one price per building, which is what the screen looked like
    // BEFORE 005. The history panel is the point, so the still opens it.
    async prepare() {
      await page.clickText("Verlauf und Änderung von Buerozentrum Handelskai");
      await page.waitFor(`document.body.textContent.includes('Vertragsverlauf')`, {
        label: "the contract history panel",
      });
      await sleep(600);
      await page.eval(`(() => {
        const h = Array.from(document.querySelectorAll('h2, h3'))
          .find((e) => e.textContent.includes('Vertragsverlauf'))
        if (h) h.scrollIntoView({ block: 'start' })
        return !!h
      })()`);
      await sleep(600);
    },
  },
  { path: "/analytics/", name: "admin-analytics", scroll: 1400 },
  { path: "/shifts/", name: "admin-shifts", scroll: 700 },
  { path: "/workers/", name: "admin-workers", scroll: 1500 },
  { path: "/locations/", name: "admin-locations", scroll: 1250 },
];

for (const still of stills) {
  await page.goto(`${BASE}${still.path}`, { settle: 2400 });
  if (still.prepare) await still.prepare();
  if (still.scroll) {
    await page.eval(`window.scrollTo(0, ${still.scroll})`);
    await sleep(700);
  }
  // Captured at 1680 so the wide tables do not wrap, written at 1280 so the screenshots
  // do not add a megabyte to a public repo. Downscaled, never re-rendered narrow.
  const raw = `/tmp/ts-demo/${still.name}-raw.png`;
  await page.screenshot(raw);
  writePng(raw, `${OUT}${still.name}.png`, { width: 1280 });
  console.log("still", still.name);
}

page.close();
child.kill();

// ---------------------------------------------------------------------------
// Encode. 1152 wide, 10 fps, no audio track at all (`-an`), yuv420p so it plays in
// GitHub's own player and in QuickTime. crf 32 was chosen by reading the P&L table back
// out of the encoded file, not by taste: the numbers on that screen are the point of it.
//
// The caption band sits at the BOTTOM and the demo banner at the top, so neither ever
// covers a table row that a caption is pointing at.
// ---------------------------------------------------------------------------
const mp4 = `${OUT}admin-walkthrough.mp4`;
execFileSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", `${WORK}/frames.txt`,
    "-vf", captionFilter(captions, result.seconds, {
      width: 1152,
      fps: 10,
      fontSize: 21,
      banner: "DEMO \u2014 local database, invented data, no live server",
    }).join(","),
    "-c:v", "libx264", "-preset", "veryslow", "-crf", "32",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    mp4,
  ],
  { stdio: "inherit" },
);
const total = result.seconds;
console.log(`wrote ${mp4} (${total.toFixed(1)}s, ${captions.length} captions)`);
