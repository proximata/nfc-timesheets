# NFC TimeSheets — Android

Native Kotlin + Jetpack Compose. Reads the **same NFC tags already on the walls** and
speaks the **same API** as the iOS app and the web admin. No server change was needed and
none was made.

    android/
      branding.properties     the ONE place an operator identity is typed
      keystore.properties     NOT COMMITTED — the operator supplies it (see .example)
      app/src/main/kotlin/
        core/                 pure Kotlin, no Android imports — this is what checks/ runs
        data/                 SQLite queue + roster cache
        net/                  HttpURLConnection + the ts_worker cookie
        ui/                   Compose
      checks/run.sh           runnable without a device, an emulator or an Android SDK

---

## READ THIS FIRST: what is unproven

**Nothing in this directory has ever been compiled or run.** The machine it was written on
had no Android SDK, no Gradle and no device, and NFC does not work on emulators anyway.

Proven here (see § Checks):

- tag-URI parsing and rejection, including the traps iOS already hit
- the exact JSON bytes of every request body
- response decoding, both timestamp shapes the server emits
- retry classification and the offline-queue ordering
- the cold-launch tap ordering
- German/English string parity and manifest wiring
- enrolment-code normalisation, **cross-checked against `server/lib/enrolment.js` and
  `server/routes/auth.js` read as source** — the alphabet, the length and the input cap
  are lifted out of the server, not copied into the check
- what each `Set-Cookie` means to the stored session, including the case that matters:
  a response that says nothing must not be read as a logout

**Not proven, and only a physical Android phone can settle it:**

1. That the Gradle build resolves at all. `gradle/libs.versions.toml` pins versions that
   exist, but the combination has never been synced. Expect the first
   **File → Sync Project with Gradle Files** to be the first real test. In particular
   `KeyboardOptions(autoCorrectEnabled = …)` on the sign-in field is a Compose Foundation
   1.7+ parameter name; if the BOM resolves to something older it is `autoCorrect`.
2. That `gradle/wrapper/gradle-wrapper.jar` is present — **it is not committed**, because
   it is a binary that cannot be produced without Gradle. Android Studio regenerates it on
   first open, or run `gradle wrapper` once with a system Gradle.
3. That a real tag on **Android 16+** fires `ACTION_VIEW` and reaches `MainActivity`.
4. That a real tag on **Android ≤ 15** fires `ACTION_NDEF_DISCOVERED` and reaches
   `NfcTapActivity`.
5. That **App Links verified**. `adb shell pm get-app-links <applicationId>` must report
   `verified` for the tag host. **Until the Play fingerprints are in `ops/branding.json`
   it will report unverified and every tap will open Chrome.** See § Play Console.
6. **Stopped state, Android 17+**: install, do *not* open, tap → nothing happens. Open
   once → works. This is a rollout step, not a bug, and there is no API that fixes it from
   inside the app.
7. The Android 16 "Launch via NFC" allowlist prompt, and whether the in-app fix-it button
   actually re-opens the choice.
8. OEM battery managers (Samsung, Xiaomi, Huawei) force-stopping the app back into the
   stopped state days later.
9. Whether one tap really is one tap in the hand, with gloves, at a stairwell door.

Provable on an **emulator**, without a tag, and worth doing first — it exercises the whole
App-Link → parse → clock-in path:

    adb shell am start -a android.intent.action.VIEW \
      -c android.intent.category.BROWSABLE \
      -d "https://<tagHost>/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301"

---

## Sign-in: the admin-issued enrolment code (decision-26)

The admin issues an 8-character code **for one named worker** in the web panel and reads
it down the phone. The worker types it once, on first launch, into the only field on the
screen. `POST /auth/code` exchanges it for **the same `worker_sessions` row Sign in with
Apple mints on iOS** — one session system, two enrolment mechanisms. Everything
downstream is unchanged: `worker_id` comes from the session cookie and never from a
request body (decision-22).

The `auth/` package and `AuthProvider` are **gone**. They were a seam for an undecided
choice; the choice is made, so an interface with one implementation and one call site is
just indirection. `POST /auth/code` is an endpoint and lives with the other five in
`net/Api.kt`.

What the client does, and why:

- **`core/EnrolmentCode.kt` normalises before sending** — case folded, spaces/dashes/
  newlines stripped, `O→0` and `I`/`L→1`. This is a *mirror* of `server/lib/enrolment.js`
  and buys exactly one thing: a code-shaped typo does not spend one of the five attempts
  before the rate limiter locks the phone out for up to 15 minutes. The server normalises
  again; nothing here is a security control. `checks/` fails if the two drift.
- **One message for every refusal.** The server answers unknown / malformed / expired /
  already redeemed / revoked / deactivated-worker with a byte-identical `401
  invalid_code`, so that they cannot be told apart. The app must not invent a
  distinction, and a locally-malformed code gets that same string.
- **A dead connection is not a bad code** and gets its own message, because
  “we'll send it when you're online” would be a lie — there is nothing queued and they do
  have to type it again.
- **The code is never logged.** This app has no logging at all, which is the cheapest way
  to guarantee that; `checks/` asserts `android.util.Log`, `println` and `System.out`
  stay absent from `app/src/main/kotlin`.
- **`POST /auth/code` is the one route marked `sessionBearing = false`.** Its 401 means
  “that is not a code”, not “your session died”, and letting it latch the session-rejected
  flag would sign the worker straight back out on the first *successful* enrolment.
- **Enrolment is two calls, on purpose**: redeem, then `GET /auth/session`. The second one
  proves the cookie actually reached the jar and will be sent again after the process is
  killed. Trusting the enrolment response alone is how you get a friendly screen over a
  phone that files nothing.
- **There is no “not a worker” dead-end screen on Android.** It cannot happen: a code is
  issued *for* a worker, so redeeming one makes you that worker by construction. That
  screen exists on iOS because Apple will authenticate someone nobody hired.

Session persistence is `SharedPreferences`, written with `commit()` and not `apply()` —
process death is normal on Android and is *exactly* when a stopped-state tap arrives, so
a session that only exists in an in-flight async write is a re-enrolment phone call.

Signing out therefore costs a phone call: codes are single-use. The settings screen says
so before the button.

---

## Checks

    cd android && ./checks/run.sh

Needs `kotlinc` and a JDK 17+ — the toolchain the operator already has, not a project
dependency. Fetches one jar (`org.json`, which on-device comes from `android.jar`) into
`checks/.lib/` on first run.

Everything it *runs* is deliberately free of Android imports. That constraint is why
`core/` exists as a separate package: `data/`, `net/` and `ui/` cannot be compiled here.
Where a rule lives in one of those — `commit()` on the session write, `sessionBearing =
false` on `/auth/code`, cache-before-server on launch, every `stringIdFor` arm — the check
reads the file as **text** and asserts the line is present. That is weaker than running
it and it is stated as such; it is still enough to catch the edit that quietly removes it.

It also reads `../server/lib/enrolment.js` and `../server/routes/auth.js`. Run it from a
full checkout, not from `android/` alone.

---

## Build

    ./gradlew :app:assembleDebug          # no keystore needed
    ./gradlew :app:bundleRelease          # needs android/keystore.properties

Debug and release share the same `applicationId` on purpose. An `applicationIdSuffix`
would make App Links fail to verify against the published `assetlinks.json` — i.e. the
debug build could never reproduce the only bug that matters.

**Signing.** Resolution order, first hit wins:

1. `android/keystore.properties` — gitignored. Copy `keystore.properties.example`.
2. env: `TS_KEYSTORE_PATH`, `TS_KEYSTORE_PASSWORD`, `TS_KEY_ALIAS`, `TS_KEY_PASSWORD`.
3. neither → **the debug signing config**, so a fresh clone builds and runs with no
   operator secret. Play then refuses the artifact. Loud failure, right place.

Never commit a keystore, a password, or a fingerprint-bearing secret. `.gitignore` covers
`keystore.properties`, `*.jks`, `*.keystore`, `local.properties`.

---

## White-labelling this app

Everything an operator must change is in **`android/branding.properties`**. A missing key
is a hard Gradle failure — never an empty string, which is how the iOS side can silently
produce a dead `applinks:` entitlement.

| key | what it drives | note |
|---|---|---|
| `ts.applicationId` | Play identity | **IMMUTABLE after the first upload**, and it is what `server/wellknown/assetlinks.json` already publishes |
| `ts.namespace` | `R` / `BuildConfig` package | **do not change on a rebrand** — see below |
| `ts.appName` | launcher label | |
| `ts.tagHost` | manifest `${tagHost}` + `BuildConfig.TAG_HOST` | must equal `ops/branding.json` `host` |
| `ts.appKey` | `X-App-Key` | not a secret; must equal `APP_KEY` in `/etc/nfc/env` |
| `ts.versionName` / `ts.versionCode` | Play | |

`android/checks/run.sh` fails if the live host appears anywhere under `app/src` — one
literal, one place.

**`ts.namespace` is the one key that is not really configurable.** It is the Kotlin package
`R` and `BuildConfig` are generated into, and it is hard-wired in three places Gradle cannot
follow: the `package` line of every file under `app/src/main/kotlin/...`, the directory tree
itself, and the `import io.github.qwadratic.nfctimesheets.{R, BuildConfig}` statements in
`net/Api.kt`, `ui/TimeSheetApp.kt` and `ui/TimeSheetViewModel.kt`. Change it and the build
fails with an unresolved reference. That is *loud*, so it is not dangerous — but it is not a
rebrand knob either. It is **internal**: it never appears in Play, in the manifest, on a tag
or in `assetlinks.json`, so it leaks no previous operator identity to anyone. The name that
is actually visible is `ts.applicationId`, and that one *is* configurable. Renaming the
package is a find-and-replace plus a `git mv`, it is optional cosmetics, and it should never
ride along with a rebrand you are about to ship.

**Changing `ts.tagHost` is only half the job.** The other half is `ops/branding.json` and
the generated well-known files. And it does not re-point tags already glued to walls: a
new operator picks the host **at zero tags** (decision-15).

---

## Play Console — the owner's step, and the one that makes taps work

1. Create the app. `applicationId` must be exactly `ts.applicationId`.
2. Upload an AAB to **Internal testing** (100 testers, no review, no build expiry).
3. **Release → Setup → App signing** — copy **both** SHA-256 fingerprints:
   - the **Play App Signing** certificate (this is the one on users' devices)
   - the **upload** certificate
   Never compute the first one with `keytool`; it will not match.
4. Paste both into `ops/branding.json` `android.sha256CertFingerprints`, regenerate the
   well-known files, redeploy, re-run `server/wellknown/verify.sh`.
   Uppercase, colon-separated hex. A lowercase fingerprint is accepted by the JSON and
   silently ignored by Android's verifier.
5. On the device: `adb shell pm get-app-links <applicationId>` → must say `verified`.

Until step 4 lands, **every Android tap opens Chrome**.

---

## Worker rollout checklist

- [ ] Admin issues the enrolment code for that worker in the web panel and reads it to
      them. It is shown **once**, lasts **an hour**, and works **once**. Reissuing is one
      click; a code read to the wrong person is revoked in one click.
- [ ] Install from Play, then **open the app once**. Android delivers no NFC intents to an
      app in the stopped state (Android 17+).
- [ ] Type the code. Case, spaces and dashes do not matter; `O`/`0` and `I`/`l`/`1` are
      interchangeable. The screen must land on “Zeiterfassung”.
- [ ] NFC on.
- [ ] On the first tap Android 16+ shows a "Launch via NFC" notification — **allow it**.
      If it was dismissed wrong, the app shows a fix-it button on the log screen.
- [ ] Tap a real tag and confirm a shift appears with "Gesendet".

---

## Deliberately not in this pass

| Not built | Why |
|---|---|
| FCM / push | decision-10 is satisfied by a local notification. FCM = a Google project, a token table, a service-account secret and a runtime permission. |
| Sentry | Telemetry is scoped to the API and iOS (decision-23). A third SDK is a decision record, not a convenience. |
| Tag **writing** | The admin panel and iOS own tag writing. A second writer is a second way to brick a tag. |
| History / payroll beyond parity | The admin panel is the reporting surface (decision-7). |
| Any new server endpoint | Constraint. If Android seems to need one, that is a design bug on this side. |
| Room, OkHttp, Retrofit, kotlinx.serialization | See the note at the top of `gradle/libs.versions.toml`. |
