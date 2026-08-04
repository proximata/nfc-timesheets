// Records the iOS worker journey on a simulator: sign-in, a tap that opens a shift, the
// takeover screen with its running timer and its shortened tab bar, the app-icon badge,
// and the tap that closes it again.
//
//   node demo/record-ios.mjs
//
// Run `sh demo/ios-setup.sh` first — it builds with TS_TAG_HOST pointed at loopback,
// trusts the demo CA inside the simulator and installs. Then `demo/demo-server.mjs` and
// `demo/tls-front.mjs` have to be up. backlog/docs/DEMO.md has the whole sequence.
//
// The stages come from demo/journey.mjs and are the SAME stages demo/record-android.mjs
// walks, in the same order, with the same minimum durations — that is what lets
// demo/compose-devices.mjs put the two clips side by side without an edit that lies.
//
// THE NFC TAP IS MOCKED, and the app says so on screen for every frame: DemoHooks.swift
// pins a yellow band to the top of the window whenever the demo hooks are armed. There is
// no NFC radio in a simulator. That is physics, and no caption is going to change it.
//
// THE UNIVERSAL LINK IS MOCKED TOO, and that one IS worth spelling out. On a device iOS
// reads the tag with the app closed and opens https://<host>/t?l=<uuid> straight into it.
// On a simulator it cannot: `-sdk iphonesimulator` sets `ENTITLEMENTS_ALLOWED = NO`, so the
// build has no `com.apple.developer.associated-domains`, so `simctl openurl` hands the URL
// to Safari instead. The demo therefore injects the location id at the point the URL parse
// would have produced it — through TagLink.normalizedUUID, into the same TapInbox — so
// every line after the parse is the shipping code.
//
// It records the simulator's framebuffer with `simctl io recordVideo`. The Mac's screen is
// never captured, so no window, notification, chat or bank tab can end up in the file. The
// home screen that DOES appear is the simulator's own, which holds stock Apple apps and
// this app and nothing else; it is in frame because the app-icon badge is the whole point
// of that shot.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { captionFilter } from "./burnin.mjs";
import { runStages } from "./journey.mjs";
import { writePng } from "./png.mjs";

const BUNDLE = "io.github.qwadratic.NFCTimeSheets";
const API = process.env.DEMO_API ?? "http://127.0.0.1:8082";
const IDENTITY = process.env.DEMO_IDENTITY ?? "/tmp/ts-demo/identity.json";
const OUT = new URL("../docs/media/", import.meta.url).pathname;

// Same guard as record-admin.mjs and record-android.mjs. The phone must never be pointed
// at the live server.
if (!["127.0.0.1", "localhost"].includes(new URL(API).hostname)) {
  console.error("record-ios: DEMO_API must be loopback.");
  process.exit(1);
}

const simctl = (...args) => execFileSync("xcrun", ["simctl", ...args], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The product ships German (decision-8) and the Android recorder forces de-AT with
// `cmd locale set-app-locales`. The simulator here is an en-AT device, so without this the
// iOS pane read "Log / Materials / History / Settings" under a shared caption promising
// "Verlauf is gone from the tab bar" — a side-by-side whose two halves were not the same
// product. NSUserDefaults reads -AppleLanguages out of the argument domain, so the
// override is per launch and per app: nothing about the device is changed.
const GERMAN = ["-AppleLanguages", "(de-AT)", "-AppleLocale", "de_AT"];

/** Terminate, then start fresh with these argv. A cold launch is also the REAL tap path:
 *  a background NFC read happens with the app closed and launches it. */
async function relaunch(...args) {
  try {
    simctl("terminate", "booted", BUNDLE);
  } catch {
    /* not running */
  }
  await sleep(1200);
  simctl("launch", "booted", BUNDLE, "--ts-demo", ...args, ...GERMAN);
}

// ---------------------------------------------------------------------------
// Admin side: one location UUID, over the same HTTP API a director uses.
// ---------------------------------------------------------------------------
const login = await fetch(`${API}/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@example.test", password: "demo-nur-lokal-2026" }),
});
if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
const cookie = login.headers.getSetCookie()[0].split(";")[0];

const data = await (await fetch(`${API}/admin/data`, { headers: { cookie } })).json();
const location = data.locations.find((l) => l.slug === "handelskai-94");
if (!location) throw new Error("demo seed is missing handelskai-94");

// The identity demo/demo-server.mjs minted at boot. It is an Apple-shaped RS256 token
// signed with a key only that process has, for an invented address in the seed.
const identity = JSON.parse(readFileSync(IDENTITY, "utf8"));

// PRE-FLIGHT: this worker must not already be clocked in. The server is authoritative for
// open shifts (decision-19), so a leftover open shift from a run that died mid-journey
// turns the first tap of the next run into a clock-OUT, and the takeover screen this whole
// clip exists to show never appears. Measured on the Android side, where it cost a take.
const worker = data.workers.find((w) => w.email === identity.email);
if (!worker) throw new Error(`no worker in the demo seed has the address ${identity.email}`);
const stale = data.shifts.find((s) => s.worker_id === worker.id && s.end_time === null);
if (stale) {
  throw new Error(
    `${worker.name} still has shift ${stale.id} open since ${stale.start_time} — the first tap ` +
      "would close it instead of opening one. Re-seed: psql -q -d nfc_demo -f demo/seed.sql",
  );
}

console.log(`signing in as ${identity.email}; tag location ${location.slug} ${location.id}`);

// ---------------------------------------------------------------------------
// Back to a first-launch phone. The DATA CONTAINER is wiped rather than the app
// uninstalled: the session cookie, the UserDefaults cache and the local SwiftData store
// all live there, but the notification authorization does NOT — it belongs to SpringBoard.
// Uninstalling would throw that away and put the permission alert in the middle of the
// recording. `sh demo/ios-setup.sh --allow-notifications` grants it once.
// ---------------------------------------------------------------------------
try {
  simctl("terminate", "booted", BUNDLE);
} catch {
  /* not running */
}
const container = simctl("get_app_container", "booted", BUNDLE, "data");
for (const dir of ["Library", "Documents", "tmp"]) rmSync(`${container}/${dir}`, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Record.
// ---------------------------------------------------------------------------
mkdirSync("/tmp/ts-demo", { recursive: true });
const raw = "/tmp/ts-demo/ios-raw.mov";
rmSync(raw, { force: true });

// THE APP IS OPENED BEFORE THE RECORDER STARTS, same rule as the Android recorder: the
// first frames must not be a home screen. It is opened with no demo arguments, so what is
// on screen is the real signed-out state.
await relaunch();
await sleep(5000);

const rec = spawn("xcrun", ["simctl", "io", "booted", "recordVideo", "--codec", "h264", "-f", raw], {
  stdio: "ignore",
});
// t0 IS THE SPAWN, not the end of the settle sleep. Caption times are stamped against t0
// and then used as `enable='between(t,...)'` on the RAW FILE, whose t=0 is when recording
// started — starting the clock after a 2.5 s settle put every caption 2.5 s early.
const t0 = Date.now();
await sleep(2500); // recordVideo takes a moment to actually start writing frames

/** Caption windows, in seconds from t0. Filled in as the run goes, never guessed. */
const captions = [];
const say = (text) => {
  captions.push({ at: (Date.now() - t0) / 1000, text });
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${text}`);
};

/** A still off the framebuffer, halved, taken DURING the run so it can never show a state
 *  the video does not. */
function shot(name) {
  const src = `/tmp/ts-demo/${name}-raw.png`;
  simctl("io", "booted", "screenshot", src);
  writePng(src, `${OUT}${name}.png`, { width: 440 });
  console.log("still", name);
}

const stages = await runStages(
  {
    async launch() {
      say("iOS app, first launch - Sign in with Apple and nothing else");
      shot("ios-signin");
      await sleep(4000);
      // NOT edited out, and not a demo artefact. A fresh install has no cookie, so
      // Session.restore's GET /auth/session comes back 401, and the .sessionRejected
      // observer sets `signedOut(reason: "Your session ended. Sign in again.")`
      // (Auth.swift:240) on a state that was .unknown a moment earlier. Reachable on a
      // real phone, and the string is hardcoded English in a German-default product
      // (decision-8). Reported rather than hidden.
      say("The red line is a real bug - a fresh install has no session to end");
      await sleep(4000);
      say("A simulator has no Apple ID, so the demo server mints an RS256 token");
    },

    async signin() {
      say("Signature, issuer, audience, expiry and nonce are all checked for real");
      await relaunch("--ts-demo-signin", identity.identity_token, "--ts-demo-nonce", identity.nonce);
      await sleep(9000);
      say("Signed in. This is the app as it looked before a shift: a list.");
    },

    async tapin() {
      say("NFC TAP IS MOCKED - a simulator has no NFC radio");
      await sleep(4000);
      say("The location id is injected where the tag URL would have produced it");
      await relaunch("--ts-demo-tap", location.id);
      await sleep(9000);
    },

    async takeover() {
      say("THE TAKEOVER. Before, a clock-in changed one small pill on one row.");
      shot("ios-shift");
      await sleep(7000);
      say("Building named, state in words, and the clock counting up in 64pt");
    },

    async locked() {
      say("Verlauf is gone from the tab bar. Material and Einstellungen stay.");
      await sleep(6000);
      say("Not a kiosk: signing out and asking for material are one tap away");
    },

    async outside() {
      say("Outside the app: the icon badge. It survives a restart.");
      simctl("launch", "booted", "com.apple.springboard");
      await sleep(6000);
      shot("ios-badge");
      await sleep(3000);
      say("No Live Activity: the widget extension target does not exist yet");
    },

    async tapout() {
      say("MOCKED TAP AGAIN - the same location ends the shift");
      await relaunch("--ts-demo-tap", location.id);
      await sleep(10000);
    },

    async cleared() {
      say("Closed, sent, and the tab bar is whole again");
      shot("ios-closed");
      await sleep(5000);
      say("The badge went with it");
      simctl("launch", "booted", "com.apple.springboard");
      await sleep(5000);
    },
  },
  { t0, say, sleep },
);

const total = (Date.now() - t0) / 1000;
rec.kill("SIGINT");
await sleep(4000);

writeFileSync("/tmp/ts-demo/ios-stages.json", `${JSON.stringify({ total, stages }, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Burn the captions in. demo/burnin.mjs explains why they are in a padded bar rather than
// a box over the picture, and why `expansion=none` is not optional.
// ---------------------------------------------------------------------------
const mp4 = `${OUT}ios-journey.mp4`;
execFileSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error", "-i", raw,
    "-vf", captionFilter(captions, total, {
      width: 440,
      fontSize: 14,
      top: 26,
      bottom: 40,
      banner: "DEMO \u2014 iOS Simulator, local server, NFC MOCKED",
    }).join(","),
    "-c:v", "libx264", "-preset", "slow", "-crf", "30",
    // -an is not optional. A screen recording that keeps its audio track keeps whatever
    // was said in the room while it ran.
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    mp4,
  ],
  { stdio: "inherit" },
);
console.log(`wrote ${mp4} (${total.toFixed(1)}s, ${captions.length} captions)`);
