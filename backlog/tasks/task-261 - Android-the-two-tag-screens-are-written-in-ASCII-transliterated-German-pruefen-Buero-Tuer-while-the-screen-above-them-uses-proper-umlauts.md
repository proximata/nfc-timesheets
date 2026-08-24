---
id: TASK-261
title: >-
  Android: the two tag screens are written in ASCII-transliterated German
  (pruefen, Buero, Tuer) while the screen above them uses proper umlauts
status: To Do
assignee: []
created_date: '2026-08-24 19:07'
labels:
  - android
  - i18n
  - ux
  - operators
dependencies: []
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
- [ ] #1 Every write_* and verify_* string in res/values/strings.xml uses proper umlauts and eszett, matching the signin_* and err_* strings in the same file
- [ ] #2 No wording, sentence order or meaning changes — the diff is character substitutions only
- [ ] #3 res/values-en/strings.xml is checked for the same problem and key parity is unchanged
- [ ] #4 The strings are read on a real device or emulator screenshot after the change, to confirm no encoding or font regression
<!-- AC:END -->
