// Enrolment codes (decision-26). Generation, normalisation, shape.
//
// A code is a LOW-ENTROPY BEARER CREDENTIAL that gets spoken over the phone to a tired
// cleaner standing in a stairwell. Everything below is sized against that, not against a
// threat model borrowed from API keys.
//
// ---------------------------------------------------------------------------
// THE ALPHABET — Crockford base32: 0123456789ABCDEFGHJKMNPQRSTVWXYZ
//
// I, L, O and U are NOT in it. I/l/1 and O/0 are the classic misread pairs, and U is out
// because a random 8-character string that spells something obscene is a support call of
// a different kind. 32 characters is exactly 5 bits, so generation is a straight bit
// slice with no rejection sampling and no modulo bias.
//
// The excluded letters are not merely absent, they are ALIASED on the way in
// (normaliseCode): a worker who types O gets 0, and I or l gets 1. So the ambiguity is
// resolved in our favour instead of costing an attempt. Case is folded and anything that
// is not a letter or a digit is stripped, because people type the hyphen, and spaces, and
// sometimes both.
//
// Aural confusion (B/P/D, M/N, S/F in German) is NOT solved by the alphabet — removing
// every aurally confusable letter leaves too few characters and makes codes longer, which
// is worse. It is solved by the code being SHORT and by a mistyped attempt being cheap:
// the rate limiter allows several tries before it bites, and a genuinely lost code is one
// admin click away from being reissued.
//
// ---------------------------------------------------------------------------
// THE ARITHMETIC — and note the search space is SHARED.
//
// An attacker guessing codes is not attacking one worker. Every live code in the system
// is a valid answer, so their odds scale with the number of codes outstanding. That is
// the number the size has to be chosen against.
//
//   search space          32^8                     = 2^40 = 1_099_511_627_776
//   live codes at once    ~20 workers; ceiling      = 50 (pathological: everyone at once)
//   p(one guess hits ANY) 50 / 2^40                 = 4.5e-11
//
//   per-IP limit          5 failures, then 30s doubling to a 15 min cap (lib/auth.js)
//                         => long-run <= ~4 guesses / 15 min / IP  = ~384 / day / IP
//   global ceiling        30 attempts / minute, ALL callers        = 43_200 / day
//                         (the per-IP limit alone does nothing against IP rotation, and
//                          rotation is cheap; the global ceiling is what bounds the
//                          shared search space. ~3 orders of magnitude above real use:
//                          20 workers enrol once each, ever.)
//
//   guesses in ONE code's lifetime, at the global ceiling: 30 * 60 = 1_800
//   p(a hit in that hour, with 50 codes live)  1_800 * 4.5e-11    = 8.2e-8  (~1 in 12M)
//   saturated year-round: 43_200 * 365 * 4.5e-11 = 7.1e-4 hits/yr (~1 in 1_400 years)
//
// and that last figure assumes 50 codes live CONTINUOUSLY, which they are not — they are
// live for an hour, a handful of times a year. The real exposure is the line above it.
//
// If the alphabet, the length, the TTL or either limit changes, redo this block. It is
// the justification for the whole mechanism, not decoration.
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_CHARS = 8;
const CODE_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

// 60 minutes. Short enough that the arithmetic above holds, long enough for the real
// journey: the admin phones the worker, the worker installs the app from the store,
// works through onboarding and types the code. A 5-minute code would be a mechanism that
// fails for everyone with a slow connection, and the recovery for an expired code is
// another phone call.
export const CODE_TTL_MS = 60 * 60 * 1000;

// Longest input we will even look at. A code is 8 characters plus whatever separators a
// human sprinkled in; 64 is generous and bounds the regex work an unauthenticated caller
// can buy.
const MAX_INPUT = 64;

/**
 * A fresh code. Returns the canonical form (what gets hashed) and the display form (what
 * the admin reads aloud). 5 bytes = 40 bits = exactly 8 * 5, so every code is uniform
 * over the whole space with no bias and no retry loop. 2^40 is exact in a double.
 */
export function newEnrolmentCode() {
  let n = 0;
  for (const byte of randomBytes(5)) n = n * 256 + byte;
  const chars = new Array(CODE_CHARS);
  for (let i = CODE_CHARS - 1; i >= 0; i--) {
    chars[i] = ALPHABET[n % 32];
    n = Math.floor(n / 32);
  }
  const code = chars.join("");
  // Grouped for reading out: "K7QF, dash, 3MZ2". normaliseCode strips the hyphen again,
  // so the two forms are interchangeable everywhere except in what we hash.
  return { code, display: `${code.slice(0, 4)}-${code.slice(4)}` };
}

/**
 * Whatever the worker typed -> the canonical 8-character code, or null.
 *
 * null is the ONLY failure signal. The caller must treat it exactly like a code that is
 * unknown, expired, already redeemed or belongs to a deactivated worker — "your code is
 * the wrong shape" is still information about our codes.
 */
export function normaliseCode(input) {
  if (typeof input !== "string" || input.length > MAX_INPUT) return null;
  const canonical = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "") // hyphens, spaces, non-breaking spaces from a paste
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return CODE_RE.test(canonical) ? canonical : null;
}

// Two distinct, never-equal stand-ins so the redemption path can run exactly one
// constant-time comparison whether or not it found a candidate row. Random per process:
// a fixed sentinel is a value an attacker could try to make us store.
export const DECOY_STORED = randomBytes(32).toString("hex");
export const DECOY_PRESENTED = randomBytes(32).toString("hex");
