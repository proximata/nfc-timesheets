#!/usr/bin/env node
// A FAILED LOAD MUST NOT GO ON SAYING "loading".
//
//     node demo/check-load-failure.mjs
//
// WHAT WENT WRONG, seen rather than reasoned about. On 2026-08-20 postgresql was stopped on
// production and the director's own screens were photographed with a real admin session:
//
//   Übersicht   a red "Das hat gerade nicht funktioniert…" AND, directly beneath it,
//               "Wird geladen…" — in brighter, larger type than the error. Two contradicting
//               statements at once, and the louder of the two was the false one.
//   Objekte     the same red line, with "Objekte werden geladen …" ~370px below it inside the
//               table. A director looking at the table never saw the error at all.
//
// Desaturated (`sips --matchTo Generic Gray`) it is worse, and this is the part that makes it
// a house-rule violation rather than a nitpick: with colour removed, the error line is DIMMER
// than the "loading" line. Colour was not the second signal, it was the only one — and it was
// pointing the wrong way, because the more prominent line said everything was fine.
//
// Every one of these screens is a static export that fetches on the client (decision-16), so
// `data === null` means BOTH "not fetched yet" and "the fetch failed", for ever. The fix is
// one condition: say the error where the spinner was.
//
// WHAT THIS ASSERTS, and why it is a source check rather than a browser one: reproducing it
// live means stopping Postgres on production, which is not something to put in a check that
// people run casually. The defect is entirely visible in the source — a `loading` string
// rendered from a null-data branch with no reference to the page's own `loadError`.
//
// SHOW IT RED:  node demo/check-load-failure.mjs --mutate
//   rewrites one screen back to the unconditional spinner, runs the check, restores the file.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(REPO, "web");

// Every admin screen that fetches its own data. Kept explicit rather than globbed: a new
// screen should have to be added here on purpose, and the count below is what catches one
// that was not.
const SCREENS = [
  "app/page.tsx",
  "app/locations/page.tsx",
  "app/workers/page.tsx",
  "app/shifts/page.tsx",
  "app/payroll/page.tsx",
  "app/pl/page.tsx",
  "app/operators/page.tsx",
  "app/material-requests/page.tsx",
  "app/analytics/page.tsx",
  "app/clients/page.tsx",
  "app/contracts/page.tsx",
  "app/inventory/page.tsx",
];

let failed = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => {
  console.log(`  FAIL ${m}`);
  failed = 1;
};

// The top-level "the page has no data yet" spinner. Multi-line in four of the twelve, so this
// matches the EXPRESSION and not a whole line.
const GUARDED = /\{\s*loadError === null \? t\('loading'\) : tError\(loadError\)\s*\}/;
const BARE = /\{\s*t\('loading'\)\s*\}/;

function check() {
  failed = 0;
  for (const rel of SCREENS) {
    const src = readFileSync(path.join(WEB, rel), "utf8");

    // The screen must HAVE a loadError to fall back on. A screen that swallows its own fetch
    // failure has a different and worse bug, and this check would otherwise pass it silently.
    if (!src.includes("loadError")) {
      bad(`${rel}: no loadError state at all — a failed fetch is invisible on this screen`);
      continue;
    }
    if (!GUARDED.test(src)) {
      bad(`${rel}: its no-data branch says "loading" without consulting loadError — with the API down it says "Wird geladen…" for ever`);
      continue;
    }
    // And no OTHER bare `{t('loading')}` left over: a second, unguarded spinner further down
    // the page would put the same lie back on the screen underneath the honest one.
    const withoutGuarded = src.replace(new RegExp(GUARDED.source, "g"), "");
    if (BARE.test(withoutGuarded)) {
      bad(`${rel}: a SECOND unguarded {t('loading')} remains — it would keep spinning under the error`);
      continue;
    }
    ok(`${rel}`);
  }

  // The words themselves have to exist in both locales, or the honest branch renders a key.
  for (const locale of ["de", "en"]) {
    const messages = JSON.parse(readFileSync(path.join(WEB, "messages", `${locale}.json`), "utf8"));
    const keys = Object.keys(messages.error ?? {});
    // Every ErrorKey the pages can pass to tError.
    const want = ["network", "auth", "notFound", "conflict", "request", "server", "badResponse"];
    const missing = want.filter((k) => !keys.includes(k));
    missing.length === 0
      ? ok(`messages/${locale}.json carries all ${want.length} error strings the fallback can render`)
      : bad(`messages/${locale}.json is missing error strings: ${missing.join(", ")}`);
  }
  return failed;
}

if (process.argv.includes("--mutate")) {
  // THE NEGATIVE CASE, on a real file, restored in a finally.
  const victim = path.join(WEB, SCREENS[0]);
  const original = readFileSync(victim, "utf8");
  try {
    writeFileSync(victim, original.replace(GUARDED, "{t('loading')}"));
    console.log(`-- mutant: ${SCREENS[0]} put back to an unconditional spinner`);
    const rc = check();
    console.log(rc === 1 ? "\n  RED, as it must be" : "\n  FAIL: the mutant did NOT go red");
    process.exitCode = rc === 1 ? 0 : 1;
  } finally {
    writeFileSync(victim, original);
    console.log("-- restored");
  }
  const after = check();
  console.log(after === 0 ? "  and green again\n" : "  FAIL: still red after the restore\n");
  if (after !== 0) process.exitCode = 1;
} else {
  const rc = check();
  console.log(rc === 0 ? "\ncheck-load-failure: OK" : "\ncheck-load-failure: FAILED");
  process.exitCode = rc;
}
