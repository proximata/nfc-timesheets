---
id: TASK-264
title: >-
  Android: a paused update download says Warte auf Internetverbindung for three
  different reasons and offers no cancel or retry
status: To Do
assignee: []
created_date: '2026-08-24 19:08'
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
- [ ] #1 Each DownloadManager pause reason renders its own sentence — waiting for any network, backing off before a retry, and queued for wifi-only are three different messages
- [ ] #2 The wifi-only case says so and offers the choice to download over mobile data, or explains where to change it
- [ ] #3 A paused or stalled download can be cancelled and retried from the screen, without waiting for it to reach the terminal Fehlgeschlagen state
- [ ] #4 de and en strings.xml both carry the new strings with exact key parity
- [ ] #5 Verified against a server with a trusted certificate, not the self-signed demo front, so the download actually starts
<!-- AC:END -->
