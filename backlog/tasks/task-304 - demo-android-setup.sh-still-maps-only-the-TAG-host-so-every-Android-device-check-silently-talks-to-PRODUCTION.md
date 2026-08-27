---
id: TASK-304
title: >-
  demo/android-setup.sh still maps only the TAG host, so every Android device
  check silently talks to PRODUCTION
status: To Do
assignee: []
created_date: '2026-08-27 16:07'
labels:
  - demo
  - android
  - tooling
  - bug
dependencies: []
priority: high
ordinal: 222000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-296 review gate while trying to run demo/check-shift-screen-brand.mjs, 2026-08-27. This is why that check has been unrunnable, and it is a production-contact hazard, not just a broken demo.

WHERE. demo/android-setup.sh (the hosts file it stages), /tmp/ts-demo/tls/ext.cnf (the cert SANs), backlog/docs/DEMO.md section 1.

MEASURED STATE. android-setup.sh stages exactly one app host:
    printf '127.0.0.1 localhost\n::1 ip6-localhost\n127.0.0.1 timesheets.exe.xyz\n' > /data/local/tmp/hosts
and the demo certificate's SANs are DNS:timesheets.exe.xyz, DNS:localhost, IP:127.0.0.1, IP:10.0.2.2.

But since decision-40 the app does NOT talk to the tag host. net/Api.kt line 72:
    private val base = "https://${BuildConfig.API_HOST}"
and branding.properties sets ts.apiHost=schimmer-glanz.exe.xyz. The tag host is only ever PARSED off a card; it is never called. So the hosts entry the setup script writes covers a host the app never contacts, and every API call from the emulator resolves schimmer-glanz.exe.xyz over the real internet.

WHAT BREAKS, observed. On an emulator set up exactly per DEMO.md, sign-in with a locally minted enrolment code renders 'Dieser Code wird nicht angenommen' while the local demo server logs no /auth/code at all - because the code was checked against the LIVE BOX, which has never heard of it. The failure looks like an app bug and is a routing bug. Downstream: check-shift-screen-brand.mjs stops at 'the offline tap did not open a shift on the phone', which is what TASK-295 recorded as environmental and pre-existing; this is the environment it meant.

WHY IT MATTERS BEYOND THE DEMO. A demo/verification run pointed at production is one mis-set fixture away from writing to it. The observed call was a rejected enrolment code (no write), but the same emulator, signed in against the live box, would have posted shifts to real workers. Nothing in the setup makes that visible: the script prints 'ready' either way.

FIX, both halves or neither.
1. Stage BOTH hosts, and take the value from branding.properties rather than hardcoding it, so a rename cannot re-open this:
     127.0.0.1 timesheets.exe.xyz
     127.0.0.1 schimmer-glanz.exe.xyz
2. Re-issue the demo leaf certificate with both names in subjectAltName (ext.cnf), otherwise the app fails hostname verification on the API host and the symptom merely changes. Verified working locally with:
     subjectAltName=DNS:timesheets.exe.xyz,DNS:schimmer-glanz.exe.xyz,DNS:localhost,IP:127.0.0.1,IP:10.0.2.2
   After that the emulator reached the local server (GET /auth/capabilities 200, sign-in 200, GET /roster 200, GET /flags 200) and check-shift-screen-brand.mjs ran green.
3. Make the script FAIL LOUD if the API host does not resolve to 127.0.0.1 inside the emulator - a demo that can reach production must not start.

MUST NOT REGRESS. The tag host mapping stays (the tap URL in a recording must remain the real one off the wall). No app source change: the point of the demo rig is that the APK is byte-for-byte the shipping one. decision-40's two-host split is not up for renegotiation here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 android-setup.sh maps BOTH ts.tagHost and ts.apiHost, read from branding.properties, never hardcoded
- [ ] #2 the demo leaf cert carries both names in subjectAltName; DEMO.md's generation step updated to match
- [ ] #3 the script refuses to finish if the API host inside the emulator does not resolve to 127.0.0.1
- [ ] #4 demo/check-shift-screen-brand.mjs runs end to end on a freshly set up emulator with no manual patching
<!-- AC:END -->
