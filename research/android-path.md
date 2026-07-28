# Android Path — NFC TimeSheets

Research only. No implementation. Sources cited inline, all fetched 2026.

---

## 1. Recommendation Summary

| Question | Answer |
| --- | --- |
| Language | **Kotlin**. Java viable but pointless. See §2. |
| Approach | **Second native app** (Kotlin + Compose), shared REST backend. Not KMP, not RN, not Flutter. |
| Cross-platform verdict | **No.** iOS app already written in SwiftUI. Rewriting it to share ~400 lines of UI is negative ROI. |
| NFC on Android | **Better than iOS.** One tap, no notification, app launches direct. See §4. |
| Push | **Skip for now.** decision-10 already uses local notifications. FCM only if server-initiated push becomes real requirement. |
| Distribution | Play Console, $25 one-time, **internal testing track only** for pilot. Avoids 12-tester/14-day rule entirely. |
| Effort to first working Android build | **Low-medium.** App is small: 2 SwiftData models, ~476 LOC UI, thin REST client. NFC path is simpler on Android than iOS. |

**Killer detail**: Android tag scan of an `https://` NDEF URI on Android 16+ fires `ACTION_VIEW` → App Links → app opens directly. No notification tap. No unlock prompt beyond normal screen unlock. This is the exact UX the iOS app can't have. Worker taps tag, app is open with `?l=<LOCATION_UUID>` already parsed.

**Server work needed**: serve `/.well-known/assetlinks.json` with `Content-Type: application/json`, no redirects. Same pattern as AASA (decision-4). Existing `/t?l=<ID>` URI scheme (decision-5) works unchanged on both platforms. **Zero tag rewrites.**

---

## 2. Language: Kotlin vs Java

**Kotlin. Not a close call.**

Google, official position ([developer.android.com/kotlin/first](https://developer.android.com/kotlin/first)):

> "If you're looking to build an Android app, we recommend starting with Kotlin to take advantage of its best-in-class features."

> "When building new Android development tools and content, such as Jetpack libraries, samples, documentation, and training content, we will design them with Kotlin users in mind while continuing to provide support for using our APIs from the Java programming language."

Java is *supported*, not *recommended*. Concretely:

- **Jetpack Compose is Kotlin-only.** Compose compiler plugin requires Kotlin. Java path = XML layouts + View system = older paradigm, more code, no SwiftUI mental model transfer.
- **Coroutines are Kotlin-only.** All modern async Android (network, DB, NFC callbacks) is coroutine-shaped. Java gets callbacks/RxJava.
- Google's own stat: "Android apps that contain Kotlin code are 20% less likely to crash" — null safety.
- Java-only samples in new docs are thinning out. Every new Jetpack API ships Kotlin-first with Java interop as afterthought.

**Transfer value for a SwiftUI dev**: Kotlin ≈ Swift. Null safety (`?`/`!!` vs `?`/`!`), data classes ≈ structs, `sealed class` ≈ `enum` with associated values, coroutines ≈ `async/await`, extension functions in both. Compose ≈ SwiftUI (declarative, `@Composable` ≈ `View`, `remember`/`mutableStateOf` ≈ `@State`). Java offers **none** of this transfer.

Java is viable only if: existing large Java codebase, or team that refuses Kotlin. Neither applies. **Kotlin.**

---

## 3. Tooling on macOS

### Setup
1. Android Studio (JetBrains IDE, free). Bundles SDK, AVD manager, adb, Gradle.
2. Accept SDK licenses, install a platform (target latest stable API) + build-tools.
3. JDK bundled with Studio (JBR). No separate install needed.

`ponytail:` don't install Homebrew `android-sdk`/`openjdk` separately. Studio's bundled SDK + JBR is enough and avoids version drift. Upgrade path: if you ever need CI, install `cmdline-tools` only.

### Emulator on Apple Silicon
**Good.** Not a pain point anymore.

Android's own acceleration doc ([developer.android.com/studio/run/emulator-acceleration](https://developer.android.com/studio/run/emulator-acceleration)) lists supported processors:

> - Intel Processors with Intel Virtualization Technology (VT-x, vmx)…
> - AMD Processors with AMD-V (SVM)…
> - **Apple silicon**

Requirement table:

| CPU Architecture | System Image Requirement |
| --- | --- |
| ARM64 | arm64-v8a system images for Android 5.0 (API level 21) and higher |

Rule: **pick `arm64-v8a` system images.** They run natively via `Hypervisor.Framework`. Picking an x86_64 image on an M-series Mac means no acceleration — the doc explicitly warns:

> "AVDs that don't follow the requirements, such as ARM- or MIPS-based system images on Intel or AMD CPUs, can't use the VM acceleration."

Practical: emulator boot and interaction speed are near-native. Better than iOS Simulator on cold start in many cases.

### macOS-specific pain points
Honestly minimal. Notable ones:

- **Emulator has no NFC.** Same as iOS Simulator. All NFC work requires a physical Android device. Non-negotiable — buy/borrow one cheap Android phone with NFC.
- **Gradle daemon eats RAM.** 8GB Mac is tight, 16GB+ comfortable. Gradle builds are slower than `xcodebuild` for a project this size on first build, comparable after warm cache.
- **Rosetta not needed** for modern Studio + arm64 images. Old StackOverflow answers about Rosetta are stale.
- **adb over USB-C** works out of the box, no driver install (unlike Windows). Enable Developer Options → USB debugging on device.
- **Wireless debugging** (Android 11+): pair over Wi-Fi from Studio, no cable. Better than iOS's equivalent in practice.

### Physical device debugging — vs iOS
Massively simpler than iOS:

| | iOS | Android |
| --- | --- | --- |
| Cost to run on own device | Apple Developer Program required for TestFlight/long-lived provisioning ($99/yr) | Free |
| Signing | Provisioning profiles, certs, entitlements, capability toggles | Debug keystore auto-generated, zero config |
| Install debug build | Xcode + trusted cert on device | `adb install` / Studio Run |
| Build expiry | 7-day free-tier builds | Never |

No provisioning-profile hell. This is the single biggest quality-of-life win on Android.

---

## 4. NFC on Android — the important part

### 4.1 Background tag reading equivalent

**Yes, and it's better.** Android's *tag dispatch system* does this natively since ~API 10, no special entitlement.

Android NFC guide ([developer.android.com/develop/connectivity/nfc/nfc](https://developer.android.com/develop/connectivity/nfc/nfc)):

> "Android-powered devices are usually looking for NFC tags when the screen is unlocked, unless NFC is disabled in the device's Settings menu. When an Android-powered device discovers an NFC tag, the desired behavior is to have the most appropriate activity handle the intent **without asking the user what application to use**."

Contrast, Apple ([developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading)):

> "The system displays a pop-up notification each time it reads a new tag. **After the user taps the notification**, the system delivers the tag data to the appropriate app. If the iPhone is locked, the system prompts the user to unlock the phone before providing the tag data to the app."

> "For universal links, the system launches (or brings to the foreground) the app associated with the universal link **after the user taps the notification**."

**iOS: tap tag → notification appears → tap notification → (unlock) → app opens.**
**Android: tap tag (screen on/unlocked) → app opens.**

For a cleaner clocking in at a building door with gloves on, that's a real UX gap in Android's favour.

### 4.2 Intent filters vs iOS universal links from NDEF

Android has **three** dispatch intents, priority ordered:

1. `ACTION_NDEF_DISCOVERED` — highest priority, matched on MIME type or URI.
2. `ACTION_TECH_DISCOVERED` — fallback, matched on tag technology (`NfcA`, `Ndef`, `MifareUltralight`…).
3. `ACTION_TAG_DISCOVERED` — last resort. **Deprecated starting Android 17 (API 37).**

Filter example from the doc, matching a URI — this is directly the decision-5 shape:

```xml
<activity
    android:name=".MyActivity"
    android:exported="true"
    android:permission="android.permission.DISPATCH_NFC_MESSAGE">
    <intent-filter>
        <action android:name="android.nfc.action.NDEF_DISCOVERED"/>
        <category android:name="android.intent.category.DEFAULT"/>
        <data android:scheme="https"
                  android:host="developer.android.com"
                  android:pathPrefix="/index.html" />
    </intent-filter>
</activity>
```

**BUT — critical Android 16 change.** Same doc:

> "**Note:** Starting Android 16, scanning NFC tags that store URL links (i.e URI scheme is "htttps://" or "http://") will trigger the `ACTION_VIEW` intent instead of `ACTION_NDEF_DISCOVERED` intent."

> "Starting Android 16, scanning NFC tags that store URL links will trigger the `ACTION_VIEW` intent. To filter for `ACTION_VIEW` refer to `this`. **Use Android app links to open your app for the URL.**"

Our tags carry `https://timesheets.exe.xyz/t?l=<UUID>` (decision-5). So on Android 16+ the mechanism is **exactly the iOS universal-link model**: tag URL → `ACTION_VIEW` → App Links verification → our activity. On Android ≤15 it's `ACTION_NDEF_DISCOVERED`.

`ponytail:` register **both** filters on the same activity (`ACTION_VIEW` + `autoVerify`, and `ACTION_NDEF_DISCOVERED` with the same `<data>` block). Both deliver an intent whose `data` is the URL. Parse `intent.data?.getQueryParameter("l")` in one place. ~10 lines of manifest, one function. Ceiling: if Android drops the NDEF path entirely, delete the second filter. No abstraction needed.

### 4.3 Android 16/17 gotchas — read these before planning

Three behaviour changes that matter for a worker-facing kiosk-ish app:

**(a) App allowlist for NFC tag scanning (Android 16+)**

> "Starting Android 16, users are notified when an app receives it's first NFC intent to scan NFC tags. The user is provided with the option to disallow the app from scanning for NFC tags anymore in the notification."
> - `NfcAdapter.isTagIntentAllowed()` to check.
> - `ACTION_CHANGE_TAG_INTENT_PREFERENCE` intent to re-prompt.
> - Setting lives under `Settings > Apps > Special app access > Launch via NFC`.

One-time consent, not per-tap. But if a worker dismisses it wrong, clocking silently stops working. **Onboarding must call `isTagIntentAllowed()` and surface a fix-it prompt.** Not optional — this is a data-loss-adjacent failure mode (worker thinks they clocked in, didn't).

**(b) `DISPATCH_NFC_MESSAGE` permission (Android 17 / API 37+)**

> "Starting Android 17 (API level 37), for an activity to be dispatched an NFC intent, if the app targets SDK > `Build.VERSION_CODES.BAKLAVA`, it must be protected by the `android.permission.DISPATCH_NFC_MESSAGE` permission."

Just an attribute on the activity: `android:permission="android.permission.DISPATCH_NFC_MESSAGE"`.

**(c) Stopped-state apps get no NFC intents (Android 17+)**

> "the system will not dispatch NFC intents to applications that are in a stopped state (e.g. if the application has never been launched by the user or has been force-stopped)."

**Worker must open the app once after install before tags work.** Must be in the onboarding/rollout runbook. Also: aggressive OEM battery managers (Samsung, Xiaomi, Huawei are the usual suspects) force-stop apps — worth a "disable battery optimization for this app" step in the rollout checklist.

**(d) NFC only scans when screen unlocked.** Same practical constraint as iOS. Not a regression.

### 4.4 App Links: `assetlinks.json` vs `apple-app-site-association`

Same idea, different file. Both `.well-known/`, both `application/json`, both verified at install.

Android format ([developer.android.com/training/app-links/configure-assetlinks](https://developer.android.com/training/app-links/configure-assetlinks)):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.example",
    "sha256_cert_fingerprints":
    ["14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5"]
  }
}]
```

Hosting requirements (verbatim):

> - The `assetlinks.json` file is served with content-type `application/json`.
> - The `assetlinks.json` file must be accessible over an HTTPS connection…
> - The `assetlinks.json` file must be accessible without any redirects (no 301 or 302 redirects).

**decision-4 already solved this shape for AASA.** Same server, same `Content-Type` handling, one more static route. Verifies decision-4 was the right call — GitHub Pages would have broken assetlinks too.

Verification is triggered by `android:autoVerify="true"`:

> "When `android:autoVerify="true"` is present in at least one of your app's intent filters, installing your app on a device that runs Android 6.0 (API level 23) or higher causes the system to automatically verify the hosts associated with the URLs in your app's intent filters."

> "For each unique hostname found in the intent filters, Android queries the corresponding websites for the Digital Asset Links file at `https://hostname/.well-known/assetlinks.json`."

**Trap — Play App Signing fingerprint:**

> "If you're using Play App Signing for your app, then the certificate fingerprint produced by running `keytool` locally will usually **not** match the one on users' devices. You can verify whether you're using Play App Signing for your app in your Play Console developer account under `Release > Setup > App signing`; if you do, then you'll also find the correct Digital Asset Links JSON snippet for your app on the same page."

So: **copy the fingerprint out of Play Console**, don't compute it from your local keystore. `sha256_cert_fingerprints` is an array — put both debug and Play fingerprints in so local debug builds also verify.

Test command from the doc (wait ≥20s after install):

```
adb shell am start -a android.intent.action.VIEW \
    -c android.intent.category.BROWSABLE \
    -d "http://domain.name:optional_port"
```

---

## 5. NFC Comparison Table

| Capability | iOS (current app) | Android | Verdict |
| --- | --- | --- | --- |
| Background tag read, app not running | Yes, via Core NFC background tag reading | Yes, via tag dispatch system | **Same** |
| Taps required to get payload into app | **2** (tag + notification) | **1** (tag) | **Android better** |
| Unlock required | Yes — "prompts the user to unlock the phone before providing the tag data" | Yes (screen must be unlocked to scan) | Same |
| Payload delivered | NDEF message as `NSUserActivity` (universal link) | URL in `Intent.data` | Same |
| Hardware UID accessible in background path | No (drove decision-5) | Yes via `ACTION_TECH_DISCOVERED`, but not on the URL/`ACTION_VIEW` path | Android better in theory, irrelevant given decision-5 |
| Foreground scan session | `NFCNDEFReaderSession` + system modal sheet | `enableReaderMode()` / foreground dispatch, no forced system UI | **Android better** (no modal) |
| Tag writing | Core NFC (iOS 13+) | `Ndef.writeNdefMessage()`, full support | Android better |
| Domain association file | `/.well-known/apple-app-site-association` | `/.well-known/assetlinks.json` | Same |
| Association file `Content-Type` | `application/json` required | `application/json` required | Same |
| Redirects allowed on association file | No | No (explicitly "no 301 or 302") | Same |
| Fingerprint/ID in association file | Team ID + bundle ID | `package_name` + SHA-256 signing cert fingerprint | Android slightly worse (Play App Signing gotcha) |
| Entitlement/capability needed | `Near Field Communication Tag Reading` capability + `applinks:` associated domain | `<uses-permission android:name="android.permission.NFC" />` + `DISPATCH_NFC_MESSAGE` on activity (API 37+) | Same effort |
| Device-model gating | iPhone 7+ / iOS 11+; background read iPhone XS+ / iOS 13+ | `<uses-feature android:name="android.hardware.nfc" android:required="true"/>` filters Play listing | Same |
| User can silently disable app's NFC | No | **Yes** — Android 16 "Launch via NFC" allowlist | **Android worse** — must handle |
| Works if app never launched since install | Yes | **No** on Android 17+ (stopped state) | **Android worse** — must handle |
| Emulator/simulator support | None | None | Same (physical device required) |
| Tag rewrite needed for Android | — | **No.** Same `https://timesheets.exe.xyz/t?l=<UUID>` URI works | Free win |

---

## 6. Push Notifications

### First: do you need it?

`ponytail:` **Probably not.** decision-10 specifies: server cron auto-closes >8h shifts, **local notification** motivates the worker, app-launch modal forces resolution. Local notifications need no FCM, no APNs, no Firebase project, no token registry, no server credential rotation.

Android local notification = `NotificationCompat` + `AlarmManager`/`WorkManager`. Equivalent to `UNUserNotificationCenter` on iOS. Zero backend work.

Only add push if a requirement appears that *needs* server-initiated delivery to a possibly-cold app — e.g. admin remotely closing a shift, or a schedule change pushed same-day. Not in 3A scope.

### If you do need it: FCM

Setup on Android ([firebase.google.com/docs/cloud-messaging/android/client](https://firebase.google.com/docs/cloud-messaging/android/client)):
1. Create Firebase project, register the Android app (package name), download `google-services.json` into `app/`.
2. Add `google-services` Gradle plugin + `firebase-messaging` dependency.
3. Manifest: declare a `FirebaseMessagingService` subclass.
4. **Request runtime `POST_NOTIFICATIONS` permission on Android 13+** — this is a real dialog, must be handled, not a manifest-only thing.
5. Retrieve registration token, POST it to your server.
6. Requires **Google Play services** on device. Check with `GoogleApiAvailability` — matters if any worker has a non-GMS device (Huawei etc.).

### FCM vs APNs effort

| | APNs (iOS) | FCM (Android) |
| --- | --- | --- |
| Account prerequisite | Apple Developer Program ($99/yr) | Free Google account |
| Server credential | `.p8` auth key + key ID + team ID | Service account JSON, OAuth2 access token |
| Client config file | none (capability toggle) | `google-services.json` |
| Runtime permission prompt | Yes | Yes (Android 13+) |
| Device prerequisite | none | Google Play services present |
| Token lifecycle | APNs device token | FCM registration token (rotates, must resync) |

Roughly equivalent effort. FCM's extra `google-services.json`/Gradle plugin step cancels out APNs' certificate ceremony.

### Can one backend serve both?

**Yes — FCM HTTP v1 can deliver to iOS too.** Upload your APNs `.p8` auth key into the Firebase project; the iOS app registers with FCM; your Node server sends one FCM v1 request and Firebase fans out to APNs or Android transport. One credential (service account JSON), one API.

Auth per the FCM v1 doc ([firebase.google.com/docs/cloud-messaging/send/v1](https://firebase.google.com/docs/cloud-messaging/send/v1)):

> `export GOOGLE_APPLICATION_CREDENTIALS="/home/user/Downloads/service-account-file.json"`

Server-key auth is dead; v1 uses service-account OAuth2. On Node: `firebase-admin` package, `messaging().send({ token, notification, ... })`.

`ponytail:` If push ever happens, do **FCM-for-both** rather than two push stacks. Trade-off accepted: adds a Google dependency to the iOS app. Ceiling: if that's unacceptable, split later — the server-side send call is one function.

---

## 7. Distribution

### Play Console basics

Registration ([support.google.com/googleplay/android-developer/answer/6112435](https://support.google.com/googleplay/android-developer/answer/6112435)):

> "There is a US$25 one-time registration fee"

**One-time, no renewal.** vs Apple's $99/year. Plus identity verification (~2 business days). Organization accounts additionally need legal business info and, in some cases, a **D-U-N-S number** ([support.google.com/googleplay/android-developer/answer/…required-information](https://support.google.com/googleplay/android-developer/answer/10788890)).

### The 12-tester rule — and why it does NOT apply here

> "Developers with personal accounts created after November 13, 2023, must meet specific testing requirements before the…" — Play Console Help

The rule: **personal** accounts created after 2023-11-13 must run a **closed test with ≥12 testers opted in continuously for 14 days** before they can publish to **production**. Organization accounts are exempt. Widely reported as the #1 solo-dev blocker in 2026 ([iconikai.com](https://www.iconikai.com/blog/google-play-developer-account-fee-2026), [testfi.app](https://www.testfi.app/blog/google-play-closed-testing-12-testers-14-days), [choicely.com](https://www.choicely.com/tutorials/how-to-create-a-google-play-developer-account-for-your-organization)).

**Key insight for this project:** it gates **production publishing only**. A 5–20-worker pilot never needs production. **Internal testing track = 100 testers = done.**

> "Internal testing is for up to 100 trusted testers and is fast, but it does not satisfy the production requirement." — testfi.app

Fine. We don't want the production requirement. This is the same posture as the current TestFlight internal track.

If the company ever wants a public listing: register as an **organization** (the cleaning company), skip the 12-tester rule entirely.

### Track comparison

Verbatim from Play Console Help ([support.google.com/googleplay/android-developer/answer/9845334](https://support.google.com/googleplay/android-developer/answer/9845334)):

> **Internal testing**: Create an internal testing release to quickly distribute your app to up to 100 testers for initial quality assurance checks… **You can start an internal test before you've finished setting up your app.**

> **Policy and security reviews**: Internal tests may **not** be subject to the usual Play policy or security reviews. Apps that are active on internal testing tracks are exempt from inclusion in Google Play's Data safety section.

> **Country distribution**: You can add users from any location to your internal test.

> "You can distribute apps via the internal test track much faster than the open or closed tracks."

### TestFlight vs Play tracks

| | TestFlight (current) | Play Internal | Play Closed | Play Open |
| --- | --- | --- | --- | --- |
| Tester cap | 100 internal / 10,000 external | **100** | up to 2,000 per email list (larger via Groups) | unlimited |
| Tester identification | Apple ID email | Google account email / email list / Google Group | same | anyone with the opt-in link |
| Review before testers get build | Internal: no. External: yes (Beta App Review) | **No** — "may not be subject to the usual Play policy or security reviews" | Yes | Yes |
| Time from upload to testers | Internal: minutes after processing | **Minutes** ("builds available in minutes"/seconds) | Hours–days (review) | Hours–days (review) |
| Build expiry | **90 days** | None | None | None |
| App must be fully configured | Store listing not needed for internal | **No** — "before the app is reviewed for the first time, users will see a temporary name for the app" | Yes | Yes, listing publicly visible |
| Discoverable in store | No | No — "testers won't be able to find it by searching" | No | Yes |
| Update mechanism | TestFlight app | **Play Store app** (auto-update works) | Play Store | Play Store |
| Counts toward 12-tester/14-day production rule | n/a | **No** | Yes | n/a |
| Annual cost | $99/yr Apple Developer Program | **$25 once** | same | same |

**Play internal testing is strictly better than TestFlight for a worker pilot:**
- Builds never expire (no 90-day re-upload treadmill — real ops win for a small cleaning company).
- Updates arrive through the normal Play Store app the workers already have. No second app to install, no "what's TestFlight" onboarding conversation.
- No Beta App Review at all.

**Timeline, upload → tester has build:** minutes for processing + Play propagation. Realistically same-day, usually <1h. Slower part is workers actually tapping update.

Note the track-eligibility quirk:

> "Users who opted into internal testing aren't eligible for open and closed testing… These users… would only receive the version code published on the **Internal testing** track."

Don't mix a worker into two tracks.

---

## 8. Cross-Platform Assessment

Context that decides this: **the iOS app already exists** (SwiftUI, SwiftData, 3 files, ~580 LOC). UI surface is tiny (tap → shift toggle, list of shifts, unresolved-shift modal, settings). All the real logic is in the backend. NFC is platform-specific by definition.

| Option | Pros for THIS app | Cons for THIS app | Verdict |
| --- | --- | --- | --- |
| **Two native apps** (SwiftUI + Kotlin/Compose) | Zero rewrite of working iOS app. Each NFC integration uses first-party APIs, first-party docs, no plugin between you and a platform bug. Compose ≈ SwiftUI so the port is mechanical. Best-in-class debugging on both. No build-toolchain risk. | Duplicate UI (~500 LOC ×2). Two release pipelines. Feature parity by discipline. | **Recommended** |
| **KMP + Compose Multiplatform** | KMP core stable since Nov 2023; Compose Multiplatform for iOS stable May 2025 (v1.8.0, [JetBrains](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-release/)). Could genuinely share models + API client. Kotlin/Native interop with Swift is decent. | **Requires rewriting the working SwiftUI app in Compose**, or shipping a KMP shared module into an existing Xcode project (real Gradle↔Xcode build integration cost). NFC is `expect`/`actual` anyway — the one hard part stays duplicated. Shared surface here = ~2 data classes + one HTTP client = **not worth a build system**. Solo dev now owns Gradle + Xcode + KMP toolchain interactions. | **No.** Right tech, wrong project size. |
| **React Native** | `react-native-nfc-manager` is the mature option and covers NDEF on both. Web-adjacent skills reusable with the Next.js admin panel. | Full rewrite of iOS app. NFC via community plugin = you're one maintainer away from being stuck (see open issues re: NfcV/iOS quirks). Background tag reading + App Links + NDEF dispatch all need native config anyway. JS runtime + Metro + native deps = biggest toolchain surface of all options. Offline/local store needs another dep. | **No.** |
| **Flutter** | `nfc_manager` (pub.dev) is well-maintained, Android side works well. Single UI codebase, good tooling on macOS. | Full rewrite. iOS NFC in Flutter has a documented history of flakiness ("Android works fine, but the iOS does not detect" — common report). Background tag reading on iOS still requires native plumbing. Dart is a third language in a project that already has Swift + TypeScript. | **No.** |

### The deciding argument

Cross-platform pays when **UI is large and platform APIs are small**. This app is the inverse: **UI is tiny, and the single most important feature is the most platform-specific API on the phone.** Every cross-platform option makes you write the NFC layer twice *anyway*, plus adds a toolchain.

Sharing already happens where it should: **the REST API is the shared code.** That's the correct sharing boundary for this system.

`ponytail:` deliberate shortcut — accept ~500 LOC of duplicated UI. Ceiling: if the app grows to 5k+ LOC of shared business logic (payroll calc on device, complex offline reconciliation, P&L views from 3B), revisit KMP for a **shared logic module only** (no Compose Multiplatform, keep SwiftUI). That's an additive migration, not a rewrite.

---

## 9. Maintenance / Two-App Operations

**Backend is the contract.** Both apps are thin clients over `/roster`, `/shifts`, `/shifts/unresolved`. Enforce that:
- Never add platform-specific endpoints. One API, both clients.
- Version the API additively (add fields, don't rename/remove). Old app builds keep working when a worker doesn't update.
- `X-App-Key` stays a single app-level key; add a `X-Client` header (`ios`/`android` + version) purely for server-side logging so you can tell which platform a bad payload came from.

**Feature parity.** Don't chase it per-commit. Pick a cadence:
- iOS is the reference implementation (it exists, it's deployed).
- Android ships a feature only after the iOS behaviour is settled. Avoids porting a design twice.
- Keep one `docs/app-behaviour.md` describing worker-visible behaviour in platform-neutral terms (tap → toggle rules, 8h timeout modal per decision-10, offline queue semantics). Both apps implement *that*, not each other.

**Versioning.** Same semantic version across platforms, independent build numbers. `1.4.0 (iOS build 22)` / `1.4.0 (Android versionCode 31)`. Server logs the semver, ignores build number.

**Release coordination.** Don't try to ship simultaneously — Play internal (minutes) and TestFlight (minutes, but 90-day expiry) have different rhythms. Rule: **server changes must be backward compatible with the oldest app version still in the field.** Then release order stops mattering. This is the only coordination discipline that actually holds for a solo dev.

**i18n (decision-8).** Both apps need the same German strings. Android uses `res/values-de/strings.xml`, iOS uses String Catalogs. Keep a single source-of-truth key list; don't let the two drift into different phrasing for the same screen.

**Effort to maintain**: low ongoing, medium at each new feature (implement twice). Acceptable given the tiny UI surface.

---

## 10. Concrete Next Steps (if proceeding)

Ordered, each independently useful:

1. **Buy one cheap Android phone with NFC.** Android 15 or 16. Non-negotiable — emulator can't do NFC. This is the whole prerequisite.
2. **Verify the existing tags work unchanged.** Install any NFC reader app on the test phone, tap an existing `https://timesheets.exe.xyz/t?l=<UUID>` tag, confirm it offers to open the URL. This validates decision-5 on Android with zero code. Do this before anything else.
3. **Add `/.well-known/assetlinks.json` to `server/server.js`.** Same route pattern as AASA (decision-4): explicit `Content-Type: application/json`, no redirect. Placeholder fingerprint initially. Effort: low, ~5 lines.
4. **Install Android Studio.** Create AVD with an **arm64-v8a** system image. Confirm it boots fast.
5. **New Kotlin + Compose project.** Package `io.github.qwadratic.nfctimesheets` (mirror the iOS bundle ID). `minSdk` 26 or so, `targetSdk` latest.
6. **Manifest NFC wiring** — one activity, three things:
   - `<uses-permission android:name="android.permission.NFC" />`
   - `<uses-feature android:name="android.hardware.nfc" android:required="true" />`
   - Intent filters: `ACTION_VIEW` + `autoVerify="true"` for `https://timesheets.exe.xyz/t`, **and** `ACTION_NDEF_DISCOVERED` with the same `<data>` block (covers Android ≤15). Activity gets `android:permission="android.permission.DISPATCH_NFC_MESSAGE"`.
7. **Parse and stub.** `intent.data?.getQueryParameter("l")` → show it on screen. Tap a real tag. If the location UUID appears, **the hard part is done.**
8. **Register Play Console ($25), get the App Signing SHA-256** from `Release > Setup > App signing`. Put it (plus your debug keystore fingerprint) into `assetlinks.json` on the server. Re-verify with the `adb shell am start` command.
9. **Handle `NfcAdapter.isTagIntentAllowed()`** on app start; if false, prompt via `ACTION_CHANGE_TAG_INTENT_PREFERENCE`. Do this early, not as polish — silent clock-in failure is the worst bug this app can have.
10. **Port the domain layer.** `Shift`/`Site` → Kotlin data classes + Room (Room ≈ SwiftData). Port the REST client (Ktor client or OkHttp+kotlinx.serialization). `ponytail:` OkHttp + kotlinx.serialization is fewer moving parts than Ktor client for 6 endpoints.
11. **Port the UI in Compose.** Passive "approach tag" screen, shift list, unresolved-shift blocking modal (decision-10).
12. **Upload AAB to Play internal testing.** Add workers' Google account emails. Share the opt-in link.

---

## 11. What NOT To Do

- **Don't rewrite the iOS app.** Any answer that starts with "first, port SwiftUI to X" is wrong for a working, shipped app with a tiny UI.
- **Don't rewrite the NFC tags.** decision-5's `https://.../t?l=<UUID>` scheme works on both platforms. Rewriting 20 tags in a live building is a real cost for zero gain.
- **Don't filter `ACTION_TAG_DISCOVERED`.** Deprecated in Android 17. Also: "Filtering for `ACTION_TAG_DISCOVERED` is usually too general… your application has a low probability of starting."
- **Don't read the hardware UID for location identity.** Would contradict decision-5, and would need `ACTION_TECH_DISCOVERED` — a *different, lower-priority* dispatch path than the URL path. Two mechanisms, two bugs.
- **Don't pick an x86_64 emulator image on Apple Silicon.** No VM acceleration. Doc warns explicitly.
- **Don't plan around the emulator for NFC.** It has none.
- **Don't compute `sha256_cert_fingerprints` from your local keystore** if using Play App Signing. Doc: the local fingerprint "will usually not match the one on users' devices." Copy it from Play Console. This is the classic App Links debugging rabbit hole.
- **Don't serve `assetlinks.json` behind a redirect** (Vercel/proxy rewrites, trailing-slash normalization). "no 301 or 302 redirects." Same class of bug as decision-4's MIME issue.
- **Don't put the frontend and the association files on different hosts.** decision-11 puts the frontend on Vercel and API+association files on the VM. Keep `assetlinks.json` with AASA on `timesheets.exe.xyz`. Consistent, one place to break.
- **Don't chase a Play *production* release for the pilot.** It triggers the 12-tester/14-day closed-test requirement for personal accounts. Internal testing track, 100 testers, no review. If public listing is ever needed, register the **company** as an organization account instead.
- **Don't add FCM in 3A.** decision-10 is satisfied by local notifications. Adding Firebase means a Google project, a token table in Postgres, a service-account credential to rotate, a Play-services dependency, and an Android 13 runtime permission dialog — all for a notification the device can schedule itself.
- **Don't ship without testing the "stopped state" path** on Android 17+: install, do *not* open the app, tap a tag → nothing happens. Then open once → works. Bake "open the app once" into the worker rollout checklist.
- **Don't ignore OEM battery managers.** Samsung/Xiaomi/Huawei force-stop backgrounded apps, which re-triggers the stopped-state problem. Rollout checklist item: exclude the app from battery optimization.
- **Don't introduce a second backend or Android-only endpoints.** The API is the shared code. That's the whole cross-platform strategy.

---

## Sources

- Android NFC basics + tag dispatch + Android 16/17 changes — https://developer.android.com/develop/connectivity/nfc/nfc
- Android App Links verification — https://developer.android.com/training/app-links/verify-android-applinks
- Configure `assetlinks.json` — https://developer.android.com/training/app-links/configure-assetlinks
- Kotlin-first Android — https://developer.android.com/kotlin/first
- Emulator hardware acceleration (Apple silicon, arm64) — https://developer.android.com/studio/run/emulator-acceleration
- Apple Core NFC background tag reading — https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading
- FCM Android client setup — https://firebase.google.com/docs/cloud-messaging/android/client
- FCM HTTP v1 send — https://firebase.google.com/docs/cloud-messaging/send/v1
- Play Console: set up open/closed/internal test — https://support.google.com/googleplay/android-developer/answer/9845334
- Play Console: get started / $25 fee / testing requirements — https://support.google.com/googleplay/android-developer/answer/6112435
- Play App Signing — https://support.google.com/googleplay/android-developer/answer/9842756
- Compose Multiplatform 1.8.0 — iOS stable — https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-release/
- 12-tester / 14-day rule commentary — https://www.testfi.app/blog/google-play-closed-testing-12-testers-14-days , https://www.iconikai.com/blog/google-play-developer-account-fee-2026
- Play track comparison commentary — https://primetestlab.com/blog/google-play-internal-vs-closed-vs-open-testing
- `react-native-nfc-manager` — https://github.com/revtel/react-native-nfc-manager
- Flutter `nfc_manager` — https://pub.dev/packages/nfc_manager
