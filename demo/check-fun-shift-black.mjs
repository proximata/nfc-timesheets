#!/usr/bin/env node
// THE FLAG-ON RUNNING SCREEN IS STILL NOT THE WALLPAPER (decision-57 §3, decision-60 §3).
//
//     node demo/check-fun-shift-black.mjs
//
// THE FILENAME IS HISTORIC AND IS KEPT ON PURPOSE. decision-57 §3's flag-ON screen was a
// true BLACK with walking silhouettes; decision-60 §3 supersedes that with an animated
// dark-to-light BLUE gradient. The file keeps its name because TASK-295 and TASK-296 cite
// it by that name and a check whose provenance you cannot find is a check nobody trusts.
// WHAT IT ASSERTS moved; WHAT IT IS FOR did not, and never will: neither the flag-OFF nor
// the flag-ON running screen may ever be a colour the PHONE chose.
//
// `check-shift-screen-brand.mjs` measures the flag-OFF screen on a device, and since
// decision-60 §2 that screen is ShiftBrand's fixed blue rather than a grey. This file
// covers the flag-ON variant, which cannot be photographed on a laptop: rendering it needs
// a device, a signed-in worker AND a server-side flag row, so a screenshot assertion would
// skip exactly when it matters. The property itself is static and total — every colour the
// variant paints must be a LITERAL in ui/Theme.kt, and the screen must take those literals
// rather than any MaterialTheme role. Material You can only reach a screen through
// `dynamic*ColorScheme` or through a role that falls through to a baseline, so fixed
// literals, proven at the places they are written, are the whole of "not the wallpaper".
//
// SHOW IT RED: change ShiftBrand.Container to MaterialTheme.colorScheme.surface, or to
// `Color(0xFF10243D).takeIf { !isSystemInDarkTheme() }`, and re-run.
import { readFileSync } from "node:fs";

const KT = "android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets";
const theme = readFileSync(`${KT}/ui/Theme.kt`, "utf8");
const screen = readFileSync(`${KT}/ui/TimeSheetApp.kt`, "utf8");
const backdrop = readFileSync(`${KT}/ui/FunShiftBackdrop.kt`, "utf8");

/**
 * Comments stripped before any "this call is absent" assertion. ui/Theme.kt's own header
 * NAMES `dynamicLightColorScheme(context)` in prose — that paragraph is the record of the
 * incident and must not be what fails this check.
 */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};
const assert = (cond, good, badMsg) => (cond ? ok(good) : bad(badMsg));

console.log("check-fun-shift-blue: decision-60 §2/§3, the running screen's fixed blues");

// 1. EVERY COLOUR THE SCREEN CAN PAINT IS A FIXED LITERAL. Named one by one, so a value
//    quietly turned into an expression (a role, a system-theme branch, a computed tint)
//    fails here rather than on a phone. The hexes are asserted too: they are what
//    check-shift-screen-brand.mjs measures on a device, and the two must not drift.
for (const [name, object, hex] of [
  ["Container", "ShiftBrand", "10243D"],
  ["OnContainer", "ShiftBrand", "E6ECF5"],
  ["Outline", "ShiftBrand", "9FC4E8"],
  ["Deep", "FunShift", "0A1626"],
  ["Lift", "FunShift", "1F4E85"],
  ["Overdue", "FunShift", "FFB4AB"],
]) {
  const m = new RegExp(`val ${name} = Color\\(0xFF([0-9A-Fa-f]{6})\\)`).exec(theme);
  assert(
    m?.[1]?.toUpperCase() === hex,
    `${object}.${name} is the literal Color(0xFF${hex}) in ui/Theme.kt`,
    `${object}.${name} is ${m ? `#${m[1]}` : "missing or not a literal"}, expected #${hex} — ` +
      "a value that is not a literal is a value a wallpaper or a Material baseline can reach",
  );
}

// 2. THE SCREEN TAKES THE LITERALS, not a role a baseline or a dynamic scheme could fill
//    in. This is the assertion the pink incident would have needed.
assert(
  /else -> ShiftBrand\.Container/.test(screen),
  "the running screen's container is the ShiftBrand literal, not a Material role",
  "the running container is not the ShiftBrand literal — a Material role can fall through to a baseline",
);

// 3. NOTHING IN THE RUNNING-SCREEN PATH IS DYNAMIC. Material You enters exactly one way.
for (const [file, text] of [
  ["ui/Theme.kt", code(theme)],
  ["ui/TimeSheetApp.kt", code(screen)],
  ["ui/FunShiftBackdrop.kt", code(backdrop)],
]) {
  assert(
    !/dynamic(Light|Dark)ColorScheme/.test(text),
    `${file} calls no dynamic*ColorScheme — the wallpaper has no route in`,
    `${file} calls dynamic*ColorScheme: this is the exact call TASK-238 removed`,
  );
}

// 4. AND IT DOES NOT DEPEND ON THE SYSTEM THEME EITHER. decision-60 §2: the same blue on
//    every phone. A running screen that is #10243D on one handset and something else on
//    another is two products again, which is the whole complaint the brand work started from.
const containerBlock = /val container = when \{[\s\S]*?\n    \}/.exec(screen)?.[0] ?? "";
assert(
  containerBlock.includes("ShiftBrand.Container") && !containerBlock.includes("isSystemInDarkTheme"),
  "the running screen's colour does not branch on isSystemInDarkTheme()",
  "the running colour branches on the system theme — decision-60 §2 says a FIXED value",
);

// 5. THE DECORATION CANNOT BECOME THE SIGNAL. The animation paints in the two gradient
//    blues only — never in a text colour — and it is hidden from TalkBack. It is texture
//    behind the words, and DESIGN.md § 3.4's rule (the state is spelled out) survives the
//    flag untouched.
assert(
  /FunShift\.(Deep|Lift)/.test(backdrop) &&
    !/FunShift\.Overdue|ShiftBrand\.OnContainer/.test(backdrop),
  "the animation paints only in FunShift.Deep/Lift — it never borrows a text colour",
  "the animation paints in a text colour: decoration that can be mistaken for the state",
);
assert(
  /clearAndSetSemantics \{ \}/.test(backdrop),
  "the animation is hidden from TalkBack",
  "the animation is in the a11y tree — a per-frame decoration on a screen whose one spoken element is the clock card",
);

// 6. THE FLAG IS STILL OFF BY DEFAULT, and the animation is still composed only under it.
//    decision-60 changed the two BASELINE colours, not the OFF-by-default posture of the
//    flag itself. If either of these goes, the device checks start measuring a moving
//    screen nobody opted into.
assert(
  /funTheme: Boolean = false/.test(screen),
  "the flag defaults to OFF at the composable",
  "the flag does not default to OFF — decision-60's consequences keep the flag OFF by default",
);
assert(
  /if \(funTheme\) FunShiftBackdrop\(\)/.test(screen),
  "the animation is composed ONLY under the flag",
  "the animation is composed unconditionally — it would reach workers who never opted in",
);

console.log(failures === 0 ? "\ncheck-fun-shift-blue: OK" : `\ncheck-fun-shift-blue: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
