---
id: TASK-267
title: >-
  Android: the sign-in screen buries one field and one button under five
  paragraphs of explanation
status: Done
assignee: []
created_date: '2026-08-24 19:09'
updated_date: '2026-08-25 06:30'
labels:
  - android
  - ux
  - worker
dependencies: []
priority: low
ordinal: 185000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: Android worker journey, step 'Cleared app data for a true first-launch state, relaunched the app, captured the initial sign-in screen'. Driven live on the ts-demo emulator, screenshot 01-signin.png.

WHAT WORKS AND MUST NOT BE LOST: it IS obvious which field an ordinary worker uses. The intro sentence is specific ('Geben Sie den Anmeldecode ein, den Sie von Ihrer Verwaltung bekommen haben.'), the field is labelled 'Anmeldecode', the SMS block introduces itself with its own question ('Ihre Verwaltung hat eine Telefonnummer fuer Sie hinterlegt?'), and the operator section names itself out for anyone who is not one. The sign-in itself was one code, one tap, first attempt — exactly decision-26's intent.

THE FRICTION IS LENGTH ONLY: five-plus paragraphs of help and legal-style text stack above and below the single button a first-time user needs, so the very first screen a new hire sees reads as a document rather than a one-tap sign-in. This is the lowest-severity item in the whole UAT pass and is filed as such.

FIX SHAPE: keep every sentence, change what is visible first. The code field, its one-line instruction and the Anmelden button lead; the SMS block and the operator block stay where they are but collapse behind their own one-line headings; any legal or explanatory paragraph moves behind a disclosure. NOTHING TRUE MAY BE DELETED to shorten the screen — that rule has been enforced across this product's redesign work and applies here.

Do not reorder the two sign-in doors relative to each other or make either harder to reach: decision-48 makes them interchangeable for the same worker, and the journey confirmed both work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On first launch the Anmeldecode field, its instruction and the Anmelden button are visible without scrolling on a common phone screen
- [x] #2 Every sentence currently on the screen still exists — collapsed or behind a disclosure, never deleted
- [x] #3 The SMS door is still reachable in one tap and is still discoverable without prior knowledge
- [x] #4 The Betreiber section stays reachable without a worker sign-in (TASK-254 depends on that surface)
- [x] #5 de and en strings.xml keep exact key parity
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-25 06:30
---
VERIFY PHASE, independent re-check of d9c3614 against the actual composable, not the report.

AC1 - layout tree read top-down in SignInScreen (TimeSheetApp.kt), order is:
app_name title -> LanguageSection -> err_no_session Card (conditional, TASK-262) ->
signin_code_intro -> PendingCard -> OutlinedTextField(signin_code_label) -> Button(signin_submit)
-> only THEN the three RevealSections. So field, instruction and button genuinely precede the
collapsed content in the tree, not merely visually. Above-fold budget at default font on a 360dp
phone: 28 padding + ~36 title + 16 + ~80 LanguageSection + 16 + ~48 intro + 16 + ~80 field with
supporting text + 16 + 48 button = ~384dp, well inside a common ~640dp content height. PendingCard
early-returns when empty, so on a true first launch it contributes nothing at all. The Column keeps
its verticalScroll, which is what protects the 200 percent font case.

AC2 - nothing deleted, checked mechanically: the res/ diff for this commit has ZERO deletion lines.
Every sentence previously rendered on this screen is still rendered - signin_code_help and
nfc_first_run_note inside the first reveal body; signin_sms_intro and signin_operator_heading were
PROMOTED to reveal labels, so they render more prominently than before, not less. The only Text
removed from SmsSignInSection is its duplicate signin_sms_intro, which would otherwise print twice
(once as trigger, once on reveal). Exactly one new key: signin_more_info.

AC3 - the SMS door's trigger is its own self-describing question (signin_sms_intro, 'Ihre Verwaltung
hat eine Telefonnummer fuer Sie hinterlegt?'), so it is discoverable with no prior knowledge, and one
tap composes SmsSignInSection. Worth stating plainly: sending a code is now two taps (reveal, then
send) where it was one tap after a scroll. The reveal is one-way by design so a mid-flow OTP entry
can never be discarded by a re-collapse.

AC4 - reachability of Betreiber is STRUCTURALLY unchanged, verified by reading the gates, not the
prose: TimeSheetApp routes SessionState.SignedOut -> SignInScreen unconditionally, and the operator
block composes inside SignInScreen with no auth condition of any kind above it. The only new gate is
RevealSection's local rememberSaveable Boolean - Compose state, no session, no capability flag, no
server answer. write_open and verify_open still open WriteTagActivity / VerifyZoneActivity directly.
TASK-254's surface survives.

Relative order of the two sign-in doors (code field, then SMS) and of the operator section is
unchanged, per decision-48. Neither door was made conditional on the other.

AC5 - de/en parity recomputed from both files: 278 keys each, diff empty.

RevealSection itself: Modifier.clickable(role = Role.Button) with heightIn(min = 48.dp), so the touch
target floor and the TalkBack role are both honoured. MINOR, not a blocker and not an AC: it carries
no expanded/collapsed stateDescription, so TalkBack announces a button rather than a disclosure.
Worth a follow-up only if the a11y pass picks it up.

Build re-run by me: android/checks/run.sh all five green; gradlew :app:compileDebugKotlin
--rerun-tasks (forced) -> BUILD SUCCESSFUL. android/ tree clean, web/ untouched by this track.

VERDICT: SHIPPED.
---
<!-- COMMENTS:END -->
