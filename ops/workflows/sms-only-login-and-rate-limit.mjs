export const meta = {
  name: 'sms_only_login_and_rate_limit',
  description: 'Drop Sign in with Apple, phone+OTP/code becomes the only iOS worker login, per-IP admin-tunable SMS rate limit, honest unregistered-number copy, TASK-244 login-number UI, TASK-M sync fix, migration-history nav removal',
  phases: [{ title: 'Design' }, { title: 'Build' }, { title: 'Verify' }],
};

const STYLE = `STYLE (defaults; task instructions below win on explicit conflict):
- CAVEMAN: terse, technical exact. Drop articles/filler/hedging. Fragments OK. Pattern: [thing] [action] [reason]. [next step]. Code blocks + exact quotes unchanged.
- PONYTAIL: lazy senior dev. Before code, climb ladder: (1) needed at all? (2) stdlib? (3) native platform? (4) already-installed dep? (5) one line? (6) minimum code. No unrequested abstractions/factories/configs. Mark deliberate shortcuts ponytail: naming ceiling + upgrade path. Never simplify away input validation at trust boundaries, error handling preventing data loss, security, accessibility, or explicit asks. Non-trivial logic -> one runnable check (assert self-check or tiny test file, no frameworks). Trivial one-liners need no test.
- NO TIME ESTIMATES. Relative effort (low/med/high) + reason only.
- RTK: prefix shell commands with rtk.
`;

const REPO = 'cd /Users/gerhardgustav/Desktop/ai-automations/hoiv/cleaning-timesheets';

const HARD_RULES = `ABSOLUTE PROHIBITIONS:
- NEVER edit NFCTimeSheets/NFCTimeSheets.xcodeproj/project.pbxproj. Owner hand-edits it; a bump of CURRENT_PROJECT_VERSION is an owner-only manual step for later.
- NEVER edit or delete anything under docs/media/, never commit screenshots or recordings.
- NEVER git add -A. Stage explicit paths only.
- NEVER build the full local-data-wipe feature. Explicitly OUT OF SCOPE this run (owner deferred it separately). If a file you must touch also relates to it (e.g. DataMigrations.swift), touch only what THIS brief requires and nothing else.
- Money/rate-limit numbers: validate with a bounds check server-side (trust boundary), never trust the client.
- Every commit is real, working-tree state; never leave uncommitted drift for the next phase to guess about.
- Session cookie name constants already exist: SESSION_COOKIE (admin, ts_session), WORKER_SESSION_COOKIE (ts_worker), OPERATOR_SESSION_COOKIE (ts_operator) in server/lib/auth.js. Reuse, do not rename.
Always ${REPO} before any git/psst/pnpm command. Use /usr/bin/grep, /bin/ls, /usr/bin/awk, /usr/bin/git (rtk wraps grep/ls locally, but on ssh/CI paths use absolute binaries). SSH SQL must be piped over stdin (heredoc/printf), never embedded in a quoted -c "..." remote string, or dollar-prefixed tokens get re-parsed by the remote shell.`;

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          amends: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['id', 'title', 'summary'],
      },
    },
    server: {
      type: 'object',
      properties: {
        settingsKey: { type: 'string' },
        rateLimitDefault: { type: 'integer' },
        rateLimitMin: { type: 'integer' },
        rateLimitMax: { type: 'integer' },
        rateLimitWindowSec: { type: 'integer' },
        unregisteredStatus: { type: 'integer' },
        unregisteredErrorCode: { type: 'string' },
        appleRouteDecision: { type: 'string' },
        filesToChange: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['settingsKey', 'rateLimitDefault', 'rateLimitMin', 'rateLimitMax', 'rateLimitWindowSec', 'unregisteredStatus', 'unregisteredErrorCode', 'appleRouteDecision', 'filesToChange'],
    },
    ios: {
      type: 'object',
      properties: {
        signInFlowSummary: { type: 'string' },
        retryFixSummary: { type: 'string' },
        filesToChange: { type: 'array', items: { type: 'string' } },
        filesToRemoveOrGutApple: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['signInFlowSummary', 'retryFixSummary', 'filesToChange'],
    },
    android: {
      type: 'object',
      properties: {
        changeSummary: { type: 'string' },
        filesToChange: { type: 'array', items: { type: 'string' } },
      },
      required: ['changeSummary', 'filesToChange'],
    },
    web: {
      type: 'object',
      properties: {
        changeSummary: { type: 'string' },
        filesToChange: { type: 'array', items: { type: 'string' } },
      },
      required: ['changeSummary', 'filesToChange'],
    },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['decisions', 'server', 'ios', 'android', 'web', 'risks'],
};

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    typecheckPass: { type: 'boolean' },
    deployed: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['commits', 'filesChanged', 'typecheckPass', 'deployed', 'notes'],
};

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    liveProofs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, pass: { type: 'boolean' }, detail: { type: 'string' } },
        required: ['name', 'pass', 'detail'],
      },
    },
    boardUpdates: {
      type: 'array',
      items: {
        type: 'object',
        properties: { taskId: { type: 'string' }, status: { type: 'string' }, evidence: { type: 'string' } },
        required: ['taskId', 'status', 'evidence'],
      },
    },
  },
  required: ['verdict', 'blockers', 'liveProofs', 'boardUpdates'],
};

phase('Design');

const design = await agent(
  STYLE + `
${HARD_RULES}

Repo: ${REPO} (NFC TimeSheets, cleaning-company timesheet app, iOS Swift + Android Kotlin + Node/Postgres server + Next.js admin, all in one monorepo).

OWNER DECISIONS ALREADY MADE THIS SESSION (do not re-litigate, just design the implementation):

1. iOS: remove Sign in with Apple ENTIRELY from worker login. Only phone+OTP self-serve sign-in and admin-issued enrolment-code paste remain, both always visible (no capability gate needed since Apple is gone, unlike Android's earlier SMS-gated-by-capabilities approach). This is decision-22's identity mechanism being retired; decision-22's STRUCTURAL rule (worker_id comes from the session, never the request body) survives untouched and must keep being true for the new screens.

2. Threat model for SMS explicitly changed by the owner: assume no attackers who will probe numbers. decision-48 section 6 currently returns byte-identical 202 for POST /auth/sms/request regardless of whether the phone is a registered worker, specifically to prevent number enumeration. The owner has explicitly waived that concern and wants an honest, distinct response for an unregistered number, surfaced at the moment the worker tries to request a code (not at verify), so the client can show a message like this number is not registered, contact your employer or administrator instead of pretending a code was sent. Design the exact status/error code (do not reuse invalid_phone which is shape-only, or sms_not_configured which is a server property). This amends decision-48 section 6, write the amendment.

3. Rate limiting for POST /auth/sms/request is being simplified given point 2: delete the per-phone-number bucket entirely (checkOtpRequestRate in server/lib/auth.js, it existed only to make unknown numbers behave identically to known ones for anti-enumeration, no longer needed). Replace with one per-IP bucket: N requests per 5 minutes, reusing the same IP-extraction the codebase already has (clientIp(req) in server/server.js, already used by checkLoginRate(ip) in server/lib/auth.js for admin login, same pattern, same spendRolling() helper that already exists). The window is fixed at 5 minutes in code. The count N must be an admin-tunable number, default 3, via the existing generic settings mechanism: app_settings key/value table, POST/DELETE /admin/settings/:key already live (server/routes/admin.js has a SETTINGS allowlist map and putSetting/deleteSetting handlers, read them, this is 005_v2_features.sql's pl_margin_baseline_bp pattern, reuse verbatim, do not invent a new mechanism). Unlike the margin baseline (which does nothing when unset, a feature toggle), an unset rate-limit key must fall back to a hardcoded default of 3, never unlimited and never block everyone. Owner wants the count clamped 1-20 (floor so admin can't accidentally set 0 and lock the company out; ceiling so it stops being a meaningful limit past roughly 240 per hour), confirm or adjust this bound and state your reasoning if you change it. checkGlobalSmsSpend (20/hr, 100/day process-wide cost ceiling) and checkGlobalOtpVerifyRate (60/min, guards the OTP code itself against brute force) are unrelated to this and must not be touched.

4. Web admin: TASK-244 (still open, real gap): PUT /admin/workers/:id/phone and DELETE /admin/workers/:id/phone already exist server-side and are correct (sets/clears the worker's SMS login number in phone_identities), but there is no UI to call them. web/app/workers/page.tsx already reads worker.phone_e164 (nullable) and disables the SMS senden button when it is null, showing German copy Keine Login-Nummer hinterlegt. Zugangscode direkt weitergeben. (web/messages/de.json, smsNoPhone key), but nothing ever sets it. This field is deliberately separate from workers.phone (a plain contact-only field, already editable in the same form), the UI must make that distinction legible (label it as the SMS or login number, not phone number again) to avoid the project's recurring confusing-copy problem (e.g. the earlier Betreiber vs Operator defect). Now that Apple sign-in is gone and SMS+code are the only two worker onboarding paths, this UI gap becomes a hard blocker, a worker cannot get an SMS at all until an admin can type their number in.

5. iOS bug TASK-M (real, unfixed): API.swift's APIFailure.isRetryable (around line 152) only treats shift_already_open and transport/408/429/5xx as retryable. Any other 4xx, including 401, makes Sync.swift line 154 set that specific local shift's syncBlocked to true permanently (nothing clears it except an explicit resolution path at Sync.swift line 216). A worker's session lapsing during a background sync attempt (not necessarily the worker doing anything wrong, could be idle in a bag past the session TTL) therefore silently and permanently strands that worker's already-worked, not-yet-synced hours: after re-signing in, that specific queued shift never retries again, no error ever surfaces to the worker, and the admin sees nothing. Read API.swift lines 140-160 and Sync.swift lines 60-220 in full before deciding the fix, options include (a) making 401 retryable (session-not-found requests will just keep failing harmlessly until re-sign-in restores the cookie, at which point the existing per-tick retry loop picks the row back up automatically with zero new code) or (b) an explicit clear-syncBlocked-for-401-blocked-rows-on-successful-sign-in step. Pick the smaller, more correct one and say why. Also: server/routes/operator.js's POST /operator/zones/:id/verify gate returns 422 zone_unverified at POST /shifts/open for any client hitting an unverified zone (this is server-side and platform-agnostic, iOS will hit it the moment zones are used, exactly like Android already does per TASK-242). iOS's workerMessage switch (API.swift around line 165) has no case for zone_unverified today (falls into default). Add the case (German-first copy, matches Android's wording intent) and add zone_unverified to isRetryable, same reasoning as Android's TASK-242 fix: it must never permanently strand a locally-recorded worked shift.

6. Small housekeeping, independent, low risk, include in this run: remove the Migration history NavigationLink from iOS Settings (ContentView.swift around lines 711-712, MigrationHistoryView() destination), it is developer-facing and confuses workers, per the owner. And: NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements is sitting modified, uncommitted in the working tree right now (the owner's own local Xcode add NFC Tag Reading capability click from a prior session). Diff it against HEAD to see exactly what Xcode auto-stripped, restore the original explanatory comments Xcode deleted (there were 4, including one warning that NDEF, not TAG, caused App Store rejection error 90778) while keeping the new NFC capability key Xcode added. This is a text-only restoration of an already-existing local diff, not a new capability grant.

Your job: produce one structured design covering server, iOS, Android (does Android need any change? Android already shipped its own SMS sign-in screen gated by GET /auth/capabilities in an earlier run, check whether it needs a small update to show the new not-registered-contact-admin copy for parity, and whether anything about the rate-limit change is client-visible to it at all. Keep Android's slice small, this run is primarily an iOS + server change), and Web admin. Write 1-2 new decision records (next free numbers, check backlog/decisions/ for the highest existing number first) that (a) retire decision-22's Apple-only clause while keeping its session-not-body rule, and (b) amend decision-48 section 6's byte-identical-response and per-phone-limiter clauses given the owner's explicit threat-model change. Do not write code. Read the real files named above before deciding anything.
`,
  { label: 'design', model: 'anthropic/claude-opus-5', schema: DESIGN_SCHEMA, agentTimeoutMs: 5400000 },
);

if (design === null) {
  log('Design phase failed validation/repair, cannot proceed.');
  return { verdict: 'DESIGN_FAILED' };
}

log('Design complete: ' + design.decisions.map((d) => d.id).join(', '));

phase('Build');

const designJson = JSON.stringify(design);

const buildResults = await parallel([
  () =>
    agent(
      STYLE + `
${HARD_RULES}

Implement the SERVER slice of this design. Full design JSON (read the relevant server and decisions fields; other fields are for your context only):
${designJson}

Steps:
1. Write the decision record markdown file(s) from design.decisions to backlog/decisions/ (check the highest existing decision number first, do not collide). Match this project's existing decision file format exactly.
2. server/lib/auth.js: delete checkOtpRequestRate (per-phone bucket) and its OTP_REQUEST_RULES. Add a per-IP bucket using the same spendRolling() helper and clientIp-style key, window design.server.rateLimitWindowSec, count read from app_settings (design.server.settingsKey) at request time with default design.server.rateLimitDefault when unset. Add the new SETTINGS allowlist entry in server/routes/admin.js's SETTINGS map with an integer validator clamped to design.server.rateLimitMin and design.server.rateLimitMax.
3. server/routes/auth.js smsRequest(): call the new IP-based limiter (pass req so clientIp(req) can run). When no phone_identities target is found, return design.server.unregisteredStatus and design.server.unregisteredErrorCode instead of the current always-202. Update the doc comment above the function, it currently states byte-identical 202 as a deliberate anti-enumeration property, that claim is now false, rewrite it and point at the decision record that changed it.
4. Decide design.server.appleRouteDecision (delete server/routes/auth.js's /auth/apple route plus server/lib/apple.js, or deprecate in place), default toward deletion since it will have zero callers once iOS drops the button, only deprecate-in-place if you find a real reason, and state it in your notes.
5. Run whatever server-side check/test harness exists (grep for existing check runners such as server/check-api.js) before and after. Deploy via ops/deploy.sh to the live VM (production currently has zero real workers and locations, safe to deploy freely per prior owner authorization). Verify live: GET /admin/sms-status still returns configured true; POST /auth/sms/request for a garbage/unregistered E.164 number returns the new distinct response, not 202; hitting it one more than design.server.rateLimitDefault times from one script within 5 minutes returns 429 on the one over the limit; POST /admin/settings to change the value then re-requesting confirms the new limit takes effect without a restart.
6. Commit as you go, small commits, real messages. Return the schema.
`,
      { label: 'server', model: 'anthropic/claude-sonnet-5', schema: RESULT_SCHEMA, agentTimeoutMs: 5400000 },
    ),
  () =>
    agent(
      STYLE + `
${HARD_RULES}

Implement the iOS slice of this design. Full design JSON (read ios, decisions, and server for the exact wire contract you are building against, server may be mid-implementation in a parallel agent, so build against design.server's specified contract, not by inspecting live server code which may be transiently in flux):
${designJson}

Steps:
1. NFCTimeSheets/NFCTimeSheets/ContentView.swift SignInView (around line 104): remove SignInWithAppleButton and everything Apple-specific from the sign-in screen. Replace with two always-visible paths: (a) phone number entry, POST /auth/sms/request, then code entry, POST /auth/sms/verify (mirror the wire shapes server/routes/auth.js actually defines, read them once server's commits land, or build against design.server's stated contract and adjust after), showing the new unregistered-number response as literal honest copy (German-first, decision-8) distinct from a wrong-code error; (b) the existing admin-issued enrolment code paste flow (EnrolmentCode.swift already exists from a prior run, read it, reuse, do not duplicate). Both visible at once, no gating.
2. Remove AppleNonce, AppleSignInRequest, the /auth/apple call in AuthAPI (API.swift) if design.server.appleRouteDecision says delete; if it says deprecate, leave the Swift code but delete the UI entry point only. Follow whatever design.server actually says.
3. API.swift APIFailure.isRetryable (around line 152) and workerMessage (around line 165): apply design.ios.retryFixSummary exactly, read API.swift lines 140-230 and Sync.swift lines 60-220 in full first, make the smallest correct change, and add a zone_unverified case to workerMessage with real German-first copy plus isRetryable true for it.
4. ContentView.swift around line 711: delete the Migration history NavigationLink and MigrationHistoryView() destination (read the surrounding Settings section first so you remove exactly this row and nothing else in that list).
5. NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements: diff it against HEAD to see what changed from the owner's Xcode click. Restore the 4 comments Xcode stripped (find them via git log -p on this file) while keeping the new capability key Xcode added. Do not touch project.pbxproj, never, under any circumstance.
6. Typecheck everything you touched: swiftc -typecheck against the arm64-apple-ios18.0 target the way this project's existing checks do (see NFCTimeSheets/checks/run.sh for the exact invocation pattern) plus a Release xcodebuild if time allows (informational only, not required to pass to report success, code-signing may fail without the owner's local Xcode capability toggle, that is expected and not your bug).
7. Commit as you go. Return the schema. In notes: name anything you could not verify (no simulator/device NFC, no live server to hit from Swift), and be explicit about which design.server.appleRouteDecision you ended up building against.
`,
      { label: 'ios', model: 'anthropic/claude-sonnet-5', schema: RESULT_SCHEMA, agentTimeoutMs: 5400000 },
    ),
  () =>
    agent(
      STYLE + `
${HARD_RULES}

Implement the small Android slice of this design (keep this tight, Android already has a working SMS-gated-by-capability sign-in screen from a prior run, and never had Apple sign-in to remove). Full design JSON:
${designJson}

Steps:
1. Find Android's existing SMS request/verify call site (grep android/app/src for auth/sms or similar, the earlier SMS onboarding run added this). Add handling for design.server.unregisteredStatus and design.server.unregisteredErrorCode with the same honest German-first copy iOS is getting. Match whatever exact wording the ios agent's commits use if you can see them, otherwise pick sensible parallel wording and note the divergence risk.
2. Confirm nothing else needs to change, the rate-limit change and per-IP bucket are entirely server-side and invisible to a well-behaved client. Do not touch Android's tag-writing, self-update, or zone-verification code, out of scope.
3. If Android has no compiler/JDK path available in this sandbox, do a text-level correctness pass and say so plainly in notes rather than claiming a build you could not run.
4. Commit as you go. Return the schema.
`,
      { label: 'android', model: 'anthropic/claude-sonnet-5', schema: RESULT_SCHEMA, agentTimeoutMs: 5400000 },
    ),
  () =>
    agent(
      STYLE + `
${HARD_RULES}

Implement the WEB ADMIN slice of this design (TASK-244 plus the rate-limit settings control). Full design JSON:
${designJson}

Steps:
1. web/app/workers/page.tsx: it already reads worker.phone_e164 (nullable) and disables SMS senden with copy Keine Login-Nummer hinterlegt (web/messages/de.json key smsNoPhone) when null, but there is no input to set it. Add one: an inline edit control (small field plus save, next to or inside the existing worker row/drawer, matching this file's existing patterns, read the whole file first, it already has a drawer-based edit flow for name/email/phone/rate) that calls PUT /admin/workers/:id/phone to set it and DELETE /admin/workers/:id/phone to clear it. Label it distinctly from the existing phone (contact-only) field, something like SMS login number, not phone number again, so the two are never confused.
2. Add a small settings control for design.server.settingsKey, reuse the exact existing pattern web/lib/pl.ts and web/app/pl/page.tsx use for pl_margin_baseline_bp (POST/DELETE /admin/settings/:key, integer input, clamp client-side to design.server.rateLimitMin and design.server.rateLimitMax matching the server's own bound, unset falls back to default N stated in the UI, not left implicit). Put it near the existing SMS-status display on web/app/workers/page.tsx (same screen the admin already reads SMS configured/not-configured on) rather than inventing a new settings page, no new route.
3. de.json and en.json: add new keys at exact parity (both files, same keys, real German not machine-translated filler) for every new string. Run this project's i18n parity check.
4. Run whatever pnpm verify (or equivalent script in web/package.json) this project already runs, must be clean.
5. Deploy (pnpm build in web/, then ops/deploy.sh) since server changes are landing in the same run and production is currently empty of real users.
6. Commit as you go. Return the schema.
`,
      { label: 'web', model: 'anthropic/claude-sonnet-5', schema: RESULT_SCHEMA, agentTimeoutMs: 5400000 },
    ),
]);

const serverResult = buildResults[0];
const iosResult = buildResults[1];
const androidResult = buildResults[2];
const webResult = buildResults[3];

log('Build phase done.');

phase('Verify');

const verify = await agent(
  STYLE + `
${HARD_RULES}

Independently re-verify this run against the actual repo and actual live production, do not trust the JSON below, use it only to know where to look. Every one of this project's last dozen workflow reports has had at least one claim that did not hold up under a second read, find this run's version of that before reporting done.

Design plus all 4 build-phase results:
${JSON.stringify({ design: design, server: serverResult, ios: iosResult, android: androidResult, web: webResult })}

Check, with real commands and real file reads, not paraphrase:
1. Read the actual decision record files committed to backlog/decisions/, do they exist, are they coherent, do they actually amend decision-22 and decision-48 as claimed.
2. server/lib/auth.js and server/routes/admin.js: confirm checkOtpRequestRate is genuinely gone, confirm the new per-IP limiter is genuinely wired into smsRequest, confirm the SETTINGS map has the new key with the stated clamp. Hit production live: POST /auth/sms/request with a syntactically valid but definitely unregistered E.164 number and confirm you get design.server.unregisteredStatus, not 202. Then exceed the configured rate limit from one source within the window and confirm 429. Then POST /admin/settings to change the limit and confirm the new limit takes effect without a service restart, deleting your temp admin session afterward.
3. Diff NFCTimeSheets.entitlements and project.pbxproj against the pre-run commit, pbxproj must be byte identical, zero diff. Confirm the entitlements diff contains the restored comments, not just the bare capability key.
4. Confirm ContentView.swift no longer references SignInWithAppleButton, AppleNonce is gone or genuinely unreachable per whichever appleRouteDecision was actually taken (check server matches, if iOS still calls /auth/apple but server deleted the route, that is a real bug, flag it as a blocker), and the Migration history NavigationLink is gone.
5. Confirm API.swift isRetryable and workerMessage changes are real and reason once, concretely, about whether the fix is actually correct for the described bug.
6. web/app/workers/page.tsx: confirm the phone_e164 edit control is real and reachable, confirm the settings control round-trips against live production.
7. de.json and en.json key parity for every new string, exact same key set, both files.
8. Update the backlog board for TASK-244 and TASK-M (or whatever their real task IDs are, grep for them) to Done only if you found real evidence per this project's evidence rule (commit sha, live endpoint response, or passing check, never the agent said so), otherwise leave them In Progress and state exactly what is missing. Always redirect stdin from /dev/null on backlog task create/edit.
9. Name what is still not proven end to end: no physical device or simulator ran the new iOS sign-in screen, no real Android build ran if the android agent could not compile, whether a real SMS was sent through the new unregistered-number path during this verification (it should not have been, confirm sms_deliveries has zero new rows from your test).

Return the schema with a real verdict (SHIPPED, SHIPPED_WITH_GAPS, or BLOCKED, your call) and every blocker you find, not a summary of what the build agents claimed.
`,
  { label: 'verify', model: 'anthropic/claude-opus-5', schema: VERIFY_SCHEMA, agentTimeoutMs: 5400000 },
);

log('Verify verdict: ' + (verify ? verify.verdict : 'NULL'));

return {
  design: design,
  server: serverResult,
  ios: iosResult,
  android: androidResult,
  web: webResult,
  verify: verify,
};
