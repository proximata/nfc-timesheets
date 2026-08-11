---
id: TASK-49
title: Analyse Balint's screen recording from the first Android field test
status: To Do
assignee: []
created_date: '2026-08-11 19:12'
labels:
  - android
  - research
  - evidence
dependencies: []
priority: high
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHAT IT IS. Balint recorded his screen during the first real Android field test on 2026-08-11 - the session that produced shift 7 at HOIV, the first successful Android clock-in the system has ever had, and the session where he then could not clock out. The recording is in the Telegram chat with Balint (@arvidenchi, peer 6566785488). Pull it with the telegram-utils session, the same way the two tag photos were pulled.

INCLUDE THE AUDIO IF THERE IS ANY. A screen recording may carry a voice track, and a tester talking through what they are doing is worth more than the pixels: it says what they EXPECTED, which is the one thing no log, no database row and no video frame can tell us. Transcribe it if present.

WHY IT IS WORTH REAL ATTENTION RATHER THAN A GLANCE. This is the first time anyone outside this machine has used the Android app against a real tag on a real wall. Every previous Android 'test' was an emulator with a mocked tap. Specifically, look for:
  - how long he held the phone to the tag, and where on the phone he held it
  - whether the scan screen reported anything before it succeeded
  - what he tried when he could not clock out, and in what order - that is the honest
    measure of how discoverable the UI is
  - any moment where the app said something true but unhelpful
  - whether the NFC banner or any other state looked stale

KNOWN ALREADY, so do not spend the analysis rediscovering it: the clock-out was impossible
because the manual scan button only exists on the idle screen and ShiftRunningScreen returns
early, so with an adopted tag (no URL, no passive tap) there is no way out. That is a
separate fix. The recording is for what we do NOT already know.

PRIVACY: the recording is of a real person using a real phone and may show notifications,
other apps or his name. It must NOT be committed to the public repo, and anything quoted
from it in a report goes in redacted. Treat it like the earlier demo footage.
<!-- SECTION:DESCRIPTION:END -->
