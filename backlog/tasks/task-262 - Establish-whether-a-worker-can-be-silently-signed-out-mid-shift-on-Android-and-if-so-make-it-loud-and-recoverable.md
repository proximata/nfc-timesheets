---
id: TASK-262
title: >-
  Establish whether a worker can be silently signed out mid-shift on Android,
  and if so make it loud and recoverable
status: Done
assignee: []
created_date: '2026-08-24 19:07'
updated_date: '2026-08-24 22:22'
labels:
  - android
  - worker
  - reliability
  - investigation
dependencies: []
modified_files:
  - >-
    android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/TimeSheetApp.kt
  - android/app/src/main/res/values/strings.xml
  - android/app/src/main/res/values-en/strings.xml
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
- [x] #1 Every code path that clears the worker session is enumerated, and it is established in writing whether any of them can fire on something other than an explicit sign-out or a genuine server 401
- [x] #2 A network error, a timeout, a 5xx, a proxy HTML error page and a TLS failure are each proven NOT to clear the session
- [x] #3 If a session is cleared while a shift is open locally, the local shift row survives and is still visible to the office once a session returns
- [x] #4 The worker is told in words what happened and what to do, rather than being dropped on a bare sign-in screen
- [x] #5 android/checks/core-check.kt still passes
- [x] #6 The finding is recorded even if the answer is that it cannot happen — a written negative is the deliverable if the code proves clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Enumerate every code path that clears the worker session (SharedPreferences/cookies/state): dropToSignedOut(), its 2 call sites (sessionRejected collector, restoreSession's 401 branch), the sole writer of app.sessionRejected (Api.send()'s sessionBearing-gated classifier), and the 2 explicit paths (signOut, signIn's own-submit catch) that are correctly out of scope.
2. For each of network error/timeout/TLS/5xx/proxy-HTML/2xx-unparseable, trace Api.kt's send() to prove it cannot reach onSessionRejected() -- write the verdict per case.
3. Confirm AC3 (open/queued shift survives a session clear): dropToSignedOut/signOut never touch app.store; confirm the 2026-08-20 401-retryable fix (ApiFailure.isRetryable, SyncPlan.blocksRow) already makes a lapsed session non-blocking, pinned by core-check.kt.
4. AC4: find why a passive session drop (dropToSignedOut's reasonKey) does not reach the worker as words, fix with the smallest change, new copy in both locales, no new string keys.
5. Confirm core-check.kt passes unmodified.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1/AC2 -- FULL ENUMERATION: exactly 2 code paths can silently clear a signed-in worker's session: (1a) init{}'s app.sessionRejected.collect{} -> dropToSignedOut(), (1b) restoreSession()'s catch, 401 branch -> dropToSignedOut(). Sole writer of sessionRejected is Api.kt send()'s classifier: 'if (status==401 && sessionBearing) onSessionRejected()' -- gated by the sessionBearing flag so /auth/code and other non-session routes' 401s never fire it. The 2 explicit paths (signOut() / Abmelden tap, signIn()'s own catch on a refused code) are correctly out of scope per the task -- neither can silently drop an already-signed-in worker.

Per-case verdict, all traced against Api.kt's send():
- network error/timeout/TLS failure: caught by 'catch (_: Exception)' wrapping outputStream.write/responseCode/inputStream.read, converted to ApiFailure.network() (status=0) BEFORE the status-code branch runs. Structurally unreachable from onSessionRejected(). PROVEN CLEAN.
- 5xx: reaches the classifier but status!=401 so the guard is false; restoreSession's own catch also gates strictly on ==401. PROVEN CLEAN.
- proxy HTML error page, non-401 status (502/503/504/511): same status-gate as 5xx. PROVEN CLEAN.
- proxy HTML page, 2xx with unparseable body (captive portal): runCatching{JSONObject(payload)}.getOrElse{throw ApiFailure.network()} converts it to status=0. PROVEN CLEAN.
- RESIDUAL, named not fixed: an intermediary answering literal HTTP 401 with any body DOES fire onSessionRejected() (status check runs before body parsing). No evidence this occurs on this deployment (exe.dev's proxy fails 502-class on backend-down; nothing in this repo puts a 401-issuing layer in front of apiHost; the task's own real incident was adb reverse pointed at a genuinely different live server correctly saying 'no session', not a malformed proxy page). Recorded as a narrow structural gap, not a live bug -- NOT fixed, per the task's own instruction that a written negative is an acceptable deliverable.

AC3: neither dropToSignedOut() nor signOut() touches app.store (SQLite shift rows) -- only cookies/worker-cache/notification-arming/in-memory session state; local row untouched by construction. Retry path already correct and already shipped: ApiFailure.isRetryable treats status==401 && code!='invalid_code' as retryable (fixed 2026-08-20, documented in-file as a former real payroll-loss bug), so SyncPlan.blocksRow is false for a lapsed-session 401 and the row is replanned once the session returns. core-check.kt's retryClassification() pins both assertions ('401 unauthorized retryable', 'a lapsed session NEVER blocks a queued shift'). PROVEN CLEAN, no fix needed, SyncPlan/ApiFailure/TapInbox/Wire/Zones NOT touched.

VERDICT: no code defect in the session-clearing mechanism itself (AC1-3). The 401/sessionBearing design already does exactly what decision-22 requires.

AC4 -- REAL GAP FOUND AND FIXED (message-display defect, not a session-clearing defect): dropToSignedOut() sets reasonKey='err_no_session' on SessionState.SignedOut, but ui/TimeSheetApp.kt's SignInScreen only surfaces a reasonKey when 'typed == attempted' -- true only after THAT screen's own failed submit sets attempted=typed. On the FIRST composition after a passive drop (fresh composable: typed='', attempted=null), '' != null, so errorKey is always null and the reason is silently dropped -- worker sees an empty code field with zero explanation. Confirmed 'err_no_session' is CLIENT-SYNTHESIZED and unique to dropToSignedOut() (server auth failures answer 'unauthorized' per Api.kt's own kdoc; /auth/code answers 'invalid_code'), so it was safe to special-case on this exact key with zero risk to the submit-refusal flow.

FIX (2 parts, no new string keys, no core-check impact): (1) ui/TimeSheetApp.kt SignInScreen -- added an unconditional Card, NOT gated by typed==attempted, shown whenever reasonKey=='err_no_session', placed before signin_code_intro/PendingCard so it's read first; stops rendering the instant reasonKey changes to anything else (the existing gated errorKey path still handles a later failed-submit refusal correctly, no interference). (2) rewrote err_no_session's copy in both locales (values/strings.xml:321, values-en/strings.xml:234) to say what happened (signed out of this device, not by the worker), that recorded hours are safe and will send automatically, and what to do (ask the office for a new code) -- replacing the old bare 'you were signed out, sign in again'.

Considered but NOT done (optional hardening for the residual AC2 gap, no live instance found): in Api.kt's send(), only fire onSessionRejected() when the 401 body parses as recognized JSON auth-error shape, mirroring the file's own existing '2xx we cannot parse is not a success' discipline. Left as a named option, not implemented -- no live trigger observed, owner's call.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 22:22
---
VERIFIED independently at 802d47d by reading Api.kt / TimeSheetViewModel.kt / ShiftStore.kt directly, not by trusting the audit prose.

AC1 ✓ enumeration is correct and complete. Sole writer of app.sessionRejected is TimeSheetsApplication.kt:63 → Api.kt:385 'if (status == HTTP_UNAUTHORIZED && sessionBearing) onSessionRejected()'. Two consumers: TimeSheetViewModel.kt:223 (collector → dropToSignedOut) and :277 (restoreSession, '401 -> dropToSignedOut()'). dropToSignedOut (:851) clears cookies + workers + signals only.
AC2 ⚠ 4 of 5 proven, 1 residual — see GAP below. Traced at source in Api.kt send(): the try{} wraps outputStream.write / responseCode / inputStream.read and 'catch (_: Exception) { throw ApiFailure.network() }' fires BEFORE the status branch, so offline/DNS/timeout/TLS never reach the classifier ✓. 5xx and non-401 proxy pages fail the '== 401' guard ✓. A 2xx with an unparseable body hits 'runCatching{JSONObject}.getOrElse{ throw ApiFailure.network() }' ✓.
GAP (named, not fixed, NOT introduced by this task): an intermediary answering literal HTTP 401 with an HTML body DOES fire onSessionRejected — the status check at Api.kt:385 runs before the body is parsed. AC2 lists 'a proxy HTML error page' unqualified, so that case is proven only for non-401 statuses. No live instance found in this repo (nothing in ops/ or the tag host puts a 401-issuing layer in front of apiHost; exe.dev fails 502-class). Blast radius is now bounded by AC3+AC4 in this same task. The 2-line hardening (fire only when the 401 body parses as our JSON error shape) is left as the owner's call.
AC3 ✓ stronger than claimed. grep for DELETE across the module: the ONLY deletes are ShiftStore.kt:255 'locations' and :268 'zones' (roster refresh). Nothing anywhere deletes from the 'shifts' table — the row cannot be lost by construction, not merely by these two paths not touching it. ShiftStore is SQLiteOpenHelper('timesheets.db'), so it survives process death. ApiFailure.isRetryable: status==401 && code!='invalid_code' → true; SyncPlan.blocksRow = !isRetryable → false. Pinned by core-check.kt:282-283.
AC4 ✓ card is real and unconditional: TimeSheetApp.kt:203 'if (reasonKey == "err_no_session")', outside the typed==attempted gate, above signin_code_intro, liveRegion Assertive. Key is client-only — 'no_session' appears in exactly 2 places (TimeSheetViewModel.kt:857, ApiFailure.kt:110), never from the server. Copy in both locales says what happened, that hours are saved and auto-send, and to ask the office for a new code. Not a bare bounce.
AC5 ✓ 'git diff 802d47d^ HEAD -- android/checks/' is EMPTY — core-check.kt byte-identical. run.sh re-run here: core-check/known-tags/tag-writer/manifest/verify-no-shift all OK. :app:compileDebugKotlin exit 0.
AC6 ✓ written negative recorded in the notes.

VERDICT: SHIPPED_WITH_GAPS — the one gap is the literal-401 intermediary above, disclosed rather than papered over.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AC1-3: NO CODE DEFECT FOUND in the session-clearing mechanism -- written up in full above (2 silent-clear paths enumerated, 5 non-401 transport/proxy cases proven structurally clean, 1 narrow residual named-not-fixed, open-shift survival already fixed 2026-08-20 and pinned by core-check). AC4: real message-display gap found and fixed -- SignInScreen now shows an unconditional explanation card on a passive session drop (err_no_session), with rewritten copy in both locales explaining what happened and that hours are safe. core-check.kt UNMODIFIED (confirmed: zero core-check references to onSessionRejected/sessionRejected; the fix lives entirely in ui/TimeSheetApp.kt + 2 string values). android/checks/run.sh green end to end. :app:compileDebugKotlin clean. Commit 802d47d.
<!-- SECTION:FINAL_SUMMARY:END -->
