// Records the Android worker journey on an emulator: enrolment-code sign-in, a tag URL
// opening the app and starting a shift, the takeover screen with its running clock and
// its shortened navigation bar, the ongoing lock-screen notification, and the same URL
// ending the shift.
//
//   node demo/record-android.mjs
//
// Run demo/android-setup.sh first — the emulator has to be pointed at the local demo
// server before anything here means anything. backlog/docs/DEMO.md has the whole sequence.
//
// The stages come from demo/journey.mjs and are the SAME stages demo/record-ios.mjs
// walks, in the same order, with the same minimum durations — that is what lets
// demo/compose-devices.mjs put the two clips side by side without an edit that lies.
//
// THE NFC TAP IS MOCKED and the recording says so on screen, in the caption that is
// burned into the frames, for as long as the mocked steps are visible. No emulator has NFC
// hardware; `adb shell pm list features` lists no `android.hardware.nfc`, so
// `NfcAdapter.getDefaultAdapter()` returns null. That is physics. What IS demonstrated is
// every line after the OS hands the URL to the app — which is the same code either way.
//
// It records the device screen with `screenrecord`, on the device. The Mac's screen is
// never captured, so no window, notification, chat or bank tab can end up in the file.
// The one place something outside this app COULD appear is the notification shade, so
// before it is opened the shade is checked and the run refuses to pull it down if
// anything other than this package has posted into it.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { captionFilter } from "./burnin.mjs";
import { runStages } from "./journey.mjs";
import { writePng } from "./png.mjs";

const ADB = `${process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools"}/platform-tools/adb`;
const PKG = "io.github.qwadratic.NFCTimeSheets";
const ACTIVITY = `${PKG}/io.github.qwadratic.nfctimesheets.MainActivity`;
const API = process.env.DEMO_API ?? "http://127.0.0.1:8082";
const OUT = new URL("../docs/media/", import.meta.url).pathname;

// Same guard as record-admin.mjs. The phone must never be pointed at the live server.
if (!["127.0.0.1", "localhost"].includes(new URL(API).hostname)) {
  console.error("record-android: DEMO_API must be loopback.");
  process.exit(1);
}

const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tap the widget whose text or content-description contains `needle`.
 *
 * By LABEL and not by pixel coordinates. The previous cut of this script carried a table
 * of device pixels, which is fine right up to the moment a screen gains a row — and this
 * app just gained a whole takeover screen. A label is also the accessibility label, so a
 * tap that cannot be found here is a control a screen reader cannot find either.
 */
async function tapText(needle, { optional = false } = {}) {
  adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  const xml = adb("shell", "cat", "/sdcard/ui.xml");
  const nodes = [...xml.matchAll(/<node[^>]*>/g)].map((m) => m[0]);
  const matches = nodes.filter((n) => {
    const text = /text="([^"]*)"/.exec(n)?.[1] ?? "";
    const desc = /content-desc="([^"]*)"/.exec(n)?.[1] ?? "";
    return text.includes(needle) || desc.includes(needle);
  });
  // A label matches the paragraph that explains the field as well as the field itself, so
  // prefer something a finger can actually operate. "Geben Sie den Anmeldecode ein" is a
  // <TextView> and tapping it does nothing at all — silently, which is the worst kind.
  const hit =
    matches.find((n) => n.includes('clickable="true"') || /class="[^"]*EditText"/.test(n)) ??
    matches[0];
  if (!hit) {
    if (optional) return false;
    throw new Error(`no widget on screen labelled "${needle}"`);
  }
  const [, x1, y1, x2, y2] = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(hit).map(Number);
  adb("shell", "input", "tap", String((x1 + x2) / 2), String((y1 + y2) / 2));
  await sleep(1200);
  return true;
}

/** The text currently on screen, for asserting that a stage actually happened. */
function screenText() {
  adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  return [...adb("shell", "cat", "/sdcard/ui.xml").matchAll(/text="([^"]*)"/g)]
    .map((m) => m[1])
    .join(" | ");
}

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
const worker = data.workers.find((w) => w.name === "Selim Kaya");
const location = data.locations.find((l) => l.slug === "donaufeld-101");
if (!worker || !location) throw new Error("demo seed is missing Selim Kaya / donaufeld-101");

// PRE-FLIGHT: this worker must not already be clocked in. The server is authoritative for
// open shifts (decision-19), so a leftover open shift from a run that died mid-journey
// turns the first tap of the next run into a clock-OUT. That is not a broken app, it is
// the app being right — but it silently records the wrong story, and it did: a take was
// lost to a takeover screen that never appeared. Re-seed and run again.
const stale = data.shifts.find((s) => s.worker_id === worker.id && s.end_time === null);
if (stale) {
  throw new Error(
    `${worker.name} still has shift ${stale.id} open since ${stale.start_time} — the first tap ` +
      "would close it instead of opening one. Re-seed: psql -q -d nfc_demo -f demo/seed.sql",
  );
}

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
//
// The notification permission goes with it — which is what we want. It is asked for on
// camera, from the shift screen, AFTER the first clock-in, and that ordering is a
// deliberate product rule (ShiftSignal.shouldAskForNotifications), not an accident.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Clear the shade of everything that is not this app, BEFORE recording.
//
// A stock emulator posts "Serial console enabled - performance is impacted, check
// bootloader" from package `android`, and it comes back after a reboot and after its
// channel is switched off. It is not personal data, but it is not this product either,
// and the shade is the one shot in this clip where something outside the app can get into
// frame. Snoozed rather than dismissed because it is not dismissible; it returns by
// itself, which is exactly what a demo prop should do.
// ---------------------------------------------------------------------------
for (const key of adb("shell", "cmd", "notification", "list").split("\n")) {
  const trimmed = key.trim();
  if (trimmed === "" || trimmed.includes(PKG)) continue;
  adb("shell", `cmd notification snooze --for 1800000 '${trimmed}'`);
  console.log(`snoozed a notification that is not this app: ${trimmed}`);
}

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
// t0 IS THE SPAWN, not the end of the settle sleep — see the same note in record-ios.mjs.
const t0 = Date.now();
await sleep(2500); // screenrecord takes a moment to actually start writing frames

/** Caption windows, in seconds from t0. Filled in as the run goes, never guessed. */
const captions = [];
const say = (text) => {
  captions.push({ at: (Date.now() - t0) / 1000, text });
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${text}`);
};

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

const stages = await runStages(
  {
    async launch() {
      say("Android app, first launch - one field for a code");
      shot("android-signin");
      await sleep(5000);
      say("No Sign in with Apple here: an admin issues the code (decision-26)");
    },

    async signin() {
      say("The worker types the code the office gave them");
      await tapText("Anmeldecode");
      adb("shell", "input", "text", code);
      await sleep(2500);
      say("One code, one worker, one hour, single use");
      await tapText("Anmelden");
      await sleep(9000);
      // The orange card is seeded, not broken: Selim Kaya has an auto-closed shift from
      // 3 August that nobody has confirmed, and decision-10 says the app must not let it
      // be ignored. Unexplained, it reads as a demo falling over.
      say("The orange card is real: an 8h auto-closed shift he must resolve (decision-10)");
      await sleep(4000);
    },

    async tapin() {
      say("NFC TAP IS MOCKED - no emulator has NFC hardware");
      await sleep(4000);
      say("The tag URL is delivered as the same intent the NFC radio would send");
      adb(
        "shell", "am", "start",
        "-a", "android.intent.action.VIEW",
        "-c", "android.intent.category.BROWSABLE",
        "-n", ACTIVITY,
        "-d", tagUrl,
      );
      await sleep(9000);
    },

    async takeover() {
      // The permission alert is part of the product and is shown rather than pre-granted:
      // it is asked ONCE, from the shift screen, AFTER the tap has already been saved.
      say("Asked only NOW - never at a door at 06:02 with gloves on");
      // The alert is drawn by the SYSTEM permission controller, in the SYSTEM locale —
      // not by this app, and not in the app's locale. On an en-US emulator the button
      // says "Allow", `tapText("Zulassen")` returned false through `optional`, the alert
      // stayed up covering the app, and the next stage failed with "Material vanished"
      // — a true statement about a screen that was not the app. The emulator now runs
      // de-AT (persist.sys.locale), and both labels are tried anyway.
      const asked =
        (await tapText("Zulassen", { optional: true })) || (await tapText("Allow", { optional: true }));
      if (!asked) console.warn("  (no permission alert — already granted?)");
      await sleep(2500);
      // Whatever happened above, the app must be what is on screen now.
      if (/Benachrichtigungen senden|send you notifications/.test(screenText())) {
        throw new Error("the permission alert is still up — refusing to record a system dialog");
      }
      say("THE TAKEOVER. Before, a clock-in changed one word on one row.");
      shot("android-shift");
      await sleep(5000);
      // Said out loud because the iPhone pane next to this one is mint green and this one
      // is pink, and a viewer is owed the reason: ui/Theme.kt takes
      // dynamicLightColorScheme from the wallpaper on Android 12+. Every colour in the app
      // is a Material role, never a literal, so the palette is the phone's, not ours.
      say("Pink because Material You takes the palette from THIS phone's wallpaper");
      await sleep(4000);
    },

    async locked() {
      const text = screenText();
      if (text.includes("Verlauf")) throw new Error("Verlauf is still in the navigation bar");
      if (!text.includes("Material")) throw new Error("Material vanished — that is the one tab that must not");
      say("Verlauf is gone from the navigation bar. Material and Einstellungen stay.");
      await sleep(6000);
      say("Not a kiosk: a handed-over phone can still be signed out");
    },

    async outside() {
      // Refuse to pull the shade down if anything but this app has posted into it. A
      // notification shade is the one place on this device where something outside the
      // app being demonstrated can get into frame.
      const listed = adb("shell", "cmd", "notification", "list");
      const foreign = listed
        .split("\n")
        .filter((l) => l.trim() !== "" && !l.includes(PKG) && !l.startsWith("Notification"));
      if (foreign.length > 0) {
        throw new Error(`refusing to open the shade: ${foreign.length} foreign notification(s)`);
      }
      say("Outside the app: an ongoing notification with a live clock");
      adb("shell", "cmd", "statusbar", "expand-notifications");
      await sleep(5000);
      shot("android-notification");
      await sleep(3000);
      say("Android draws the clock itself, so it has no 8-hour ceiling");
      adb("shell", "cmd", "statusbar", "collapse");
      await sleep(2000);
    },

    async tapout() {
      say("MOCKED TAP AGAIN - the same tag is the only way to end a shift");
      adb(
        "shell", "am", "start",
        "-a", "android.intent.action.VIEW",
        "-c", "android.intent.category.BROWSABLE",
        "-n", ACTIVITY,
        "-d", tagUrl,
      );
      await sleep(10000);
    },

    async cleared() {
      say("Closed and sent. The navigation bar is whole again.");
      shot("android-closed");
      await sleep(5000);
      say("Verlauf is back, and the notification is gone with the shift");
      await tapText("Verlauf", { optional: true });
      await sleep(4000);
    },
  },
  { t0, say, sleep },
);

const total = (Date.now() - t0) / 1000;
adb("shell", "pkill", "-INT", "screenrecord");
await sleep(4000);
rec.kill();
adb("pull", "/sdcard/demo.mp4", "/tmp/ts-demo/android-raw.mp4");

writeFileSync("/tmp/ts-demo/android-stages.json", `${JSON.stringify({ total, stages }, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Burn the captions in. demo/burnin.mjs explains why they are in a padded bar rather than
// a box over the picture, and why `expansion=none` is not optional.
// ---------------------------------------------------------------------------
const mp4 = `${OUT}android-journey.mp4`;
execFileSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error", "-i", "/tmp/ts-demo/android-raw.mp4",
    "-vf", captionFilter(captions, total, {
      width: 440,
      fontSize: 14,
      top: 26,
      bottom: 40,
      banner: "DEMO \u2014 Android Emulator, local server, NFC MOCKED",
    }).join(","),
    "-c:v", "libx264", "-preset", "slow", "-crf", "30",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    mp4,
  ],
  { stdio: "inherit" },
);
console.log(`wrote ${mp4} (${total.toFixed(1)}s, ${captions.length} captions)`);
