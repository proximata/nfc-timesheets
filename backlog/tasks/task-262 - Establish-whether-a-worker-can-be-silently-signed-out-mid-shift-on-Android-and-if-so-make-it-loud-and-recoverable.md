---
id: TASK-262
title: >-
  Establish whether a worker can be silently signed out mid-shift on Android,
  and if so make it loud and recoverable
status: To Do
assignee: []
created_date: '2026-08-24 19:07'
labels:
  - android
  - worker
  - reliability
  - investigation
dependencies: []
priority: medium
ordinal: 180000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: Android worker journey — observed twice during the session, then largely explained away. Filed as an INVESTIGATION, not as a confirmed defect. Read the caveat before scoping.

WHAT HAPPENED: twice during the run the app returned to the sign-in screen without anyone tapping Abmelden. Most of it was traced to a real test-environment cause: another concurrent process on the same Mac kept re-pointing the emulator's adb reverse tcp:443 mapping at a different local demo stack mid-session, so the app's calls started hitting a server that had never heard of its session. Once the tunnel was pinned back, the entire journey — enrolment-code sign-in, tap in, tap out, sign out, SMS sign-in — ran clean end to end. So the honest reading is: probably environment, not proven environment.

WHY IT IS STILL WORTH A DELIBERATE CHECK: the consequence if it CAN happen on a real phone is out of proportion to the odds. A worker dropped to the sign-in screen mid-shift cannot get back in on their own — an enrolment code is one-time and comes from the office, and the SMS door only exists if the office has stored their number. A cleaner alone in a building at 06:00 with a running shift and a locked app has no path forward. This is the same class of problem as TASK-225 (a shift stranded on a phone is invisible to everyone), which was real.

WHAT TO ESTABLISH, in order:
 1. Can the client clear its session on anything other than an explicit Abmelden and a genuine 401 from the server? Read every path that clears the session in SharedPreferences and every call site that treats a response as an auth failure. A network error, a timeout, a 5xx, an HTML error page from a proxy and a TLS failure must NOT be one of them.
 2. If a session IS cleared while a shift is open locally, what happens to the shift row? It must survive, and the office must be able to see it.
 3. What does the worker see? A silent bounce to sign-in is the worst possible answer. Say what happened and what to do.

MUST NOT REGRESS: the tap path (android/checks/core-check.kt), and the rule that clocking in writes its local row before any signal is armed. This task must not touch the offline queue's refusal semantics — an unresolved tag correctly refusing to open a shift is WANTED behaviour, and TASK-240 and TASK-247 were closed Wont Do on exactly that point. Do not reopen them here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every code path that clears the worker session is enumerated, and it is established in writing whether any of them can fire on something other than an explicit sign-out or a genuine server 401
- [ ] #2 A network error, a timeout, a 5xx, a proxy HTML error page and a TLS failure are each proven NOT to clear the session
- [ ] #3 If a session is cleared while a shift is open locally, the local shift row survives and is still visible to the office once a session returns
- [ ] #4 The worker is told in words what happened and what to do, rather than being dropped on a bare sign-in screen
- [ ] #5 android/checks/core-check.kt still passes
- [ ] #6 The finding is recorded even if the answer is that it cannot happen — a written negative is the deliverable if the code proves clean
<!-- AC:END -->
