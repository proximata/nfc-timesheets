# Product launch and planning verification — 23 September 2026

Base: `7827b83`, branch `codex/product-launch-and-scheduling`. All database and browser
journeys below used disposable local PostgreSQL fixtures, never a production company.

## Automated checks

- `node server/check-api.js`: PASS, existing full API regression suite.
- `node server/check-workspaces.js`: PASS, migrations 022–025 under restricted roles,
  company isolation and new product checks. Trial requests persist once per normalized
  email, platform-only read, invalid email refused, repeated requests throttled. Schedule
  tests exercise create/retry/edit/stale-version/cancel, another company's worker/building,
  worker self-only reads, simultaneous overlap attempts and adjacent time windows.
  Planning leaves the actual `shifts` table unchanged.
- `pnpm verify`: run; fails on four **pre-existing Windows path assertions** in
  `scripts/check.mjs`: exactly one HomeMap; two location-page checks; required worker rate.
  Their slash assumptions were not rewritten. All added URL/custom-date/DST checks pass.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`: PASS individually. Lint retains one existing
  optional-chain warning in payroll. Static export includes `/product/` and `/schedule/`.
- Android `:app:assembleDebug`: PASS. `:app:testDebugUnitTest` reports **NO-SOURCE**;
  this is not a claim that an Android unit-test suite ran.
- `node ops/check-branding.mjs`: every line `ok`, final `check-branding: OK`, no TODO.

## Real browser journeys

Landing: German and English, desktop and 390px layout, CTA anchor, required fields, malformed
email feedback and a successful synthetic work-email request. The request was verified in
PostgreSQL and the platform inbox. A tenant admin cannot open the platform inbox. No browser
console errors on the public page. CSS respects reduced motion; no additional library.

Dates: workspace, shifts, payroll, P&L and analytics all showed 14–20 September for Last week
and excluded the fixture's 23 September shift. Custom 21–23 September included the same
1.5 hours / EUR 22.50 on all relevant screens. Links from workspace and report building
links retained `period=custom&start=2026-09-21&end=2026-09-23`. Reversed dates kept Apply
disabled and retained the prior URL/results. Both languages were exercised. Tests also
cover the 73-hour Vienna interval across the autumn daylight-saving change.

Scheduling: admin created a future assignment, changed its time and instructions, and
cancelled it through the confirmation dialog. PostgreSQL showed versions 1, 2, 3 and the
correct UTC equivalents of Vienna inputs. A competing overlapping assignment displayed
the specific refusal and created no row. Worker filter, next/previous week, empty week,
This week and Refresh were driven through the UI. Cancellation leaves visible history.
The saved notice now re-translates immediately when switching German/English; this was
verified in the browser after a successful save and a fresh production build.

## Real Android emulator journey

The compiled debug application used the existing debug-only API override and the same
disposable database as the admin. The worker signed in through the actual code screen.
An edited admin assignment appeared on the worker home at 10:30–12:30 Vienna, including
its updated instructions. A cold start retained the session and loaded the schedule.
Cancelling in admin and pressing Refresh assignments on Android removed that assignment;
the other assignments remained. German and English schedule labels were visible.

A cached-session loading race found during review was fixed: confirming the same worker
does not invalidate an already running schedule request. Sign-out and worker identity
changes still invalidate it. Upcoming cards initially show at most three assignments.

## Review and delivery limits

A dedicated review read the decision records and changes and ran branding. Its findings
(422 form feedback, default time in the past, month-only overview label) were corrected.
Browser verification found additional month-only explanatory copy, also corrected.

Screenshots and the Russian visual report are local regenerable artifacts under
`captures/company-workspaces/product-launch/`; they are not committed. Existing Android
company branding was not replaced. No production migration, deployment, Play release,
push, PR or merge was performed. Physical NFC taps cannot be tested by this emulator.
New NFC scan animations and iOS scheduling remain outside this iteration.

## Follow-up Android fixes (TASK-346)

The user caught a direct operator-tools row in signed-in Settings. It is removed;
Settings now uses the same five-tap version entry as the signed-out screen, followed
by the unchanged separate operator-authentication gate. The focused JVM
`version-tap-gate-check` passes and the debug APK builds successfully.
The emulator verified no ordinary Settings row, four taps staying on Settings, the
fifth opening the operator screen, Back retaining the worker session, and the
signed-out fifth tap opening the operator-code form.

The account-switch walkthrough also exposed another worker's local Recent records.
Local history queries, tap open-shift lookup and boot notification recovery now use
the current worker ID. Account changes clear rendered state; asynchronous local reads
check the current identity before publishing. Durable queued shifts are not deleted.
The rebuilt app's worker B home shows an empty Recent section and own empty schedule.
Read-only SQLite inspection confirmed that the four old September 22 rows belonged to
worker 1 (Legacy worker), while the current test workers are Anna a (2) and Anna b (3).
Those four rows remain on disk; hiding them for both current accounts is correct.
The final A → B → A UI pass confirmed ownership preservation: B saw neither of A's
new Recent rows nor assignments; returning A saw both its real manual shift and its
labelled DEBUG-test row again. The emulator is left signed in as Anna a in German.

## Manual start zone selection (TASK-347)

The ownership walkthrough exposed an older real bug: manual start submitted a building
UUID, which decision-69 no longer accepts. The Android picker now explicitly labels
each building and zone and submits the selected zone ID; no arbitrary default zone and
no server-side verification bypass. Explanatory and empty-state copy ships in DE/EN.

After a fresh debug build, the emulator selected `Haus a · Eingang`, used the ordinary
Start button and received HTTP 201. PostgreSQL confirmed worker 2, the selected
`start_zone_id`, and `manual_start=true`. The ordinary Stop button set `end_time` and
`manual_close=true`; the resulting row appeared in Recent. An earlier DEBUG-simulated
row was used only to inspect local ownership; it is not evidence of server acceptance.

Final read-only review after all fixes covered every decision record and the final
Android/web deltas. No remaining decision or code-quality blocker was found. The
reviewer repeated branding (all `ok`, no TODO/FAIL) and `git diff --check` successfully.
