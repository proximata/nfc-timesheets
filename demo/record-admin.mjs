// Records the admin panel walkthrough and the stills that go with it.
//
//   node demo/record-admin.mjs            # video + stills into docs/media/
//   DEMO_BASE=http://127.0.0.1:8082 node demo/record-admin.mjs
//
// Prerequisites are in backlog/docs/DEMO.md: a seeded nfc_demo database and the API
// serving web/out on DEMO_BASE. It refuses to run against anything that is not a
// loopback address — see the guard below.
//
// Everything on screen comes out of the demo database. Nothing is drawn, annotated,
// composited or sped up. The only post-processing is JPEG frames -> H.264 and a scale
// to 1280 wide.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
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
  // 1. Sign in. decision-20: email + password, no PIN.
  await signIn();

  // 2. Übersicht — what needs attention now: someone clocked in, two shifts the 8h timer
  //    closed that nobody has confirmed (decision-10), a building with no shifts at all.
  await page.scrollTo("h2, [id]", { pause: 1400 });
  await page.eval("window.scrollTo({ top: 260, behavior: 'smooth' })");
  await sleep(1800);

  // 3. Materialanforderungen — the queue, and one request actually moved a step.
  await page.clickText("Materialanforderungen", { selector: "nav a" });
  await page.waitFor(`document.querySelector('#materials-queue-heading')`, {
    label: "the material request list",
  });
  await sleep(900);
  await page.scrollTo("#materials-queue-heading", { pause: 1600 });
  await page.clickText("Genehmigen – Anforderung von Elif Demir");
  await sleep(2200);

  // 4. Vertragsverwaltung — a price with a start date, and the period it replaced still
  //    on file with an end date rather than deleted.
  await page.clickText("Vertragsverwaltung", { selector: "nav a" });
  await page.waitFor(`document.querySelector('#contracts-buildings-heading')`, {
    label: "the contract list",
  });
  await sleep(800);
  await page.scrollTo("#contracts-buildings-heading", { pause: 1400 });
  await page.clickText("Verlauf und Änderung von Buerozentrum Handelskai");
  await sleep(2600);

  // 5. Gewinn & Verlust — first with no target margin (nothing is graded, and it says so),
  //    then with 12% typed in, at which point three buildings are flagged.
  await page.clickText("Gewinn & Verlust", { selector: "nav a" });
  await page.waitFor(`document.querySelector('#pl-result-heading')`, { label: "the P&L table" });
  await sleep(900);
  await page.scrollTo("#pl-result-heading", { pause: 2400 });
  await page.scrollTo("#pl-baseline-heading", { pause: 1000 });
  await page.type('input[type="text"], #pl-baseline-heading ~ * input', "12");
  await sleep(500);
  await page.clickText("Zielmarge speichern");
  await sleep(1800);
  await page.scrollTo("#pl-result-heading", { pause: 2600 });

  // 6. Objektauswertung — hours worked against hours agreed, plus the honest statement
  //    that this build carries no Google Maps key.
  await page.clickText("Objektauswertung", { selector: "nav a" });
  await page.waitFor(`document.body.textContent.includes('Karte')`, {
    label: "the analytics screen",
  });
  await sleep(900);
  await page.eval("window.scrollTo({ top: 760, behavior: 'smooth' })");
  await sleep(2000);
  await page.eval("window.scrollTo({ top: 1400, behavior: 'smooth' })");
  await sleep(2400);

  // 7. Lohnabrechnung — the money that is actually paid out.
  await page.clickText("Lohnabrechnung", { selector: "nav a" });
  await sleep(1600);
  await page.eval("window.scrollTo({ top: 700, behavior: 'smooth' })");
  await sleep(2400);
});

console.log(`captured ${result.frames} frames over ${result.seconds.toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Stills. Taken AFTER the walkthrough so the 12% target margin is already saved and the
// P&L still shows a graded table rather than five "nicht beurteilbar" rows.
// ---------------------------------------------------------------------------
const stills = [
  { path: "/", name: "admin-dashboard", scroll: 0 },
  { path: "/material-requests/", name: "admin-material-requests", scroll: 900 },
  { path: "/pl/", name: "admin-pl", scroll: 1250 },
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
  // Captured at 1680 so the wide tables do not wrap, written at 1280 so eight screenshots
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
// ---------------------------------------------------------------------------
const mp4 = `${OUT}admin-walkthrough.mp4`;
execFileSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", `${WORK}/frames.txt`,
    "-vf", "scale=1152:-2,fps=10",
    "-c:v", "libx264", "-preset", "veryslow", "-crf", "32",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    mp4,
  ],
  { stdio: "inherit" },
);
console.log(`wrote ${mp4}`);
