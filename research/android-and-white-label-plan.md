# Android app + "any signing entity" — build plan

Plan only. No product code written in this phase. Read against the tree at `84da28f`.
Binding decisions read: all 23 in `backlog/decisions/`. Prior research read:
`research/android-path.md`, `backlog/docs/SIWA-REPORT.md`, `backlog/docs/TAP-FIX-AND-SENTRY.md`.

---

## 0. Agreement with the stated interpretation

**Point 1 (Android lives in `android/`, no restructure): agreed, no amendment.**
`ops/deploy.sh` hardcodes `./server/`, `./web/out/`, `./ops/` (lines 55–62). `web/scripts/check.mjs`
walks `app/ components/ lib/` relative to `web/`. Four Swift checks `cd NFCTimeSheets`. Moving
anything churns all of it for zero function.

**Point 2 ("any signing entity" is mostly a server/config problem): agreed, with ONE amendment.**

The amendment matters, so it is stated up front:

> `NFCTimeSheets/NFCTimeSheets.entitlements:16` (`applinks:timesheets.exe.xyz`) **cannot** be folded
> into the iOS config file in pass 1. Templating it as `applinks:$(TS_TAG_HOST)` works — Xcode
> substitutes build settings into entitlements — but an **undefined** build setting expands to the
> **empty string**, so with the `.xcconfig` not yet attached the entitlement becomes `applinks:` and
> the universal link dies on the next build. That is precisely the "white-label knob that changes
> current behaviour on day one is a bug" case, and it is the worst one available: it breaks the tap
> on a TestFlight build while the owner is mid-verification.
>
> So the iOS surface is **one config file + one checked mirror**: `Branding.xcconfig` holds the
> values, `NFCTimeSheets.entitlements` keeps its literal, and a runnable check fails if the two
> disagree. Honest, inert, and the check is what actually prevents the silently-dead-tag failure.

Everything else in point 2 is right and is the spine of the plan below.

**One thing the brief does not say that must be said:** white-labelling makes the *host* a variable.
It does **not** make **tags already on walls** re-pointable. decision-15 keeps them unlocked, so a
rewrite is possible, but it is a physical site visit. Config is cheap only for a **new** operator
starting from **zero tags**. The decision record in §7 must say this in those words.

---

## 1. INVENTORY — every hardcoded operator identity

Four identities are baked in: **team id**, **bundle/package id**, **tag host**, **app name**. Plus
two per-operator credentials (**app key**, **Sentry DSN**) and one **signing identity** that does not
exist yet (Android cert fingerprint). File:line, exhaustive.

### 1.1 Apple Team ID `6Y842FE8Q4`

| File | Line | What | Class |
|---|---|---|---|
| `NFCTimeSheets/NFCTimeSheets.xcodeproj/project.pbxproj` | 320, 384 | `DEVELOPMENT_TEAM` — project-level Debug/Release | **DO NOT EDIT** |
| " | 414, 450 | `DEVELOPMENT_TEAM` — app target Debug/Release | **DO NOT EDIT** |
| " | 484, 506 | `DEVELOPMENT_TEAM` — Tests target | **DO NOT EDIT** |
| " | 527, 547 | `DEVELOPMENT_TEAM` — UITests target | **DO NOT EDIT** |
| `server/wellknown/apple-app-site-association` | 1 | `appID` prefix. **Load-bearing: tags die if wrong.** | generate |
| `server/wellknown/verify.sh` | 62, 63 | asserts the literal string in the LIVE body | generate/derive |
| `server/routes/wellknown.test.js` | 31 | `assert.strictEqual(...appID, "6Y842FE8Q4....")` | derive |
| `pages/.well-known/apple-app-site-association` | 5 | DEPRECATED dir (`pages/` is reference only) | delete or freeze |
| `AGENTS.md` | 27 | prose | doc |
| `state.md` | 9 | prose | doc |
| `Backlog.md` | 53 | prose | doc |
| `backlog/tasks/task-4 - Serve-AASA-from-exe.xyz-server.md` | 27, 40 | prose | doc |
| `backlog/docs/SIWA-REPORT.md` | 11 | prose | doc |
| `backlog/docs/WORKERS-SCREEN.md` | 113 | prose | doc |

### 1.2 Bundle / package id `io.github.qwadratic.NFCTimeSheets`

| File | Line | What | Class |
|---|---|---|---|
| `NFCTimeSheets/NFCTimeSheets.xcodeproj/project.pbxproj` | 430, 466 | `PRODUCT_BUNDLE_IDENTIFIER` app target | **DO NOT EDIT** |
| " | 488, 510 | `...NFCTimeSheetsTests` | **DO NOT EDIT** |
| " | 530, 550 | `...NFCTimeSheetsUITests` | **DO NOT EDIT** |
| `NFCTimeSheets/NFCTimeSheets/API.swift` | 53 | `API.bundleId` — doc-only mirror of the server's `aud` | config |
| `NFCTimeSheets/NFCTimeSheets/API.swift` | 60 | `Notification.Name("io.github.qwadratic.NFCTimeSheets.sessionRejected")` — internal only, no wire effect | leave |
| `server/lib/apple.js` | 27 | `APPLE_AUDIENCE` — **trust boundary.** Wrong ⇒ every sign-in 401s | config |
| `server/check-api.js` | 28 | `BUNDLE_ID` used to mint test tokens (line 39) | derive |
| `server/check-api.js` | 200 | `user-agent: "NFCTimeSheets/2 CFNetwork"` fixture | cosmetic |
| `server/wellknown/apple-app-site-association` | 1 | `appID` suffix | generate |
| `server/wellknown/assetlinks.json` | 7 | `package_name` — **Android applicationId. Wrong ⇒ App Links never verify** | generate |
| `server/routes/wellknown.test.js` | 31, 40 | assertions | derive |
| `server/wellknown/verify.sh` | 62, 63 | live-body assertion | derive |
| `pages/.well-known/apple-app-site-association` | 5 | deprecated | delete/freeze |
| `AGENTS.md` 28 · `state.md` 10 · `SIWA-REPORT.md` 11,59,187 · `task-4` 40,46 · `research/android-path.md` 420 | — | prose | doc |

> **LIVE INCONSISTENCY, decide before the first Play upload.** `assetlinks.json:7` already declares
> `package_name: "io.github.qwadratic.NFCTimeSheets"` (mixed case) while `research/android-path.md:420`
> proposes `io.github.qwadratic.nfctimesheets` (lower case). `applicationId` is **immutable once
> published to Play**. See §5.1 for the call.

### 1.3 Tag host `timesheets.exe.xyz` — the irreversible one

**Load-bearing (a mismatch = a dead tag on a wall):**

| File | Line | What |
|---|---|---|
| `NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements` | 16 | `applinks:timesheets.exe.xyz` — Associated Domains |
| `NFCTimeSheets/NFCTimeSheets/TagLink.swift` | 19 | `TagLink.host` — the parse-time host allowlist |
| `NFCTimeSheets/NFCTimeSheets/API.swift` | 21 | `API.base` — every REST call |
| `web/lib/tag.ts` | 11 | default of `NEXT_PUBLIC_TAG_BASE_URL` — **the URL the admin copies onto a physical tag** |
| `server/wellknown/apple-app-site-association` | — | must be SERVED from this exact host (no redirect, no CDN alias) |
| `server/wellknown/assetlinks.json` | — | same |

**Derived (already correct — do not add a second literal):**

| File | Line | What |
|---|---|---|
| `NFCTimeSheets/NFCTimeSheets/Telemetry.swift` | 97, 98 | `tracePropagationTargets`/`failedRequestTargets` = `[TagLink.host]` |

**Defaults / operational:**

| File | Line | What |
|---|---|---|
| `ops/deploy.sh` | 22 | `HOST="${1:-timesheets.exe.xyz}"` |
| `server/wellknown/verify.sh` | 9, 13 | default host |
| `web/.env.example` | 24 | commented `NEXT_PUBLIC_TAG_BASE_URL` |
| `README.md` | 29, 109 · `ops/README.md` 50, 173 | runbook commands |

**Fixtures / comments (must track the config or the checks become theatre):**

| File | Line |
|---|---|
| `NFCTimeSheets/checks/tag-link-check.swift` | 18, 22, 29, 30, 31, 32, 33, 35, 36 |
| `NFCTimeSheets/checks/scrub-check.swift` | 29, 79, 81, 82, 83 |
| `server/check-api.js` | 194 |
| `server/wellknown/verify.sh` | 66 (`/t?l=<uuid>` probe) |
| `server/db/migrations/001_init.sql` | 60 · `server/db/seed.sql` 32 · `server/db/README.md` 90 |
| `NFCTimeSheets/NFCTimeSheets/TagLink.swift` | 7 (header comment) · `NFCTimeSheetsApp.swift` 126 · `NFCTimeSheets.entitlements` 12 |

**Docs:** `AGENTS.md` 9, 30, 34, 36, 67 · `state.md` 12, 28 · `Backlog.md` 21, 61, 63, 64, 75, 84, 95, 119 ·
`backlog/decisions/` 4, 5, 15, 16 · `backlog/docs/` USER-JOURNEYS 136, 284, 326; WORKERS-SCREEN 13, 90, 100, 117;
ADMIN-ITERATION-REPORT 274, 287; BLOCKER-FIX-REPORT 255, 258, 268, 289; SIWA-REPORT 201, 202, 215, 219;
TAP-FIX-AND-SENTRY 212, 226; BLOCKER-aasa-host-vs-cloudflare 12, 21; AUTOPILOT-RUN-REPORT 109 ·
`backlog/tasks/` 1, 4, 5, 6, 8, 14 · `research/` android-path 153, 252, 417, 424, 444;
observability-and-migration-plan 106, 110, 111, 437, 537, 538, 554; decision-brief 27; supabase-vs-vm 208, 372.

### 1.4 App name `NFC TimeSheets` / `NFCTimeSheets`

| File | Line | What |
|---|---|---|
| `NFCTimeSheets/NFCTimeSheets.xcodeproj/project.pbxproj` | 431, 467 | `PRODUCT_NAME = "$(TARGET_NAME)"` ⇒ home-screen name `NFCTimeSheets` — **DO NOT EDIT** |
| `NFCTimeSheets/NFCTimeSheets/ContentView.swift` | 71 | `Text("NFC TimeSheets")` on the sign-in screen |
| `server/wellknown/t.html` | 18, 50 | `<title>` and `<h1>` of the "app not installed" page — **worker-facing, on the tag fallback path** |
| `web/messages/en.json` / `de.json` | 3, 4, 8, 479, 490 | `meta.title`, `meta.description`, `nav.brand`, mobile blocker, login note |
| `web/package.json` | 5 · `server/package.json` 6 | descriptions |
| `ops/systemd/nfc-api.service` | 1, 8 · `nfc-autoclose.service` 20 · `nfc-autoclose.timer` 5 · `nfc-backup.service` 5 · `nfc-backup.timer` 5 | unit descriptions |
| `server/server.js` | 1 · `ops/backup/pg-backup.sh` 3 | comments |
| `pages/hello/index.html` | 6, 10 | deprecated |
| `video/src/Video.tsx` | 219 | marketing asset, out of scope |

### 1.5 Signing identity

| Platform | Where it lives today | Note |
|---|---|---|
| iOS | `CODE_SIGN_STYLE = Automatic` + `DEVELOPMENT_TEAM` (pbxproj 411–414, 447–450). No `PROVISIONING_PROFILE_SPECIFIER`. | Automatic signing means the identity IS the team id. A new operator changes exactly one setting — and must own the App ID. |
| Android | **Does not exist.** `server/wellknown/assetlinks.json:8` `sha256_cert_fingerprints: []`. | Empty array is legal and currently correct; App Links simply stay unverified. |

### 1.6 Per-operator credentials (not "identity", but they break on handover)

| File | Line | What |
|---|---|---|
| `NFCTimeSheets/NFCTimeSheets/API.swift` | 46 | `API.appKey = "tsk_…"`. Must equal `APP_KEY` in `/etc/nfc/env`. Deliberately cleartext (see the comment). A new operator needs their own value in **both** places, shipped together. |
| `NFCTimeSheets/NFCTimeSheets/Info.plist` | 17 | `SentryDSN` (currently empty ⇒ telemetry off, decision-23) |
| `ops/systemd/nfc-api.service` | 18–19 | `EnvironmentFile=/etc/nfc/env`; `APP_KEY`, `DATABASE_URL`, `PORT` required |
| `.gitleaks.toml` | 25 | allowlists `tsk_[A-Za-z0-9]{16,}` **by prefix, not by value** — already rotation-safe, no change needed |

---

## 2. CONFIGURATION SURFACE — one per platform, one for the server

### 2.1 Server / well-known: `ops/branding.json` (SINGLE SOURCE OF TRUTH)

New file, committed, hand-edited, the only place an operator's identity is typed.

```jsonc
{
  "host": "timesheets.exe.xyz",
  "appName": "NFC TimeSheets",
  "apple": {
    "teamId": "6Y842FE8Q4",
    "bundleIds": ["io.github.qwadratic.NFCTimeSheets"],   // ARRAY. see §3.3
    "paths": ["/t*"]
  },
  "android": {
    "packageName": "io.github.qwadratic.NFCTimeSheets",
    "sha256CertFingerprints": []                           // ARRAY. see §3.4
  }
}
```

Defaults above are byte-for-byte today's values. Consumers: the generator (§3), `verify.sh` (§3.5),
`routes/wellknown.test.js`, and the cross-platform branding check (§4). Nothing at **runtime** reads
it — the server keeps reading the two static files it reads today (`routes/wellknown.js:32–34`), so
there is no new boot dependency, no new server dep, no decision-16/23 pressure.

### 2.2 iOS: `NFCTimeSheets/Branding.xcconfig` + Info.plist keys + Swift fallbacks

**Mechanism, in three inert layers.**

**(a) `NFCTimeSheets/Branding.xcconfig`** — new file, **not referenced by the project**, therefore
provably inert. Contents (defaults = today):

```
TS_TEAM_ID       = 6Y842FE8Q4
TS_BUNDLE_ID     = io.github.qwadratic.NFCTimeSheets
TS_APP_NAME      = NFC TimeSheets
TS_TAG_HOST      = timesheets.exe.xyz
TS_APP_KEY       = tsk_9880d49f83794967790deb8a2c8f3dd46633cc78104c2f65
TS_SENTRY_DSN    =

DEVELOPMENT_TEAM            = $(TS_TEAM_ID)
PRODUCT_BUNDLE_IDENTIFIER   = $(TS_BUNDLE_ID)
INFOPLIST_KEY_CFBundleDisplayName = $(TS_APP_NAME)
```

**(b) `NFCTimeSheets/NFCTimeSheets/Info.plist`** — add three keys next to the existing `SentryDSN`
(this file is already wired via `INFOPLIST_FILE`, so **no pbxproj edit**):

```xml
<key>TSTagHost</key>   <string>$(TS_TAG_HOST)</string>
<key>TSAppKey</key>    <string>$(TS_APP_KEY)</string>
<key>TSBundleId</key>  <string>$(TS_BUNDLE_ID)</string>
```

With the xcconfig **not** attached, `$(TS_*)` is undefined and Xcode substitutes the **empty string**.

**(c) Swift readers with today's literals as the fallback** — exactly the pattern already proven in
`Telemetry.swift:76` (`Bundle.main.object(forInfoDictionaryKey:) ?? ""`, then a validity guard):

- `TagLink.swift:19` → `static let host = Branding.string("TSTagHost") ?? "timesheets.exe.xyz"`
- `API.swift:21` → base built from `TagLink.host`, **removing a second host literal**
- `API.swift:46` → `Branding.string("TSAppKey") ?? "tsk_9880…"`
- `API.swift:53` → `Branding.string("TSBundleId") ?? "io.github.qwadratic.NFCTimeSheets"`

`Branding.string(_:)` returns `nil` for missing **and for empty**. Empty ⇒ fallback ⇒ **byte-identical
behaviour to today with nothing attached.** One new Foundation-only file `Branding.swift`; the target
uses `fileSystemSynchronizedGroups` (pbxproj 123, 146, 169) so a new file needs **no pbxproj edit**.

**What the xcconfig CAN carry:** `DEVELOPMENT_TEAM`, `PRODUCT_BUNDLE_IDENTIFIER`, display name,
`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`, `CODE_SIGN_STYLE`, `PROVISIONING_PROFILE_SPECIFIER`,
and any user-defined `TS_*` that Info.plist or the entitlements can then substitute.

**What it CANNOT carry — state this to the owner verbatim:**
1. **The Associated Domains entitlement, safely.** See §0. Kept literal; a check enforces the mirror.
2. **Anything in the Apple Developer portal.** Registering the App ID; enabling *Sign in with Apple*
   and *Associated Domains* on it; the provisioning profile; the App Store Connect app record. All
   manual, all per-operator, all runbook items.
3. **Target-level overrides.** `PRODUCT_BUNDLE_IDENTIFIER` and `DEVELOPMENT_TEAM` are set at
   **target** level (pbxproj 414/430, 450/466). Target level **beats** a project-level xcconfig. The
   owner must clear those two rows so they inherit. That is a pbxproj write — **by Xcode, at the
   owner's hand, never by an agent.**
4. **Secrecy.** `TS_APP_KEY` and `TS_SENTRY_DSN` are compiled into the binary; the xcconfig is
   committed. Neither is a secret and both are already documented as such (`API.swift:23–45`,
   `Info.plist:6–15`). An xcconfig is not a vault and must never be treated as one.

**Owner click path (do this only when white-labelling; skipping it changes nothing):**
1. Xcode → Project navigator → select the **project** `NFCTimeSheets` (blue icon, top row).
2. **Info** tab → **Configurations** → expand **Debug** → in the row named `NFCTimeSheets`
   (the project row, not the target rows) → the "Based on Configuration File" dropdown → choose
   **Branding**. Repeat for **Release**.
3. **Build Settings** tab → select the **target** `NFCTimeSheets` → search `PRODUCT_BUNDLE_IDENTIFIER`
   → select the row → press **Delete** (this removes the target override so the xcconfig's value is
   inherited; the row turns grey/italic showing the inherited value). Repeat for `DEVELOPMENT_TEAM`.
4. Repeat step 3 for the `NFCTimeSheetsTests` and `NFCTimeSheetsUITests` targets **only if** their
   bundle ids must move too (they must, for a different team).
5. Edit `NFCTimeSheets/NFCTimeSheets.entitlements` line 16 by hand to `applinks:<new host>`.
6. Build. Verify the expansion landed:
   `codesign -d --entitlements - "$(xcodebuild -showBuildSettings … | …)/NFCTimeSheets.app"`
   — the exact one-liner ships in the rebrand runbook (§6, task 14).

### 2.3 Android: `android/branding.properties` + gitignored signing

**`android/branding.properties`** — committed, defaults = today's server-side values:

```properties
ts.applicationId=io.github.qwadratic.NFCTimeSheets
ts.namespace=io.github.qwadratic.nfctimesheets
ts.appName=NFC TimeSheets
ts.tagHost=timesheets.exe.xyz
ts.appKey=tsk_9880d49f83794967790deb8a2c8f3dd46633cc78104c2f65
ts.sentryDsn=
```

`android/app/build.gradle.kts` reads it and projects it into:
- `applicationId` / `namespace` / `versionName`
- `manifestPlaceholders["tagHost"]` → `AndroidManifest.xml` uses
  `<data android:scheme="https" android:host="${tagHost}" android:path="/t"/>` on **both** the
  `ACTION_VIEW` + `autoVerify="true"` filter and the `ACTION_NDEF_DISCOVERED` filter.
  Gradle **fails the build** on an unresolved placeholder — the opposite of Xcode's silent-empty
  behaviour, which is why the Android side gets the templating and iOS does not.
- `buildConfigField` for `TAG_HOST`, `APP_KEY`, `SENTRY_DSN`
- `resValue("string", "app_name", …)`

**Signing — never committed.** `android/app/build.gradle.kts` resolves, in order:
1. `android/keystore.properties` (**gitignored**): `storeFile`, `storePassword`, `keyAlias`, `keyPassword`
2. env vars `TS_KEYSTORE_PATH` / `TS_KEYSTORE_PASSWORD` / `TS_KEY_ALIAS` / `TS_KEY_PASSWORD`
3. neither present → **fall back to the debug signing config** so a fresh clone builds and runs
   without any operator secret. `release` builds then carry a debug signature and are refused by
   Play — the correct, loud failure.

Add to `.gitignore`: `android/keystore.properties`, `android/local.properties`, `*.jks`, `*.keystore`,
`android/.gradle/`, `android/build/`, `android/app/build/`, `android/app/google-services.json`.
`.gitleaks.toml` already allowlists `tsk_…` by prefix — no change.

---

## 3. WELL-KNOWN FILE PRODUCTION

### 3.1 Decision: **generated from `ops/branding.json`, and the OUTPUT IS COMMITTED**

Not generated only at deploy time. Reason, and it is the whole reason:

> AASA is the single most dangerous file in this product. A human must be able to read the exact
> bytes in a `git diff` **before** they reach a wall. Deploy-time-only generation hides the bytes
> behind a script and moves the review to a moment when nobody is looking.

So: `ops/gen-wellknown.mjs` (Node stdlib only, runs on the dev machine, **not** a server dependency)
writes `server/wellknown/apple-app-site-association` and `server/wellknown/assetlinks.json`.
`--check` mode re-generates in memory and diffs against disk, exit 1 on mismatch.
`ops/deploy.sh` gains a **step 0**: `node ops/gen-wellknown.mjs --check` — deploy aborts if the
committed files and `branding.json` have drifted. Everything downstream still rsyncs the committed
bytes, so the deployed artifact is exactly what was reviewed.

### 3.2 AASA shape

`appID = <teamId>.<bundleId>`, one `details` entry per bundle id, `paths: ["/t*"]`. Byte-identical to
today's file for today's config — the generator is verified by producing zero diff on first run.

### 3.3 AASA is host-exact and CDN-cached — the generator must be ADDITIVE

Apple's CDN caches AASA and installed apps hold their association until reinstall/update. Therefore:

- `apple.bundleIds` is an **array**, and rebranding means **appending** the new appID, never
  replacing. Both apps then work off the same tags during a handover.
- `gen-wellknown.mjs --check` **fails if any appID present in the committed AASA is absent from
  `branding.json`**. Removing an appID must be a deliberate two-step (edit `branding.json`, then
  regenerate with `--allow-removal`), because silently dropping one bricks every installed copy of
  the old app the moment its AASA cache refreshes.
- Content-Type, zero redirects, no `.json` extension: already enforced by `routes/wellknown.js`
  and `verify.sh`. Do not touch that logic.

### 3.4 assetlinks — fingerprints are PLURAL, and this is where Android App Links die

`sha256CertFingerprints` is an array and must normally hold **two or three** values:

1. the **Play App Signing** certificate — copied from **Play Console → Release → Setup → App signing**.
   This is the one on users' devices.
2. the **upload** certificate — different from (1) whenever Play App Signing is on, which is the
   default. Needed so an internally-distributed AAB verifies.
3. optionally the local **debug** keystore fingerprint, so `./gradlew installDebug` builds verify too.
   `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`

`research/android-path.md` §4.4 has the citation: a locally computed fingerprint "will usually not
match the one on users' devices." **Never compute (1) with keytool.**

Generator validation, hard-failing:
- each entry matches `^([0-9A-F]{2}:){31}[0-9A-F]{2}$` — uppercase, colon-separated, 32 bytes.
  A lowercase or unpunctuated fingerprint is accepted by the JSON but ignored by the verifier, which
  is the exact silent-failure class we are engineering against.
- `packageName` matches `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$`.
- an **empty** array stays legal (today's state) but emits a WARNING naming the consequence:
  "Android App Links unverified; taps open the browser."

### 3.5 `verify.sh` proves the LIVE files match the config

Rewrite the two body assertions (`verify.sh:60–68`); keep every transport assertion (status,
`content-type` exact, zero redirect hops) unchanged.

New body checks, all sourced from `ops/branding.json` — **no literal team id or bundle id anywhere in
verify.sh after this**:
1. fetch `/.well-known/apple-app-site-association`, compare **byte-for-byte** against the committed
   `server/wellknown/apple-app-site-association`. Not a substring match: a substring match passes on a
   file that also contains a stale appID or a widened `paths`.
2. same for `/.well-known/assetlinks.json`.
3. assert the host argument equals `branding.json.host` unless `--host-override` is passed
   (so `SCHEME=http ./verify.sh 127.0.0.1:8080` still works for the local smoke test).
4. keep the `/t?l=<uuid>` 200 `text/html` probe.
5. when `sha256CertFingerprints` is non-empty, print the `adb shell pm get-app-links <package>`
   command to run on the physical device — the only real proof of Android verification, and it
   cannot be done from a shell on the Mac.

`ops/deploy.sh` already runs `verify.sh` after restart and it is a hard gate. Keep it that way.

---

## 4. ONE RUNNABLE CHECK FOR THE WHOLE IDENTITY SURFACE

`ops/check-branding.mjs` — Node stdlib, no deps, no framework, mirrors the style of
`web/scripts/check.mjs`. Run: `node ops/check-branding.mjs`. Non-zero on failure. It asserts, from
`ops/branding.json`:

| # | Assertion | Guards against |
|---|---|---|
| 1 | `Branding.xcconfig` `TS_TEAM_ID`/`TS_BUNDLE_ID`/`TS_TAG_HOST`/`TS_APP_KEY` == branding.json | drift between the iOS knob and the server |
| 2 | `NFCTimeSheets.entitlements:16` == `applinks:<host>` | **the §0 amendment — dead universal link** |
| 3 | `server/wellknown/apple-app-site-association` == generator output | AASA drift |
| 4 | `server/wellknown/assetlinks.json` == generator output | assetlinks drift |
| 5 | committed AASA still contains every appID it contained at the previous commit | bricking installed apps |
| 6 | `server/lib/apple.js` `APPLE_AUDIENCE` ∈ `apple.bundleIds` | every sign-in 401s |
| 7 | `android/branding.properties` `ts.applicationId` == `android.packageName`, `ts.tagHost` == `host` | App Links never verify |
| 8 | `web/lib/tag.ts` default host == `host` | **a tag written from the admin panel is dead on the wall** |
| 9 | no Swift/TS/JS source outside the config files contains the team id, or the host outside a comment/fixture allowlist | a fourth literal creeping in |
| 10 | fingerprint format (§3.4) | silently ignored fingerprint |

Wire it into `ops/deploy.sh` step 0 alongside `gen-wellknown.mjs --check`. This check **is** the
deliverable of §1 — the inventory turned into something that fails.

---

## 5. ANDROID

### 5.1 Package name — decide before the first Play upload

**Recommendation: `applicationId = io.github.qwadratic.NFCTimeSheets`** (mixed case), i.e. keep what
`server/wellknown/assetlinks.json:7` **already serves**. `namespace = io.github.qwadratic.nfctimesheets`
(lower case, for `R`/`BuildConfig`); Gradle allows the two to differ.

Reasoning: `applicationId` is immutable after publishing; mixed case is legal (`[A-Za-z][A-Za-z0-9_]*`
per segment, ≥2 segments); and this choice means **zero change to a file that gates physical tags**.
Ladder step 1: the change was not needed at all.

### 5.2 Minimum first pass — what "the platform works end to end" means

1. **App Links off a real tag.** Manifest: `NFC` permission, `<uses-feature android:name="android.hardware.nfc" android:required="true"/>`,
   one activity with **both** intent filters (`ACTION_VIEW` + `autoVerify="true"`, and
   `ACTION_NDEF_DISCOVERED`) over `https://${tagHost}/t`, and
   `android:permission="android.permission.DISPATCH_NFC_MESSAGE"` on the activity (Android 17+).
   **Never** filter `ACTION_TAG_DISCOVERED` (deprecated Android 17).
2. **Tag parse at the trust boundary.** A direct port of `TagLink.swift`: scheme must be `https`,
   host must equal `BuildConfig.TAG_HOST`, path `/t` or `/t/`, query `l` must parse as a UUID, then
   lowercase. Anything else is dropped. Tags are unlocked (decision-15) so the payload is untrusted.
   Port `checks/tag-link-check.swift`'s 9 negative cases verbatim as the unit test.
3. **Cold-launch ordering.** Port `TapInbox.swift` — a tap that arrives before the session resolves
   must be held, not dropped. This is the exact bug that lost the owner's first real tap
   (`NFCTimeSheetsApp.swift:126–150`); do not re-discover it on Android.
4. **The same clock-in/clock-out calls, unchanged.** `POST /shifts/open {client_uuid, location_uuid,
   start_time}` at clock-IN with `end_time` NULL (decision-19); `POST /shifts/close {client_uuid,
   end_time, auto_closed}`; `client_uuid` is the idempotency key for both halves. **No `worker_id`
   in any body or query, ever** (decision-22). `X-App-Key` header on every call.
5. **Session-based identity.** `GET /auth/session` on launch; 401 ⇒ blocking sign-in screen; the
   session cookie is the only identity. Server is authoritative for open shifts:
   `GET /shifts/open` on launch reconciles the local queue (decision-19).
   The sign-in **screen** is built as one swappable composable — §5.4 decides what goes behind it.
6. **Unresolved-shift resolution flow, mandatory and blocking** (decision-10).
   `GET /shifts/unresolved` → modal that cannot be dismissed → `POST /shifts/:id/resolve {end_time}`.
7. **`NfcAdapter.isTagIntentAllowed()` on every launch**, with a fix-it prompt via
   `ACTION_CHANGE_TAG_INTENT_PREFERENCE` when false (Android 16+). Not polish — a silent clock-in
   failure is the worst bug this product can have.
8. **German.** `res/values-de/strings.xml` German + `res/values/strings.xml` English, no hardcoded
   user-visible strings (decision-8). The Android app therefore ships **better** than iOS, whose UI
   strings are still English literals (`API.swift:150` records that ceiling). A key-parity check
   mirroring `web/scripts/check.mjs`'s locale check ships with it.
9. **Offline queue.** Room, mirroring the SwiftData `Shift` row's sync columns
   (`serverId`, `openSyncedAt`, `closeSyncedAt`, `syncError`, `syncBlocked`) and the retry
   classification in `APIFailure.isRetryable` (`API.swift:135–145`) — including the one non-obvious
   rule, that `409 shift_already_open` **is** retryable.
10. **`X-Client: android/<versionName>`** header. Server ignores it today; costs nothing; makes the
    access log (`server.js:160–180`) able to name the platform behind a bad payload. **No server change.**

**Server changes required for all of the above: NONE.** Every route already exists and is additive
(§ SIWA-REPORT "Wire contract"). That is the constraint being honoured, not a coincidence.

### 5.3 NOT in the first pass, and why

| Not building | Why |
|---|---|
| FCM / push | decision-10 is satisfied by a device-local notification. FCM = Google project + token table + service-account secret + Play-services dep + Android 13 runtime permission. Ladder step 1: not needed. |
| Sentry on Android | decision-23 scopes telemetry to API + iOS. Adding a third SDK is a decision record, not a convenience. Ship without; add once the app is real. |
| Tag **writing** mode | task-6 owns tag writing on iOS. One writer is enough; a second is a second way to brick a tag. |
| History / payroll / settings beyond parity | The admin panel is the reporting surface (decision-7). |
| Play **production** track | Triggers the 12-tester/14-day rule for personal accounts. Internal testing (100 testers, no review, no build expiry) is strictly better for a 5–20 person pilot. |
| KMP / shared module | `research/android-path.md` §8 settled it. The shared code is the REST API. |
| Any new server endpoint | Constraint. If Android seems to need one, that is a design bug in the Android app. |

### 5.4 Worker identity on Android — RECOMMENDATION, owner's call, NOT implemented in this phase

decision-22 chose Sign in with Apple and `routes/auth.js:15` explicitly parked Google for "when an
Android app exists". It exists. Three options, honestly costed.

---

**Option A — Sign in with Apple on Android, via Apple's web flow.**

Mechanism: a **Services ID** (a separate Apple identifier), a **Return URL** on
`https://timesheets.exe.xyz/auth/apple/callback`, and a `client_secret` that the server must **mint
itself**: an ES256 JWT signed with an Apple **.p8 private key**, valid ≤6 months.

Server impact:
- New route pair (authorize redirect + `form_post` callback), plus a Chrome Custom Tab on the client
  and an App Link hop back into the app.
- `server/lib/apple.js:27` `APPLE_AUDIENCE` becomes a **set** `{bundleId, servicesId}` — web-flow
  tokens carry the **Services ID** as `aud`, not the bundle id. Small, additive, but a hard blocker
  if missed: every Android sign-in 401s.
- Zero new npm deps (ES256 signing is `node:crypto`, same as `apple.js` already does RS256).
- **A genuine rotating secret enters the system for the first time.** `/etc/nfc/env` today holds
  `DATABASE_URL`, `APP_KEY`, `PORT` — nothing that expires. The .p8-derived client secret expires in
  ≤6 months, and when it does, **every Android sign-in stops** with no warning.

Identity impact: **`sub` is stable per (Apple ID, developer team)** when the Services ID is grouped
with the primary App ID. Same human, same `sub`, same `workers` row on both platforms. **One identity
system, one workers table, zero account linking.** Technically the cleanest.

**Why it still fails: the users.** The Android workers are on Android because they do **not** have
iPhones. Sign in with Apple requires an **Apple ID with 2FA**. A worker with no Apple device can
create one, but the 2FA second factor then has to arrive by SMS to a trusted number, on an account
created for the sole purpose of clocking in at a stairwell. That is not a clunky flow — it is an
onboarding wall in front of the first Android worker, and it will be blamed on the app.

---

**Option B — add Google as a second provider.**

Server impact:
- `server/lib/google.js`, ~80 lines, structurally identical to `apple.js`: JWKS at
  `https://www.googleapis.com/oauth2/v3/certs`, RS256, `iss ∈ {accounts.google.com,
  https://accounts.google.com}`, `aud` = the **Web** OAuth client id. **Zero new npm deps.**
- New route `POST /auth/google`. `POST /auth/apple` untouched.
- Google Cloud project + OAuth client ids. The Android client id must be registered **per signing
  certificate SHA-1** — debug, upload, **and** Play App Signing. Same fingerprint trap as
  assetlinks, in a second console.
- Play Services dependency on the client (`GoogleApiAvailability` check needed for non-GMS devices).

**Account linking — the part that must be stated plainly.** Today `workers.email` is a single
`TEXT UNIQUE` column and `apple_sub` is a single `TEXT UNIQUE` column
(`002_worker_identity.sql`). Matching is: `apple_sub` first, else claim the row by `email` if
`apple_sub IS NULL` (`routes/auth.js:106–122`). With two providers:

- Google **always** returns a real, verified address (`anna@gmail.com`).
- Apple **may** return `x@privaterelay.appleid.com` — per-app, unguessable, and the very case
  `002_worker_identity.sql` documents at length.
- So the same human on two phones produces **two different emails** and **two different subjects**.
  Email is the only join key and in the Hide My Email case it **does not join**.
- Consequence: `workers` cannot hold the identity any more. It needs
  `worker_identities(worker_id, provider, subject UNIQUE, email)` with the UNIQUE moved off
  `workers.email`, plus an admin UI that registers **N addresses per worker** and shows which
  provider each came from. Matching becomes `(provider, subject)` first, then `email` **within that
  worker's registered addresses only**. Auto-linking two providers by a bare email match must be
  **forbidden** — a Gmail address typed into two worker rows would silently merge two people's
  payroll.
- That is a migration, an admin screen, and a new class of support conversation ("Anna appears twice").

---

**Option C — admin-issued one-time enrolment code. RECOMMENDED for the first pass.**

Mechanism: the admin panel generates an 8-character code bound to a worker row, TTL ~15 minutes,
single use. The app POSTs `{code}`; the server mints the **same `ts_worker` session** it mints today
and returns the **same** `{worker:{id,name}}` body and the **same** `Set-Cookie: ts_worker`.

Server impact:
- One table (`worker_enrolment_codes`: `code_hash PK, worker_id, expires_at, redeemed_at`) — hashed
  the same way `worker_sessions.token` is, for the same reason.
- One worker route `POST /auth/enrol` (`auth: "app"`, reusing `checkLoginRate` so there is one
  lockout policy), one admin route `POST /admin/workers/:id/enrolment-code`.
- **Zero new npm deps. Zero new provider. Zero new secret in `/etc/nfc/env`. Zero change to the
  `workers` table. Zero change to `/roster` or any `/shifts/*` route.** Deletable in one migration.

decision-22 compatibility: decision-22's operative property is *"the server decides who the caller
is; the client never names a worker."* An enrolment code satisfies that exactly — it is a
server-issued, server-revocable credential and eligibility is still the `workers` row. `active` is
still re-checked on every request inside `requireWorkerSession`.

**What it costs, stated without spin:** a live code is a bearer token sitting in a WhatsApp message
for 15 minutes. Anyone who intercepts it in that window gets a 90-day session as that worker.
That is **strictly narrower** than the hole decision-22 closed (which was: anyone with the app key
could file hours as **anyone**, forever) but it **is** weaker than "proved possession of an Apple ID".
Mitigations already available: one-time use, short TTL, the existing rate limiter, the admin sees
`redeemed_at`, and `DELETE /admin/workers/:id` already revokes every session.

Note the honest comparison: the SIWA flow's **own** bootstrap already terminates in
"the worker reads an address off a screen to their manager over the phone"
(`SIWA-REPORT.md` §"Hide My Email caveat"). The trust chain is already anchored in a human
recognising a voice. Option C makes that explicit instead of dressing it up.

---

**Recommendation: C now, B as the named upgrade path.**

- C unblocks Android with **no provider, no schema change, no new secret, and no account-linking
  problem** — and it keeps ONE workers table and ONE session mechanism, which was the actual goal
  behind "one identity system".
- A is rejected on **users**, not on elegance: Android workers plausibly have no Apple ID, and the
  .p8 rotation introduces the first expiring credential in the system.
- B is the right answer **if** the owner wants federated identity on Android. Its real cost is not
  the token verifier (~80 lines, no deps) — it is `worker_identities` + an admin screen for multiple
  addresses + three OAuth client ids. Trigger to revisit: >30 workers, or self-service onboarding,
  or a worker device that is not company-managed.
- **The Android app must be built so this is one swappable screen** (§5.2 item 5): everything behind
  it — cookie, `GET /auth/session`, 401 handling, sign-out — is identical under all three options.

**This is the owner's call. Draft the decision record as `status: proposed` and stop.**

### 5.5 What stays UNPROVEN until the owner runs it on a physical device

No NFC on any emulator. Full stop. The following **cannot** be verified by any agent and must be an
explicit, checkbox-shaped section of the handover:

1. That a real tag on Android 16+ fires `ACTION_VIEW` (not `ACTION_NDEF_DISCOVERED`) and reaches our
   activity.
2. That a real tag on Android ≤15 fires `ACTION_NDEF_DISCOVERED` and reaches the same activity.
3. That App Links verification actually **succeeded** — `adb shell pm get-app-links <package>` must
   report `verified` for `timesheets.exe.xyz`. Until `sha256CertFingerprints` is populated from Play
   Console this **will** report unverified, and every tap will open Chrome.
4. That the Play App Signing fingerprint (not the keytool one) is the one the device checks.
5. Stopped-state behaviour on Android 17+: install, do **not** open, tap → nothing. Open once → works.
   Must be a line in the worker rollout checklist.
6. The Android 16 "Launch via NFC" allowlist prompt, and that the `isTagIntentAllowed()` fix-it path
   actually re-prompts.
7. OEM battery managers (Samsung/Xiaomi/Huawei) force-stopping the app back into stopped state.
8. Whether one tap really is one tap in the hand, with gloves, at a stairwell door.

What **is** provable without a tag, and must therefore be automated:
`adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d
"https://timesheets.exe.xyz/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301"` — proves the App Link routing
and the whole parse→clock-in path, on an emulator, without NFC.

---

## 6. NUMBERED PLAN — build agents follow this in order

Phase A is the white-label work and is independent of Android. Phase B is Android. Phase A tasks 1–4
must land before any `wellknown` file is touched by anything else.

### Phase A — configuration surface (no behaviour change anywhere)

1. **Create `ops/branding.json`** with the defaults in §2.1, byte-equal to today's identities.
   No consumer yet. Pure addition.
2. **Write `ops/gen-wellknown.mjs`** (§3). Node stdlib only. `--check` and `--write` modes,
   `--allow-removal` guard. **Acceptance: `node ops/gen-wellknown.mjs --check` passes against the
   files already on disk with zero diff.** If it produces any diff, the generator is wrong, not the
   files.
3. **Write `ops/check-branding.mjs`** (§4), assertions 1–10. Assertions 1, 7 fail until tasks 5 and
   11 land — implement them to SKIP-with-notice when the file is absent, then flip to hard-fail in
   task 15. **Acceptance: passes on the tree as it stands.**
4. **Rewrite the body assertions in `server/wellknown/verify.sh`** (§3.5) to byte-compare live vs
   committed and to read `ops/branding.json`. Keep every transport assertion untouched.
   Add step 0 to `ops/deploy.sh`: `node ops/gen-wellknown.mjs --check && node ops/check-branding.mjs`,
   before the web build. **Acceptance: `SCHEME=http ./server/wellknown/verify.sh 127.0.0.1:8080`
   against a locally booted server still passes.**
5. **Add `NFCTimeSheets/Branding.xcconfig`** (§2.2a). **Do not reference it from the project.**
   Pure addition; `git status` on the pbxproj must stay clean.
6. **Add `NFCTimeSheets/NFCTimeSheets/Branding.swift`** — Foundation only,
   `static func string(_ key: String) -> String?` returning `nil` for missing **and empty**.
   New file only; `fileSystemSynchronizedGroups` picks it up with no pbxproj edit.
7. **Add the three `$(TS_*)` keys to `NFCTimeSheets/NFCTimeSheets/Info.plist`** (§2.2b).
8. **Point `TagLink.swift:19`, `API.swift:21`, `API.swift:46`, `API.swift:53` at `Branding`
   with today's literals as fallbacks** (§2.2c). `API.base` must be **derived from `TagLink.host`**,
   deleting the second host literal. `Telemetry.swift:97–98` already reads `TagLink.host` — do not
   touch it. **Acceptance, and this is the hard one:**
   - `xcrun --sdk iphoneos swiftc -typecheck -target arm64-apple-ios18.0 NFCTimeSheets/NFCTimeSheets/*.swift`
     is clean (the same command SIWA-REPORT §7 used);
   - all four `NFCTimeSheets/checks/*.swift` still pass unchanged;
   - a new case in `checks/tag-link-check.swift` pins `TagLink.host == "timesheets.exe.xyz"` and
     `API.base.absoluteString == "https://timesheets.exe.xyz"` **with no Info.plist value present**.
     That case IS the "inert by default" contract. It must exist before the owner rebuilds.
9. **Do not touch `NFCTimeSheets.entitlements`.** Recorded here so no agent "helpfully" templates it.
10. **Write `ops/REBRAND.md`** — the runbook for a new signing entity: the click path from §2.2,
    the Developer-portal steps (App ID, Sign in with Apple, Associated Domains), the Play Console
    steps, the `branding.json` edits, the `gen-wellknown` + `check-branding` + `verify.sh` gates, and
    the `codesign -d --entitlements -` verification one-liner. Explicitly states: **a new operator
    gets a new host from day zero; changing the host of a deployment whose tags are already on walls
    is a physical site visit** (decision-15).
11. **Update the docs that carry the identity as prose**: `AGENTS.md` 27–30, `state.md` 9–12,
    `README.md`, `ops/README.md`, `web/.env.example:24` — each gains a pointer to `ops/branding.json`
    as the source of truth. Delete `pages/.well-known/apple-app-site-association` or add a
    `DEPRECATED` header to `pages/` (decision-4 superseded it; a second live AASA in the tree is a
    trap for the next reader).
12. **Flip `ops/check-branding.mjs` assertions 1 and 7 to hard-fail.**

### Phase B — Android

13. **`android/` skeleton.** Kotlin + Compose, `minSdk 26`, `targetSdk` latest stable, Gradle KTS,
    `android/branding.properties` (§2.3), gitignored signing (§2.3), `.gitignore` entries.
    No NFC yet. **Acceptance: `./gradlew :app:assembleDebug` succeeds on a clean clone with no
    keystore present.**
14. **Manifest + tag parse.** §5.2 items 1–2. `TagLink.kt` is a literal port of `TagLink.swift`
    including the negative cases. **Acceptance: unit test with the 9 negative cases from
    `checks/tag-link-check.swift`, plus the `adb shell am start` App-Link probe from §5.5 landing on
    the activity with the UUID parsed.**
15. **REST client + Room queue.** §5.2 items 4, 9, 10. Ports `API.swift`'s explicit field names and
    `APIFailure.isRetryable` — including `409 shift_already_open` being retryable.
    **Acceptance: unit tests for the retry classification and for idempotent double-tap
    (same `client_uuid` twice ⇒ one row).**
16. **Session plumbing + swappable sign-in screen.** §5.2 item 5. `GET /auth/session` on launch,
    401 ⇒ sign-in, cookie persistence, sign-out. **The sign-in screen renders a placeholder until
    §5.4 is decided.** No provider code.
17. **TapInbox port + clock-in/clock-out UI.** §5.2 items 3, 4. Server-authoritative open-shift
    reconciliation on launch (decision-19).
18. **Unresolved-shift blocking modal.** §5.2 item 6 (decision-10).
19. **`isTagIntentAllowed()` + fix-it prompt.** §5.2 item 7. Not deferred to polish.
20. **German strings + locale parity check.** §5.2 item 8 (decision-8, decision-17 posture).
21. **Play Console: register, upload to Internal testing, copy BOTH fingerprints** from
    Release → Setup → App signing into `ops/branding.json`, regenerate, redeploy, re-run `verify.sh`,
    then `adb shell pm get-app-links` on the device. **This is the step that makes Android taps work
    and it is the owner's, not an agent's.**
22. **`android/README.md`** — build, sign, release, and the §5.5 unproven-until-you-tap checklist.

### Phase C — decisions

23. **`decision-24`** — Android is a separate native Kotlin/Compose app in `android/`; the repo stays
    multi-root; no restructure of `NFCTimeSheets/`, `server/`, `web/`, `ops/`. Records the already-made
    call plus the directory and the "API is the shared code, no Android-only endpoints" rule.
    Status: **accepted**.
24. **`decision-25`** — Operator identity is configuration, not source. `ops/branding.json` is the
    single source; well-known files are generated and committed; the AASA appID list is
    append-only; iOS reads `Branding.xcconfig` + Info.plist with literal fallbacks and its
    entitlement is a checked mirror; Android reads `branding.properties`; keystores and passwords are
    never committed. Defaults reproduce today's behaviour exactly. Status: **accepted**.
25. **`decision-26`** — Android worker identity. Write §5.4 into the record with **Option C
    recommended**, A and B costed, and the account-linking analysis for B stated in full.
    Status: **proposed**. Do not implement. Do not let a build agent pick.
26. **`decision-27`** (only if the owner wants Android telemetry) — amends decision-23 to cover a
    third SDK. Status: **proposed**, deferred.

All decision records via the `backlog` CLI, never by editing the markdown (AGENTS.md).

---

## 7. RISKS, RANKED — irreversible first

| # | Risk | Blast radius | Mitigation, and where it lives |
|---|---|---|---|
| **1** | **AASA regression on `timesheets.exe.xyz`.** A dropped appID, a changed Content-Type, or a redirect. Tags are already on walls; every iPhone tap opens Safari instead of clocking in, and Apple's CDN cache makes the recovery lag. | **Irreversible without site visits.** Whole product. | `gen-wellknown.mjs` is append-only for appIDs (§3.3); `check-branding` assertion 5; `verify.sh` byte-compares live vs committed; `deploy.sh` already hard-gates on `verify.sh`. **Task 2's acceptance is zero diff on first run** — if the generator changes a byte, stop. |
| **2** | **Templating the Associated Domains entitlement.** `$(TS_TAG_HOST)` undefined ⇒ `applinks:` ⇒ universal links dead on the **next** build. Existing installs keep working, so it can ship unnoticed to TestFlight. | iOS taps, silently. | **Do not do it** (§0, task 9). `check-branding` assertion 2 enforces the literal mirror. `ops/REBRAND.md` carries the `codesign -d --entitlements -` verification. |
| **3** | **Destabilising the live iOS app mid-verification.** The owner is verifying a tap fix on TestFlight right now. | The thing being verified. | Every Phase A iOS change is additive and inert: new unreferenced xcconfig, new Foundation-only file, Info.plist keys that expand to empty, Swift readers whose fallbacks are today's literals. **Zero pbxproj bytes change.** Task 8's acceptance pins the no-config path. |
| **4** | **The host is not company-owned** (decision-15's standing risk) and white-labelling does not make deployed tags re-pointable. A new operator wanting their own host after tags are glued down pays a site visit. | Every tag. | Not solvable by config. `ops/REBRAND.md` and `decision-25` must say, in those words: **a new operator picks the host at zero tags.** decision-15's revisit trigger ("before the first paying client") is still open and should be closed while it is still ~EUR 10. |
| **5** | **assetlinks fingerprint wrong, missing, or lower-cased.** Android App Links silently fall back to Chrome — Android's exact version of failure #1, and the classic App Links rabbit hole. | Every Android tap. | Generator format validation (§3.4); the plural-fingerprint rule; **never keytool for the Play key**; `adb shell pm get-app-links` in the runbook and printed by `verify.sh`. |
| **6** | **`applicationId` chosen wrong and then published.** Immutable after the first Play upload; the wrong value means editing the file that gates tags, or a new Play listing. | Android, permanently. | §5.1 decides **before** task 21. Keep `io.github.qwadratic.NFCTimeSheets` — zero change to a live file. |
| **7** | **Android identity decision blocks the app.** Sign-in is the gate on every other route. | Android schedule. | Task 16 builds one swappable screen; everything behind it is provider-agnostic. `decision-26` stays **proposed** — no build agent picks. |
| **8** | **A federated provider introduces the first expiring secret** (Apple .p8, ≤6 months) or the first `worker_identities` migration (Google). | Sign-in outage / payroll data model. | Both costed in §5.4. Option C avoids both. Either A or B is a **new decision record**, not a task. |
| **9** | **`workers.email` is `TEXT UNIQUE`** — the account-linking landmine the moment a second provider lands. | Payroll correctness (two people merged). | §5.4 Option B spells out the required schema move and the rule that email alone must **never** auto-link providers. |
| **10** | **`ops/deploy.sh` ordering.** Step 0 must run **before** the web build and the rsyncs; `--delete` must not learn about new paths. | A broken deploy. | Task 4 inserts step 0 only; the four rsyncs and the migrate-before-restart order (`deploy.sh:9–14`) are untouched. |
| **11** | **Doc drift.** `AGENTS.md`, `state.md`, `README.md` are what the next agent reads and they carry the team id and host as prose. | Wasted work, wrong assumptions. | Task 11, plus `check-branding` assertion 9 keeps the *code* clean even if a doc rots. |
| **12** | **Server dependency budget** (decision-16 as amended by decision-23: `pg` + `@sentry/node`, nothing else). | A decision violation. | Every server-side item here is Node stdlib: the generator runs on the dev machine, the token verifiers (if ever) use `node:crypto` exactly as `lib/apple.js` already does. **No agent adds a dep without a decision record.** |

---

## 8. What this plan deliberately does NOT do

- Does not move a single existing directory.
- Does not write one byte of `project.pbxproj`.
- Does not change the iOS app's behaviour with nothing wired up.
- Does not add a server dependency.
- Does not add a server endpoint for Android.
- Does not pick the Android identity provider.
- Does not rewrite a tag.
