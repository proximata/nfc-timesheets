# Shipping this under your own signing identity

Operator runbook. Both platforms, end to end. Follow it in order.

---

## READ THIS FIRST: THERE ARE TWO HOSTS

They used to be one value, and that is how a tag died. The VM was renamed
`timesheets` → `schimmer-glanz`; the server moved in one command; the card already written
and handed to a client kept pointing at a hostname that no longer existed. Nothing errored.
The tag simply stopped working (decision-40).

| | `tagHost` | `apiHost` |
|---|---|---|
| today | `timesheets.exe.xyz` | `schimmer-glanz.exe.xyz` |
| serves | `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`, `/t` — and **nothing else** | admin panel, REST API, Postgres |
| written onto | **physical NFC cards, on walls** | nothing |
| **may it be renamed?** | **NO. NEVER.** | **Yes, freely, from a keyboard.** |
| cost of moving it | a site visit **per building**, rewriting every tag by hand | a redeploy |
| deployed by | `ops/tag-host/deploy.sh` | `ops/deploy.sh` |

The app **parses** the tag host and **talks to** the API host. Those are different jobs and
they are now different values.

> **The tag host is chosen once, at zero tags.**
>
> Every NFC tag carries `https://<tagHost>/t?l=<location uuid>`. The host is written into the
> physical tag. Changing it after tags are on walls means **walking to every building and
> rewriting every tag by hand** — tags are left unlocked precisely so that is possible
> (decision-15), but it is a site visit per building, not a deploy.
>
> Pick your tag host before you write your first tag. Everything else in this document is
> reversible from a keyboard. This is not.

> **An exe.dev name is not owned by the company.** `timesheets.exe.xyz` is permanent by
> *policy*, not by contract — it lives in somebody else's namespace. A domain the company
> actually owns is the right long-term answer, and moving to one is still a site visit per
> building. This split is the cheap version: it removes the reason a rename would ever be
> wanted.

### If the tag host ever does have to move

All of these change **together**, and tags are rewritten by hand afterwards. Anything left
behind is a silent dead tap, never an error:

| File | What it holds |
|---|---|
| `ops/branding.json` | `tagHost` — the source of truth |
| `android/branding.properties` | `ts.tagHost` |
| `web/lib/tag.ts` | the default the admin panel prints onto tags |
| `NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements` | `applinks:` literal (hand-edited; see step 4) |
| `NFCTimeSheets/Branding.xcconfig` | `TS_TAG_HOST` |
| `NFCTimeSheets/NFCTimeSheets/Branding.swift` | `defaultTagHost` |
| `ops/tag-host/nginx.conf` | the box that serves the three files |
| exe.dev | the VM name, and `share set-public` on the new one |

Gates: `node ops/check-branding.mjs`, `android/checks/run.sh` (it pins the URI physically on
the HOIV card), and `./server/wellknown/verify.sh`.

Second thing, and it is the failure mode this whole surface exists to prevent:

> **A wrong association file does not error. It just stops working.**
>
> If `/.well-known/apple-app-site-association` does not name your app, iOS silently opens
> Safari instead of the app. If `assetlinks.json` does not carry your signing certificate's
> fingerprint, Android silently opens Chrome. No crash, no log, no red build. A worker
> stands at a door and cannot clock in. **Verify before you write tags, every time.**

---

## The one file you edit

`ops/branding.json`. It is the source of truth for operator identity and nothing else in the
repo is allowed to disagree with it:

| Field | What it is |
|---|---|
| `tagHost` | **permanent.** Written onto tags; serves the association files and `/t` |
| `apiHost` | **renameable.** Admin panel, API, database |
| `appName` | home-screen name on both platforms |
| `apple.teamId` | your 10-character Apple Developer Team ID |
| `apple.bundleIds` | **array, append-only** — see the handover note below |
| `apple.paths` | AASA path patterns; `/t*` is the whole tag surface |
| `android.packageName` | Play `applicationId`. **Immutable after the first Play upload.** |
| `android.sha256CertFingerprints` | **plural** — see step 8 |

Two gates read it and both are wired into `ops/deploy.sh` step 0:

```
node ops/gen-wellknown.mjs      # committed association files == branding.json?
node ops/check-branding.mjs     # everything else == branding.json?
```

**Handover, not replacement.** Apple caches AASA and an installed app holds its association
until it is reinstalled. Deleting an appID from AASA breaks every phone that already has the
old app, and you cannot uninstall it from a worker's phone. So a handover **appends** your
bundle id to `apple.bundleIds` and keeps the previous one until the old app is dead. The
generator refuses to drop a published appID unless you pass `--allow-removal`.

---

## Steps

### 1. Edit `ops/branding.json`

Set `tagHost`, `apiHost`, `appName`, `apple.teamId`, and append your bundle id / set your
`android.packageName`. Leave `sha256CertFingerprints` empty for now — step 8 fills it.

If you genuinely run one box for both jobs, set them to the same value **and** add
`"singleHost": true` — `check-branding` refuses the coupling until you say so out loud,
because two fields that quietly happen to be equal is exactly what the split undid.

Then provision and deploy the tag host, which is its own box and is not touched by
`ops/deploy.sh`:

```
ssh exe.dev "new --name=<your tag host name>"
ssh exe.dev "share set-public <your tag host name>"    # MANDATORY - see below
./ops/tag-host/deploy.sh
```

> **The tag host's HTTP proxy must be PUBLIC.** exe.dev proxies are private by default and
> answer an unauthenticated request with `401` and a redirect to a login page. Android and
> iOS fetch the association files with no credentials and no cookie jar: a private proxy
> means App Links and universal links **silently never verify**, on every phone, forever.
> `./server/wellknown/verify.sh` catches it (`status 401`, `2 redirect hops`).

### 2. Regenerate and review the association files

```
node ops/gen-wellknown.mjs --write
git diff server/wellknown/
```

**Read that diff.** These are the exact bytes that will be served to every phone. They are
committed rather than generated at deploy time for exactly this reason: a human sees them
before they reach a wall.

### 3. Attach `NFCTimeSheets/Branding.xcconfig` in Xcode

The xcconfig exists but is **not referenced by the project**, so it currently changes
nothing. `project.pbxproj` is hand-edited by the owner and never by tooling, so this is a
click path, not a script:

1. Xcode → Project navigator → select the **project** `NFCTimeSheets` (blue icon, top row).
2. **Info** tab → **Configurations** → expand **Debug** → the row named `NFCTimeSheets`
   (the *project* row, not the target rows below it) → the **"Based on Configuration File"**
   dropdown on the right → choose **Branding**.
3. Repeat for **Release**.
4. **Build Settings** tab → select the **target** `NFCTimeSheets` → search
   `PRODUCT_BUNDLE_IDENTIFIER` → click the row → press **Delete**.
   The row turns grey/italic and shows the value inherited from the xcconfig.
   **This step is mandatory**: the setting is currently defined at *target* level, and target
   level beats a project-level xcconfig. Without it the xcconfig is silently ignored for
   this one setting.
5. Repeat step 4 for `DEVELOPMENT_TEAM`.
6. Repeat steps 4–5 for the `NFCTimeSheetsTests` and `NFCTimeSheetsUITests` targets. Their
   bundle ids must move too, or signing fails under a different team.

Then edit `NFCTimeSheets/Branding.xcconfig` so `TS_TEAM_ID`, `TS_BUNDLE_ID`, `TS_APP_NAME`
and `TS_TAG_HOST` match `ops/branding.json`, and edit the two fallbacks in
`NFCTimeSheets/NFCTimeSheets/Branding.swift` (`defaultTagHost`, `defaultBundleId`) to match
as well — those are what an unconfigured build uses. `node ops/check-branding.mjs` fails if
any of them drift.

### 4. Edit the Associated Domains entitlement BY HAND

`NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements`, line 16:

```xml
<string>applinks:YOUR-HOST</string>
```

**This one cannot be driven from the xcconfig, and pretending otherwise would be worse than
leaving it manual.** `applinks:$(TS_TAG_HOST)` does substitute — but an *undefined* Xcode
build setting expands to the **empty string**, so any build without the xcconfig attached
would produce `applinks:` and kill universal links on the next build, with a green build and
no error. So the entitlement holds a literal and `ops/check-branding.mjs` asserts it equals
`branding.host`.

### 5. Point the SERVER at your bundle id

`server/lib/apple.js`:

```js
export const APPLE_AUDIENCE = "io.github.qwadratic.NFCTimeSheets";
```

This is the `aud` claim the server checks on every Apple identity token. It is **not**
driven by `branding.json` — it is a trust boundary and a silent default here would mean
accepting tokens minted for somebody else's app. Set it to **your** bundle id by hand.
`ops/check-branding.mjs` fails if it is not one of `apple.bundleIds`.

`server/check-api.js`'s `BUNDLE_ID` is the same value in the integration suite; change it
too or `pnpm --dir server check` fails against a real database.

### 6. Apple Developer portal — manual, per operator

None of this can be automated from the repo:

- Register the App ID for your bundle id under your team.
- Enable the **Associated Domains** capability on it.
- Enable **Sign in with Apple** on it (worker identity, decision-22).
- Create/refresh the provisioning profile (automatic signing handles this once the team is set).
- Create the App Store Connect record for TestFlight.

### 7. Rotate the app key

`API.swift`'s `appKey` and `/etc/nfc/env`'s `APP_KEY` must hold the **same** value, and it
must be yours, not the previous operator's. It is not a secret (it is compiled into the
binary — `strings` on any IPA recovers it) and it carries no authority on its own since
decision-22; it is a coarse gate against internet noise. Change it in
`NFCTimeSheets/NFCTimeSheets/Branding.swift`, in `android/branding.properties`
(`ts.appKey`), and in `/etc/nfc/env` **together** — an old build stops working the moment
the server flips.

### 8. Android: `android/branding.properties`

Set `ts.applicationId`, `ts.appName`, `ts.tagHost`, `ts.apiHost` to match
`ops/branding.json`, and `ts.appKey` to the value from step 7.

`ts.tagHost` is the manifest `${tagHost}` placeholder **and** `BuildConfig.TAG_HOST`, which
is what `TagLink` parses — and the ONLY host it accepts (decision-40's amendment removed the
earlier legacy-host parser widening). `ts.apiHost` is `BuildConfig.API_HOST`, which is the
only thing `Api.kt` ever calls, and it must **never** appear in an `autoVerify` intent-filter:
App Link verification is all-or-nothing across the hosts in a filter, so one host that stops
serving `assetlinks.json` un-verifies the app for the *other* host too. There is no fallback
for a card written under an OLD `ts.tagHost` any more — changing it strands every card
already on a wall until each is physically rewritten. Do not change it lightly.

**Leave `ts.namespace` alone.** It is the Kotlin package that `R` and `BuildConfig` are
generated into, and it is hard-wired in three places tooling cannot follow: the `package`
line of every file under `app/src/main/kotlin/...`, the directory tree itself, and the
`import io.github.qwadratic.nfctimesheets.{R, BuildConfig}` statements in `Api.kt`,
`TimeSheetApp.kt` and `TimeSheetViewModel.kt`. Changing it breaks the build with an
unresolved-reference error. It is **internal** — it never appears in Play, in the manifest,
on a tag or in `assetlinks.json`, so it does not carry the previous operator's identity in
any way a user or Google can see. `applicationId` is the name that matters, and that one
*is* configurable. Renaming the package is a find-and-replace across `android/`, plus
`git mv` on the directory tree, and it is optional cosmetics — do it separately, never as
part of a rebrand you are about to ship.

Signing credentials go in `android/keystore.properties`, which is **gitignored** — never
commit a keystore or a password. With no keystore present the build falls back to debug
signing, which Play refuses: a loud failure, on purpose.

`applicationId` is **immutable once uploaded to Play**. Get it right before step 9.

### 9. Android: the fingerprints, and the trap that eats a day

Upload your first AAB to Play → **Internal testing**. Then:

**Play Console → Release → Setup → App signing.** Copy **both** SHA-256 certificate
fingerprints shown there:

- the **App signing key certificate** — this is the one on users' devices;
- the **Upload key certificate** — different from the above whenever Play App Signing is on,
  which is the default.

Both go in `android.sha256CertFingerprints`. Add your local debug keystore's fingerprint too
if you want `./gradlew installDebug` builds to verify:

```
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android
```

> **Never take the Play signing fingerprint from `keytool`.** `keytool` only ever knows the
> key on your machine. With Play App Signing on, Google re-signs your app with a *different*
> certificate, and a locally computed fingerprint will not match what the device checks.
> This is the single most common reason App Links stay unverified.

Format is enforced by the generator: **uppercase, colon-separated, 32 bytes**
(`AB:CD:...`). A lowercase fingerprint is valid JSON and is then **silently ignored** by
Android — which is exactly the failure class this whole surface exists to stop.

Then regenerate and redeploy:

```
node ops/gen-wellknown.mjs --write
git diff server/wellknown/assetlinks.json
./ops/deploy.sh
```

### 10. Serve it from your TAG host

`ops/deploy.sh` pushes `server/wellknown/` to the VM and restarts the unit. Requirements the
server already satisfies and that you must not break if you put anything in front of it:

- `/.well-known/apple-app-site-association` — **no `.json` extension**, on the filename or
  the URL.
- `Content-Type: application/json`, exactly. Not `text/plain`, not with a charset.
- **HTTP 200 with zero redirect hops.** iOS does not follow a redirect here.
- Same host as the tag URI. Not a CDN alias, not a `www.` variant.

### 11. VERIFY, BEFORE WRITING ANY TAG

```
./server/wellknown/verify.sh                                   # the TAG host (the default)
./server/wellknown/verify.sh <apiHost> --host-override         # the API host serves them too
```

It asserts status, exact content-type and zero redirects on both files; that the **live
bytes are identical** to the reviewed files in `server/wellknown/`; that the host being
probed is the configured one; and that the committed files still match `branding.json`. It
prints `VERIFY OK - safe to write NFC tags.` or exits non-zero.

`ops/deploy.sh` runs it as the last step and treats a failure as a failed deploy. Do not
route around it.

iOS-specific verification, after a build:

```
# 1. the entitlement that actually shipped
codesign -d --entitlements - --xml \
  ~/Library/Developer/Xcode/DerivedData/NFCTimeSheets-*/Build/Products/Debug-iphoneos/NFCTimeSheets.app \
  | plutil -p -
# must show applinks:<your host> — NOT "applinks:" and NOT the previous operator's host

# 2. what the app will actually parse
cd NFCTimeSheets
cat NFCTimeSheets/Branding.swift NFCTimeSheets/TagLink.swift NFCTimeSheets/API.swift \
    checks/tag-link-check.swift > /tmp/c.swift && swift /tmp/c.swift
```

Android-specific verification — **only provable on a physical device**:

```
adb shell pm get-app-links <your applicationId>
```

It must report `<your host>: verified`. Anything else and every tap opens Chrome.
`verify.sh` prints this command for you once fingerprints are configured; it cannot run it.

### 12. Then, and only then, write a tag

Admin panel → Locations → the tag URI shown there. It is built from
`NEXT_PUBLIC_TAG_BASE_URL`, whose default is `https://<branding.tagHost>` — **not** the host
the admin panel is being served from. Writing the host you happen to be looking at is the
mistake decision-40 removes.

Tap the first tag with a real phone before writing the rest. NFC does not work on any
emulator or simulator, so this step cannot be automated and cannot be skipped.

---

## Checklist

- [ ] **Tag host** chosen, and **no tags written yet** — and it is NOT the API host
- [ ] Tag-host VM provisioned, `share set-public` run, `./ops/tag-host/deploy.sh` green
- [ ] `ops/branding.json` edited (`tagHost` + `apiHost`); bundle id **appended**, not replaced
- [ ] `node ops/gen-wellknown.mjs --write`, diff **read**, committed
- [ ] `Branding.xcconfig` attached to Debug + Release; target-level `PRODUCT_BUNDLE_IDENTIFIER`
      and `DEVELOPMENT_TEAM` rows **deleted** on all three targets
- [ ] `NFCTimeSheets.entitlements` `applinks:` edited by hand
- [ ] `Branding.swift` fallbacks updated
- [ ] `server/lib/apple.js` `APPLE_AUDIENCE` **and** `server/check-api.js` `BUNDLE_ID` set to your bundle id
- [ ] App ID registered; Associated Domains + Sign in with Apple enabled
- [ ] App key rotated in Swift, Android and `/etc/nfc/env` **together**
- [ ] `android/branding.properties` set — `ts.tagHost` **and** `ts.apiHost` (**`ts.namespace` left alone**); keystore in gitignored `keystore.properties`
- [ ] AAB uploaded to Play internal testing; **both** fingerprints copied from Play Console
- [ ] `node ops/check-branding.mjs` — OK
- [ ] `./ops/deploy.sh` — green, including step 7/7
- [ ] `./server/wellknown/verify.sh` — `VERIFY OK` on the **tag** host
- [ ] `codesign -d --entitlements -` shows your host
- [ ] `adb shell pm get-app-links` reports `verified`
- [ ] **One** tag written, tapped on a real iPhone and a real Android phone, shift appears
- [ ] Remaining tags written
