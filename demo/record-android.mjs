// Records the Android worker journey on an emulator: enrolment code sign-in, a tag URL
// opening the app and starting a shift, the same URL ending it, the history, the material
// tab.
//
//   node demo/record-android.mjs
//
// Run demo/android-setup.sh first — the emulator has to be pointed at the local demo
// server before anything here means anything. backlog/docs/DEMO.md has the whole sequence.
//
// THE NFC TAP IS MOCKED and the recording says so on screen, in the caption that is
// burned into the frames, for as long as the mocked steps are visible. No emulator has NFC
// hardware; `adb shell pm list features` lists no `android.hardware.nfc`, so
// `NfcAdapter.getDefaultAdapter()` returns null. That is physics. What IS demonstrated is
// every line after the OS hands the URL to the app — which is the same code either way.
//
// It records the device screen with `screenrecord`, on the device. The Mac's screen is
// never captured, so no window, notification, chat or bank tab can end up in the file.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { writePng } from "./png.mjs";

const ADB = `${process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools"}/platform-tools/adb`;
const PKG = "io.github.qwadratic.NFCTimeSheets";
const ACTIVITY = `${PKG}/io.github.qwadratic.nfctimesheets.MainActivity`;
const API = process.env.DEMO_API ?? "http://127.0.0.1:8082";
const OUT = new URL("../docs/media/", import.meta.url).pathname;
const FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";

// Same guard as record-admin.mjs. The phone must never be pointed at the live server.
if (!["127.0.0.1", "localhost"].includes(new URL(API).hostname)) {
  console.error("record-android: DEMO_API must be loopback.");
  process.exit(1);
}

const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Device is 1080x2400. Everything below is in device pixels.
const TAP = {
  codeField: [540, 610],
  signIn: [540, 883],
  refresh: [540, 1590],
  tabRecord: [126, 2242],
  tabMaterial: [402, 2242],
  tabHistory: [677, 2242],
};

// ---------------------------------------------------------------------------
// Admin side: sign in, take a location UUID and mint one enrolment code. Exactly what a
// director does on the Mitarbeiter screen, over the same HTTP API.
// ---------------------------------------------------------------------------
const login = await fetch(`${API}/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@example.test", password: "demo-nur-lokal-2026" }),
});
if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
const cookie = login.headers.getSetCookie()[0].split(";")[0];

const data = await (await fetch(`${API}/admin/data`, { headers: { cookie } })).json();
const worker = data.workers.find((w) => w.name === "Marta Nowak");
const location = data.locations.find((l) => l.slug === "donaufeld-101");
if (!worker || !location) throw new Error("demo seed is missing Marta Nowak / donaufeld-101");

const enrol = await (
  await fetch(`${API}/admin/workers/${worker.id}/enrolment-code`, {
    method: "POST",
    headers: { cookie },
  })
).json();
const code = enrol.code;
const tagUrl = `https://timesheets.exe.xyz/t?l=${location.id}`;
console.log(`code ${code} for ${worker.name}; tag ${tagUrl}`);

// ---------------------------------------------------------------------------
// Back to a first-launch phone: clear the app's own storage, which is where the session
// cookie and the local shift log live. The system-level locale override is not app data
// and survives, but it is re-applied anyway so a fresh machine gets German too.
// ---------------------------------------------------------------------------
adb("shell", "pm", "clear", PKG);
try {
  adb("shell", "cmd", "locale", "set-app-locales", PKG, "--user", "current", "--locales", "de-AT");
} catch {
  console.warn("could not force de-AT; the emulator's own locale will decide");
}
await sleep(1500);

// ---------------------------------------------------------------------------
// Record.
// ---------------------------------------------------------------------------
mkdirSync("/tmp/ts-demo", { recursive: true });
adb("shell", "rm", "-f", "/sdcard/demo.mp4");

// THE APP IS OPENED BEFORE THE RECORDER STARTS, and that ordering is the whole reason
// this comment exists. The previous recording in this repo was made with a desktop screen
// recorder and leaked a chat list and a banking app into a public README. Recording from
// the launcher would put the emulator's home screen — Gmail, Chrome, YouTube — into the
// first two seconds of every clip. Nothing outside this app is ever in frame.
adb("shell", "am", "start", "-n", ACTIVITY);
await sleep(6000);
const top = adb("shell", "dumpsys", "activity", "activities");
if (!top.includes(PKG)) throw new Error("the app is not on top; refusing to record the launcher");

const rec = spawn(
  ADB,
  ["shell", "screenrecord", "--bit-rate", "4000000", "--size", "540x1200", "--time-limit", "180", "/sdcard/demo.mp4"],
  { stdio: "ignore" },
);
await sleep(2500); // screenrecord takes a moment to actually start writing frames
const t0 = Date.now();

/** Caption windows, in seconds from t0. Filled in as the run goes, never guessed. */
const captions = [];
const say = (text) => captions.push({ at: (Date.now() - t0) / 1000, text });

/**
 * A still, straight off the device framebuffer, halved so the repo does not carry six
 * 1080x2400 PNGs. Taken DURING the run rather than from a second pass, so a screenshot
 * can never show a state the video does not.
 */
function shot(name) {
  const raw = `/tmp/ts-demo/${name}-raw.png`;
  execFileSync("sh", ["-c", `${ADB} exec-out screencap -p > ${raw}`]);
  writePng(raw, `${OUT}${name}.png`, { width: 540 });
  console.log("still", name);
}

say("Android app, first launch");
shot("android-signin");
await sleep(4000);

say("The worker types the code the office gave");
adb("shell", "input", "tap", ...TAP.codeField.map(String));
await sleep(1200);
adb("shell", "input", "text", code);
await sleep(2500);

say("One code, one worker, 1 hour, single use");
adb("shell", "input", "tap", ...TAP.signIn.map(String));
await sleep(9000);

say("NFC TAP IS MOCKED - no emulator has NFC");
await sleep(4000);

say("The tag URL is delivered directly instead");
adb(
  "shell", "am", "start",
  "-a", "android.intent.action.VIEW",
  "-c", "android.intent.category.BROWSABLE",
  "-n", ACTIVITY,
  "-d", tagUrl,
);
await sleep(9000);
adb("shell", "input", "tap", ...TAP.refresh.map(String));
await sleep(6000);

say("Shift open - identity from the session");
shot("android-shift");
await sleep(5000);

say("MOCKED TAP AGAIN - the same URL ends it");
adb(
  "shell", "am", "start",
  "-a", "android.intent.action.VIEW",
  "-c", "android.intent.category.BROWSABLE",
  "-n", ACTIVITY,
  "-d", tagUrl,
);
await sleep(9000);
adb("shell", "input", "tap", ...TAP.refresh.map(String));
await sleep(6000);

say("History: what this phone recorded");
adb("shell", "input", "tap", ...TAP.tabHistory.map(String));
await sleep(6500);

say("Materials: no push exists, and it says so");
adb("shell", "input", "tap", ...TAP.tabMaterial.map(String));
await sleep(5000);
shot("android-materials");
await sleep(2500);

const total = (Date.now() - t0) / 1000;
adb("shell", "pkill", "-INT", "screenrecord");
await sleep(4000);
rec.kill();
adb("pull", "/sdcard/demo.mp4", "/tmp/ts-demo/android-raw.mp4");

// ---------------------------------------------------------------------------
// Burn the captions in. They are not a README footnote on purpose: a video travels away
// from the text that came with it, and the one thing that must never travel alone is
// "this tap did not happen".
// ---------------------------------------------------------------------------
const esc = (s) => s.replace(/[\\':]/g, (c) => `\\${c}`);
const drawn = captions.map(({ at, text }, i) => {
  const until = captions[i + 1]?.at ?? total;
  return [
    "drawtext=",
    `fontfile=${FONT}:`,
    `text='${esc(text)}':`,
    "fontcolor=white:fontsize=17:line_spacing=4:",
    "box=1:boxcolor=black@0.75:boxborderw=12:",
    "x=(w-text_w)/2:y=h-70:",
    `enable='between(t,${at.toFixed(2)},${until.toFixed(2)})'`,
  ].join("");
});

const banner =
  `drawtext=fontfile=${FONT}:text='DEMO \u2014 local database, no live data':` +
  "fontcolor=white:fontsize=17:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=28";

const mp4 = `${OUT}android-journey.mp4`;
execFileSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error", "-i", "/tmp/ts-demo/android-raw.mp4",
    "-vf", ["scale=440:-2", "fps=12", banner, ...drawn].join(","),
    "-c:v", "libx264", "-preset", "slow", "-crf", "30",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    mp4,
  ],
  { stdio: "inherit" },
);
console.log(`wrote ${mp4} (${total.toFixed(1)}s, ${captions.length} captions)`);
