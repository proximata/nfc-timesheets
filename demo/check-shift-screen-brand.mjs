#!/usr/bin/env node
// THE SCREEN THE CLEANER ACTUALLY LOOKS AT, MEASURED — not the one the app opens on.
//
//     node demo/check-shift-screen-brand.mjs
//
// WHAT IT FOUND, and it was found by opening a screenshot rather than by running anything.
// TASK-238 removed `dynamicLightColorScheme(context)` from `ui/Theme.kt` and shipped
// 0.5.2 / versionCode 9 with a hand-written scheme taken from `docs/brand/DESIGN.md`.
// `demo/check-app-not-wallpaper.mjs` went green on it and the task was closed Done.
//
// The clocked-in screen was still BRIGHT PINK.
//
//   .field-recordings/verdict-225/12-pending-on-screen.png, 0.5.2 / 9, taken by
//   demo/prove-offline-push.mjs:
//     #FFD8E4  47.9% of the app's pixels   channel spread 39
//     #E6E0E9  40.9%                       channel spread  9
//     #31111D   0.7%                       channel spread 32
//
// Those three are Material 3's BASELINE `tertiaryContainer`, `surfaceContainerHighest` and
// `onTertiaryContainer` — the purple family Google ships when a role is not assigned.
// `TimeSheetApp.kt` paints the running shift with `tertiaryContainer` / `onTertiaryContainer`
// and `Theme.kt` assigns `tertiary` but NOT `tertiaryContainer`, so 88.8% of the one screen
// the person doing the work stares at all day falls through to a default.
//
// WHY THE EXISTING CHECK COULD NOT SEE IT, which is the more useful half of the finding.
// `check-app-not-wallpaper.mjs` renders with `am force-stop` + `am start -n <activity>` — a
// cold start with NO tap intent. That lands on the idle screen, whose dominant surface is
// #FAFAFA and genuinely is the brand's. It asks "does the app follow the wallpaper", it
// answers that correctly, and it never renders the screen its own finding was written about
// ("the clocked-in screen rendered bright pink"). Two green lines, one unmeasured screen.
//
// This file renders the RUNNING state, by tapping the way a tag does.
//
// NOTHING REACHES PRODUCTION. The radio is switched off first, so the tap writes a row on
// the phone and nowhere else (that is TASK-225's whole design, proven by
// demo/prove-offline-push.mjs). The row is closed and then deleted out of the phone's own
// SQLite in a finally, and the job is cancelled, so no queue is left armed behind it.
//
// SHOW IT RED: run it against the build that shipped the bug.
//     adb install -r android/dist/nfc-timesheets-0.5.2-9-release.apk
//     node demo/check-shift-screen-brand.mjs        # -> FAIL, #FFD8E4, spread 39
//
// UPDATED FOR decision-60 §2. The owner ruled this one screen over to a BLUE, so
// "achromatic everywhere" is no longer the right assertion here — the running field is now
// ShiftBrand.Container, a fixed #10243D, and its text ShiftBrand.OnContainer. What is
// UNCHANGED, and is the only reason this file exists, is that the colour must be a value
// THIS PROJECT chose: the dominant field is asserted to be that exact hex, and every other
// significant area still has to be achromatic. A build that follows the wallpaper fails on
// both halves; the 0.5.2/9 negative case above still goes red, on #FFD8E4 and on the
// lavender behind it.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PKG = "io.github.qwadratic.NFCTimeSheets";
const ACTIVITY = `${PKG}/io.github.qwadratic.nfctimesheets.MainActivity`;
const SDK = process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools";
const ADB = process.env.ADB ?? `${SDK}/platform-tools/adb`;
const TAG_HOST = process.env.TAG_HOST ?? "timesheets.exe.xyz";
const HOIV = process.env.LOCATION_ID ?? "c3c37d4a-ca0a-42c5-b248-9704b9907ec7";
const DB = `/data/data/${PKG}/databases/timesheets.db`;
const OUT = process.env.OUT_DIR ?? ".field-recordings/shift-screen-brand";
const JOB_ID = 225;
/** DESIGN.md § 1: the mark is achromatic, saturation exactly zero. Same budget as its sibling. */
const SPREAD_BUDGET = 12;
/**
 * decision-60 §2's fixed field, read from the source rather than retyped here: two copies
 * of a hex is how a check and the thing it checks start disagreeing silently. Missing or
 * non-literal in Theme.kt is itself a failure — that is the wallpaper-bleed class.
 */
const THEME_KT = "android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/Theme.kt";
const shiftBrand = (name) => {
  const m = new RegExp(`val ${name} = Color\\(0xFF([0-9A-Fa-f]{6})\\)`).exec(readFileSync(THEME_KT, "utf8"));
  return m ? `#${m[1].toUpperCase()}` : null;
};
/** A colour has to own this much of the screen before "dominant" means anything. */
const MIN_SHARE = 0.02;

mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};

const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
const shell = (cmd) => adb("shell", cmd);
const tryShell = (cmd) => {
  try {
    return shell(cmd);
  } catch {
    return "";
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const radio = (on) => {
  tryShell(`svc wifi ${on ? "enable" : "disable"}`);
  tryShell(`svc data ${on ? "enable" : "disable"}`);
};
const tap = () => shell(`am start -n ${ACTIVITY} -a android.intent.action.VIEW -d "https://${TAG_HOST}/t?l=${HOIV}"`);
const openShifts = () =>
  tryShell(`sqlite3 ${DB} "select count(*) from shifts where end_time is null"`).trim();
const localRows = () => tryShell(`sqlite3 ${DB} "select count(*) from shifts"`).trim();
/** The a11y tree, so "the running screen is on screen" is read and not assumed. */
const screenText = () => {
  if (!tryShell("uiautomator dump /sdcard/ssb.xml").includes("dumped to")) return "";
  return tryShell("cat /sdcard/ssb.xml");
};

/**
 * Every colour in the app's own pixels, by share. The status bar (140px) and the gesture
 * bar (120px) are cropped: they are the OS's chrome, they are ALLOWED to follow the
 * wallpaper, and including them would fail a correct build. Identical crop to
 * check-app-not-wallpaper.mjs on purpose — two files, one instrument.
 */
function palette(png) {
  const raw = execFileSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", "pipe:0", "-vf", "crop=in_w:in_h-260:0:140", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { input: png, maxBuffer: 1 << 28 },
  );
  const counts = new Map();
  for (let i = 0; i < raw.length; i += 3) {
    const key = (raw[i] << 16) | (raw[i + 1] << 8) | raw[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = raw.length / 3;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const r = (key >> 16) & 255;
      const g = (key >> 8) & 255;
      const b = key & 255;
      return {
        hex: `#${key.toString(16).padStart(6, "0").toUpperCase()}`,
        share: n / total,
        spread: Math.max(r, g, b) - Math.min(r, g, b),
      };
    })
    .filter((c) => c.share >= MIN_SHARE);
}

async function main() {
  const build = tryShell(`dumpsys package ${PKG} | grep -m1 versionName`).trim();
  const model = tryShell("getprop ro.product.model");
  const emulated = tryShell("getprop ro.kernel.qemu") === "1" || model.startsWith("sdk_");
  console.log(`check-shift-screen-brand: ${build} on ${model}${emulated ? "  (EMULATOR)" : "  (physical device)"}`);

  tryShell(`am force-stop ${PKG}`);
  radio(false);
  await sleep(2500);

  try {
    if (localRows() === "") {
      bad("the phone's database is unreadable — is adbd root, and is a worker signed in?");
      return;
    }
    if (openShifts() !== "0") {
      bad(`the phone already holds ${openShifts()} open shift(s) — this run needs a clean start`);
      return;
    }

    tap();
    await sleep(9000);
    if (openShifts() !== "1") {
      bad(`the offline tap did not open a shift on the phone (open=${openShifts()}) — nothing to photograph`);
      return;
    }
    ok("an OFFLINE tap opened a shift on the phone, and on the phone only");

    const xml = screenText();
    if (!/Eingestempelt|Clocked in|Läuft|Running/.test(xml)) {
      bad("the running screen is not what is on screen — the measurement below would be of something else");
      return;
    }
    ok("…and the running screen is what the a11y tree says is on screen");

    const png = execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 28 });
    writeFileSync(`${OUT}/running.png`, png);
    const colours = palette(png);
    console.log(`  the running screen, by share (${OUT}/running.png):`);
    for (const c of colours) {
      console.log(`    ${c.hex}  ${(100 * c.share).toFixed(1)}%  channel spread ${c.spread}`);
    }

    // THE FIELD IS THE COLOUR THIS PROJECT CHOSE (decision-60 §2), asserted against the
    // literal in Theme.kt rather than a hex retyped in this file.
    const expected = shiftBrand("Container");
    if (expected === null) {
      bad(`ShiftBrand.Container is not a Color(0xFF……) literal in ${THEME_KT} — that is the wallpaper-bleed class itself`);
      return;
    }
    const field = colours[0];
    if (field.hex === expected) {
      ok(`the running field is ShiftBrand.Container ${expected} at ${(100 * field.share).toFixed(1)}% — the fixed value decision-60 §2 names`);
    } else {
      bad(
        `the running field is ${field.hex} at ${(100 * field.share).toFixed(1)}%, not ShiftBrand.Container ${expected}. ` +
          "Either this screen is being painted by something other than the literal (a Material role, a dynamic scheme, " +
          "the wallpaper), or Theme.kt and the installed build have drifted.",
      );
    }

    // EVERY OTHER significant area, not just the largest. The pink was 47.9% and the
    // lavender 40.9%: an assertion on the single dominant colour would have caught one of
    // the two, and a build that fixed only that one would then read as correct. The field
    // above is the ONE exemption, and it is exempt because it was named, not because it
    // is big.
    const coloured = colours.filter((c) => c.hex !== expected && c.spread > SPREAD_BUDGET);
    if (coloured.length === 0) {
      ok(`every OTHER area of the running screen is achromatic (budget ${SPREAD_BUDGET}, DESIGN.md § 1)`);
    } else {
      for (const c of coloured) {
        bad(
          `${c.hex} covers ${(100 * c.share).toFixed(1)}% of the running screen at channel spread ${c.spread} ` +
            `(budget ${SPREAD_BUDGET}). Only ShiftBrand.Container is allowed a hue here; this is a Material ` +
            "baseline role falling through.",
        );
      }
    }
  } finally {
    // Close it, drop it, and disarm the job — the phone must be left exactly as found.
    tap();
    await sleep(9000);
    tryShell(`am force-stop ${PKG}`);
    tryShell(`sqlite3 ${DB} "delete from shifts"`);
    tryShell(`cmd jobscheduler cancel ${PKG} ${JOB_ID}`);
    radio(true);
    await sleep(2500);
    console.log(`  (cleanup: the phone holds ${localRows() || "?"} row(s), the radio is back on)`);
  }

  console.log(failures === 0 ? "\ncheck-shift-screen-brand: OK" : `\ncheck-shift-screen-brand: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
