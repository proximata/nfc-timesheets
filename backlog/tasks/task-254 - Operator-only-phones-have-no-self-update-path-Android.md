---
id: TASK-254
title: Operator-only phones have no self-update path (Android)
status: Done
assignee: []
created_date: '2026-08-24 17:44'
updated_date: '2026-08-25 14:27'
labels:
  - android
  - reliability
dependencies: []
priority: high
ordinal: 172000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found 2026-08-24: UpdateSection in TimeSheetApp.kt is explicit — 'Lives ONLY here: Settings, worker-initiated, never on the tap or clock-out path.' WriteTagActivity.kt and VerifyZoneActivity.kt (the actual operator screens) have zero references to UpdateManager. An operator-only phone (e.g. Mister Clarity, op id 71 — never signs in as a worker) has NO self-service path to a fix. This bit us same-day: 0.5.6->0.5.7 shipped an operator-reachability fix, and an operator-only phone would have had no way to receive it without a manual sideload.

iOS note: iOS has no self-update mechanism at all (App Store rule), expected and correct — this task's iOS half is documentation only (what to tell an operator-only iPhone user), not code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 UpdateSection (or equivalent check/download/install) is reachable from the Betreiber? section on the sign-in screen and from WriteTagActivity/VerifyZoneActivity, without ever signing in as a worker
- [x] #2 checkForUpdate/download/install reuse UpdateManager as-is — no second implementation
- [x] #3 verified on emulator: an operator-only session (no worker sign-in) can see + trigger an update check
- [x] #4 iOS: documented as N/A in the task, not built — self-update is against App Store rules; note what an operator-only iPhone should do instead (TestFlight / sideload)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Commit c03f4eb. AC1, AC2, AC4 met. AC3 NOT fully met - see below.

AC4 (iOS, documentation only, nothing built; NFCTimeSheets/ untouched):
Self-update is impossible on iOS by App Store rule - an app may not download and
execute a binary. There is nothing to build and nothing to fix. What an
operator-only iPhone should do instead:
  1. TestFlight, internal track (this is the supported path). Install TestFlight,
     accept the invite once; updates then arrive as ordinary app updates with a
     push notification. No worker sign-in involved at any point.
  2. Off TestFlight there is no self-service path at all: the build must be
     re-signed and sideloaded by hand, per device.

AC3 - what was actually verified on emulator-5554 (userdebug, API 36), and what
was not. ONE uninterrupted session, no pm clear between steps:
  - pm clear, then shared_prefs/session.xml -> 'No such file or directory'.
    Re-checked at the END of the run: shared_prefs/ is EMPTY. So the whole run
    had no worker session AND no operator session - strictly less identity than
    'operator-only', which is what makes the reachability result strong.
  - SignInScreen -> Betreiber? renders 'App-Version' + 'Installiert: 0.5.8 (15)'
    (update_title + update_current_version) with no session.
  - WriteTagActivity on a no-NFC emulator shows BOTH 'Dieses Telefon hat kein
    NFC.' and 'Nach Updates suchen' - proves the outside-the-when placement.
  - Tapping it: topResumedActivity=...ui.UpdateActivity. Same from
    VerifyZoneActivity. Both confirmed via dumpsys activity activities.
  So 'can SEE' is proven at all three hosts, without a worker sign-in.

WHAT REMAINS for AC3: the check never reached the server. Every state observed
was 'Keine Verbindung' (err_network) - the emulator has DNS and pings the API
host, but the app's GET /app/version always failed, both before and after
pressing 'Erneut versuchen'. Because the state text is identical before and
after the press, this run CANNOT distinguish 'the button re-ran the check' from
'the button did nothing', and it never observed an up-to-date/available state at
all. The radio-flip test (disable radios -> err_network, enable -> a different
state) is therefore also vacuous here: err_network is already the state with the
radio on.
TO CLOSE AC3: on a device or emulator with real egress to the API host, open any
of the three hosts and confirm the state resolves to up-to-date or available
(not err_network), and that pressing the check button visibly re-runs it. Note
GET /app/version needs a valid X-App-Key (auth:'app'), so a bare curl answers
401 - that is expected and is not the failure being chased.

Gates run, all green: android/checks/run.sh (core, known-tags, tag-writer,
manifest, verify-no-shift, new update-reach) exit 0; verify-no-shift-check.sh
under all three MUTANTs (tapinbox, actionview, workerapi) red as required;
update-reach-check.sh MUTANT=secondimpl red as required; gradlew
:app:assembleDebug exit 0; node ops/check-branding.mjs OK with its one known
pre-existing TODO - 'iOS is still associated with the RENAMEABLE host
schimmer-glanz.exe.xyz, not the permanent tag host timesheets.exe.xyz'
(TASK-188), untouched by this task. NFCTimeSheets/checks/run.sh not applicable:
no iOS file was touched.

Trap hit and worth recording: my first draft of the new code put the literal
strings ACTION_VIEW, app.api and restoreSession in COMMENTS inside
VerifyZoneActivity.kt. verify-no-shift-check.sh forbids those tokens anywhere in
that file, comments included, so the prose describing why the change was safe
made an existing gate go red. Comments now name the concepts without spelling
the tokens, and update-reach-check.sh assembles its own forbidden token from
fragments for the same reason.

INDEPENDENT VERIFICATION (second agent, re-ran everything rather than trusting the
implementation report). AC3 is now CLOSED with real evidence, and the reason the first
run could not close it was an ENVIRONMENT FIXTURE, not the app.

ROOT CAUSE of the endless err_network: emulator-5554's /system/etc/hosts had
  127.0.0.1 timesheets.exe.xyz
  127.0.0.1 schimmer-glanz.exe.xyz
installed on purpose by demo/android-setup.sh, which points the app at a local TLS front
via 'adb reverse tcp:443'. With that front not running, EVERY request fails - so the app
was correct and the phone was lying. Verified by reading the file, not by inference.

WHAT WAS DRIVEN, one session, app data cleared first (pm clear -> no shared_prefs at all,
re-checked at the END: shared_prefs/ still EMPTY, so neither a worker NOR an operator
session ever existed during the run):
  hosts temporarily bind-mounted to the real A record (161.210.92.13), restored byte-for-byte
  afterwards; adb reverse left untouched.

  SEE, all three hosts, no session:
    SignIn -> Betreiber?  'App-Version' + 'Installiert: 0.5.8 (15)' + the check
    WriteTagActivity      'Dieses Telefon hat kein NFC.' AND 'Nach Updates suchen' together
                          (the outside-the-when proof, on a device with no NFC at all)
    VerifyZoneActivity    same button; tap -> topResumedActivity=...ui.UpdateActivity
  and the check RESOLVED against the live server: 'Sie haben die aktuelle Version.'
  (UpToDate), never err_network.

  TRIGGER, proven by a state flip the press alone can cause, run twice - on the Betreiber?
  section and again on UpdateActivity opened from WriteTagActivity:
    UpToDate --[airplane ON, wait 4s: STILL UpToDate]--> press --> 'Keine Verbindung ...'
    + 'Erneut versuchen' --[airplane OFF]--> press --> 'Sie haben die aktuelle Version.'
  A->B->A, both edges caused by the button, with the 4s idle proving nothing re-checks in
  the background. This is what the first run's identical-text-either-way observation could
  not establish.

RE-RAN INDEPENDENTLY, all green: android/checks/run.sh exit 0 (core, known-tags,
tag-writer, manifest, verify-no-shift, update-reach); MUTANT=secondimpl on
update-reach-check.sh goes red as required; gradlew :app:assembleDebug exit 0;
node ops/check-branding.mjs OK with the one KNOWN PRE-EXISTING TODO, quoted in full because
it belongs in a human-read report and not only in a script's stdout:
  'TODO iOS is still associated with the RENAMEABLE host schimmer-glanz.exe.xyz, not the
   permanent tag host timesheets.exe.xyz. Universal links work today because the API host
   also serves the association files.'  -> TASK-188, untouched by this task.

AC2 re-checked by hand, not by the new check alone: exactly one UpdateSection definition
(ui/TimeSheetApp.kt:2111, internal, called from 3 sites), one checkForUpdate()
(update/UpdateManager.kt:66), one installIntent (same file), one DownloadManager.Request
enqueue (same file, :89). No second implementation anywhere under app/src/main.

AC4 is DOCUMENTATION ONLY and is recorded above; no file under NFCTimeSheets/ was opened,
edited or built for it. One line: iOS cannot self-update (App Store rule) - an operator-only
iPhone gets builds through TestFlight's internal track, and off TestFlight only by a manual
re-signed sideload.
<!-- SECTION:NOTES:END -->
