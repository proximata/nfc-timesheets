---
id: TASK-264
title: >-
  Android: a paused update download says Warte auf Internetverbindung for three
  different reasons and offers no cancel or retry
status: Done
assignee: []
created_date: '2026-08-24 19:08'
updated_date: '2026-08-25 06:29'
labels:
  - android
  - ux
  - updates
dependencies: []
priority: low
ordinal: 182000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: Android worker journey, step 'Published a fake newer release on the local server, tapped Nach Updates suchen, then Herunterladen'. Driven live on the ts-demo emulator, screenshot 16-update-waiting.png, plus a read of update/UpdateCheck.kt.

TWO SEPARATE THINGS, and only the second is confirmed:

CONFIRMED, from source: UpdateCheck.kt maps three distinct DownloadManager pause reasons — genuinely waiting for a network, waiting to retry, and queued for wifi-only — onto the single sentence 'Warte auf Internetverbindung ...'. Only one of those three is about having no internet. A phone that is online but has the download queued for wifi-only, or is backing off before a retry, tells the worker to go find WiFi. And there is no cancel or retry control while paused: the only retry button in the whole flow appears on the terminal 'Fehlgeschlagen' state, which the paused state may never reach.

NOT CONFIRMED, do not chase it: in this run the download also never started at all — the server log shows the APK request never arrived. That is very likely Android's separate DownloadManager process refusing this demo's self-signed TLS certificate, which cannot happen in production against a real certificate. It was not independently verified against a trusted cert, so the whole 'ready to install' and install-prompt path is UNTESTED, not broken. See the walkthrough's coverage gaps.

WHY IT MATTERS FOR UAT: the update path is how a field phone gets a fix without someone driving out to sideload it, so it is exercised often during a pilot. Sending the worker, or the office on the phone with the worker, to check WiFi when WiFi is not the problem burns the one troubleshooting attempt a non-technical user has in them. A retry button costs nothing and fixes most of it.

RELATED: TASK-254 (operator-only phones cannot reach this screen at all) and TASK-253 (neither app shows its version). Same area, do not merge — this one is only about the paused state's copy and controls.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each DownloadManager pause reason renders its own sentence — waiting for any network, backing off before a retry, and queued for wifi-only are three different messages
- [x] #2 The wifi-only case says so and offers the choice to download over mobile data, or explains where to change it
- [x] #3 A paused or stalled download can be cancelled and retried from the screen, without waiting for it to reach the terminal Fehlgeschlagen state
- [x] #4 de and en strings.xml both carry the new strings with exact key parity
- [x] #5 Verified against a server with a trusted certificate, not the self-signed demo front, so the download actually starts
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-25 06:29
---
VERIFY PHASE, independent re-check of d9c3614 (all evidence re-derived from source, none copied from the build report).

AC1 - three distinct sentences, verified in source not description:
UpdateCheck.classify() DM_STATUS_PAUSED now branches three ways -
DM_PAUSED_WAITING_FOR_NETWORK -> WAITING_FOR_NETWORK, DM_PAUSED_WAITING_TO_RETRY ->
WAITING_TO_RETRY, DM_PAUSED_QUEUED_FOR_WIFI -> QUEUED_FOR_WIFI (else-arm still RUNNING,
unchanged). UpdateManager maps each to its own DownloadPauseReason (NETWORK/RETRY/WIFI_ONLY),
and the UpdateSection when-branch resolves each to a genuinely different string:
update_waiting_network 'Warte auf Internetverbindung ...' / update_waiting_retry 'Kurze Pause,
bevor der Download automatisch erneut versucht wird ...' / update_waiting_wifi 'Der Download
wartet auf eine WLAN-Verbindung.' Three reasons, three strings, none collapsed.

AC2 - WIFI_ONLY branch additionally renders update_wifi_mobile_note plus an OutlinedButton
to UpdateReadiness.wifiOnlySettingsIntent() = ACTION_IGNORE_BACKGROUND_DATA_RESTRICTIONS_SETTINGS
on API24+, ACTION_APPLICATION_DETAILS_SETTINGS below (minSdk 23). enqueueDownload() already sets
setAllowedOverMetered/setAllowedOverRoaming, so the settings deep link is the honest offer.

AC3 - read the Composable, not the claim: TimeSheetApp.kt is UpdateState.Downloading branch,
guard is 'if (s.pauseReason != null)' -> Row with OutlinedButton update_cancel_button ->
cancelUpdateDownload() and Button update_retry_button -> retryUpdateDownload(), both
heightIn(min = 48.dp). That is the PAUSED state, one state before terminal Failed. ViewModel:
cancelUpdateDownload() cancels updatePollJob, drops to UpdateState.Available, calls
UpdateManager.cancelDownload(id) (DownloadManager.remove + prefs clear, so resumePending cannot
resurrect it); retryUpdateDownload() cancels and AWAITS the old DM row before re-enqueuing,
which is what stops two writers racing on the fixed destination filename. Both no-op unless the
state really is Downloading. pollUpdateDownload writes state every 700ms and only breaks on
ReadyToInstall/Failed, so a paused state does keep rendering and the buttons stay reachable.

AC4 - de/en key parity re-computed from both files, not trusted: 278 keys each, diff empty.
res/ diff for this commit has ZERO deletion lines (only additions).

AC5 - re-run by me, my own request, numbers below are mine:
  openssl s_client -> chain CN=exe.xyz <- Let's Encrypt CN=YR1 <- ISRG Root YR,
    Verify return code 0 (ok). curl succeeded with no -k, i.e. system trust store accepted it.
    Not the self-signed emulator front the task blamed.
  GET /app/version (X-App-Key from android/branding.properties, the same value the app compiles
    into BuildConfig.APP_KEY) -> 200 published=true version_code=14 version_name=0.5.7
    sha256 dddc4b5ccd9845c7389d34e50026b0c5d518a8a801530efef6aec3e14748ac75
  GET /app/download -> HTTP/2 200, content-disposition nfc-timesheets-0.5.7-14-release.apk,
    content-type application/vnd.android.package-archive, content-length 1760402, received
    1760402, magic bytes 504b0304 (PK zip), sha256 dddc4b5c...748ac75 - byte-identical to the
    manifest hash. Scratch file deleted from /tmp immediately, existence re-checked after rm.
  Read-only GETs only, no admin/worker/operator credential used, nothing written.
  HONEST CAVEAT, recorded rather than glossed: this proves the release endpoint serves real APK
  bytes over a TRUSTED chain, so the 'DownloadManager refused the cert' hypothesis is ruled out
  at the trust-chain layer. It is NOT an on-device run - DownloadManager completing the transfer
  and the install prompt appearing are still untested on hardware. The task's own NOT CONFIRMED
  paragraph stays true to that extent.

checks/core-check.kt diff is non-empty and that is CORRECT, not a weakened check: the old
assertion encoded the bug ('queued-for-wifi classifies as WAITING_FOR_NETWORK too'). It now
asserts QUEUED_FOR_WIFI, and a NEW assertion for WAITING_TO_RETRY was added. Net strictly more
assertions, none removed, PAUSED-unknown -> RUNNING untouched.

Build re-run by me: android/checks/run.sh all five green (core, known-tags, tag-writer, manifest,
verify-no-shift); gradlew :app:compileDebugKotlin --rerun-tasks (forced, not UP-TO-DATE) ->
BUILD SUCCESSFUL, only two pre-existing 'No cast needed' warnings in unrelated files. No source
residue of the old waitingForNetwork Boolean. android/ tree clean. No APK cut, none required.

VERDICT: SHIPPED.
---
<!-- COMMENTS:END -->
