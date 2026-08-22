#!/usr/bin/env node
// THE MESSAGE ITSELF: one GSM-7 segment, and a Vienna wall clock (decision-48 §5.3).
//
//   node server/check-sms-message.mjs
//
// NO DATABASE, NO NETWORK, NO CREDENTIAL. This file asserts two properties of a pure
// function, and it must stay runnable on a train and on a box with no Twilio account —
// which is every box today.
//
// WHY THESE TWO AND NOT MORE. They are the two ways this message can be quietly wrong in
// a way nobody notices until a bill or a phone call:
//
//   1. ONE CHARACTER OUTSIDE GSM 03.38 flips the whole SMS to UCS-2. The single-segment
//      limit halves from 160 to 70, a 108-character message becomes TWO segments, and the
//      cost and the out-of-order risk double. The German typographic quotes „ " — which
//      the admin panel uses everywhere and which a copy edit would naturally reach for —
//      are exactly such characters. Nothing on any screen would say so.
//   2. THE EXPIRY RENDERED IN UTC reads as a real time and is an hour or two early. The
//      director reads „Gültig bis 27.08. um 12:32 Uhr" down the telephone, the cleaner
//      believes it, and the code appears to have expired before it did. Vienna is UTC+1
//      in winter and UTC+2 in summer, so a naive implementation is right for nobody and
//      wrong by a different amount depending on the month.
//
// The seeded RED cases for both live in server/check-sms-mutants.sh.
import assert from "node:assert/strict";
import {
  GSM7_SINGLE_SEGMENT,
  isGsm7,
  isOneSegment,
  renderEnrolmentSms,
  renderOtpSms,
  septets,
  viennaDay,
  viennaTime,
} from "./lib/sms.js";

let failures = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const test = (name, fn) => {
  try {
    fn();
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").join("\n       ")}`);
  }
};

// The longest name anybody would plausibly put in ops/branding.json. „Schimmer und Glanz
// Reinigung" is the real operator's full trading name and is longer than the current
// `appName`, so the budget is checked against the worse of the two, not the one we happen
// to ship with today.
const LONG_NAME = "Schimmer und Glanz Reinigung";
const SHORT_NAME = "NFC TimeSheets";
const EXPIRES = new Date("2026-08-27T12:32:00Z"); // 14:32 Vienna, CEST

test("the enrolment SMS is GSM-7 and fits ONE segment, for the longest plausible sender name", () => {
  for (const name of [SHORT_NAME, LONG_NAME]) {
    const text = renderEnrolmentSms({ name, display: "K7QF-3MZ2", expiresAt: EXPIRES });
    assert.ok(isGsm7(text), `not GSM-7 with sender name ${JSON.stringify(name)}: ${JSON.stringify(text)}`);
    assert.ok(
      septets(text) <= GSM7_SINGLE_SEGMENT,
      `${septets(text)} septets > ${GSM7_SINGLE_SEGMENT} with sender name ${JSON.stringify(name)} — that is TWO messages`,
    );
    assert.ok(isOneSegment(text));
  }
  ok(
    `one segment: ${septets(renderEnrolmentSms({ name: LONG_NAME, display: "K7QF-3MZ2", expiresAt: EXPIRES }))}/${GSM7_SINGLE_SEGMENT} septets at the longest name`,
  );
});

test("the OTP SMS is GSM-7 and fits ONE segment too", () => {
  for (const name of [SHORT_NAME, LONG_NAME]) {
    const text = renderOtpSms({ name, code: "483920", ttlMinutes: 10 });
    assert.ok(isGsm7(text), `not GSM-7: ${JSON.stringify(text)}`);
    assert.ok(septets(text) <= GSM7_SINGLE_SEGMENT, `${septets(text)} septets > ${GSM7_SINGLE_SEGMENT}`);
  }
  ok("one segment for the OTP message as well");
});

test("the umlauts we DO use are GSM-7, and the quotes we must NOT use are not", () => {
  // Both halves matter. Without the first, a paranoid implementation could pass by
  // stripping every non-ASCII character and shipping "Gultig bis", which is not German.
  for (const ch of "äöüÄÖÜßÉàéèìòù§¿¡") assert.ok(isGsm7(ch), `${ch} should be GSM-7 basic`);
  // The exact characters web/messages/de.json uses for quoting. If one of these ever
  // reaches this template the message silently doubles in price.
  for (const ch of ["\u201e", "\u201c", "\u201a", "\u2018", "\u2013", "\u2014", "\u2026", "á", "í", "ú", "ő"]) {
    assert.ok(!isGsm7(ch), `${JSON.stringify(ch)} must NOT be treated as GSM-7`);
  }
  ok("ä ö ü ß are GSM-7; „ “ – — … are not, and are refused");
});

test("the expiry is the VIENNA wall clock, not UTC and not the machine's locale", () => {
  // 12:32 UTC on 27 August is 14:32 in Vienna. A UTC implementation renders 12:32 here and
  // is wrong by exactly the offset — a difference that reads as a plausible time.
  assert.equal(viennaTime(EXPIRES), "14:32", "August is CEST, UTC+2");
  assert.equal(viennaDay(EXPIRES), "27.08.");
  const text = renderEnrolmentSms({ name: SHORT_NAME, display: "K7QF-3MZ2", expiresAt: EXPIRES });
  assert.match(text, /Gültig bis 27\.08\. um 14:32 Uhr/);
  ok(`"${text}"`);
});

test("the DST boundary: the same UTC wall time renders an hour apart across the last Sunday in October", () => {
  // 2026-10-25 is the last Sunday of October: Vienna goes CEST (UTC+2) -> CET (UTC+1) at
  // 03:00 local. A code issued at 23:50 CEST on the Saturday expires on a day that has 25
  // hours. Formatting an absolute TIMESTAMPTZ in the business zone is the ONLY way both
  // lines below come out right; a fixed +01:00 or +02:00 offset gets exactly one of them.
  const before = new Date("2026-10-24T21:50:00Z");
  const after = new Date("2026-10-25T21:50:00Z");
  assert.equal(viennaTime(before), "23:50", "the Saturday is still CEST (UTC+2)");
  assert.equal(viennaDay(before), "24.10.");
  assert.equal(viennaTime(after), "22:50", "the Sunday is CET (UTC+1) — one hour earlier for the same UTC instant");
  assert.equal(viennaDay(after), "25.10.");
  ok("24.10. 21:50Z -> 23:50 Vienna;  25.10. 21:50Z -> 22:50 Vienna");
});

test("the code in the message is the DISPLAY form — character for character what is on screen", () => {
  // If the SMS said K7QF3MZ2 and the screen said K7QF-3MZ2, a worker reading one out to
  // somebody looking at the other would disagree about their own credential. normaliseCode
  // accepts both, but "it works anyway" is not a reason to print two different things.
  const text = renderEnrolmentSms({ name: SHORT_NAME, display: "K7QF-3MZ2", expiresAt: EXPIRES });
  assert.ok(text.includes("K7QF-3MZ2"), text);
  ok("the hyphenated display form, exactly as the panel shows it");
});

if (failures > 0) {
  console.error(`\nFAIL check-sms-message: ${failures} case(s)`);
  process.exit(1);
}
console.log("OK check-sms-message");
