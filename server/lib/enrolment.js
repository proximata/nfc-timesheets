// Enrolment codes (decision-26). Generation, normalisation, shape.
//
// A code is a LOW-ENTROPY BEARER CREDENTIAL that gets spoken over the phone to a tired
// cleaner standing in a stairwell. Everything below is sized against that, not against a
// threat model borrowed from API keys.
//
// ---------------------------------------------------------------------------
// THE ALPHABET — DIGITS ONLY: 0123456789 (decision-63, TASK-319).
//
// It used to be 8 characters of Crockford base32. The owner asked for five digits and no
// dash, and decision-63 is that request costed out rather than waved through. No letters
// means no misread pairs to design around and nothing to alias on the way in, so the
// O->0 / I,L->1 step is GONE — there is nothing left for it to fix. Normalisation still
// strips hyphens and spaces, because people type them out of habit.
//
// Aural confusion is not an alphabet problem here either: digits read cleanly over a phone
// in German, and a mistyped attempt is cheap — the limiter allows several tries before it
// bites, and a lost code is one admin click away from being reissued.
//
// 10 is not a power of two, so generation CANNOT be a bit slice: it uses rejection
// sampling per digit (see newEnrolmentCode) rather than `byte % 10`, which would make
// 0-5 more likely than 6-9 and quietly shrink the effective space.
//
// ---------------------------------------------------------------------------
// THE ARITHMETIC — REDONE AT THE NEW NUMBERS (decision-63 §6). The space is SHARED.
//
// An attacker guessing codes is not attacking one worker. Every live code in the system
// is a valid answer, so their odds scale with the number of codes outstanding.
//
//   search space          10^5                      = 100_000
//   live codes at once    ~20 workers; ceiling       = 50 (pathological: everyone at once)
//
//   per-IP limit          5 failures, then 30s doubling to a 15 min cap (lib/auth.js)
//                         => long-run <= ~4 guesses / 15 min / IP  = ~384 / day / IP
//                         UNCHANGED — it already does real work against one attacker.
//   global ceiling        5 attempts / minute, ALL callers (lib/auth.js), down from 30.
//                         (the per-IP limit does nothing against IP rotation, and rotation
//                          is cheap; the global ceiling is what bounds the shared space.)
//
//   guesses in ONE code's 15-minute lifetime, at the ceiling: 5 * 15 = 75
//   p(a hit against ONE live code)        75 / 100_000        = 7.5e-4  (~1 in 1_333)
//   p(a hit, 50 codes live the whole 15m) 75 * 50 / 100_000   = 3.75e-2 (~1 in 27)
//
// THAT IS OPENLY WEAKER than the 8-character design's ~1-in-12M, and it is accepted as
// such, not overlooked: the 50-simultaneous-codes case is the same anomaly this file
// always called it, and real use (1-3 live codes at ~20 workers) sits at 7.5e-4 to 2.3e-3.
//
// THE TTL IS LOAD-BEARING, NOT A DETAIL. At the old 5-day TTL a 5/min ceiling still buys
// 36_000 guesses — a third of the entire keyspace — and at the old 30/min ceiling it buys
// 216_000, i.e. MORE THAN THE WHOLE SPACE: a hit would be arithmetically guaranteed. A
// 100_000-value space cannot survive a multi-day window at any rate limit worth having,
// which is why CODE_TTL_MS is 15 minutes below and why lengthening it is not a free knob.
//
// If the alphabet, the length, the TTL or either limit changes, redo this block. It is
// the justification for the whole mechanism, not decoration.
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789";
const CODE_CHARS = 5;
const CODE_RE = /^[0-9]{5}$/;

// 15 MINUTES (decision-63 §4). This CUT the 5-day TTL that was itself raised from 60
// minutes on 2026-08-17 after a real failure — a code expired before the worker could
// redeem it and the recovery was a second phone call. THAT FAILURE MODE IS BACK, on
// purpose: a 5-digit code is a 100_000-value space, and the arithmetic above shows no rate
// limit rescues a multi-day window over a space that small. The TTL was the only lever big
// enough, so the code must now be read out and used almost immediately, or reissued.
//
// Single-use redemption, hashed storage, byte-identical failures and one-click revoke are
// unchanged — the length, the TTL and the global ceiling are what moved.
//
// Making this configurable is TASK-45 and is deliberately NOT done here: an env knob is one
// more thing that can be wrong on one machine, and nobody has yet needed a second value.
export const CODE_TTL_MS = 15 * 60 * 1000;

// Longest input we will even look at. A code is 5 digits plus whatever separators a
// human sprinkled in; 64 is generous and bounds the regex work an unauthenticated caller
// can buy.
const MAX_INPUT = 64;

/**
 * A fresh code. `code` and `display` are the SAME STRING now (decision-63 §2 dropped the
 * hyphen); both are returned so every caller — SMS, admin JSON, the tests — keeps its
 * field name and nobody has to remember which form is safe to hash.
 *
 * REJECTION SAMPLING, not `% 10`. 256 is not a multiple of 10, so a modulo of a random
 * byte would make 0-5 about 10% likelier than 6-9 and shrink the effective keyspace this
 * file's arithmetic is built on. Bytes >= 250 are discarded instead; the loop draws a
 * fresh block when it runs out, and expected wastage is ~2%.
 */
export function newEnrolmentCode() {
  const chars = [];
  while (chars.length < CODE_CHARS) {
    for (const byte of randomBytes(CODE_CHARS)) {
      if (byte >= 250) continue; // 250 = 25 * 10: the largest unbiased slice of a byte
      chars.push(ALPHABET[byte % 10]);
      if (chars.length === CODE_CHARS) break;
    }
  }
  const code = chars.join("");
  return { code, display: code };
}

/**
 * Whatever the worker typed -> the canonical 5-digit code, or null.
 *
 * null is the ONLY failure signal. The caller must treat it exactly like a code that is
 * unknown, expired, already redeemed or belongs to a deactivated worker — "your code is
 * the wrong shape" is still information about our codes.
 */
export function normaliseCode(input) {
  if (typeof input !== "string" || input.length > MAX_INPUT) return null;
  // Only the strip survives: with a digits-only alphabet there is no letter left to alias
  // (decision-63 §1). Non-digits are stripped rather than rejected, so a pasted "1-2345"
  // or "12 345" still works; anything else fails the shape test below.
  const canonical = input.replace(/[^0-9]/g, "");
  return CODE_RE.test(canonical) ? canonical : null;
}

// Two distinct, never-equal stand-ins so the redemption path can run exactly one
// constant-time comparison whether or not it found a candidate row. Random per process:
// a fixed sentinel is a value an attacker could try to make us store.
export const DECOY_STORED = randomBytes(32).toString("hex");
export const DECOY_PRESENTED = randomBytes(32).toString("hex");
