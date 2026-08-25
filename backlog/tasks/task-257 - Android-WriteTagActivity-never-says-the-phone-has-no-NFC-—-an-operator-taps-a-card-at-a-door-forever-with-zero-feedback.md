---
id: TASK-257
title: >-
  Android: WriteTagActivity never says the phone has no NFC — an operator taps a
  card at a door forever with zero feedback
status: Done
assignee: []
created_date: '2026-08-24 19:05'
updated_date: '2026-08-24 20:13'
labels:
  - android
  - operators
  - ux
  - nfc
dependencies: []
priority: high
ordinal: 175000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: operator journey, steps 'Check whether WriteTagActivity handles a phone with no NFC hardware the same way VerifyZoneActivity does' and 'Tap Tag pruefen on the same no-NFC device'. Driven live on the ts-demo emulator, which has no NFC radio, and confirmed in source.

THE ASYMMETRY, measured at HEAD:

  VerifyZoneActivity.kt:245   val nfc = adapter
                              nfcState = when { nfc == null -> NfcState.UNSUPPORTED
                                                not nfc.isEnabled -> NfcState.DISABLED
                                                else -> NfcState.READY }
                              -> shows 'Dieses Telefon hat kein NFC.' plus 'Ohne NFC kann an den Tags
                                 nicht gestempelt werden. Bitte bei der Verwaltung melden.' and a single
                                 Fertig button, BEFORE it ever asks for a Betreiber-Code. Correct.

  WriteTagActivity.kt:285     val nfc = adapter ?: return
                              -> silently no-ops. There is no adapter-availability check anywhere in the
                                 file. The screen shows the normal 'Halte einen leeren NTAG213 an das
                                 Telefon...' instructions and the operator-code gate exactly as if the
                                 radio were present and on.

Same two buttons, same sign-in screen, one device: tap Tag pruefen and the phone tells you the truth, tap Tag beschreiben and it lies by omission.

WHY IT MATTERS FOR UAT: this is the single worst failure shape for a non-technical user — an operator standing at a building entrance holding a card against a phone that will never read it, with the screen actively telling them to keep holding it. NFC switched OFF in quick settings is far more common in the field than NFC being absent, and it hits the identical dead branch. The operator has no way to distinguish 'this card is bad' from 'this phone is not listening'.

FIX SHAPE: give WriteTagActivity the SAME NfcState machine VerifyZoneActivity already has — do not invent a second one. UNSUPPORTED and DISABLED both short-circuit ahead of the operator-code gate, so no code is ever asked for on a phone that cannot write. DISABLED should say the radio is switched off rather than absent, since that one the operator can fix themselves.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a phone with no NFC adapter, WriteTagActivity says so in German and shows no write instructions and no Betreiber-Code field
- [ ] #2 On a phone whose NFC is switched OFF, WriteTagActivity says the radio is off — wording distinct from the no-hardware case, because that one the operator can fix
- [ ] #3 The check runs in onResume and re-evaluates when the operator toggles NFC and returns to the app, matching VerifyZoneActivity
- [ ] #4 The NfcState machine is REUSED from VerifyZoneActivity, not reimplemented — one definition, two call sites
- [ ] #5 The no-NFC short-circuit happens BEFORE the operator-code gate: no code is ever requested on a phone that cannot write
- [ ] #6 de and en strings.xml both carry the new strings with exact key parity
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 20:13
---
VERIFIED independently at 6a104a3 (read the real source, not the build report).

AC1 nfcState=UNSUPPORTED renders only R.string.scan_unsupported ('Dieses Telefon hat kein NFC.'); write instructions, pending-id, override field AND the Betreiber-Code field all live inside WriteBody(), which is the READY arm only. WriteTagActivity.kt:171-175.
AC2 DISABLED renders scan_disabled = 'NFC ist ausgeschaltet. Bitte in den Einstellungen aktivieren.' - genuinely distinct sentence, names the fixable cause. EN pair equally distinct.
AC3 onResume (WriteTagActivity.kt:288-294) recomputes nfcState from the adapter every resume, byte-identical when{} to VerifyZoneActivity.kt:249-254; toggling NFC and returning re-evaluates.
AC4 grep 'NfcState' over the whole android/ tree: ONE definition, nfc/NfcState.kt:7. Zero other enum declarations. Two call sites (VerifyZoneActivity, WriteTagActivity), no reimplementation.
AC5 structural, not an if: the operator-code OutlinedTextField is inside WriteBody(); on UNSUPPORTED/DISABLED that composable is never invoked, so no code can be requested on a phone that cannot write.
AC6 exact key parity - values/ and values-en/ both 259 keys, comm both directions empty. No new keys needed for this task (existing scan_* reused).

BUILD: ./gradlew :app:compileDebugKotlin --rerun-tasks -> BUILD SUCCESSFUL, only 2 pre-existing warnings in files this commit did not touch (WriteSimulation.kt, TagWriter.kt). assembleDebug -> app-debug.apk produced. android/checks/run.sh -> core/known-tags/tag-writer/manifest/verify-no-shift ALL OK.
---
<!-- COMMENTS:END -->
