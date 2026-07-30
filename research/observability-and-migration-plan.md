# Plan: Sentry (app + server), cold-launch tap fix, on-device migration mechanism

Research output. No product code written. Build agents follow the numbered steps.
Sources read in full: `.claude/skills/sentry-{sdk-setup,node-sdk,cocoa-sdk,instrument-logging,instrumentation-guide}` incl. every `references/*.md`; `backlog/decisions/decision-1..22`; `server/`, `NFCTimeSheets/`, `ops/`.

---

## 0. What the skills actually prescribe (and where memory was wrong)

### Versions the skills state

| Thing | Skill says | Note |
|---|---|---|
| `@sentry/node` | ≥10.42.0 "current docs at time of writing" | verify with `pnpm view` before pinning |
| `Sentry.logger.*` + `enableLogs` (node) | ≥9.41.0 GA | we need this |
| scope attributes on logs (node) | ≥10.32.0 | we need this |
| `Sentry.metrics.*` (node) | ≥10.25.0 | not used in v1 |
| `inheritOrSampleWith` in `tracesSampler` | ≥9.x | we use it |
| `ignoreSpans` object form w/ `attributes` | ≥9.x | we use it |
| `sentry-cocoa` | 9.15.0 | SPM `from: "9.15.0"` |
| cocoa `enableLogs` top-level | 9.0.0+ (8.55 was `experimental.enableLogs`) | we use top-level |
| cocoa `configureProfiling` closure | 9.0.0+; `profilesSampleRate` **removed** in 9.0.0 | we leave profiling off |
| cocoa `enablePropagateTraceparent` | 9.0.0+ | not needed, Sentry headers suffice |
| cocoa `strictTraceContinuation` / `orgId` | 9.10.0+ (node: 9.x) | we turn it ON |
| cocoa `experimental.enableStandaloneAppStartTracing` | 9.15.0+ | we turn it ON |
| cocoa `inAppExclude` | **removed** in 9.0.0 → use `options.add(inAppInclude:)` | do not write `inAppExclude` |
| cocoa metrics `enableMetrics` | default **true** in 9.12+ | leave default |
| SwiftUI tracing | `import Sentry` on 9.4.1+; `SentrySwiftUI` product is **deprecated** | pick product `Sentry` only |

### Places the skill overrules my training memory — the skill wins

1. **`dataCollection` is a trap.** node-sdk SKILL.md, Configuration Reference: *"When omitted, the SDK falls back to `sendDefaultPii` (default `false`). Passing the object — even `{}` — flips unset categories to their permissive defaults; opt out per category."*
   The skill's own quickstart template pastes `dataCollection: { /* commented-out opt-outs */ }`. **Copying that template verbatim enables cookies + HTTP bodies.**
   → **OMIT `dataCollection` entirely.** Rely on `sendDefaultPii: false`.
2. **`includeLocalVariables: true`** is in the skill's template. It attaches local variable values to stack frames. `requireWorkerSession` has `token` in scope; `verifyPassword` has `password`. → **set `false`**, explicitly, with a comment.
3. **Cocoa quickstart sets `sendDefaultPii = true`, `attachScreenshot = true`, `attachViewHierarchy = true`.** All three are wrong for this app (payroll screens, worker names). → `false`/`false`/`false`. Session Replay: not enabled at all.
4. **Cocoa `tracePropagationTargets` default is *all requests*** and `failedRequestTargets` default is `[".*"]`. Not "our host". → must be set explicitly or trace headers go to every host URLSession touches.
5. Node `httpIntegration` continues incoming traces automatically; `Sentry.continueTrace()` is documented as needed **only for non-HTTP channels**. My instinct was to hand-roll `continueTrace` on a vanilla `node:http` server — the skill says the propagator + OTel HTTP instrumentation covers it. Plan uses the automatic path, with the hand-rolled one as a documented contingency (step 14).
6. Cocoa logs: *"Logs can be lost in crash scenarios if the SDK cannot flush the buffer before the app terminates."* → logs are **not** an audit trail for clock-ins. The SwiftData row and the Postgres row stay the truth.

### Not used, deliberately
Profiling (both sides), Session Replay, Metrics, Crons, AI monitoring, User Feedback, `@sentry/profiling-node` (native addon — would break the macOS→Linux rsync in `ops/deploy.sh` step 2/6), `nodeRuntimeMetricsIntegration` (volume, answers no question we have today).

---

## 1. Defect 1 — verified, and what the fix is

`NFCTimeSheets/NFCTimeSheets/ContentView.swift:281`:

```swift
guard sites.contains(where: { $0.locationId == locationId }) else {
    alertMsg = "Unknown tag — this location isn't registered. Ask your admin to add it."
    return
}
```

`sites` is `@Query private var sites: [Site]`, filled only by `refreshRoster(context:)` (Sync.swift), which needs the network. In `LogView.task` the order is:

```swift
if let pending = inbox.take() { handleTap(pending) }   // ← runs FIRST
await refresh()                                        // ← roster arrives here
```

So on a tag-tap cold launch the cache is empty and a valid tag is refused. Confirmed by reading, matches the live symptom (1 location, 1 worker, 1 live session, **0 shifts**, nothing local).

**Wrong invariant.** `server/lib/validate.js:188 activeLocation()` already validates `location_id` and answers `422 unknown_location`. `APIFailure.isRetryable` classifies 422 as terminal → `Sync.record()` sets `syncBlocked = true` + `syncError = "This location was removed. Ask your admin."` → `ShiftRow.syncStatus` renders it in red with `xmark.octagon.fill`. **The rejection path already exists and is already visible.** Nothing needs building for it.

### Fix (step 3 below)
- Delete the `sites.contains` guard.
- `siteName(_:)` already falls back to `"Unknown location"`. Leave it. Missing name = cosmetic; missing shift = unpaid work.
- Keep the *client-side* trust boundary that must not move: `TagLink.locationId(from:)` still rejects anything that is not a well-formed UUID on our host over https (decision-15: tags are unlocked and untrusted). A tap only reaches `handleTap` if it already parsed. `Sync.pushOpen`'s `normalizedUUID` guard stays as the belt-and-braces for legacy rows.

### The OTHER guard, `unresolved.isEmpty` (line 277) — assessment

```swift
guard unresolved.isEmpty else {
    alertMsg = "Finish your unresolved shift first — tap the warning at the top."
    return
}
```

**Yes, it can strand a worker, and it does so silently on the exact axis that matters: the timestamp.**

- On the cold-launch tap path it is inert (`unresolved` is `[]` because `fetchUnresolved()` has not run yet). So it is not the cause of the reported failure.
- In the foreground it refuses to **record** the tap. The worker is at the door at 06:02, gets an alert, resolves an unrelated 3-day-old auto-closed shift, taps again at 06:05. Three minutes of paid time gone, and only if they tap again at all.
- decision-10 requires *"mandatory resolution before app use"*. Capturing a timestamp is not "use" — it is capture. The invariant decision-10 protects is *no shift reaches payroll with an unconfirmed end time*, and a new open shift does not touch that.

**Recommendation:** keep the pressure, drop the data loss. Write the shift locally, then present the resolver **sheet** (`showResolver = true`) instead of a dismissible alert. Do not gate the local write. Do not gate sync either — the unresolved shift is already *closed* server-side, so `POST /shifts/open` will not 409.

This is a behaviour change adjacent to decision-10. It does not contradict it (the resolution is still mandatory and still blocks nothing about payroll), so no new decision record is required — but the build agent MUST put the reasoning in a code comment naming decision-10, in the house style.

---

## 2. How client and server records get merged into ONE view

**Mechanism: Sentry distributed tracing.** One Sentry **organisation**, two **projects** (`nfc-timesheets-ios`, platform `apple`; `nfc-timesheets-api`, platform `node`). Traces span projects inside an org; issues/logs/spans join on `trace_id`.

### Headers — exact names
| Header | Format | Direction |
|---|---|---|
| `sentry-trace` | `{traceId}-{spanId}-{sampled}` | iOS → API |
| `baggage` | W3C baggage, `sentry-*` keys (Dynamic Sampling Context) | iOS → API |

Not `traceparent`. `options.enablePropagateTraceparent` stays off — one propagation format, one thing to debug. No CORS allowlist needed: the iOS client is not a browser.

### iOS side — attach to `timesheets.exe.xyz` ONLY
`sentry-cocoa` swizzles `URLSession` (`enableNetworkTracking`, default true) and injects both headers into any request whose URL matches `tracePropagationTargets`. **The default is every request.** Pin it:

```swift
options.tracePropagationTargets = ["timesheets.exe.xyz"]      // substring match
options.failedRequestTargets    = ["timesheets.exe.xyz"]      // never event-ify 3rd-party 5xx
options.enableCaptureFailedRequests = true
options.strictTraceContinuation = true                         // orgId auto-parsed from DSN host
```

Apple's endpoints are never touched by our `URLSession`: `AuthenticationServices` talks to `appleid.apple.com` out of process (`ASAuthorizationController`), and `API.base` is the only URL this app constructs. `tracePropagationTargets` is the guarantee that stays true if that ever changes.

### Node side — continue, do not restart
`Sentry.init()` in `@sentry/node` v10 registers `SentryPropagator` + `SentrySpanProcessor` + `SentrySampler` + `SentryContextManager` (AsyncLocalStorage). The bundled `@opentelemetry/instrumentation-http` instruments **incoming `node:http`** — which is exactly what `createHttpServer()` in `server/server.js` is — producing an `http.server` transaction and **extracting `sentry-trace`/`baggage` automatically**. No `continueTrace()` call needed (the skill states it is required only for non-HTTP channels). Sampling continuity comes from `inheritOrSampleWith(rate)` in `tracesSampler`.

Named APIs used, all from the skills:
`Sentry.init`, `Sentry.getActiveSpan`, `Sentry.getRootSpan`, `Sentry.updateSpanName`, `Sentry.startSpan`, `Sentry.withIsolationScope`, `Sentry.setUser`, `Sentry.getIsolationScope().setAttributes`, `Sentry.logger.{info,warn,error}`, `Sentry.logger.fmt`, `Sentry.captureException`, `Sentry.flush`, `Sentry.close`, `tracesSampler({ name, inheritOrSampleWith })`, `ignoreSpans`, `beforeSend`, `beforeSendLog`, `beforeSendTransaction`, `beforeBreadcrumb`.
iOS: `SentrySDK.start`, `SentrySDK.startTransaction(name:operation:bindToScope:)`, `span.startChild(operation:description:)`, `span.setData(value:key:)`, `span.finish(status:)`, `SentrySDK.span`, `SentrySDK.logger.{info,warn,error}`, `SentrySDK.capture(error:)`, `SentrySDK.setUser`, `SentrySDK.configureScope`, `options.beforeSend`, `options.beforeBreadcrumb`, `options.beforeSendLog`.

### Contingency (only if verification in step 24 shows no `http.server` transaction)
Wrap `handle()`:
```js
Sentry.continueTrace(
  { sentryTrace: req.headers["sentry-trace"], baggage: req.headers["baggage"] },
  () => Sentry.startSpan({ name: `${req.method} ${routePattern}`, op: "http.server", forceTransaction: true }, () => handle(req,res)),
);
```
and add `ignoreSpans: [{ op: "http.server", attributes: { "sentry.origin": "auto.http.otel.http" } }]` to kill the duplicate. Do NOT ship both without verifying.

---

## 3. What ONE tap's merged trace contains

Transaction `nfc.tap` (op `nfc.tap`), started in `LogView.handleTap`, `bindToScope: true` — **load-bearing**: URLSession spans only attach to a scope-bound transaction (cocoa tracing ref, "Network spans not appearing").

```
[iOS]  transaction  nfc.tap                                    tags: ts.launch_id, ts.cold_launch
       ├─ span  tag.parse            op=function      data: ts.tag.valid, ts.location.id
       ├─ span  shift.local_write    op=db            data: ts.shift.action(open|close|autoclose),
       │                                                    ts.shift.client_uuid, ts.roster.cached_locations
       ├─ span  http.client POST /shifts/open   (AUTO, URLSession swizzle)
       │        └────────── sentry-trace + baggage ──────────┐
       └─ span  shift.apply_response op=function      data: ts.shift.server_id, ts.shift.outcome
                                                             │
[API]  transaction  POST /shifts/open   op=http.server  ◄─────┘  (AUTO, otel-http; same trace_id)
       ├─ span  db.query  SELECT s.worker_id, w.name FROM worker_sessions ...   (AUTO, pg)
       ├─ span  db.query  INSERT INTO shifts ... ON CONFLICT DO NOTHING          (AUTO, pg)
       ├─ span  db.query  SELECT ... WHERE client_uuid = $1        (AUTO, only on duplicate path)
       └─ attrs on root: ts.shift.outcome=created|duplicate|already_open,
                          ts.location.id, http.status_code
```

Named spans a build agent must create by hand: **exactly three** — `tag.parse`, `shift.local_write`, `shift.apply_response`. Everything else is auto-instrumented (URLSession swizzle, otel-http, otel-pg). Per the instrumentation guide: ~80% auto, the deliberate 20% is a span attribute, a decision log, and (not here) a metric.

**What the launch contributes, honestly:** `experimental.enableStandaloneAppStartTracing = true` produces a *separate* app-start transaction (process creation → first frame, with `Pre Runtime Init` / `UIKit Init` / `Application Init` / `Initial Frame Render` children) under a **different trace_id**. It cannot be a parent of `nfc.tap` — see §7c. Join them by searching the shared tag `ts.launch_id`.

### Logs on the same trace (shared attribute namespace `ts.*`, per instrument-logging skill step 2)

| Where | Level | Message | Attributes |
|---|---|---|---|
| iOS `handleTap`, accepted | info | `nfc tap accepted` | `ts.location.id`, `ts.shift.action`, `ts.shift.client_uuid`, `ts.cold_launch`, `ts.roster.cached_locations` |
| iOS `handleTap`, refused | warn | `nfc tap refused` | `ts.tap.reason` (`unresolved_shift`) |
| iOS `Sync.record` | error | `shift sync rejected` | `ts.api.status`, `ts.api.code`, `ts.sync.blocked`, `ts.shift.client_uuid` |
| iOS migration | info | `data migration applied` | `ts.migration.version`, `ts.migration.archived`, `ts.migration.reconciled`, `ts.migration.deleted` |
| API `openShift` | info | `shift open` | `ts.shift.client_uuid`, `ts.shift.outcome`, `ts.location.id` |
| API `closeShift` | info | `shift close` | `ts.shift.client_uuid`, `ts.shift.outcome`, `ts.shift.duration_s` |
| API `wellknown` `/t` hit | **warn** | `tag link fell back to web` | `ts.location.id` |

`ts.roster.cached_locations: 0` on the accepted line is the single field that would have diagnosed defect 1 in five seconds. That is the justification for it existing.

`/t` deserves warn, not info: a real tap that opens the app **never reaches the server at `/t`** — iOS intercepts the universal link. A GET on `/t` means the handoff failed and the tap landed in Safari. That is a first-class failure signal, not traffic.

**Set the user, do not attribute by hand.** `Sentry.setUser({ id: String(session.workerId) })` server-side (isolation scope, auto-forked per request), `SentrySDK.setUser(User(userId: String(worker.id)))` on iOS after `store(_:)`, `setUser(nil)` in `clearLocalSession()`. **id only** — no email, no name, no `apple_sub`.

---

## 4. Server access log — journald AND Sentry, different jobs

Split by the question each answers.

### journald (mandatory, zero deps, works with no DSN)
One line per request written to stdout from `createServer()`'s wrapper; systemd captures stdout → journald, which already rotates. **This is the piece that must never depend on Sentry.**

Format (space-separated, greppable):
```
[req] POST /shifts/open 201 34ms w=7
[req] GET  /t 200 2ms
[req] POST /shifts/open 422 11ms w=7 err=unknown_location
```

**Emission rule — this is what keeps assets out:**
```
log the line IFF   status >= 400
                || the request matched a `routes[]` entry (API route)
                || pathname is "/t" or "/t/"
                || wellknown() handled it
otherwise (static 2xx/3xx from serveStatic) → silent
```
The admin panel is a Next.js static export; `/_next/*`, `.js`, `.css`, `.woff2`, `.png` all fall through `findRoute` to `serveStatic` and answer 200. Under this rule they produce nothing. A 404 for a mistyped asset still logs — that is a real signal.

Reuse `redactUrl()` for the path (portal tokens). Log **path only, never query string** — `/t?l=<uuid>` is fine but the rule "path only" is one less thing to get wrong later. Log `w=<workerId>` when a worker session resolved; never a name, never an email.

`/health` is polled by nothing today; log it under the rule (it is a routed API path) and revisit if a poller appears.

### Sentry (the correlation half)
- The `http.server` transaction **is** the timed access log, with the DB spans under it. Sampled per §5.
- `Sentry.logger.*` for the shift-lifecycle lines in §3 — **not** one per request. Logs are not sampled, so they are the searchable needle; the transaction is the waterfall.
- Uncaught → the 500 branch in `createServer()` gains `Sentry.captureException(err, { tags: { route } })` **before** the existing `console.error`. Per the node error-monitoring skill: *"if you catch an error and don't re-throw it, Sentry never sees it"* — this handler catches and answers 500, so the capture is mandatory. `HttpError` (4xx) is control flow: **not** captured, per the same skill's NestJS-HttpException reasoning.

### "A tap that never arrives must leave evidence" — the honest answer
If the request never leaves the phone, the server can produce no evidence, by definition. Defect 1 produced zero server-side evidence because **zero requests were made**. The evidence has to come from the client:
- `nfc.tap` transaction with no `http.client` child → the app decided not to POST.
- `nfc tap refused` log with `ts.tap.reason` → why.
- `ts.roster.cached_locations` on the accepted log → the state that caused it.

**This is why the iOS half of Sentry is the load-bearing half of this whole exercise**, not the server half. Say so in the decision record.

---

## 5. DSN configuration (neither DSN exists yet)

### Server
- Read from `process.env.SENTRY_DSN` in `server/instrument.mjs`.
- **NOT** added to `REQUIRED_ENV` in `server/server.js`. A missing DSN must not stop the API booting. `assertEnv()` stays `["DATABASE_URL","APP_KEY","PORT"]`.
- Absent/empty → `Sentry.init({ dsn: undefined, ... })`. SDK is disabled: no integrations installed, no transport, no network, no swizzling. **Behaviour identical to today.**
- Also read `SENTRY_ENVIRONMENT` (default `"production"`) and `SENTRY_RELEASE` (default: `version` from `server/package.json`).
- Lives in `/etc/nfc/env` (0640 root:app) alongside `DATABASE_URL`/`APP_KEY`/`PORT`. Documented in `server/README.md` and `ops/systemd/nfc-api.service`'s comment block. **Nothing committed.**

### iOS
- Read from `Bundle.main.object(forInfoDictionaryKey: "SentryDSN") as? String`.
- **`NFCTimeSheets/NFCTimeSheets/Info.plist` is currently `<dict/>`** and is already wired via `INFOPLIST_FILE = NFCTimeSheets/Info.plist` (pbxproj:417/453) with `GENERATE_INFOPLIST_FILE = YES`. **Adding a key to it requires NO pbxproj edit.** This is the whole reason to use Info.plist rather than a build setting or an `.xcconfig`.
- Absent, empty, or not `https://`-prefixed → **`SentrySDK.start` is never called.** Not "started disabled" — not called. Zero swizzling, zero launch cost, zero behaviour change.

### Is the iOS DSN safe to commit? Yes. Reasoned the same way as `API.appKey`.
`API.swift` already argues: *"It is compiled into the binary, so `strings` on any installed IPA recovers it. Hiding it from git would protect nothing while it sits readable on every worker's phone."* Identical for the DSN, and the DSN is **strictly weaker** than the app key:

| | `API.appKey` | iOS Sentry DSN |
|---|---|---|
| Recoverable from the IPA | yes | yes |
| Grants read of company data | no (since decision-22) | no |
| Grants write of company data | no | no |
| Worst case if extracted | unauthenticated noise at a 401 gate | junk events burn Sentry quota |
| Mitigation | rotate key + ship build + update `/etc/nfc/env` | Sentry-side inbound filters + rate limits; rotate DSN + ship build |

→ **Commit the iOS DSN in `Info.plist`.** Mirror the `API.appKey` comment block above the `Bundle.main` read in Swift, including the ceiling: *if quota abuse ever happens the fix is a new DSN and a new build, not better hiding.* **Do NOT put it in the psst vault** — same reasoning as `API.appKey` (it blocked every commit touching that file for no security gain).
Server DSN is equally non-secret but goes in `/etc/nfc/env` because that is where server config lives. No second place to keep in sync.

### Sampling
```js
// server/instrument.mjs
tracesSampler: ({ name, inheritOrSampleWith }) => {
  if (name.includes("/health")) return 0;
  if (name.includes("/.well-known/")) return 0;
  if (name.includes("/shifts") || name.includes("/auth") || name.endsWith(" /t")) return 1.0;
  return inheritOrSampleWith(0.1);
},
ignoreSpans: [
  { op: "http.server", attributes: { "http.route": "/_next" } },  // static export assets
],
```
iOS: `options.tracesSampleRate = 1.0`. A cleaning crew produces tens of taps a day. Sampling a clock-in away is the exact failure this project is trying to stop.

---

## 6. On-device migration mechanism (SwiftData)

### 6.1 Two version numbers, two mechanisms. Do not conflate them.

| | SwiftData **schema** migration | Our **data** migration |
|---|---|---|
| What changes | model shape (attrs, types, relationships) | row contents |
| Who runs it | SwiftData, when the container opens | us, after the container opens |
| Version lives in | the store file + `VersionedSchema` in code | `UserDefaults` key `ts.dataMigrationVersion` (Int) |
| Today | implicit lightweight migration via `@Attribute(originalName:)` (`id→clientUuid`, `start→startTime`, `end→endTime`, `uid→locationId`) | does not exist |

The data runner **must not** try to do schema work, and lightweight migration must keep working. Concretely: `workerId`/`locationId` still get **no** `originalName` (correct — there is no honest mapping), so old rows still land as `workerId: 0` / `locationId: ""`. Our migration then reconciles *those values*, which is a data problem.

**Honesty clause for the future:** the day a model change is *not* lightweight-migratable, SwiftData needs `VersionedSchema` + `SchemaMigrationPlan` and that runs **before** this runner, in `ModelContainer(for:migrationPlan:)`. Record that in the code comment so nobody bolts a schema change onto the data runner.

### 6.2 Where the version is stored
`UserDefaults.standard.integer(forKey: "ts.dataMigrationVersion")`, default `0`.
Ladder: (2) stdlib — yes. Available before the `ModelContainer` exists, survives app kill, lives in the app container, is in device backups, is one line to inspect and one line to reset in a support call. **Not** a SwiftData model (a `MigrationRecord` entity is itself schema → chicken and egg). Not the Keychain (not a secret). Not a file (UserDefaults already is one).

### 6.3 The runner

```swift
// DataMigrations.swift — Foundation + SwiftData only
struct DataMigration {
    let version: Int          // strictly increasing, never reused, never reordered
    let name: String
    let run: (ModelContext) throws -> MigrationOutcome
}

enum DataMigrations {
    static let all: [DataMigration] = [ legacyShiftReconciliation ]   // version 1

    @MainActor
    static func runPending(context: ModelContext,
                           defaults: UserDefaults = .standard) -> [MigrationOutcome] { ... }
}
```

Runner contract, enforced by construction:

1. Read `applied = defaults.integer(forKey: key)`.
2. For each step in `all.sorted(by: version)` where `step.version > applied`:
   a. `let outcome = try step.run(context)`
   b. `try context.save()`  ← durable BEFORE the version moves
   c. `defaults.set(step.version, forKey: key)`
   d. `defaults.synchronize()` is **not** needed (deprecated no-op semantics), but the write is already durable at process exit and on the next runloop turn.
3. Any `throw` → **stop the whole chain**, do not advance the version, do not run later steps, log `SentrySDK.logger.error("data migration failed")`, leave the store exactly as the last successful `save()` left it. The app continues to run.

**Killed mid-step** → version not advanced → the step runs again on next launch. **Therefore every step MUST be idempotent.** That is the contract, and it is why the version is written *after* the save and never before.

**Cannot lose data on failure**, because every destructive step is ordered:
```
1. read the rows
2. write the archive file with Data.write(to:options: [.atomic, .completeFileProtection])
3. verify the archive re-reads and decodes         ← if this fails, throw; nothing deleted
4. context.delete(...) the rows
5. context.save()
6. advance the version
```
Killed between 3 and 5: rows still present, archive present → re-run re-archives (same filename, same content, idempotent overwrite) and deletes. Killed between 5 and 6: rows gone, archive present → re-run matches zero rows → no-op → version advances. **No window loses data.**

- Never installed the old version → step 1 fetches zero rows → outcome is all-zeros → version advances. Genuine no-op.
- Skipped a version → ordered steps 1..N all run. Not a single `if`.

### 6.4 Where it runs
Currently `NFCTimeSheetsApp` uses the `.modelContainer(for: [Shift.self, Site.self])` **modifier**, so the container is built by SwiftUI and the first read may be a `@Query` in `LogView` — i.e. the UI can see pre-migration rows.

Change to an explicit container built in `NFCTimeSheetsApp.init()`:
```
init() {
    startSentryIfConfigured()                       // first: capture anything below
    container = makeContainer()                     // SwiftData lightweight migration happens here
    migrationOutcomes = DataMigrations.runPending(context: container.mainContext)
    ...
}
...
.modelContainer(container)
```
Ordering is load-bearing three ways: Sentry before everything (so a migration crash is reported); schema migration before data migration (the runner touches model objects); data migration before any `@Query` renders (no flash of four "can't be sent" rows).

Cost: `makeContainer()` must not `try!`-crash on a corrupt store. `.modelContainer(for:)` already `fatalError`s today, so parity is acceptable — but capture the error to Sentry first, then rethrow. Do not add a recovery path nobody asked for.

### 6.5 THE beta migration — version 1, `legacyShiftReconciliation`

Classify every `Shift`. Three buckets, three fates.

```
legacy candidate  ⟺  TagLink.normalizedUUID(locationId) == nil   // "" or garbage
                  ∨  workerId == 0                                 // pre-decision-22
                  ∨  (serverId == nil ∧ openSyncedAt == nil ∧ syncBlocked)
```

| Bucket | Test | Fate |
|---|---|---|
| **A. Unsendable, worthless** | no valid `locationId` **AND** (`duration == nil` ∨ `duration == 0`) | archive → delete → receipt |
| **B. Unsendable, has hours** | no valid `locationId` **AND** `duration > 0` | archive → **keep the row**, `syncBlocked = true`, message rewritten to *"This shift is missing its location. Your admin has to enter it — it has not been lost."* → receipt lists it as **needs your admin** |
| **C. Valid location, orphan worker** | valid `locationId` **AND** `workerId == 0` | reconcile against the server (below), then either adopt or park as bucket B |

**Why bucket A can go, plainly:** a row with no location cannot be assigned to a building. `activeLocation()` on the server rejects it with `422 unknown_location`, so it was never postable and by construction the server does not hold it. With `duration == 0` it also carries no hours. It cannot be invoiced, cannot be paid, and cannot be corrected without inventing a building. **Do not invent one.** Its only remaining function is to sit in the History tab saying "can't be sent" forever. Deleting it removes a permanent false alarm and loses nothing — but it is archived first because these are timesheets and "I am sure it was worthless" is not a thing to be sure about at 4 rows, let alone at 400.

**Why bucket B does NOT get deleted:** duration > 0 means somebody worked. Fabricating a location is worse than none — but so is deleting evidence that hours exist. The row stays, visibly blocked, and the receipt tells the worker to talk to their admin. Manual entry in the admin panel is the resolution path (already exists: `server/routes/admin.js`).

**Reconciliation with the server DB (bucket C, and the general mechanism):**
- Idempotency key is `client_uuid`. It survived the rename (`@Attribute(.unique, originalName: "id") var clientUuid`), so legacy rows have one.
- **Needs one new endpoint:** `GET /shifts/mine?since=<iso8601>` → `{ shifts: [WireShift] }` for `session.workerId`, `auth: "worker"`, reusing `S_SHIFT_COLS` + the `locations` join, ordered by `start_time`, capped (e.g. `LIMIT 500`). Nothing about it is migration-specific; the History tab is currently local-only and this closes that gap too.
- Step logic per bucket-C row: look up `client_uuid` in the fetched set.
  - **Found** → the server already has it. `apply(wire, to: shift)` (existing helper), set `serverId`, `openSyncedAt`, `closeSyncedAt` if `end_time != nil`, `workerId = session.workerId`, clear `syncError`/`syncBlocked`. **Adopted, not duplicated.** This is the "old-new record reconciliation" the owner asked for.
  - **Not found** → the server does not know it and we cannot honestly say who worked it. **Do not reassign `workerId` to the current session worker.** Same phone is a strong prior, not a fact, and this is payroll. Park as bucket B.
- If the network call fails, **throw**. The version does not advance, nothing is deleted, the migration retries next launch. A migration that silently degrades to "delete without checking" is exactly the failure mode the rules forbid.
  - Consequence: a first launch with no signal defers the migration. Acceptable — the four rows are inert. The migration is not on the clock-in path.

### 6.6 The four live rows — exactly what happens
Screenshot: 4 rows, "Unknown location", 0h 0m, 19–28 Jul 2026, "This shift is missing its location and can't be sent."
→ no valid `locationId`, `duration == 0` → **all four are bucket A**.
1. Serialised into `Application Support/ts-migration-archive-v1.json` (every field of every row: `clientUuid`, `workerId`, `workerName`, `locationId`, `startTime`, `endTime`, `autoClosed`, `correctedAt`, `serverId`, `syncError`, plus `archivedAt` and `migrationVersion`).
2. Archive verified by re-read + decode.
3. Deleted from SwiftData.
4. Version → 1.

### 6.7 What the worker SEES

Not four rows silently vanishing between launches. A **receipt**.

- **On the launch that runs it:** a `.sheet` over `ContentView`, once.
  - Title: *"We cleaned up 4 old records"*
  - Body: *"These came from an older version of the app. They had no building and no hours, so they could not be sent and could not be paid. A copy is kept on this phone."*
  - A row per archived record: date + `0h 0m` + *"cleared"*.
  - A separate, differently styled section if bucket B is non-empty: *"N old shifts have hours but no building. Your admin has to enter these — they have not been lost."*
  - One button: **Done**.
- **Afterwards, permanently:** Settings gains a row *"Migration history"* → the same list, read back from the archive file. So it is not a flash-and-gone, and a worker who dismissed it at 06:00 at a door can find it later.
- Persistence: `UserDefaults` `ts.migration.receiptUnseen: Bool`. The *content* is read from the archive file, not duplicated into defaults.
- Accessibility: same treatment as `IneligibleView` — `.accessibilityAddTraits(.isHeader)` on the title, the sheet is a `ScrollView` (this list can exceed the screen at large text sizes), and each row is one `.accessibilityElement(children: .combine)`.
- Strings: hardcoded English, matching the rest of the app. `ponytail:` marker + decision-8 ceiling comment, identical to `APIFailure.workerMessage`.

---

## 7. Traps

**(a) sentry-cocoa + SPM without touching `project.pbxproj` — impossible, and here is the exact workaround.**
Adding an SPM dependency to a `.xcodeproj` app target writes `XCRemoteSwiftPackageReference`, `XCSwiftPackageProductDependency`, `packageReferences` and `packageProductDependencies` into `project.pbxproj`, plus `project.xcworkspace/xcshareddata/swiftpm/Package.resolved`. There is no supported way to avoid it. **The owner must do this in Xcode. Exact clicks:**
1. Open `NFCTimeSheets/NFCTimeSheets.xcodeproj`.
2. Menu **File → Add Package Dependencies…**
3. Paste into the top-right search field: `https://github.com/getsentry/sentry-cocoa.git` → Return.
4. **Dependency Rule**: `Up to Next Major Version` — `9.15.0` < 10.0.0.
5. **Add to Project**: `NFCTimeSheets`. Click **Add Package**.
6. In the *Choose Package Products* sheet, set **exactly one** product to target `NFCTimeSheets`: **`Sentry`**. Set `Sentry-Dynamic`, `SentrySwiftUI`, `Sentry-WithoutUIKitOrAppKit`, `SentrySPM`, `SentryObjC` all to **None**. (Xcode lets you pick several; the skill warns this breaks the build.) Click **Add Package**.
7. Verify: target `NFCTimeSheets` → **General** → *Frameworks, Libraries, and Embedded Content* lists `Sentry`.
8. Commit **both** `NFCTimeSheets.xcodeproj/project.pbxproj` and `NFCTimeSheets.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`. `Package.resolved` is what actually pins the exact build (`xcuserdata/` is gitignored, `xcshareddata/` is not — checked).
   Do **not** run `sentry-wizard -i ios`: it also installs a dSYM upload build phase (needs `SENTRY_AUTH_TOKEN`, which does not exist) and edits `project.pbxproj` unattended.

**Mitigation the build agents must implement:** wrap every Sentry usage in `#if canImport(Sentry)` so the repo compiles, and `checks/*.swift` still runs, **before** the owner adds the package. Concretely, put all SDK contact in one file (`Telemetry.swift`) exposing a Sentry-free API (`Telemetry.start()`, `Telemetry.tap(...)`, `Telemetry.log(...)`) with a no-op `#else` branch. Everything else in the app calls `Telemetry`, never `SentrySDK`.

**(b) App-launch timing vs SDK init.**
- `SentrySDK.start` must be on the **main thread** (skill warning). `NFCTimeSheetsApp.init()` is main-thread. Fine.
- `.onOpenURL` can fire before `ContentView.task`. Sentry must already be up → init in `App.init()`, first statement, before the container.
- Anything that makes `start` slow lands directly on time-to-first-frame on a cold tap launch — the worst possible place. So: **no session replay, no profiling, `attachScreenshot = false`, `attachViewHierarchy = false`, `debug = false`.** With those off, `start` is cheap.
- Guard the DSN before calling: `guard let dsn, dsn.hasPrefix("https://"), !dsn.isEmpty else { return }`. sentry-cocoa treats a malformed DSN as disabled rather than throwing, but the guard makes "unconfigured" a compile-visible state instead of an SDK-internal one.
- `enableWatchdogTerminationTracking` is on by default and is genuinely useful here — a background-launched app that the OS kills mid-POST is a real scenario.

**(c) Trace propagation across a cold launch — what can and cannot be linked. Be blunt.**
- **Cannot:** the physical tap, the CoreNFC read performed by iOS, the OS's AASA lookup and universal-link resolution, and the launch decision **all happen with no SDK in the process**. An NDEF URI record carries a URL and nothing else; there is no header, no trace id, no timestamp we can put on a tag and no API to read one out of the OS handoff. **The trace's true t0 is unknowable and the physical-tap→`onOpenURL` latency is not measurable from inside the app.** Do not synthesise a span for it. Do not backdate `startTimestamp` to `ProcessInfo.processInfo.systemUptime`-derived guesses.
- **Can:** the app-start transaction (process creation → first frame) via `experimental.enableStandaloneAppStartTracing = true` — but it is a **separate transaction with a separate trace_id**. It cannot parent `nfc.tap` (and with pure SwiftUI there is no UIViewController transaction for it to attach to at all). The 180-second attach window in the skill is irrelevant here for the same reason.
- **Bridge:** a per-process `ts.launch_id` UUID set on the global scope via `SentrySDK.configureScope` and set as a tag on `nfc.tap`. Search by it to see both. Plus `ts.cold_launch: Bool` on the tap transaction, computed as "the tap arrived < 3 s after `App.init()`".
- **Flush:** a background-launched app can be suspended right after the POST. sentry-cocoa persists envelopes to disk and retries on the next launch — but the cocoa logging reference explicitly says **logs can be lost on crash**. So: telemetry is for diagnosis, never for payroll. The SwiftData row and the `shifts` table stay the record.

**(d) PII in HTTP breadcrumbs — and the two default-on traps.**
- Server: `requestDataIntegration` is auto-enabled and captures `headers` (incl. `cookie` → live `ts_worker`/`ts_session`), `data` (body → Apple `identity_token`, raw `nonce`), `cookies`, `ip_address`. Governed by `dataCollection` / `sendDefaultPii`. **Omit `dataCollection` entirely** (§0.1) and belt-and-braces it in `beforeSend`.
- iOS: `enableNetworkBreadcrumbs` (default true) records URL/method/status — our URLs carry no PII, but `/portal/<token>` shapes must still be redacted if the app ever fetches one. `enableCaptureFailedRequests` (default true) with `failedRequestTargets = [".*"]` would event-ify third-party 5xx **including whatever the OS does on our behalf** → pin to `["timesheets.exe.xyz"]`.
- The denylist that must never reach Sentry: Apple `identity_token`, the raw `nonce`, `credential.user` (Apple `sub` — a stable per-person identifier, treat as PII), `ts_worker`/`ts_session` cookie values, `X-App-Key`, worker `email`, `password`/scrypt hash, `hourly_rate_cents`, portal grant tokens.
- **Scrub at the boundary, in pure testable functions** — not by remembering. See step 12/13.

**(e) Sentry inside a systemd service.**
- `ExecStart` becomes `/usr/bin/node --import /srv/nfc/instrument.mjs /srv/nfc/server.js`. `server/package.json` has `"type": "module"`, so ESM rules apply: the skill is explicit that `import "./instrument.mjs"` inside `server.js` is **not sufficient** — the `--import` flag is required or `pg` and `node:http` are loaded before the instrumentation patches them.
- `instrument.mjs` lands under `server/`, so `rsync -az --delete ./server/ $HOST:$DEST/` already ships it. The `--exclude 'check-*.mjs'` line correctly keeps the scrub check off the VM.
- `ProtectSystem=strict` + `ReadWritePaths=/srv/nfc`: Sentry writes nothing to disk. No unit change needed there. Outbound HTTPS to `*.ingest.sentry.io` is unrestricted (no `IPAddressDeny`). If DNS or egress fails, the transport drops events asynchronously; **no request handler awaits it**.
- **Shutdown loses the last events** unless flushed. Current handler:
  ```js
  server.close(() => pool.end().then(() => process.exit(0)));
  ```
  → insert `await Sentry.close(2000)` before `process.exit(0)`. systemd's default `TimeoutStopSec` (90 s) gives ample headroom for a 2 s flush. Skill: *"Shutdown: events lost — process exits before flush."*
- **`node_modules` is built on macOS and rsynced** (`deploy.sh` step 2/6: *"pg only, pure JS — safe to ship from macOS"*). `@sentry/node` + its `@opentelemetry/*` tree is pure JS. `@sentry/profiling-node` is **not** (native addon) — **do not add it**, and it is not needed since profiling is off.
  **Gate:** after `pnpm add`, `find server/node_modules -name '*.node' | head` must print nothing. If it prints anything, the macOS→Linux rsync is broken and the deploy is unsafe. Update the deploy.sh comment to say `pg + @sentry/node, both pure JS`.
- `Restart=always` + a broken `instrument.mjs` = a crash loop with `RestartSec=5`. Mitigation: `instrument.mjs` must contain **nothing that can throw** — no `await`, no file reads, no DSN validation beyond a string check. Verify locally with `node --import ./instrument.mjs -e "0"` before deploying.

**(f) The cost of a network call in the request path — the honest accounting.**
- **There is no per-request network call.** The SDK buffers and batches on a background timer; logs buffer to `MAX_LOG_BUFFER_SIZE = 100`. Nothing inside `handle()` awaits Sentry. Confirmed by the skill's own framing ("Buffered and batched — no per-log network overhead").
- **What IS in the request path:** OTel span creation + `AsyncLocalStorage` context propagation on every incoming request and every `pg` query. Microsecond-scale per span, but it is not zero and it is on the clock-in path. Unsampled requests still pay context-manager cost; `tracesSampler` returning `0` avoids span *recording*, not context management.
- **Memory:** the OTel tree plus buffers add roughly 30–60 MB RSS to a process that currently runs on `pg` alone. On a single small VM that also runs Postgres 16, that is a real number. Watch it after deploy; `nodeRuntimeMetricsIntegration()` stays off (it answers no question we have) but is the escalation if RSS becomes a problem.
- **Failure modes if Sentry is unreachable:** transport retries with backoff and drops. Requests unaffected. **No DSN at all** = SDK disabled, integrations never installed, effectively zero cost — this is the fail-soft guarantee that lets us ship before any credential exists.
- **Dependency surface:** `@sentry/node` pulls ~40 transitive packages (mostly `@opentelemetry/*`). That is the honest price of amending the `pg`-only budget, and it goes in the decision record.

**(g) Extra traps found while reading this specific codebase**
- `redactUrl()` in `server.js` is currently the *only* place a request path is written out, and it strips portal tokens. **Every new log/telemetry path must route through it**, including Sentry's `event.request.url` and every http breadcrumb URL. Move it to `server/lib/scrub.js` so `instrument.mjs` and `server.js` share one implementation. Two copies is two chances to get it wrong.
- `handle()` calls `wellknown(req,res)` **before** URL parsing and before routing. AASA and `/t` will still produce `http.server` transactions; `tracesSampler` must handle them (§5), and `/t` deliberately gets `1.0`.
- The `catch { url = new URL(...) }` → 400 branch (from commit `b1092e3`) fires constantly from scanners probing `//`. It must **not** become a Sentry event — it is a client error. Log it to journald only.
- `pg` auto-instrumentation captures **SQL text**. All queries here are parameterised (`$1`, `$2`) and parameters are not captured, so no PII lands in `db.statement`. Verify this in step 24 rather than assuming it.
- `pool.query("SELECT 1")` from `/health` → sampled to 0 by `tracesSampler`, so its `db.query` span is dropped with the transaction. Good.
- The `TapInbox` 3-second dedupe window means one physical tap can produce two `accept()` calls, one of which is swallowed. The `nfc.tap` transaction must be started in `handleTap` (post-dedupe), **not** in `onOpenURL` (pre-dedupe), or every tap looks like two.

---

## 8. Numbered build plan

Order matters. 1–4 ship value with zero new dependencies and zero credentials. 5–8 are the migration. 9–23 are Sentry, all fail-soft. 24 is the gate.

### Phase A — the tap fix (no new deps, ship first)

1. **`ContentView.swift`:** delete the `sites.contains(where:)` guard at line 281 and its `alertMsg`. Add a comment in house style: the server is authoritative for location existence (decision-19, `validate.js activeLocation` → 422), a local cache miss must never block a clock-in, and the failure surfaces through the existing `syncError`/`syncBlocked` path already rendered by `ShiftRow.syncStatus`.
2. **`ContentView.swift`:** change the `unresolved.isEmpty` guard from "refuse the tap" to "record the tap, then force the resolver". Write the shift locally first, then `showResolver = true`. Comment naming decision-10 and explaining that capture ≠ use, and that the invariant decision-10 protects (no unconfirmed end time reaches payroll) is untouched.
3. **`ContentView.swift`:** leave `siteName(_:)`'s `"Unknown location"` fallback exactly as is. Add a one-line comment: a missing name is cosmetic, a missing shift is unpaid work.
4. **Check:** extend `NFCTimeSheets/checks/tag-link-check.swift`. It already covers `TagLink` + `APIFailure`. Add assertions that `APIFailure(status: 422, code: "unknown_location")` is **not** retryable and that its `workerMessage` is the admin-facing string — pinning the rejection path the deleted guard now depends on. Run: the concat-`swift` invocation documented at the top of that file.

### Phase B — the migration mechanism

5. **`server/routes/app.js`:** add `GET /shifts/mine`, `auth: "worker"`. Query: `S_SHIFT_COLS` + `l.slug AS location_slug, l.name AS location_name`, `FROM shifts s JOIN locations l ON l.id = s.location_id WHERE s.worker_id = $1 AND s.start_time >= $2 ORDER BY s.start_time DESC LIMIT 500`. `since` via `v.timestamp` with a default of 180 days ago. Add to `appRoutes`. Add the API method to `API.swift` (`ShiftAPI.mine(since:)` → `WireShiftListEnvelope`). Comment: worker comes from `session`, never the body (decision-22).
6. **New `NFCTimeSheets/NFCTimeSheets/DataMigrations.swift`:** the runner from §6.3 — `DataMigration` struct, `MigrationOutcome`, `runPending(context:defaults:)`, `UserDefaults` key `ts.dataMigrationVersion`. Comment block covering: why UserDefaults and not a model; why the version is written after the save; why every step must be idempotent; and the schema-vs-data distinction from §6.1 including the `VersionedSchema`/`SchemaMigrationPlan` escape hatch for future non-lightweight changes.
7. **Same file — migration version 1, `legacyShiftReconciliation`:** the three buckets from §6.5, the archive-verify-delete ordering from §6.3, `LegacyShiftArchive` `Codable` written to `Application Support/ts-migration-archive-v1.json` with `[.atomic, .completeFileProtection]`, and the server reconciliation via `ShiftAPI.mine`. **Throw on network failure** — never degrade to deleting unchecked.
8. **`NFCTimeSheetsApp.swift`:** build the `ModelContainer` explicitly in `init()`, run `DataMigrations.runPending` there, pass `.modelContainer(container)`. Hold the outcomes in `@State`. **`ContentView.swift`:** present the receipt sheet from §6.7 when `ts.migration.receiptUnseen` is true, and add the "Migration history" row to `SettingsView` reading the archive file back.
9. **Check:** new `NFCTimeSheets/checks/migration-check.swift` (Foundation only, no SwiftData — so it runs under the plain `swift` interpreter like `tag-link-check.swift`). Extract the bucket classifier into a pure function `LegacyClassifier.bucket(locationId:duration:workerId:serverId:) -> Bucket` in `DataMigrations.swift` and assert: the four live shapes → `.archiveAndDelete`; locationless-with-hours → `.keepBlocked`; valid-location-zero-worker → `.reconcile`; a healthy synced row → `.leaveAlone`; and that the classifier is total (no input falls through).

### Phase C — server Sentry

10. `cd server && pnpm add @sentry/node@<exact>`. Choose the version: `pnpm view @sentry/node versions --json`, take **latest stable minus one minor**, pin exact (decision-9; `server/.npmrc` already has `save-exact=true`). Must be ≥10.32.0 for scope attributes on logs. **Gate:** `find node_modules -name '*.node'` prints nothing.
11. **New `server/lib/scrub.js`** — pure, zero imports, zero deps. Exports:
    - `redactUrl(url)` (moved verbatim from `server.js`; `server.js` imports it from here now)
    - `scrubEvent(event)` — deletes `event.request.cookies`, `event.request.data`; deletes header keys matching `/^(cookie|set-cookie|authorization|x-app-key)$/i`; deletes `event.user.email`, `event.user.ip_address`, `event.user.username`; runs `redactUrl` over `event.request.url` and every `event.breadcrumbs.values[].data.url`
    - `scrubLogAttributes(attrs)` — drops any key matching `/token|cookie|passwd|password|hash|secret|identity_token|app_key|apple_sub|nonce|email|hourly|rate_cents/i`
    - `scrubBreadcrumb(bc)` — `redactUrl` on `bc.data.url`, drop the crumb entirely if it is an http crumb to `/portal/`
12. **New `server/instrument.mjs`** — must not be able to throw (no `await`, no I/O):
    ```js
    import * as Sentry from "@sentry/node";
    import { scrubBreadcrumb, scrubEvent, scrubLogAttributes } from "./lib/scrub.js";

    Sentry.init({
      dsn: process.env.SENTRY_DSN,                 // undefined => SDK disabled, zero cost
      environment: process.env.SENTRY_ENVIRONMENT ?? "production",
      release: process.env.SENTRY_RELEASE,
      // NO dataCollection key. Passing it — even {} — flips categories permissive.
      sendDefaultPii: false,
      includeLocalVariables: false,                // `token`, `password` live in these frames
      enableLogs: true,
      strictTraceContinuation: true,
      tracesSampler: /* §5 */,
      ignoreSpans: /* §5 */,
      ignoreErrors: [/^ECONNRESET/, /^EPIPE/, "bad_json", "body_too_large"],
      beforeSend: (e) => scrubEvent(e),
      beforeSendLog: (l) => { l.attributes = scrubLogAttributes(l.attributes ?? {}); return l; },
      beforeBreadcrumb: (b) => scrubBreadcrumb(b),
    });
    ```
    Add a comment block in house style: what this costs (a dependency in the request path, ~40 transitive packages, 30–60 MB RSS), how it fails (no DSN → disabled; unreachable → async drop; never blocks a request).
13. **Check:** new `server/check-sentry-scrub.mjs`, `node:assert/strict`, no framework, matching `check-api.js`/`wellknown.test.js` style. Build a synthetic event containing **every** denylisted value — a `ts_worker=<64 hex>` cookie, an `x-app-key: tsk_...` header, `worker@example.com`, `hourly_rate_cents: 1850`, `scrypt$16384$8$1$...`, a JWT-shaped `identity_token`, and `/portal/<token>/summary` in both `request.url` and a breadcrumb — then assert **none of those literals survive** `JSON.stringify(scrubEvent(e))`. Same for `scrubLogAttributes` and `scrubBreadcrumb`. It imports only `lib/scrub.js`, so **it runs whether or not `@sentry/node` is installed**. Add `"check:scrub": "node check-sentry-scrub.mjs"` to `server/package.json` scripts.
14. **`server/server.js`:** import `redactUrl` from `lib/scrub.js` (delete the local copy). In the 500 branch of `createServer()`, add `Sentry.captureException(err, { tags: { method: req.method } })` **before** the existing `console.error`. `HttpError` (4xx) stays uncaptured — control flow, not a fault. Add `await Sentry.close(2000)` before `process.exit(0)` in the SIGTERM/SIGINT handler.
15. **`server/server.js`:** wrap `handle(req,res)` in `Sentry.withIsolationScope(...)`, and after route resolution call `Sentry.updateSpanName(Sentry.getRootSpan(Sentry.getActiveSpan()), \`${req.method} ${route.path}\`)` so transactions group by route pattern (`POST /shifts/:id/resolve`) instead of by concrete id. Set `Sentry.setUser({ id: String(session.workerId) })` when a worker session resolves — **id only**.
16. **`server/server.js`:** the journald access log from §4. One helper, one call site at the end of `handle()` plus one in the error wrapper. Emission rule exactly as specified; static 2xx silent. This must work with `SENTRY_DSN` unset — it is `console.log`, not Sentry.
17. **`server/routes/app.js`:** `Sentry.logger.info` for `shift open` / `shift close` with the §3 attributes, and span attributes via `Sentry.getActiveSpan()?.setAttributes({...})` for `ts.shift.outcome`. **`server/routes/wellknown.js`:** `Sentry.logger.warn("tag link fell back to web")` on `/t`. Justify each log against the instrument-logging skill's 7-question validation table in the PR description; delete any that fails it.
18. **`ops/systemd/nfc-api.service`:** `ExecStart=/usr/bin/node --import /srv/nfc/instrument.mjs /srv/nfc/server.js`. Extend the `EnvironmentFile` comment to name `SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` as **optional**. **`ops/deploy.sh`:** update the step-2 comment to `pg + @sentry/node, both pure JS`. **`server/README.md`:** document the optional env vars and the "absent = disabled" contract.

### Phase D — iOS Sentry

19. **Owner action, in Xcode, per §7(a) steps 1–8.** Build agents do **not** edit `project.pbxproj`. Until this is done, everything below compiles through the `#else` no-op branch.
20. **New `NFCTimeSheets/NFCTimeSheets/Scrub.swift`** — Foundation only, no Sentry import, no `#if`. `Scrub.event(_: [String: Any]) -> [String: Any]`, `Scrub.attributes(_:)`, `Scrub.url(_:)`. Same denylist as the server's `lib/scrub.js`; keep the two regex lists visually identical and cross-reference them in comments.
21. **New `NFCTimeSheets/NFCTimeSheets/Telemetry.swift`** — the **only** file that touches `SentrySDK`, entirely inside `#if canImport(Sentry)` with a no-op `#else`. Surface: `Telemetry.start()`, `Telemetry.setWorker(_:)`, `Telemetry.clearWorker()`, `Telemetry.beginTap(locationId:coldLaunch:) -> TapTrace`, `TapTrace.child(_:)`, `TapTrace.finish(ok:)`, `Telemetry.log(_:level:attributes:)`, `Telemetry.capture(_ error:)`.
    `start()` reads `Bundle.main.object(forInfoDictionaryKey: "SentryDSN")`, guards `hasPrefix("https://")`, and **returns without calling `SentrySDK.start` if absent**. Options:
    ```
    sendDefaultPii = false; attachScreenshot = false; attachViewHierarchy = false; debug = false
    tracesSampleRate = 1.0
    tracePropagationTargets = ["timesheets.exe.xyz"]
    failedRequestTargets    = ["timesheets.exe.xyz"]
    strictTraceContinuation = true
    enableLogs = true
    experimental.enableStandaloneAppStartTracing = true
    beforeSend / beforeBreadcrumb / beforeSendLog  -> Scrub.*
    ```
    No `configureProfiling`, no `sessionReplay`, no `inAppExclude` (removed in 9.0.0).
22. **`Info.plist`:** add `<key>SentryDSN</key><string></string>` (empty until the owner creates the project). Above the `Bundle.main` read in `Telemetry.swift`, mirror the `API.appKey` comment block from `API.swift`: why it is committed, what it does and does not grant, the ceiling, and that it is deliberately **not** in the psst vault.
23. **Call sites:** `NFCTimeSheetsApp.init()` → `Telemetry.start()` as the first statement (before the container, before migrations). `Session.store(_:)` → `Telemetry.setWorker(id)`; `clearLocalSession()` → `Telemetry.clearWorker()`. `LogView.handleTap` → `Telemetry.beginTap` (post-`TapInbox`-dedupe, see §7g) with `tag.parse` / `shift.local_write` children and the `nfc tap accepted|refused` log. `Sync.record(_:on:)` → `Telemetry.log("shift sync rejected", .error, ...)`. `DataMigrations.runPending` → the `data migration applied` / `data migration failed` logs.

### Phase E — records and the gate

24. **Verification, in this order** (needs the owner to have created both Sentry projects):
    - `node --import ./instrument.mjs -e "0"` → exits 0, prints nothing. (Proves `instrument.mjs` cannot crash the boot.)
    - `node check-sentry-scrub.mjs` → passes. Wire into `pnpm check` in CI-less form (documented in `server/README.md`).
    - Unset `SENTRY_DSN`, restart `nfc-api`, run `node check-api.js` → **all green, byte-identical behaviour to today.** This is the fail-soft proof and it is not optional.
    - Set `SENTRY_DSN`, restart, `curl -sS https://timesheets.exe.xyz/health` → confirm an `http.server` transaction appears in Sentry. **If it does not, apply the §2 contingency, not a guess.**
    - Confirm the `db.query` child spans carry parameterised SQL and **no parameter values**.
    - Real device: tap a tag on a **fresh install with no network at tap time**. Expect: local row written, `nfc.tap` transaction with no `http.client` child, `nfc tap accepted` log with `ts.roster.cached_locations: 0`. Then restore network → the shift syncs, and the trace for the sync POST joins the server transaction.
    - Real device: tap a tag pointing at a UUID that is not in `locations`. Expect: local row written, `422 unknown_location`, `syncBlocked` red row in the UI, one linked client+server trace showing exactly where it was rejected. **This is the regression test for defect 1.**
25. **`backlog decision create "Sentry on iOS and the API amends the pg-only server dependency budget"`**, then fill Context / Decision / Consequences in the generated file, in the style of `decision-16` (the CLI has no body flag; decisions 1–16 have bodies, so this is the established path). Content must state:
    - **Context:** the tap failure produced no server-side evidence; `server.js` logs only 500s; diagnosis required reading iOS source. The owner asked for Sentry on both halves with a unified view. decision-16's budget was `pg` + node builtins.
    - **Decision:** add `@sentry/node` (exact-pinned, decision-9) to the server and `sentry-cocoa` via SPM to the app. One org, two projects, joined by `sentry-trace` + `baggage`. DSN-agnostic and fail-soft on both sides. `sendDefaultPii` off, scrubbing in tested pure functions.
    - **Consequences / cost:** a dependency **in the request path** — ~40 transitive `@opentelemetry/*` packages, 30–60 MB RSS, µs-scale OTel span + AsyncLocalStorage overhead per request and per `pg` query; `ExecStart` now depends on `--import`; the macOS→Linux `node_modules` rsync now depends on `@sentry/node` staying pure JS (gated by the `*.node` check).
    - **How it fails:** no DSN → SDK disabled, integrations never installed, byte-identical behaviour. Unreachable ingest → asynchronous drop, no request affected. Broken `instrument.mjs` → crash loop under `Restart=always`, mitigated by the throw-free rule and the `--import -e "0"` gate.
    - **What it explicitly does not include:** profiling (native addon, breaks the rsync), session replay (payroll screens), metrics, crons, source-map/dSYM upload (needs `SENTRY_AUTH_TOKEN`, which does not exist).
    - **Amends decision-16**, does not supersede it. Reaffirms decision-9 (exact pins) and decision-1/18 (no Docker, systemd).
26. **`backlog decision create "On-device data migrations: versioned ordered idempotent steps in UserDefaults, archive-before-delete"`** — recommended, not mandated by the task, but the runner is an architectural mechanism future agents will otherwise reinvent. Record §6.1–6.3, and record the reconciliation rules from §6.5 as binding: never invent a location, `client_uuid` is the idempotency key, archive before delete, make it visible to the worker.
27. **Update `state.md`**: defect 1 fixed, migration mechanism added, Sentry added, and the two new decision ids.

---

## 9. Explicit non-goals for the build agents

- No `@sentry/nextjs` on `web/`. The admin panel is a static export served by the API; its errors are the browser's, nobody is watching them today, and adding a third SDK triples the PII surface for the panel that shows hourly rates. Revisit separately.
- No `sentry-cli`, no dSYM upload, no source-map upload. Both need `SENTRY_AUTH_TOKEN`. iOS stack traces will be unsymbolicated until someone creates one — say so in the decision record rather than half-wiring it.
- No new test framework. `node:assert` + `swift` interpreter checks, matching what is already there.
- No background retry (`BGAppRefreshTask`) — still out of scope, the existing `ponytail:` ceiling in `Sync.swift` stands.
- Do not reassign `workerId` on legacy rows. Do not invent a `locationId`. Ever.
