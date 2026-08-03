# Android, and shipping under any signing identity

Verified against the tree on 2026-08-03. Everything below was run, not assumed.

---

## 0. The live iOS app and the tags on walls

This is the only irreversible surface in the product, so it goes first.

**Nothing that shipped in this change can alter the behaviour of the current build.** Checked,
not asserted:

| | result |
|---|---|
| `NFCTimeSheets.xcodeproj/project.pbxproj` | **untouched** — `git status` on the directory is empty |
| `NFCTimeSheets.entitlements` | **untouched** — still the literal `applinks:timesheets.exe.xyz` |
| bundle id / team id in the project | unchanged: `io.github.qwadratic.NFCTimeSheets`, `6Y842FE8Q4` |
| `Branding.xcconfig` | **not referenced by the project.** Attaching it is a manual Xcode step nobody has taken |
| unconfigured `TagLink.host` | `timesheets.exe.xyz` |
| unconfigured `API.base` | `https://timesheets.exe.xyz` |
| unconfigured `API.bundleId` | `io.github.qwadratic.NFCTimeSheets` |
| live AASA still names the owner | `6Y842FE8Q4.io.github.qwadratic.NFCTimeSheets` — fetched from the live host |
| live vs committed association files | **byte-identical**, both files |
| `swiftc -typecheck`, all 4 checks in `NFCTimeSheets/checks/` | pass |

The one iOS behaviour change is that `TagLink.host` and `API.base` now read through
`Branding`, and `Branding` falls back to today's literals when nothing is configured. The
runnable check pins that:

```
check(TagLink.host == "timesheets.exe.xyz", ...)
check(API.base.absoluteString == "https://timesheets.exe.xyz", ...)
```

### The trap that was correctly avoided

`Info.plist` gained `TSTagHost = $(TS_TAG_HOST)`. **An undefined Xcode build setting expands to
the empty string, not to nothing.** With the xcconfig detached — which is how this ships — that
key is `""`. `Branding.normalize` treats empty, whitespace-only, and an unsubstituted `$(VAR)`
all as unconfigured. All three are pinned by the check.

The same trap is why the **entitlement was left as a literal**. `applinks:$(TS_TAG_HOST)` does
substitute, and with the xcconfig detached it would silently become `applinks:` — universal
links dead, on the next build, with a green build and no error, straight to TestFlight. That
would have been the worst possible outcome and it was not done. The consistency between the
entitlement and `branding.json` is enforced by `ops/check-branding.mjs` instead. I mutation-
tested that guard: setting the entitlement to `applinks:` makes the check exit 1.

### One residual risk the owner should know about

`Branding.tagHost` is a `var` reading `Bundle.main` on every access, on the clock-in path. That
is a dictionary lookup, not I/O, and it is what the app already does for the Sentry DSN. No
action; noted so it is not a surprise.

---

## 1. What a new signing entity does, start to finish

Full runbook with click paths: **`ops/REBRAND.md`**. This is the shape and the ordering
constraint.

> **Pick the host before writing the first tag.** The host is written into the physical tag.
> Changing it afterwards is a site visit per building, not a deploy. Everything else in this
> document is reversible from a keyboard.

### Order (it is load-bearing)

1. **`ops/branding.json`** — the one file. `host`, `appName`, `apple.teamId`,
   `apple.bundleIds`, `android.packageName`. Leave `sha256CertFingerprints` empty for now.
   **Append** your bundle id, never replace: removing a published appID bricks every installed
   copy of the old app when its AASA cache refreshes, and you cannot uninstall it from a
   worker's phone. The generator refuses unless you pass `--allow-removal`.
2. `node ops/gen-wellknown.mjs --write` then **read `git diff server/wellknown/`**. These are
   the exact bytes served to every phone. They are committed rather than generated at deploy
   time precisely so a human sees them before they reach a wall.
3. **iOS** — attach `Branding.xcconfig` to Debug *and* Release, then **delete the target-level
   `PRODUCT_BUNDLE_IDENTIFIER` and `DEVELOPMENT_TEAM` rows on all three targets**. Target level
   beats a project-level xcconfig; this is the step people miss and it fails silently.
4. **iOS** — edit `NFCTimeSheets.entitlements` line 16 **by hand**. See §0 for why this cannot
   be templated.
5. **iOS** — update the two fallbacks in `Branding.swift`.
6. **Server** — set `APPLE_AUDIENCE` in `server/lib/apple.js`, and `BUNDLE_ID` in
   `server/check-api.js`, to your bundle id. *(This step was missing from the runbook; added.)*
7. **Apple portal** — App ID, Associated Domains capability, Sign in with Apple capability,
   provisioning, App Store Connect record. None of this is automatable.
8. **Rotate the app key** in `Branding.swift`, `android/branding.properties` and `/etc/nfc/env`
   **together**. An old build stops working the moment the server flips.
9. **Android** — `android/branding.properties`. Keystore goes in the gitignored
   `keystore.properties`.
10. **Android** — upload an AAB to Play internal testing, then copy **both** fingerprints from
    Play Console into `branding.json` (§3), regenerate, redeploy.

### THE GATE — before any tag is written

```
node ops/gen-wellknown.mjs      # committed association files == branding.json
node ops/check-branding.mjs     # every other copy of the identity == branding.json
./server/wellknown/verify.sh    # the LIVE bytes == the reviewed bytes
```

The first two are wired into `ops/deploy.sh` **step 0/7**, before the build and before any
rsync. The third is step 7/7 and a failure fails the deploy.

`verify.sh` asserts, for both files: HTTP 200, `Content-Type: application/json` exactly, **zero
redirect hops**, and the live body **byte-for-byte equal** to the reviewed file. Byte equality
is the point — a substring check ("does it mention our appID?") also passes on a file carrying a
stale appID or a widened `paths`.

**I mutation-tested every gate. All seven bite:**

| mutation | expected | actual |
|---|---|---|
| live AASA ≠ reviewed AASA | fail | fail |
| probing a host that is not the tag host | fail | fail |
| appID replaced instead of appended | fail | fail |
| lowercase SHA-256 fingerprint | fail | fail |
| entitlement set to `applinks:` | fail | fail |
| `Branding.xcconfig` team id drift | fail | fail |
| `web/lib/tag.ts` default host drift | fail | fail |

Then: **write one tag. Tap it on a real iPhone and a real Android phone. Confirm the shift
appears.** Only then write the rest.

---

## 2. Multiple SHA-256 fingerprints — **PASS**

This is the classic App Links failure, so I tested it rather than reading the code. With Play
App Signing on (the default) the **upload key** and the **Play signing key** are different
certificates and both must be listed.

Two fingerprints in `branding.json` render correctly:

```json
"sha256_cert_fingerprints": [
  "0A:0B:0C:...:29",
  "C8:C9:CA:...:E7"
]
```

Valid JSON, array length 2, and the "still empty" `_comment` is correctly dropped once
fingerprints exist. `verify.sh` then correctly **fails** until the file is redeployed.

The format check is uppercase, colon-separated, 32 bytes — enforced, and it matters: a lowercase
fingerprint is valid JSON and is then **silently ignored** by Android's verifier.

Current live state: the array is **empty**, so Android App Links are unverified and every
Android tap will open Chrome. This is correct — there is no Android signing key yet. Both the
generator and `verify.sh` warn loudly about it.

---

## 3. Identity inventory — what is really configurable

Re-grepped the whole tree for team id, bundle id and host. `check-branding.mjs` runs 10
assertions, including two negative ones (the team id appears in no source file; the host has
exactly one home in Swift).

**Three false or missing claims found in the runbook. All three are now fixed.**

1. **`server/lib/apple.js` `APPLE_AUDIENCE` was hardcoded with no runbook step.**
   `check-branding` assertion 5 catches drift, so the operator would have hit a red gate with no
   instruction telling them what to do. It is a trust boundary — it is the `aud` claim checked
   on every Apple identity token — so it stays a deliberate hand edit, but it is now **step 6**
   of `REBRAND.md`, with `server/check-api.js`'s `BUNDLE_ID` named alongside it.

2. **`ts.namespace` was listed as a rebrand knob. It is not one.** It is the Kotlin package `R`
   and `BuildConfig` generate into, hard-wired in three places Gradle cannot follow: every
   `package` line under `app/src/main/kotlin/...`, the directory tree, and the
   `import io.github.qwadratic.nfctimesheets.{R, BuildConfig}` statements in `net/Api.kt`,
   `ui/TimeSheetApp.kt` and `ui/TimeSheetViewModel.kt`. Changing it breaks the build with an
   unresolved reference. That is *loud*, so it is not dangerous — but the runbook told the
   operator to do it. It is **internal**: it never appears in Play, in the manifest, on a tag or
   in `assetlinks.json`, so it leaks no previous-operator identity. The visible name is
   `ts.applicationId`, and that one *is* configurable. Both `REBRAND.md` and `android/README.md`
   now say **leave it alone**.

3. **`ops/deploy.sh` header said "host defaults to timesheets.exe.xyz".** It no longer does — it
   reads `branding.json`. Comment corrected.

Everything else the runbook claims is configurable, is. The `project.pbxproj` hits are expected
and are covered by the manual click path.

---

## 4. Android ⟷ iOS tag parsing

Both parsers walked line by line, then **executed against the same 16-case corpus** — Swift
through the interpreter, Kotlin on a JVM.

Agreed already: https-only, host compared after `lowercase()`, userinfo trick rejected
(`https://timesheets.exe.xyz@evil.example.com/t` → host is `evil.example.com`), single trailing
slash accepted and `//` rejected, first `l=` wins, strict 8-4-4-4-12 UUID lowercased, slug
rejected, unhyphenated UUID rejected.

The Kotlin side deliberately uses a **strict regex** rather than `java.util.UUID.fromString`,
which accepts `1-1-1-1-1` — a lenient parser would queue rows the server answers 400 to, for
ever. Correct, and matches Swift's `UUID(uuidString:)`.

### One real divergence found — **fixed**

`URLDecoder` implements form encoding, where `+` **means space**. A URI query does not, and
Swift's `URLComponents` leaves `+` alone. So `?l=+<uuid>` decoded to `" <uuid>"`, trimmed clean,
and was **accepted on Android while iOS rejected it** — the leniency direction, putting a shift
on the wire off a tag the iPhone in the next stairwell refuses. Tags are unlocked
(decision-15), so this is a trust boundary.

One-line fix in `core/TagLink.kt`: escape `+` to `%2B` before decoding. Both cases added to
`android/checks/core-check.kt`. Re-ran the corpus — the two rows now agree.

### One divergence left, deliberately

A **raw non-breaking space** inside the URI: iOS accepts, Android rejects. The cause is
`java.net.URI` refusing a structurally illegal character, not the trim logic — I verified the
trim sets directly and they are effectively equivalent. Android is being *stricter* about a URI
that is malformed by spec, on a tag the admin panel cannot produce. Changing the URI parser
would be a redesign, not a fix. Left as is, documented here.

---

## 5. Android wire contract vs `server/routes/`

Checked field by field against `server/routes/app.js` and `server/routes/auth.js`.

| call | Android sends | server reads |
|---|---|---|
| `POST /shifts/open` | `client_uuid`, `location_uuid`, `start_time` | same three |
| `POST /shifts/close` | `client_uuid`, `end_time`, `auto_closed` | same three |
| `POST /shifts/:id/resolve` | `end_time` | same |

Responses: `Wire.shift` reads `id`, `worker_id`, `location_id`, `start_time`, `end_time`,
`auto_closed`, `corrected_at`, `client_uuid` — exactly the server's `SHIFT_FIELDS` — plus
`location_slug` / `location_name` on the joined queries. `/roster` returns `{worker, locations}`
and Android reads `locations` only. `/auth/session` returns `{worker:{id,name}}`. Extra server
fields are ignored, which is the right asymmetry.

**No `worker_id` in any request body or query** (decision-22) — the check asserts the serialised
body contains no `worker` substring. `X-App-Key` header present, `ts_worker` cookie carried.
`needsResolution` derived as `auto_closed && corrected_at == null`, matching decision-10. 409
`shift_already_open` treated as retryable.

**Zero new endpoints. Zero server change required.** The app key in
`android/branding.properties` **matches** the iOS one, so this will not 401 on that account.

---

## 6. Secrets — **PASS**

`gitleaks` on the working tree with the repo config: **no leaks** in `android/`, `ops/`,
`server/`, `NFCTimeSheets/`. The 6 hits under `web/` are all in `web/.next/`, which is
gitignored build output; the rest are in untracked scratch (`.gstack/`, `.firecrawl/`).

No keystore, `.jks`, `.p8`, `.p12` or password file is tracked. `android/.gitignore` covers
`keystore.properties`, `*.jks`, `*.keystore`, `local.properties`, and the check runner's
downloaded jar — verified with `git check-ignore -v`, not by reading the file.

`ts.appKey` is committed on purpose and is not a secret: it is compiled into the APK and
`strings` recovers it from any install. It proves "our app", never "this person".

---

## 7. Everything still passes

All run after the fixes:

```
gen-wellknown --check   OK      iOS tag-link-check      OK
check-branding          OK      iOS migration-check     OK
verify.sh (live)        OK      iOS scrub-check         OK
android core-check      OK      iOS tap-inbox-check     OK
server node --test      OK      iOS swiftc -typecheck   OK
web pnpm verify         OK      deploy.sh syntax        OK
                                pbxproj untouched       OK
```

`deploy.sh` is coherent: steps renumbered 0–7, gates before the build and before any rsync, the
native-addon guard intact, `--delete` still excluding `public/` and `ops/`. No dead nav — every
`PRIMARY_NAV` href has a page on disk. Server dependencies are still exactly `pg` +
`@sentry/node`.

---

## 8. What the owner does next for Android, with no Play account

In this order. Steps 1–2 need no account and no money.

1. **Open `android/` in Android Studio and let it Sync.** This is the first real test of the
   build — the Gradle files, the manifest and everything outside `core/` have **never been
   compiled** (§10). `gradle-wrapper.jar` is not committed; Android Studio regenerates it.
2. **Run the emulator App-Link probe in `android/README.md`.** It exercises parse → clock-in
   without a tag and without NFC. Expect App Links to report **unverified** — that is correct
   and expected until step 5.
3. **Decide the identity question (§9).** Until it is decided the app has no sign-in and fails
   visibly by design, so nothing can be tested end to end past the sign-in screen.
4. **Pay the one-off 25 USD** for a Play developer account. Create the app, upload an AAB to
   **Internal testing**.
5. **Play Console → Release → Setup → App signing.** Copy **both** SHA-256 fingerprints — the
   *App signing key certificate* and the *Upload key certificate* — into
   `ops/branding.json`. Add your debug keystore's fingerprint too if you want
   `installDebug` builds to verify.

   > **Never take the Play signing fingerprint from `keytool`.** `keytool` only knows the key on
   > your machine. Play re-signs with a *different* certificate. This is the single most common
   > reason App Links stay unverified.

6. `node ops/gen-wellknown.mjs --write`, read the diff, `./ops/deploy.sh`.
7. On a physical device: `adb shell pm get-app-links io.github.qwadratic.NFCTimeSheets`. It must
   say **`verified`**. Anything else and every tap opens Chrome.
8. **Tap a real tag on a real Android phone.** Nothing before this proves the product works.

Note: `applicationId` is **immutable once uploaded to Play**. `assetlinks.json` already publishes
`io.github.qwadratic.NFCTimeSheets` and the Gradle file is deliberately marked "do not tidy the
case" — the mixed case is intentional and must not be lowercased.

---

## 9. The decision the owner must make: Android worker identity

**This is blocking.** The Android app ships with no sign-in. `UnconfiguredAuthProvider` throws
and the screen states plainly that no sign-in method is configured — there is no button and no
fake "we'll sync later". That is the right default: an app that looks friendly while filing
nothing is unpaid work nobody notices for a month.

The code references **`decision-26`** in six places. **That decision record does not exist** —
it was described in the plan but never filed. It needs writing once the owner chooses.

iOS uses Sign in with Apple (decision-22). Android cannot, without cost. Three options:

| | mechanism | server cost | the catch |
|---|---|---|---|
| **A** | Sign in with Apple web flow | Services ID, `.p8` key, new route pair; `APPLE_AUDIENCE` becomes a **set** | **Android workers are on Android because they have no iPhone.** Requires an Apple ID with 2FA — an onboarding wall in front of the first Android worker. Also introduces the system's **first expiring secret** (≤6 months); when it lapses every Android sign-in stops with no warning |
| **B** | add Google as a second provider | `server/lib/google.js` (~80 lines, no new deps), `POST /auth/google`, three OAuth client ids registered per signing certificate | **Account linking breaks.** Apple may return `x@privaterelay.appleid.com`; Google returns the real address. Email is the only join key and in that case it **does not join**. Needs a `worker_identities` table, the UNIQUE moved off `workers.email`, and an admin UI for N addresses per worker. Auto-linking by bare email must be forbidden or two people's payroll silently merges |
| **C** | admin-issued one-time enrolment code | one table, one worker route, one admin route. **Zero new deps, zero new provider, zero new secret, zero change to `workers` or any `/shifts/*` route.** Deletable in one migration | A live code is a bearer token sitting in a WhatsApp message for ~15 minutes |

### Recommendation: **C now, B as the named upgrade path.**

C satisfies decision-22 exactly — decision-22's operative property is *"the server decides who
the caller is; the client never names a worker"*, and an enrolment code is a server-issued,
server-revocable credential with eligibility still coming from the `workers` row.

Its weakness stated without spin: an intercepted code within its TTL yields a 90-day session as
that worker. That is **strictly narrower** than the hole decision-22 closed (anyone with the app
key could file hours as anyone, forever), but it *is* weaker than proving possession of an Apple
ID. Mitigations already available: one-time use, short TTL, the existing rate limiter,
`redeemed_at` visible to the admin, and `DELETE /admin/workers/:id` already revokes every
session.

And the honest comparison: the Sign in with Apple bootstrap **already** terminates in a worker
reading an address off a screen to their manager over the phone. The trust chain is already
anchored in a human recognising a voice. C makes that explicit instead of dressing it up.

Whichever option wins, it is **one implementation of `AuthProvider` and one call in the sign-in
screen**. Nothing else in the app changes — the seam was built for exactly this.

---

## 10. What is unproven, and why

Led by the things that can hurt.

**Nothing about NFC on Android is proven, and I cannot prove it.** There is no NFC on any
emulator. A physical device is mandatory.

1. **App Links verification.** `assetlinks.json` currently has an empty fingerprint array, so
   verification **will fail and every tap will open Chrome** until the Play fingerprints land.
   `verify.sh` prints `adb shell pm get-app-links` rather than pretending it covered it.
2. **The Android app has never been compiled.** No Gradle, no Android SDK, no JDK-hosted Android
   build on this machine. Everything under `data/`, `net/`, `nfc/`, `ui/`, plus `MainActivity`,
   `NfcTapActivity`, the manifest and `build.gradle.kts` are **unbuilt**. Dependency versions
   were read from live `maven-metadata.xml` so each *exists*; the *combination* is unverified.
   First `Sync Project` is the first real test.
   Only `core/` (`TagLink`, `Wire`, `ApiFailure`, `TapInbox`, `SyncPlan`) is compiled and
   executed — which is why it has zero Android imports. I re-ran that check myself: `OK`.
3. **`android/checks/run.sh` is not reproducible out of the box.** It needs `kotlinc` and a JDK
   17+. On this machine `kotlinc` was only in `/private/tmp/kotlinc` (ephemeral — a reboot
   removes it) and the JDK is keg-only at `/opt/homebrew/opt/openjdk@17`, not on `PATH`.
   I ran it as: `JAVA_HOME=/opt/homebrew/opt/openjdk@17 PATH=/private/tmp/kotlinc/bin:$JAVA_HOME/bin:$PATH ./checks/run.sh`.
   Expect `exit 127` otherwise.
4. **The Android 17 `DISPATCH_NFC_MESSAGE` permission** is commented out on `NfcTapActivity`,
   correctly: `android:permission` restricts who may *start* an activity, and on Android ≤16
   that permission does not exist, so nobody holds it and the activity would be unstartable on
   exactly the devices the NDEF filter exists for. It goes in when `targetSdk` passes 36, on
   that activity only. The check enforces that it stays commented until then. **Untested on
   any real Android 16 or 17 device.**
5. **`isTagIntentAllowed()`** (the Android 16 allowlist) is handled in `NfcReadiness.kt` with a
   settings deep-link. Unexercised.
6. **NFC is not dispatched to apps in the stopped state.** Handled by design (the app must be
   launched once after install). Unverified on hardware.
7. **`gradle-wrapper.jar` is not committed** — a binary that cannot be produced here. Android
   Studio regenerates it.
8. **`server/check-api.js`** was not run; it requires a live Postgres and CREATEs/DROPs schemas.
   `node --test` (the well-known route tests) passes.
9. **Sign-in end to end** cannot be tested on either platform until §9 is decided.

What *is* proven: the live association files are byte-identical to the reviewed ones right now;
every gate fails when it should; the two tag parsers agree on 15 of 16 corpus cases with the
16th documented; the Android wire contract matches the server field for field; and the iOS app
is unchanged in behaviour, bundle id, team and host.
