#!/usr/bin/env node
// THE WORKER'S APP MUST LOOK LIKE THE PRODUCT, NOT LIKE THE WORKER'S WALLPAPER.
//
//     node demo/check-app-not-wallpaper.mjs
//
// WHAT IT FOUND. `ui/Theme.kt` shipped `dynamicLightColorScheme(context)` on API 31+, so on
// every modern phone the app inherits the Material You palette generated from the user's own
// wallpaper. `docs/brand/DESIGN.md` § 7 says the opposite in as many words — "Android takes
// the same values into ui/Theme.kt … two hand-maintained lists will drift, and the drift will
// show up as an app that does not look like its own admin" — and § 1 measured the brand as
// ACHROMATIC. On the emulator the clocked-in screen rendered bright pink; setting the system
// palette to green re-rendered the SAME APK green. That is one product with as many colour
// schemes as it has users, and the one the director shows a client is whatever is on the
// demo phone that morning.
//
// It was never caught because nobody had LOOKED at the Android app: LOOK.md and
// LOOK-PHONE.md are both about the admin panel, at 1680 and at 390.
//
// HOW IT IS FALSIFIABLE, and this is the point of doing it on a device rather than by
// grepping Theme.kt for the word "dynamic": the negative case is a REAL BUILD. Install
// 0.5.1 / versionCode 8 and this check goes red, because that build genuinely does follow
// the wallpaper. A grep would only ever prove that a string is absent from a file.
//
//   adb install -r android/dist/nfc-timesheets-0.5.1-8-release.apk   # the shipped bug
//   node demo/check-app-not-wallpaper.mjs                            # -> FAIL
//
// THE INSTRUMENT. Two system palettes as far apart as the API allows, a relaunch between
// them, and the SAME region of the SAME screen sampled both times. The status bar and the
// gesture bar are cropped out: they are the OS's own chrome, they legitimately follow the
// wallpaper, and the clock in the corner changes between the two samples.
//
// It restores whatever palette the device had when it started, in a finally.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const PKG = "io.github.qwadratic.NFCTimeSheets";
const ACTIVITY = `${PKG}/io.github.qwadratic.nfctimesheets.MainActivity`;
const SDK = process.env.ANDROID_HOME ?? "/opt/homebrew/share/android-commandlinetools";
const ADB = process.env.ADB ?? `${SDK}/platform-tools/adb`;
const OUT = process.env.OUT_DIR ?? ".field-recordings/theme";
const KEY = "theme_customization_overlay_packages";

/** The two palettes. Chosen for maximum separation in hue, not for taste. */
const PALETTES = [
  ["magenta", "FF0090"],
  ["green", "00FF00"],
];

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

const getPalette = () => tryShell(`settings get secure ${KEY}`);
const setPalette = (hex) =>
  tryShell(
    `settings put secure ${KEY} '{"android.theme.customization.system_palette":"${hex}",` +
      `"android.theme.customization.accent_color":"${hex}",` +
      `"android.theme.customization.theme_style":"VIBRANT"}'`,
  );
const clearPalette = () => tryShell(`settings delete secure ${KEY}`);

/**
 * The app's own pixels, with the OS chrome removed. `crop=w:h:x:y` — 1080x2400 minus a
 * 140px status bar and a 120px gesture bar; both are the system's and both are ALLOWED to
 * follow the wallpaper, so including them would make this check fail on a correct build.
 */
function appPixels(png) {
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
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    sha: createHash("sha256").update(raw).digest("hex").slice(0, 16),
    dominant: `#${dominant[0].toString(16).padStart(6, "0").toUpperCase()}`,
    distinct: counts.size,
  };
}

/** Palette, cold start, settle, screenshot. Cold start because the scheme is read once. */
async function renderUnder(name, hex) {
  setPalette(hex);
  await sleep(3000);
  tryShell(`am force-stop ${PKG}`);
  await sleep(1500);
  shell(`am start -n ${ACTIVITY}`);
  await sleep(6000);
  const png = execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 28 });
  writeFileSync(`${OUT}/${name}.png`, png);
  return appPixels(png);
}

async function main() {
  const restore = getPalette();
  try {
    const build = shell(`dumpsys package ${PKG} | grep -m1 versionName`).trim();
    console.log(`check-app-not-wallpaper: ${build} on ${adb("shell", "getprop ro.product.model")}`);
    if (!shell(`getprop ro.build.version.sdk`).match(/^\d+$/) || Number(shell("getprop ro.build.version.sdk")) < 31) {
      console.log("  SKIPPED — this instance is below API 31, where dynamic colour does not exist.");
      console.log("  A skip is not a pass. Run it on API 31+ or this proves nothing.");
      process.exit(2);
    }

    const seen = [];
    for (const [name, hex] of PALETTES) {
      const px = await renderUnder(name, hex);
      console.log(`  under a ${name} system palette: dominant ${px.dominant}, ${px.distinct} distinct colours`);
      seen.push([name, px]);
    }

    const [a, b] = seen;
    if (a[1].sha === b[1].sha) {
      ok(`the app renders IDENTICALLY under a ${a[0]} and a ${b[0]} system palette (${a[1].sha})`);
    } else {
      bad(
        `the app FOLLOWS THE WALLPAPER: ${a[0]} -> dominant ${a[1].dominant}, ${b[0]} -> dominant ${b[1].dominant}. ` +
          "Every worker gets a different product and the brand is achromatic (DESIGN.md § 1).",
      );
    }

    // The brand is achromatic and dark-first, so the largest area on any screen must be a
    // GREY. Asserted independently of the comparison above: two identical wrong colours
    // would pass the equality on their own.
    for (const [name, px] of seen) {
      const r = Number.parseInt(px.dominant.slice(1, 3), 16);
      const g = Number.parseInt(px.dominant.slice(3, 5), 16);
      const bl = Number.parseInt(px.dominant.slice(5, 7), 16);
      const spread = Math.max(r, g, bl) - Math.min(r, g, bl);
      if (spread <= 12) ok(`…and under ${name} the dominant surface ${px.dominant} is achromatic (channel spread ${spread})`);
      else bad(`under ${name} the dominant surface ${px.dominant} is a COLOUR (channel spread ${spread}, budget 12)`);
    }
  } finally {
    if (restore && restore !== "null") tryShell(`settings put secure ${KEY} '${restore}'`);
    else clearPalette();
    tryShell(`am force-stop ${PKG}`);
  }

  console.log(failures === 0 ? "\ncheck-app-not-wallpaper: OK" : `\ncheck-app-not-wallpaper: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
