#!/usr/bin/env node
// THE FLAG-ON RUNNING SCREEN IS STILL NOT THE WALLPAPER (decision-57 §3).
//
//     node demo/check-fun-shift-black.mjs
//
// `check-shift-screen-brand.mjs` measures the running screen with `fun_shift_screen` OFF,
// and its contract is unchanged: achromatic, every significant area, on a device. That
// check is the reason this one exists rather than being folded into it — the flag-ON
// screen is DELIBERATELY not what that file asserts (it is pure black, and it has moving
// shapes on it), so pointing the same instrument at it would either fail a correct build
// or force the achromatic budget to be loosened for both variants. Two variants, two
// files, one property: NEITHER of them may be a colour the phone chose.
//
// WHAT IT ASSERTS, and why it is a SOURCE read and not a screenshot. The flag-ON screen
// only renders when a server row switches it on, so photographing it needs a device, a
// signed-in worker AND a server-side flag — three things that are not available on a
// laptop, which would make the assertion skip exactly when it matters. The property
// itself, though, is static and total: the black must be a LITERAL in ui/Theme.kt, and
// the screen must take that literal rather than any MaterialTheme role. Material You can
// only reach a screen through `dynamic*ColorScheme` or through a role that falls through
// to a baseline — so a fixed literal, proven at the two places it is written, is the whole
// of "not derived from the wallpaper".
//
// SHOW IT RED: change FunShift.Black to MaterialTheme.colorScheme.surface, or to
// `Color(0xFF000000).takeIf { !isSystemInDarkTheme() }`, and re-run.
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

console.log("check-fun-shift-black: decision-57 §3, the flag-ON running screen");

// 1. THE BLACK IS A FIXED LITERAL, and it is #000000 and not a near-black.
const black = /val Black = Color\(0xFF([0-9A-Fa-f]{6})\)/.exec(theme);
assert(
  black?.[1]?.toUpperCase() === "000000",
  "FunShift.Black is the literal Color(0xFF000000) in ui/Theme.kt",
  `FunShift.Black is ${black ? `#${black[1]}` : "missing"} — decision-57 §3 says a TRUE black`,
);

// 2. THE SCREEN TAKES THE LITERAL, not a role that a baseline or a dynamic scheme could
//    fill in. This is the assertion the pink incident would have needed.
assert(
  /funTheme -> FunShift\.Black/.test(screen),
  "the running screen's container is FunShift.Black when the flag is on, not a Material role",
  "the flag-ON container is not the FunShift literal — a Material role can fall through to a baseline",
);

// 3. NOTHING IN THE FUN PATH IS DYNAMIC. Material You enters exactly one way.
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

// 4. AND IT DOES NOT DEPEND ON THE SYSTEM THEME EITHER. decision-57 §3: black REGARDLESS
//    of isSystemInDarkTheme(). A flag-ON screen that is black on one phone and #0B0C0E on
//    another is two products again, which is the whole complaint the brand work started from.
const funBlock = /val container = when \{[\s\S]*?\n    \}/.exec(screen)?.[0] ?? "";
assert(
  funBlock.includes("FunShift.Black") && !funBlock.includes("isSystemInDarkTheme"),
  "the flag-ON colour does not branch on isSystemInDarkTheme()",
  "the flag-ON colour branches on the system theme — decision-57 §3 says REGARDLESS of it",
);

// 5. THE DECORATION CANNOT BECOME THE SIGNAL. The animation is drawn in the silhouette
//    colour only, and it is hidden from TalkBack — it is texture behind the words, and
//    DESIGN.md § 3.4's rule (the state is spelled out) survives the flag untouched.
assert(
  /FunShift\.Silhouette/.test(backdrop) && !/FunShift\.(OnBlack|Overdue)/.test(backdrop),
  "the animation paints only in FunShift.Silhouette — it never borrows a text colour",
  "the animation paints in a text colour: decoration that can be mistaken for the state",
);
assert(
  /clearAndSetSemantics \{ \}/.test(backdrop),
  "the animation is hidden from TalkBack",
  "the animation is in the a11y tree — a per-frame decoration on a screen whose one spoken element is the clock card",
);

// 6. FLAG OFF IS THE SHIPPED SCREEN. The default at the composable, and the backdrop only
//    composed under the flag. If either of these goes, the three existing checks
//    (check-app-not-wallpaper, check-shift-screen-brand, core-check § 17) start measuring
//    a screen nobody opted into.
assert(
  /funTheme: Boolean = false/.test(screen),
  "the flag defaults to OFF at the composable",
  "the flag does not default to OFF — OFF must be bit-for-bit the shipped screen",
);
assert(
  /if \(funTheme\) FunShiftBackdrop\(\)/.test(screen),
  "the animation is composed ONLY under the flag",
  "the animation is composed unconditionally — it would reach workers who never opted in",
);

console.log(failures === 0 ? "\ncheck-fun-shift-black: OK" : `\ncheck-fun-shift-black: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
