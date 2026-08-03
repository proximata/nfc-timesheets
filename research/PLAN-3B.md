# PLAN — iteration 3B

Research + plan only. No product code written by this agent.
Everything below was verified on this machine or fetched live. Unverified claims are marked
**UNVERIFIED** and carry the command that settles them.

Binding: `backlog/decisions/` (all), `backlog/docs/USER-JOURNEYS.md`, `ADMIN-WALKTHROUGH.md`,
`ENROLMENT-CODES.md`. Build agents do NOT re-derive decisions. They obey this file.

---

## 0. MEASURED FACTS (do not re-check, they cost minutes)

| Fact | Value |
|---|---|
| JDK | none on PATH (`/usr/bin/java` is the stub). Android Studio JBR = **OpenJDK 21.0.10** at `/Applications/Android Studio.app/Contents/jbr/Contents/Home` |
| kotlinc | not on PATH. Present at `/Applications/Android Studio.app/Contents/plugins/Kotlin/kotlinc/bin/kotlinc` |
| `android/checks/run.sh` | **PASSES today** with that kotlinc + JAVA_HOME. Output: `core-check: OK` |
| ANDROID SDK root | `/opt/homebrew/share/android-commandlinetools` — **writable**, `ANDROID_HOME` unset |
| SDK installed | emulator 36.6.11, platform-tools 37.0.0, build-tools 30.0.3/34.0.0, platforms 19/21/24/30 |
| SDK **missing** | `platforms;android-36`, `build-tools;36.0.0`, any android-36 system image |
| gradle wrapper | `gradle/wrapper/gradle-wrapper.properties` pins **gradle-9.6.1-bin.zip**. `gradle-wrapper.jar`, `gradlew`, `gradlew.bat` all **absent**. No system gradle |
| gradle-9.6.1-bin.zip sha256 (live from services.gradle.org) | `9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14` |
| pinned deps exist | AGP **9.2.1** ✓, Kotlin **2.3.21** ✓, compose-bom **2026.05.01** ✓, core-ktx 1.18.0 ✓, activity-compose 1.12.4 ✓, lifecycle 2.10.0 ✓, coroutines 1.10.2 ✓ (all confirmed in maven-metadata.xml) |
| iOS sims | iOS 26.5 runtime, `iPhone 17 Pro` C6F15E3C-C704-4367-AB99-BE4C63C2BED8 + 4 more |
| ffmpeg | `/opt/homebrew/bin/ffmpeg` ✓ |
| Maps keys | `psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY` (browser), `psst get GOOGLE_GEOCODING_KEY` (server). Used in **zero** source files |
| server route surface | `server/server.js` route table + `routes/{admin,app,auth,portal,wellknown}.js`. `adminData` already honours `from`/`to`/`limit` (T4 landed) |
| `app_name` | comes from `resValue()` in Gradle; **not** in `values/strings.xml`. No duplicate-resource hazard |
| `android/.gitignore` | does NOT ignore `gradle/wrapper/*.jar` — the wrapper jar is committable |

---

## 1. ANDROID BRING-UP — exact commands

### 1.1 Environment (every android shell, every agent)

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

Do **not** create `android/local.properties` by hand — it is gitignored and `ANDROID_HOME`
already answers the question. If AGP demands it: `echo "sdk.dir=$ANDROID_HOME" > android/local.properties`.

### 1.2 SDK packages

```bash
yes | sdkmanager --licenses > /dev/null
sdkmanager "platforms;android-36" "build-tools;36.0.0" \
           "system-images;android-36;google_apis;arm64-v8a"
```

`google_apis`, not `google_apis_playstore`: the Play image blocks `adb root` and locks
`/system`, and step 2.3 needs `pm set-app-links-user-selection`. Do **not** upgrade
platform-tools 37.0.0 → 37.0.1; churning a working toolchain is not the task.
If AGP 9.2.1 names a different build-tools revision in its error, install exactly that one.

### 1.3 Gradle wrapper — how to get a jar without trusting a random binary

The wrapper jar is produced *by Gradle itself*, so the trust question reduces to trusting the
Gradle distribution, which has a published checksum. Generate in a scratch dir so the pinned
`gradle-wrapper.properties` in the repo is never rewritten:

```bash
cd /tmp && rm -rf wrapgen && mkdir wrapgen && cd wrapgen

curl -fsSLO https://services.gradle.org/distributions/gradle-9.6.1-bin.zip
EXPECT=$(curl -fsSL https://services.gradle.org/distributions/gradle-9.6.1-bin.zip.sha256)
ACTUAL=$(shasum -a 256 gradle-9.6.1-bin.zip | cut -d' ' -f1)
[ "$EXPECT" = "$ACTUAL" ] || { echo "CHECKSUM MISMATCH — STOP"; exit 1; }
# Pinned as of this plan; if EXPECT differs from this, STOP and report:
#   9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14

unzip -q gradle-9.6.1-bin.zip
./gradle-9.6.1/bin/gradle wrapper --gradle-version 9.6.1 --distribution-type bin
```

Second, independent confirmation — compare the produced jar against Gradle's published
wrapper-jar checksum list at <https://gradle.org/release-checksums/> (section "Wrapper JAR",
row 9.6.1):

```bash
shasum -a 256 gradle/wrapper/gradle-wrapper.jar
```

Only if BOTH checks hold, copy in and commit:

```bash
cd "$REPO/android"
cp /tmp/wrapgen/gradle/wrapper/gradle-wrapper.jar gradle/wrapper/gradle-wrapper.jar
cp /tmp/wrapgen/gradlew /tmp/wrapgen/gradlew.bat .
chmod +x gradlew
git diff --stat gradle/wrapper/gradle-wrapper.properties   # MUST be empty
./gradlew --version                                        # MUST print Gradle 9.6.1
```

Why a scratch dir and not `gradle wrapper` inside `android/`: the root `build.gradle.kts`
declares `plugins { alias(...) apply false }`, which still resolves plugin markers, so running
it in-project turns wrapper generation into a full dependency resolution and mixes two
failures into one. Also it would rewrite the reviewed `gradle-wrapper.properties`.

### 1.4 First compile

```bash
cd "$REPO/android" && ./gradlew :app:assembleDebug --stacktrace
```

**First compilation of never-compiled code surfaces real errors. That is the work, not a
failure.** Budget for these, in likelihood order:

1. `KeyboardOptions(autoCorrectEnabled = …)` — Compose Foundation ≥1.7 spelling. If the BOM
   resolves older it is `autoCorrect`. Called out in `android/README.md` already.
2. AGP 9.x removed/renamed gradle.properties flags. `android.nonTransitiveRClass=true` is the
   default in AGP 9 and may now warn or error as unrecognised. Remove only on an actual error.
3. `org.gradle.configuration-cache=true` × AGP 9 × `rootProject.file()` reads in
   `app/build.gradle.kts`. Reading `branding.properties` at configuration time can break the
   configuration cache. If so: keep the read, add `providers.fileContents(...)`, or as the
   ponytail floor set `org.gradle.configuration-cache=false` and record why in the file.
4. `sourceSets.getByName("main").java.srcDir("src/main/kotlin")` — AGP 9 may want
   `kotlin.srcDir`. Cosmetic; fix as directed by the error.
5. Compose compiler / Kotlin 2.3.21 plugin ↔ compose-bom 2026.05.01 mismatch. Adjust ONLY the
   BOM, and only to an exact pinned version (decision-9, `libs.versions.toml` header).

Rules while fixing: **exact pins only, no ranges, no `+`** (decision-9). No new dependency
without a written reason (`libs.versions.toml` header names the ones deliberately absent:
OkHttp/Retrofit, kotlinx.serialization, Room/KSP, Sentry, Play Services/FCM). If a fix needs
one, STOP and report — it is a decision record, not a commit.

Then release path, which exercises R8/proguard-rules.pro (a separate class of failure):

```bash
./gradlew :app:assembleRelease
```

Expect it to succeed and be **debug-signed** (`hasUploadKey` false — by design, loud in the
right place). Verify: `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`
should print the Android Debug certificate. Do NOT create a keystore — see §5 blockers.

### 1.5 Non-negotiable check that must stay green

```bash
cd "$REPO/android" && \
  KOTLINC="/Applications/Android Studio.app/Contents/plugins/Kotlin/kotlinc/bin/kotlinc" ./checks/run.sh
```

Passes today. Any Kotlin change under `core/` must leave it passing. If a build agent wants a
smoother invocation, the only permitted change is a `KOTLINC` fallback inside `run.sh` that
tries the Studio path — not a new test framework, not a Gradle unit-test source set.

### 1.6 AVD for the demo

```bash
"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
  -n ts-demo -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7 --force
```

Call the cmdline-tools binary directly: the homebrew shim `/opt/homebrew/bin/avdmanager`
emits `line 173: test: : integer expression expected` and dies when it cannot find a JDK.

```bash
emulator -avd ts-demo -no-snapshot -no-boot-anim -netdelay none -netspeed full &
adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done'
```

**Expect `NfcReadiness.UNSUPPORTED`.** `NfcAdapter.getDefaultAdapter()` returns null on the
emulator, so `NfcBanner` renders `nfc_missing_title`/`nfc_missing_body`. That banner is
CORRECT and must appear in the demo recording, uncropped. `<uses-feature nfc required="true">`
is a Play filter and does not block `adb install`.

---

## 2. EMULATOR DEMO TECHNIQUE

### 2.0 The mock, stated in the artefact

Both demos replace the physical tap with **opening the exact URL the tag stores**:
`https://timesheets.exe.xyz/t?l=<location-uuid>` (decision-5, decision-21). Everything after
the OS hands that URL to the app is the identical code path (`TagLink.locationId` /
`TagLink.kt`). This sentence, or its German equivalent, must be **burned into the video and
spoken in the caption track**, not buried in a README:

> Kein echter NFC-Tap: Emulatoren haben keine NFC-Hardware. Geöffnet wird exakt die URL, die
> auf dem Tag an der Wand steht — ab hier ist es derselbe Code-Pfad.

### 2.1 iOS — simctl

```bash
xcodebuild -project NFCTimeSheets/NFCTimeSheets.xcodeproj -scheme NFCTimeSheets \
  -sdk iphonesimulator -configuration Debug -derivedDataPath /tmp/dd build

xcrun simctl boot C6F15E3C-C704-4367-AB99-BE4C63C2BED8   # iPhone 17 Pro
open -a Simulator
xcrun simctl install booted /tmp/dd/Build/Products/Debug-iphonesimulator/NFCTimeSheets.app
xcrun simctl launch booted io.github.qwadratic.NFCTimeSheets   # once: registers associated domains
xcrun simctl io booted recordVideo --codec h264 /tmp/ios-demo.mp4 &   # stop with kill -INT
xcrun simctl openurl booted "https://timesheets.exe.xyz/t?l=<UUID>"
```

**Does an https universal link opened via `simctl openurl` actually reach an app with
associated domains on the Simulator?**

Evidence says **yes, when the association actually resolves** — the Simulator shares the
host Mac's `swcd`, and `simctl openurl` follows the same routing as a tap. Sources relied on:
Apple TN3155 "Debugging universal links"
(<https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links>) for
the mechanism and the CDN caveat; "Test Universal Links Locally for iOS"
(codeburst) and the Ionic forum thread on `simctl openurl booted`, both of which use
`simctl openurl` as the standard local universal-link test.

The caveat that actually bites: **since iOS 14 the AASA is fetched through Apple's CDN**
(`https://app-site-association.cdn-apple.com/a/v1/<domain>`), so a stale CDN copy, not the
app, is what fails. `timesheets.exe.xyz` is public and its AASA has been live and unchanged,
so this should be a non-issue here.

**This is UNVERIFIED on this machine and the build agent must settle it empirically and
report the literal result.** Supporting evidence to capture alongside:

```bash
sudo swcutil verify -d timesheets.exe.xyz \
  -j server/wellknown/apple-app-site-association \
  -u "https://timesheets.exe.xyz/t?l=<UUID>"      # must print: Pattern ... matched.
swcutil dl -d timesheets.exe.xyz                   # force a fresh association download
swcutil show | grep -A3 timesheets.exe.xyz         # after install: the app's live association
```

**Honest fallback ladder if Safari opens instead of the app:**

- **F1 — developer-mode entitlement, LOCAL ONLY.** Change the entitlement string to
  `applinks:timesheets.exe.xyz?mode=developer` to bypass Apple's CDN (documented under
  Associated Domains Entitlement, referenced from TN3155). **Never commit it**:
  `ops/check-branding.mjs` asserts the entitlement mirrors `branding.host` (decision-24 §6)
  and will fail. Revert before any commit; `node ops/check-branding.mjs` must be green at
  commit time. Fidelity cost: **zero** — it only changes where the AASA is fetched from.
- **F2 — declare the limitation on screen.** Record `xcrun simctl launch booted <bundle>` plus
  the `swcutil verify` output visible in the frame, and caption: "Universal-Link-Routing ist im
  Simulator nicht reproduzierbar; die Zuordnung ist separat mit `swcutil verify` belegt."
  Fidelity cost, stated plainly: the video then proves *the app handles the URL*, not *that iOS
  routes the URL to the app*. That second fact is only proven by F3.
- **F3 — the real thing.** Owner taps a real tag with the live TestFlight build, screen-recorded
  on device. External blocker: needs the owner, a phone and a wall. Do not fake it.

**iOS demo needs a signed-in worker.** iOS identity is Sign in with Apple only (decision-22;
decision-26 keeps it that way and explicitly forbids swapping the auth path mid-pilot). SIWA on
the Simulator requires the Simulator to be signed into iCloud. That is an **owner action** —
Apple ID credentials are not an agent's to hold. Plan for it; if the owner declines, F2 applies
to the whole clock-in segment and the video says so.

### 2.2 Android — emulator + adb

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n io.github.qwadratic.NFCTimeSheets/.MainActivity   # leave stopped state
```

**App Links WILL be unverified**, because `server/wellknown/assetlinks.json` has an empty
`sha256_cert_fingerprints` (no signing key exists — §5). Do not hide this. Show it:

```bash
adb shell pm get-app-links --user cur io.github.qwadratic.NFCTimeSheets
# expect: timesheets.exe.xyz: <a failure state, e.g. 1024>, NOT "verified"
```

Then perform, on camera, exactly the recovery a real user performs in
**Settings → Öffnen standardmäßig → Unterstützte Links** (Google's own documented
`DOMAIN_STATE_SELECTED`, <https://developer.android.com/training/app-links/verify-android-applinks>):

```bash
adb shell pm set-app-links-user-selection --user cur \
  --package io.github.qwadratic.NFCTimeSheets true timesheets.exe.xyz
adb shell pm get-app-links --user cur io.github.qwadratic.NFCTimeSheets
# now: Selection state / Enabled: timesheets.exe.xyz
```

Caption, mandatory:

> App Links sind **nicht verifiziert**: `assetlinks.json` enthält noch keinen
> Zertifikat-Fingerprint, weil noch kein Signaturschlüssel existiert. Hier wird die App
> manuell für die Domain freigegeben — genau der Schritt, den sonst der Nutzer in den
> Einstellungen macht. Mit Play-Fingerprints entfällt er.

The tap mock:

```bash
adb shell am start -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d "https://timesheets.exe.xyz/t?l=<UUID>"
```

Recording — prefer the emulator console recorder (records on the host, no 3-minute cap):

```bash
adb emu screenrecord start /tmp/android-demo.webm
# ...
adb emu screenrecord stop
ffmpeg -i /tmp/android-demo.webm -c:v libx264 -pix_fmt yuv420p /tmp/android-demo.mp4
```
Fallback if the console command is unavailable on emulator 36.6.11 (**UNVERIFIED**):
`adb shell screenrecord --time-limit 180 /sdcard/d.mp4 && adb pull /sdcard/d.mp4`.

### 2.3 Demo data — do NOT contaminate payroll

The demo talks to the **live** server (the tag host is fixed and TLS makes an /etc/hosts
redirect impossible). Therefore:

- Create one worker named `DEMO — Vorführung` and one location `DEMO — Vorführobjekt` through
  the admin panel. Never reuse the real worker or the HOIV building.
- Payroll aggregates group by worker, so demo shifts cannot touch a real payslip.
- Afterwards: **deactivate**, never delete (soft delete is the house rule; history stays).
- Never run `POST /admin/shifts` or `PATCH /admin/shifts/:id` against a real worker's row.

---

## 3. THE FOUR DEFERRED FEATURES

All four are currently `FUTURE_NAV` keys in `web/lib/nav.ts` with message keys already present
in `web/messages/{en,de}.json` (`materialRequests`, `plDashboard`, `contractManagement`,
`buildingAnalytics`). Building them means moving those keys into `PRIMARY_NAV`.

**One migration file for all four: `server/db/migrations/005_v2_features.sql`.** Additive only,
no `BEGIN`/`COMMIT` (`migrate.js` uses `psql -1`), never edit 001–004, every column NULLable or
DEFAULTed. Take `ops/backup/pg-backup.sh` before applying to the live box.

### 3A. Material Requests — worker-facing

**Must do.** Worker submits a free-form request in their own words. Admin sees it, validates it,
maps it to an inventory item + quantity + actual cost, marks it ordered, then marks it arrived
at the warehouse. Worker learns it arrived.

**Data (in 005):**

```sql
CREATE TABLE material_requests (
  id                BIGSERIAL PRIMARY KEY,
  worker_id         BIGINT NOT NULL REFERENCES workers(id),
  location_id       UUID REFERENCES locations(id),          -- NULLable: worker may not know
  body              TEXT NOT NULL,                          -- free text, the worker's words
  status            TEXT NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted','approved','ordered','arrived','rejected')),
  admin_note        TEXT,
  inventory_item_id BIGINT REFERENCES inventory_items(id),  -- set by the ADMIN, never inferred
  quantity          INTEGER CHECK (quantity > 0),
  cost_cents        INTEGER CHECK (cost_cents >= 0),        -- ACTUAL cost; the only P&L input
  decided_by        BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  ordered_at        TIMESTAMPTZ,     -- the period a cost belongs to
  arrived_at        TIMESTAMPTZ,
  seen_at           TIMESTAMPTZ,     -- worker acknowledged the arrival
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX material_requests_worker_idx ON material_requests (worker_id, created_at DESC);
CREATE INDEX material_requests_open_idx   ON material_requests (created_at)
  WHERE status IN ('submitted','approved','ordered');
CREATE INDEX material_requests_ordered_idx ON material_requests (ordered_at)
  WHERE ordered_at IS NOT NULL;
```

**API.** Worker routes go in `server/routes/app.js`, admin routes in `server/routes/admin.js`.
`worker_id` comes from `requireWorkerSession`, **never from the body** (decision-22 — this is
the hard rule that made decision-26 safe to add). Status transitions are an explicit table in
code (`submitted→approved|rejected`, `approved→ordered|rejected`, `ordered→arrived`), never a
free `status` assignment from the client.

- `POST   /material-requests`        (auth worker) body: `{ body, location_id? }`
- `GET    /material-requests/mine`   (auth worker)
- `POST   /material-requests/:id/seen` (auth worker; only own rows, only `status='arrived'`)
- `PATCH  /admin/material-requests/:id` (auth admin)
- `material_requests` added to the `GET /admin/data` payload

**What it must NOT pretend to know: what the worker meant.** No fuzzy matching against
`inventory_items`, no NLP, no auto-approval, no auto status advance. Free text stays free text
until a human maps it. A request with no `cost_cents` is *unpriced*, not free.

**"Notified when materials arrive" — the honest mechanism.** There is **no push**. Server deps
are `pg` + `@sentry/node` and nothing else (decision-23 amending decision-16); no APNs/FCM
infrastructure exists (TASK-26 never done); `libs.versions.toml` deliberately excludes Play
Services/FCM. So: **the app polls on launch and on refresh** and shows a banner for rows with
`status='arrived' AND seen_at IS NULL`. iOS may additionally raise a *local* notification when
it observes the transition while running — the same device-local mechanism decision-10 already
uses. Write this in the UI copy so nobody expects a lock-screen push while the app is closed.
`ponytail:` polling. Ceiling: a worker who never opens the app is never told. Upgrade path:
APNs + FCM, which is a decision record and a Play/Apple key, not a commit.

**Clients.** iOS `ContentView.swift` and Android `ui/TimeSheetApp.kt` each gain: a request form
(free text + building, prefilled from the open shift when there is one) and a list of the
worker's own requests with status and the arrival banner. iOS strings stay **English**
(decision-17 + USER-JOURNEYS §1c). Android strings go in `values/strings.xml` (German) **and**
`values-en/strings.xml` — `checks/core-check.kt` asserts parity, so both or neither.

### 3B. P&L Dashboard

**Must do.** Per building, per period: revenue − labour − materials, plus a flag for buildings
below a baseline with factual reasoning.

- **revenue** = the contract value in force during the period (see 3C), pro-rated by days.
- **labour** = Σ over payroll-eligible shifts at that building of hours × `workers.hourly_rate_cents`.
  Payroll-eligible means exactly `end_time IS NOT NULL AND NOT (auto_closed AND corrected_at IS NULL)`
  — the same predicate `adminData.hours` already uses (decision-10). Copy the predicate, do not
  invent a second one.
- **materials** = decision-6, pro-rata by labour hours:
  `building_material_cents = round(total_material_cents × building_hours / total_hours)`.
  `total_material_cents` = Σ `material_requests.cost_cents` where `status IN ('ordered','arrived')`
  and `ordered_at` falls in the period. That is the only per-period material cost this system
  has; `inventory_items.unit_cost_cents` is a price list, not a purchase ledger.

**What it must NOT pretend to know:**

1. **Historical worker rates.** `workers.hourly_rate_cents` is one mutable column. Every P&L
   figure values *all* history at the *current* rate. This must be a permanent visible line on
   the screen in German, not a tooltip. (Already a known limitation in USER-JOURNEYS §J6/J10.6.)
2. **The baseline. IT IS NOT DEFINED, AND NOTHING HERE INVENTS ONE.** Make it configuration:

   ```sql
   CREATE TABLE app_settings (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```
   Setting `pl_margin_baseline_bp` — margin floor in basis points, integer. **No default row is
   inserted.** Absent ⇒ nothing is flagged and the screen says "Zielmarge nicht gesetzt" with an
   inline control to set it. `ponytail:` a key/value table, not a settings framework. Ceiling: no
   types, no per-building override. Upgrade path: a typed column per setting when there are three.
3. **Buildings with no contract value.** `monthly_contract_cents` NULL ⇒ revenue unknown ⇒ show
   "Vertragswert fehlt", exclude from margin and from flagging. Never treat NULL as 0.
4. **Unpriced materials.** `cost_cents` NULL ⇒ excluded from the pool, and the count of excluded
   requests is shown on screen.

The flag's "reasoning" is derived fact, not advice: *"Marge X % unter Zielmarge Y %.
Ist-Zeit Z h gegenüber Sollzeit W h. Vertrag EUR N/Monat. → Vertrag prüfen."* Nothing more.

Where it computes: **SQL in the API**, not in the browser. The 2000-row shift cap
(`SHIFT_PAGE_MAX`) means a client-side aggregate silently truncates. New route
`GET /admin/pl?from=&to=` returning one row per building.

### 3C. Contract Management

Today: `locations.monthly_contract_cents` + `locations.target_minutes_per_month`, single
current mutable values.

**What history actually requires:** a period-scoped price, so a March P&L uses the March price.

```sql
CREATE TABLE location_contracts (
  id                       BIGSERIAL PRIMARY KEY,
  location_id              UUID NOT NULL REFERENCES locations(id),
  client_id                BIGINT REFERENCES clients(id),
  monthly_contract_cents   INTEGER NOT NULL CHECK (monthly_contract_cents >= 0),
  target_minutes_per_month INTEGER CHECK (target_minutes_per_month >= 0),
  valid_from               DATE NOT NULL,
  valid_to                 DATE,          -- NULL = current
  note                     TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX location_contracts_one_current_idx
  ON location_contracts (location_id) WHERE valid_to IS NULL;
```

Non-overlap beyond "one current" is enforced in the route, not by an `EXCLUDE` constraint —
that needs `btree_gist`, and a Postgres extension on a live payroll box is not worth one
guarded INSERT. `ponytail:` route-level check. Ceiling: concurrent admins could interleave;
there is one admin.

Backfill in 005, idempotent:
```sql
INSERT INTO location_contracts (location_id, client_id, monthly_contract_cents,
                                target_minutes_per_month, valid_from)
SELECT id, client_id, monthly_contract_cents, target_minutes_per_month, created_at::date
  FROM locations WHERE monthly_contract_cents IS NOT NULL;
```

`locations.monthly_contract_cents` / `target_minutes_per_month` become a **mirror of the current
contract row, with exactly one writer** (the contract route), so `/locations/`, `/reinigung/`
and the shipped iOS/Android clients keep working with zero changes. Assert the mirror in
`server/check-api.js`. Two sources of truth are only safe when one is derived and something
fails loudly when it drifts.

**Is re-pricing history honest given one current worker rate? Half, and say so out loud.**
Contract history makes the **revenue** line honest. The **cost** line stays dishonest, because
a rate change silently rewrites every past cost. Two options:

- **C1 — in scope.** Build contract history; put a permanent visible notice on P&L and Analytics
  that labour is valued at *current* rates. No payroll risk.
- **C2 — OUT OF SCOPE for this workflow.** A `worker_rates` history table with payroll reading
  rate-at-shift-time. That changes the payroll arithmetic of a system in daily use with real
  money attached. **Do not do it without a new decision record.** Write the record proposing it;
  do not implement it.

Build C1. Ship the notice. File the record for C2.

### 3D. Building Analytics + the Vienna map

**Must do.** Per building, per period: actual minutes vs target minutes (from the contract row
in force), variance, and a trend across the last N periods. Plus the map.

**Trend is arithmetic, not prediction.** N periods of actual minutes, a delta, a direction. No
forecast, no regression, no "expected next month". With fewer than two full periods the trend
is "zu wenig Daten" — not a flat line.

**Geocoding — ONCE, server-side, at creation or address change.** `locations.lat`/`lng` exist
and are NULL for all 1 live rows.

```
GET https://maps.googleapis.com/maps/api/geocode/json?address=<addr>&region=at&key=$GOOGLE_GEOCODING_KEY
```
- Key comes from **`/etc/nfc/env`** (same home as the app key), read via `process.env`. **NOT**
  `ops/branding.json` — credentials are not identity (decision-24 §9). Never committed.
- `fetch` is node stdlib. **No new server dependency** (decision-16 as amended by decision-23).
- **Geocoding must never block a location create.** Key missing, quota exhausted, network down,
  `ZERO_RESULTS` → lat/lng stay NULL, the location is created, the panel shows "nicht
  geokodiert" with a "erneut geokodieren" button. Same rule as telemetry never blocking a
  clock-in (decision-23). Wrap in try/catch, `Sentry.captureException`, carry on.
- Also call `https://maps.googleapis.com/maps/api/streetview/metadata?location=<lat>,<lng>&key=…`
  at the same moment and store the result:
  `ALTER TABLE locations ADD COLUMN street_view_status TEXT, ADD COLUMN geocoded_at TIMESTAMPTZ;`
  Metadata is free and is the only way to know coverage — the image endpoint returns a grey
  "no imagery" JPEG with HTTP 200, so an `onError` handler alone silently ships a grey box.
  Vienna coverage was validated on 5 addresses (2022-04…2026-04), so this is a rare path, but
  a rare path that lies is worse than one that errors.

**Map rendering, browser side.** Google Maps JS API loaded with `NEXT_PUBLIC_GOOGLE_MAPS_KEY`
(referrers already retargeted to `https://timesheets.exe.xyz/*`, `http://localhost:3000/*`,
`http://127.0.0.1:8080/*`). `ponytail:` load the API with a plain `<script>` tag in a client
component — no `@react-google-maps/api`, no `@vis.gl/react-google-maps`. Ladder step 3: the
platform already ships the widget. Ceiling: no clustering, no custom marker library, ~11
buildings. Upgrade path: add the wrapper when pins pass ~200.

- One pin per location with non-NULL lat/lng. Locations without coordinates are **listed beside
  the map**, never silently dropped.
- Pin thumbnail: Street View Static
  `…/streetview?size=320x200&location=<lat>,<lng>&key=…`, rendered only when
  `street_view_status='OK'`; otherwise a text-on-colour placeholder (TASK-17 AC#2).
- Click a pin → side panel: name, client, contact, actual vs target for the period, margin
  (reused from `GET /admin/pl`, not recomputed), last shift, and the tag URL. **The slug is
  never rendered in a URL shape** (decision-21).
- decision-7: desktop only. The map inherits the existing `DesktopOnlyGuard`; no mobile layout.

**What it must NOT pretend to know:** coordinates it never geocoded, a photo where Street View
has no imagery, a trend from one period, or a target for a building with
`target_minutes_per_month` NULL.

---

## 4. RISKS, RANKED

**R1 — the tags already on walls. Catastrophic, silent, needs a site visit to fix.**
A mismatch between `ops/branding.json`, `server/wellknown/apple-app-site-association`,
`server/wellknown/assetlinks.json`, `NFCTimeSheets.entitlements`, `android/branding.properties`
(`ts.tagHost`) or `web/lib/tag.ts` does not error — iOS opens Safari, Android opens Chrome
(decision-24, Context). **No phase in this workflow may write any of those files.** Gate before
and after every phase:
```bash
node ops/gen-wellknown.mjs && node ops/check-branding.mjs && server/wellknown/verify.sh
```
`android.sha256CertFingerprints` stays `[]`. Filling it is §5, not an agent's.

**R2 — the live iOS app, in daily use.** Material Requests touches `ContentView.swift`.
`handleTap`, `TagLink.swift`, `TapInbox.swift`, `Sync.swift` and `API.swift`'s existing calls
are **untouched**. New UI is additive and reachable only from a new screen. `checks/tag-link-check.swift`
must pass and the app must build for device. Ship-blocking corollary: **the currently installed
TestFlight binary must keep working against the new server** — new routes only, no changed
response shapes, no new required fields.

**R3 — live payroll data.** Migration 005 runs on a box holding 1 worker, 1 location, 5 real
shifts. Additive only; 001–004 never edited (`server/db/README.md`); no `BEGIN`/`COMMIT`; the
contract backfill idempotent. `ops/backup/pg-backup.sh` runs first. The payroll predicate
`end_time IS NOT NULL AND NOT (auto_closed AND corrected_at IS NULL)` is copied, never
reformulated (decision-10).

**R4 — the live API.** `server/check-api.js` must stay green. Routes are appended to the
existing tables in `routes/*.js`. `POST /material-requests` is a **new public-ish trust
boundary**: worker-session auth, `worker_id` from the session (decision-22), body length capped
via `lib/validate.js`, never logged verbatim (`lib/scrub.js`).

**R5 — secrets.** `GOOGLE_GEOCODING_KEY` goes into `/etc/nfc/env` on the VM and nowhere else.
`NEXT_PUBLIC_GOOGLE_MAPS_KEY` is baked into a **public** static export and is readable by
anyone — acceptable *only* because the referrer restriction is `https://timesheets.exe.xyz/*`
+ localhost. Confirm that before shipping; record it in `ops/REBRAND.md`. Neither key literal
enters git.

**R6 — dependency budget.** Server: `pg` + `@sentry/node`, nothing else (decision-23), and
`deploy.sh` already hard-fails on any native addon. Web: no map wrapper package, no chart
library — pins via the Maps JS `<script>`, trend via inline SVG. Android: nothing new
(`libs.versions.toml` header names what stays out). Any addition = STOP and report.

**R7 — file collisions between phases.** See §5. `web/messages/en.json`, `web/messages/de.json`,
`web/lib/nav.ts` and `server/routes/admin.js` are the known casualties; a concurrent write
corrupts them silently because JSON and a route array both merge "plausibly".

**R8 — Android first compile.** Never-compiled code will not build first try. This is expected
work (§1.4). It becomes a *risk* only if an agent "fixes" it by adding a dependency or loosening
a version pin.

**R9 — the demo writing to the live database.** Mitigated by the DEMO-prefixed worker/location
and deactivate-never-delete (§2.3).

**R10 — decision-7.** The four new screens are desktop-only and inherit the guard. Do not build
a mobile web material-request page; the worker surface is the native apps.

**R11 — i18n.** German is the default (decision-8/17). Four screens × two message files. Android
needs `values/` (de) + `values-en/` parity or `checks/` fails. iOS stays English by design.

---

## 5. EXTERNAL BLOCKERS — report, do not solve, do not fake

1. **No Play Console account.** Personal accounts need 12 testers × 14 consecutive days of
   closed testing before production; organisation accounts are exempt but need a D-U-N-S number.
2. **No signing keystore, and it must be the OWNER'S.** Losing it means a new Play listing
   forever. Agents must not run `keytool`. The build stays debug-signed and Play refuses it —
   loud, in the right place, by design.
3. **`assetlinks.json` fingerprints empty ⇒ Android App Links unverified ⇒ every tap opens a
   browser.** Needs TWO uppercase colon-separated SHA-256 fingerprints once a key exists
   (upload key + Play App Signing key, the latter only from Play Console → Release → Setup →
   App signing). They go in `ops/branding.json` → `node ops/gen-wellknown.mjs --write`.
4. **A physical NFC tap.** No physical Android device here; NFC does not exist on any emulator.
   §2 mocks the tap and says so on camera.
5. **Simulator iCloud sign-in** for iOS Sign in with Apple in the demo (§2.1).

---

## 6. NUMBERED PLAN — phases, ownership, order

**FILE OWNERSHIP IS ABSOLUTE.** If a phase needs a change in a file it does not own, it writes
the request in its report and stops. It does not edit the file.

### Phase 0 — Android bring-up (serial, first, no other phase runs concurrently)
Owns: `android/**` (except `app/src/main/kotlin/**/ui/**` shared with Phase 4), `.gitignore`.
1. Export the environment of §1.1.
2. Install SDK packages, §1.2.
3. Generate + double-checksum the Gradle wrapper, §1.3. Commit `gradlew`, `gradlew.bat`,
   `gradle/wrapper/gradle-wrapper.jar`. `gradle-wrapper.properties` must show an empty diff.
4. `./gradlew :app:assembleDebug` and fix real errors (§1.4). Exact pins only. No new deps.
5. `./gradlew :app:assembleRelease`; confirm debug-signed via `apksigner verify --print-certs`.
6. `./checks/run.sh` still green; add only a `KOTLINC` fallback to the Studio path if needed.
7. Create the `ts-demo` AVD, boot it, install, confirm the app launches and that the NFC banner
   reads UNSUPPORTED (§1.6).
8. Update `android/README.md` § "What is unproven": move every item this phase actually proved
   out of that list. Do not claim more.
**Report:** the literal first-compile error list and each fix.

### Phase 1 — server: schema + API (serial, after Phase 0, single agent)
Owns: `server/db/migrations/005_v2_features.sql`, `server/routes/admin.js`,
`server/routes/app.js`, `server/lib/validate.js`, `server/check-api.js`, `server/db/README.md`.
9.  Write **one** migration `005_v2_features.sql`: `material_requests`, `location_contracts`
    (+ idempotent backfill), `app_settings`, `locations.street_view_status`,
    `locations.geocoded_at`. No `BEGIN`/`COMMIT`. Header comment in the house style stating why
    each column is NULLable.
10. Worker routes in `app.js`: `POST /material-requests`, `GET /material-requests/mine`,
    `POST /material-requests/:id/seen`. `worker_id` from the session, always (decision-22).
11. Admin routes in `admin.js`: `PATCH /admin/material-requests/:id` (explicit transition
    table), `POST /admin/locations/:id/geocode`, contract CRUD
    (`POST /admin/locations/:id/contracts`, `PATCH /admin/contracts/:id`) keeping the
    `locations.*` mirror with one writer, `POST /admin/settings`,
    `GET /admin/pl?from=&to=`, `GET /admin/building-analytics?from=&to=`.
    `material_requests`, `location_contracts` and `app_settings` added to `GET /admin/data`.
12. Server-side geocode + Street View metadata on location create/address change. Key from
    `/etc/nfc/env`. **Never blocks the create.** stdlib `fetch`, no new dependency.
13. Extend `server/check-api.js`: the pro-rata split (decision-6) against a hand-computed
    fixture, the payroll-eligibility predicate reuse, the contract-in-force lookup at a period
    boundary, the mirror assertion, the status transition table's rejections, and
    `worker_id`-from-body being ignored. **This is the one runnable check for §3.**
14. Document the new `/etc/nfc/env` key in `ops/README.md`.
**Gate:** `node server/check-api.js` green; `node ops/check-branding.mjs` green; nothing under
`server/wellknown/` changed.

### Phase 2a — web shell (serial, single agent, after Phase 1)
Owns: `web/lib/nav.ts`, `web/messages/en.json`, `web/messages/de.json`, `web/lib/locale.ts`.
15. Move `materialRequests`, `plDashboard`, `contractManagement`, `buildingAnalytics` from
    `FUTURE_NAV` to `PRIMARY_NAV` with real hrefs.
16. Add **every** message key the four screens will need, German first (decision-8/17), English
    in parity. Nobody else touches these four files for the rest of the workflow.
**Gate:** `cd web && pnpm verify` green (the four routes 404 at this point — acceptable only
inside this phase, and Phase 2b closes it before any deploy).

### Phase 2b — web screens (parallel, 4 agents, after 2a)
Each agent owns exactly its own page + lib file, and **must not** edit `nav.ts` or either
messages file. Missing key ⇒ report, do not add.
17. `web/app/material-requests/page.tsx` + `web/lib/materialRequests.ts` — admin queue:
    validate, map to inventory item + quantity + cost, order, mark arrived. Free text is shown
    verbatim, never auto-matched.
18. `web/app/pl/page.tsx` + `web/lib/pl.ts` — per-building revenue/labour/materials/margin,
    the pro-rata material line labelled as such, the baseline control (empty ⇒ nothing flagged),
    and the permanent "labour valued at current rates" notice.
19. `web/app/contracts/page.tsx` + `web/lib/contracts.ts` — contract timeline per building,
    new period, close period, note. Overlaps rejected with a field error, not a toast.
20. `web/app/analytics/page.tsx` + `web/lib/analytics.ts` — actual vs target, trend, Vienna map
    with Street View thumbnails and the click-through side panel. Ungeocoded buildings listed
    beside the map. Map API loaded via a plain `<script>`, no npm map package.
All four: desktop guard inherited (decision-7), real `<table>`/`<th scope>`, keyboard-operable,
errors via `aria-describedby`, empty and error states rendered — never a blank page.
**Gate:** `cd web && pnpm verify` green; every `PRIMARY_NAV` href resolves in `web/out/`.

### Phase 3 — worker clients (parallel, 2 agents, after Phase 1)
21. iOS agent owns `NFCTimeSheets/NFCTimeSheets/ContentView.swift` + `API.swift` (additive
    calls only). Request form + own-requests list + arrival banner. English strings. `handleTap`
    / `Sync.swift` / `TagLink.swift` untouched. Must build for device and simulator.
22. Android agent owns `android/app/src/main/kotlin/**/ui/**`, `net/Api.kt`, `core/Wire.kt`,
    `res/values*/strings.xml`. Same feature. German + English parity, or `checks/` fails.
    `./checks/run.sh` green.

### Phase 4 — demo (serial, last)
Owns: `research/` + demo scripts, nothing in `web/`, `server/`, `android/app/src`, `NFCTimeSheets/`.
23. Create the DEMO worker and DEMO building through the panel (§2.3).
24. iOS: build, boot, install, launch once, `simctl openurl` the tag URL, record. **Report the
    literal result of whether the universal link reached the app.** If not, walk the F1→F2
    ladder and state the fidelity cost in the video.
25. Android: install, show `pm get-app-links` unverified, approve via
    `pm set-app-links-user-selection` on camera with the caption of §2.2, then `am start` the
    VIEW intent, record via `adb emu screenrecord`, transcode with ffmpeg.
26. Both videos carry the "no real NFC tap, identical code path after the URL" statement in
    frame. Not in a README.
27. Deactivate the DEMO worker and DEMO building. Never delete.

### Phase 5 — review gate (AGENTS.md § Workflow Review Gate)
28. Read every file in `backlog/decisions/`, read every change, block on any violation, with
    decision ID + offending code. Run, all green:
    `node ops/gen-wellknown.mjs && node ops/check-branding.mjs && server/wellknown/verify.sh &&
     node server/check-api.js && (cd web && pnpm verify) &&
     (cd android && ./checks/run.sh && ./gradlew :app:assembleDebug)`
29. Write the decision record proposing **C2** (`worker_rates` history) as a *proposal*, and a
    record for the `app_settings` baseline being deliberately unset. Do not implement C2.

### Collision table (memorise before writing anything)

| File | Sole owner |
|---|---|
| `server/db/migrations/005_v2_features.sql` | Phase 1 |
| `server/routes/admin.js`, `server/routes/app.js` | Phase 1 |
| `server/check-api.js`, `server/lib/validate.js` | Phase 1 |
| `web/lib/nav.ts`, `web/messages/en.json`, `web/messages/de.json`, `web/lib/locale.ts` | Phase 2a |
| `web/app/<feature>/page.tsx` + `web/lib/<feature>.ts` | one Phase 2b agent each |
| `NFCTimeSheets/**` | Phase 3 iOS agent |
| `android/gradle*`, `android/*.gradle.kts`, `android/gradle/**` | Phase 0 |
| `android/app/src/main/kotlin/**/ui/**`, `net/`, `core/Wire.kt`, `res/values*/` | Phase 3 Android agent |
| `ops/branding.json`, `server/wellknown/**`, `NFCTimeSheets.entitlements`, `android/branding.properties`, `web/lib/tag.ts` | **NOBODY** |
