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
        auth/                 the sign-in SEAM (decision-26 is still PROPOSED)
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

**Not proven, and only a physical Android phone can settle it:**

1. That the Gradle build resolves at all. `gradle/libs.versions.toml` pins versions that
   exist, but the combination has never been synced. Expect the first
   **File → Sync Project with Gradle Files** to be the first real test.
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

## Sign-in is deliberately not implemented

The Android worker-identity mechanism is **decision-26**, which is **proposed, not
accepted**. It is the owner's call, not a build agent's.

So the app ships with `UnconfiguredAuthProvider`, and it **fails visibly**: the sign-in
screen states that no sign-in method has been configured and offers no button. Everything
else is already built and is identical under all three costed options — the `ts_worker`
cookie, `GET /auth/session` on launch, 401 → signed out, `POST /auth/logout`. Whichever
option wins adds **one** implementation of `auth/AuthProvider.kt` and nothing else.

An app that looked friendly while filing nothing would be unpaid work nobody notices for a
month. That is why there is no placeholder button.

---

## Checks

    cd android && ./checks/run.sh

Needs `kotlinc` and a JDK 17+ — the toolchain the operator already has, not a project
dependency. Fetches one jar (`org.json`, which on-device comes from `android.jar`) into
`checks/.lib/` on first run.

Everything it covers is deliberately free of Android imports. That constraint is why
`core/` exists as a separate package: `data/`, `net/` and `ui/` are **not** covered and
cannot be, without a device.

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

- [ ] Install from Play, then **open the app once**. Android delivers no NFC intents to an
      app in the stopped state (Android 17+).
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
