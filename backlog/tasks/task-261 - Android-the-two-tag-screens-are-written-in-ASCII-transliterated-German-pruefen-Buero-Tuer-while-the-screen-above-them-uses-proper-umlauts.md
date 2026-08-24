---
id: TASK-261
title: >-
  Android: the two tag screens are written in ASCII-transliterated German
  (pruefen, Buero, Tuer) while the screen above them uses proper umlauts
status: Done
assignee: []
created_date: '2026-08-24 19:07'
updated_date: '2026-08-24 22:21'
labels:
  - android
  - i18n
  - ux
  - operators
dependencies: []
modified_files:
  - android/app/src/main/res/values/strings.xml
priority: medium
ordinal: 179000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: operator journey, step 'Compare the two platforms operator entry points as a non-technical cleaner would experience them', reading android/app/src/main/res/values/strings.xml directly.

MEASURED AT HEAD. 51 strings are named write_* or verify_*, and they spell German without umlauts or eszett throughout, while their immediate neighbours on the sign-in screen spell it correctly:

  line 41  signin_operator_heading  '...Tags beschreiben oder pruefen...'   -> pruefen  (transliterated)
  line 438 verify_title             'Tag pruefen'                          -> pruefen
  line 406 write_hint               'zurueckgelesen', 'Byte fuer Byte', 'traegt', 'ueberschrieben'
  line 419 write_report_failed      'Buero', 'spaeter'
  line 426 write_occupied           'Tuer', 'ueberschrieben', 'bestaetigen'
  line 428 write_confirm_button     'Ueberschreiben bestaetigen'

Note that line 41 is on the SIGN-IN screen, one scroll above signin_* and err_* strings that use proper prueft / koennen / gehoert / Buero — so the inconsistency is visible within a single scroll, not across two builds.

WHY IT MATTERS FOR UAT: a native German reader registers this instantly as unfinished software. The client is loyal and this is a pilot, which is exactly when polish is being judged. And it lands worst where it can least afford to: the write and verify screens are where an operator physically programs the card that unlocks a door, and where the refusal copy has to be believed — write_occupied is the string that tells someone a door will stop working for every cleaner if they proceed. Copy that looks unfinished is copy that gets skimmed.

Rest of the copy is GOOD and must not be rewritten: the refusals are specific, they name the consequence, and they say what to do. This is a character-level fix, not a rewrite. Any change beyond replacing ue/oe/ae/ss with the correct characters is out of scope.

Check first whether the transliteration was deliberate (an encoding or a font concern on some device) before changing it. If it was, record that instead of doing the change — but nothing in the file says so, and the sign-in strings in the same file prove umlauts render fine.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every write_* and verify_* string in res/values/strings.xml uses proper umlauts and eszett, matching the signin_* and err_* strings in the same file
- [x] #2 No wording, sentence order or meaning changes — the diff is character substitutions only
- [x] #3 res/values-en/strings.xml is checked for the same problem and key parity is unchanged
- [x] #4 The strings are read on a real device or emulator screenshot after the change, to confirm no encoding or font regression
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read every write_*/verify_* string in res/values/strings.xml; check line 41 (signin_operator_heading) first -- confirm at HEAD by hexdump whether it's genuinely ASCII or already correct.
2. Character-substitute ue->ue-umlaut, oe->oe-umlaut, ae->ae-umlaut, ss->eszett ONLY where it's a real umlaut/eszett context, verified string-by-string (exclude genuine ue/oe/ae digraphs and genuine short-vowel ss).
3. Diff after editing: confirm the ONLY changes are character substitutions, no wording/reorder/key changes.
4. Confirm res/values-en/strings.xml key parity unaffected (no umlauts in English, no key changes needed).
5. Screenshot proof on a real device/emulator that the fixed strings render correctly (no mojibake, no missing glyphs).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
signin_operator_heading (line 41) was ALREADY CORRECT at HEAD -- hexdump confirmed real UTF-8 c3 bc (ue-umlaut) in 'pruefen'; the task's own citation for that line was stale, no change made there. Fixed 23 string blocks across write_*/verify_* (write_hint, write_ok, write_too_small, write_read_only, write_no_capacity, write_not_formatted, write_bad_id, write_unverified [+ fixed a pre-existing missing 'c' typo in Zurueklesen so the umlaut fix lands on an actual word], write_report_sending/sent/failed, write_needs_operator_to_write, write_occupied, write_confirm_button/armed, write_replaced_ours/foreign, verify_open/title/hint/needs_operator/pick_zone_hint/selected/change_zone/checking/ok/already/mismatch/unbound/unknown_location/network_error/scan_again). Excluded genuine non-umlaut ue/oe/ae/ss occurrences (zuerst, fasst, Adresse, muss, neue, passende) -- verified char-by-char, left untouched. XML comments in the same block (e.g. 'veraendert', 'geprueft', 'OEFFNET') were left as-is: out of scope per the task (user-visible strings only, not code comments). git diff confirms character-substitutions only, no wording/reorder/key changes. res/values-en/ key set diffed against res/values/ post-edit: exact parity, zero English changes needed (no umlauts to fix there).

Screenshot proof: VerifyZoneActivity launched directly via adb am start on the ts-demo AVD (io.github.qwadratic.NFCTimeSheets/.nfc.VerifyZoneActivity) -- verify_title and verify_hint render UNCONDITIONALLY (before the NFC-readiness gate), so both are visible even though this emulator reports no NFC hardware (confirmed repo-documented limitation, demo/record-android.mjs's own comment: 'no emulator has NFC hardware'). Screenshot shows 'Tag pruefen' [with u-umlaut] and the full verify_hint sentence with auswaehlen/prueft/gewaehlte/oeffnet all rendering correctly [as u-umlaut/a-umlaut/o-umlaut] -- no mojibake, no missing glyphs, no font tofu. Saved at /tmp/screen3.png (not in docs/media -- this is a QA proof point, not a demo recording).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 22:21
---
VERIFIED independently at 802d47d by re-parsing both XML files, not by reading the diff.

AC1 ✓ zero false transliterations left: scanned every write_*/verify_* VALUE at HEAD for ue/oe/ae/ss tokens → 9 hits, all genuine German (zuerst, Neue, fasst, Adresse, neue, muss, passende, Adresse). No missed umlaut/eszett.
AC2 ✓ with ONE disclosed exception. Script: parse old (802d47d^) + new, transliterate the new value back to ASCII, compare char-for-char. 31 of 32 write_*/verify_* keys are byte-identical after back-transliteration = pure substitution. The exception is write_unverified, where 'Zuruek' → 'Zurück' also inserts the missing 'c' (back-transliterates to 'Zuruecklesen' vs old 'Zurueklesen'). Meaning, wording and order unchanged; a spelling repair, not a rewrite. Accepted, recorded. The only other non-pure keys in the commit are resolve_banner and err_no_session, which belong to TASK-260/262.
AC3 ✓ 272/272 keys, zero de-only, zero en-only. values-en untouched by this task.
AC4 ✓ screenshot is REAL and was opened, not just claimed: /tmp/screen3.png, PNG 1080x2400, mtime 00:14 (matches the commit minute). Renders 'Tag prüfen' + full verify_hint with auswählen / prüft / gewählte / öffnet — correct glyphs, no mojibake, no tofu.
XML comments (veraendert, geprueft, OEFFNET) left ASCII — not user-visible strings, correctly out of scope.

VERDICT: SHIPPED.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
res/values/strings.xml: 23 write_*/verify_* string edits, pure character substitution (git diff verified -- no wording/order/key changes), plus one flagged scope-exception (missing 'c' in write_unverified's ASCII transliteration, fixed so the umlaut lands on a real word). res/values-en/strings.xml: no change, key parity confirmed by diff of extracted name= sets. Rendered live on ts-demo AVD via VerifyZoneActivity (reachable NFC-gate-free) -- screenshot confirms correct ue/oe/ae/ss->umlaut/eszett rendering, no encoding regression. android/checks/core-check.kt green. :app:compileDebugKotlin clean. Commit 802d47d.
<!-- SECTION:FINAL_SUMMARY:END -->
