# Re-recording the demo

Every clip and screenshot in `docs/media/` is produced by the scripts in `demo/`, against a
**local** database seeded with invented data. Run the commands below and you get the same
files. Change a screen, re-run the one script, commit the new file.

**Written 2026-08-03, rewritten 2026-08-04** when the iOS journey turned out to be perfectly
recordable after all. §4 has what each of the three supposed blockers actually was, measured.
§5 is the side-by-side. What genuinely cannot be filmed is at the bottom — read that before you
conclude something is broken.

---

## Re-record: the exact command for every artefact

One row per file in `docs/media/`. Every command assumes §1 has been done once on this
machine and is run **from the repo root**. `«stack»` is the two commands in §1 that start
the demo API — reproduced here so no row is a fragment:

```sh
# «stack» — needed by every row except demo-write-tag.mp4
psql -q -d nfc_demo -f demo/seed.sql
DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs
cd server && DATABASE_URL=postgres:///nfc_demo \
  APP_KEY=tsk_9880d49f83794967790deb8a2c8f3dd46633cc78104c2f65 \
  PORT=8082 PUBLIC_DIR=../web/out node server.js &
cd ..
```

| Artefact | Exact command | Needs | Time |
|---|---|---|---|
| `admin-walkthrough.mp4` + the 11 `admin-*.png` | «stack» then `node demo/record-admin.mjs` | Chrome | ~3 min |
| `ios-journey.mp4` + `ios-signin/shift/badge/closed.png` | «stack» then `sh demo/ios-setup.sh` then `node demo/record-ios.mjs` | Xcode, booted simulator | ~2 min |
| `android-journey.mp4` + `android-signin/shift/notification/closed.png` | «stack» then `node demo/tls-front.mjs &` then `sh demo/android-setup.sh` then `node demo/record-android.mjs` | `JAVA_HOME`, `ANDROID_HOME`, running emulator | ~3 min |
| `both-devices.mp4` + `before-ios-shift.png` | «stack» then `node demo/record-ios.mjs && node demo/record-android.mjs && node demo/compose-devices.mjs` | both of the above | ~6 min |
| `before-android-shift.png` | *not re-recordable* — the 3 August build, kept as a historical "before". Re-shooting it against today's build would produce an "after" and destroy the comparison. | — | — |
| `demo-write-tag.mp4` | *not re-recordable by script* — a real phone writing a real tag with NFC Tools, filmed by hand. Re-shoot only with a redaction pass over the URL field. | a real phone + blank tag | — |

**`compose-devices.mjs` re-cuts without re-recording.** It reads `/tmp/ts-demo/ios-raw.mov`,
`android-raw.mp4` and the two `*-stages.json`. If those survive from the last run — they are
not deleted on exit — a caption or layout fix costs ~16 s and no device time. Only if they
are gone do you need the two recorders again.

The Android toolchain wants both of these exported, and `~/Library/Android/sdk` is *not* the
right answer on this machine:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
```

---

## The rules these scripts enforce, so you do not have to remember them

- **Never the live server.** `record-admin.mjs`, `record-android.mjs` and `tls-front.mjs`
  each refuse to run against anything that is not a loopback address, and say so.
- **Never the live database.** `demo/seed.sql` `TRUNCATE`s, so it opens by refusing to run
  on any database not named `nfc_demo`. `demo/make-admin.mjs` has the same guard.
- **No real person.** Every worker, client, contact, email and price in the seed is
  invented. The Vienna streets are real (geocoding needs something to chew on); the
  buildings on them are not. Worker phone numbers are left empty rather than made up — an
  invented Austrian mobile number in a public repo is somebody's real number.
- **Nothing outside the app in frame.** The admin capture is headless Chrome, which has no
  window chrome, no tab strip and no desktop. The Android capture is `screenrecord`, which
  records the emulator's framebuffer and nothing else, and the app is brought to the front
  **before** the recorder starts so the launcher never appears. The Mac's screen is never
  captured by anything here.
- **A mocked tap says so on screen.** The Android captions are burned into the frames, not
  written in this file, because a video travels away from the text that came with it.

---

## 1. The local stack

Once per machine. Postgres 16+ and Node 22+; nothing else is installed.

```sh
cd <repo root>

createdb nfc_demo
DATABASE_URL=postgres:///nfc_demo node server/db/migrate.js
psql -d nfc_demo -v ON_ERROR_STOP=1 -f demo/seed.sql
DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs
#   -> demo admin ready: demo@example.test / demo-nur-lokal-2026
```

That password is fixed, published and worthless. It exists so a recording can type it on
camera. `server/bin/create-admin.js` still refuses a non-tty password and that refusal
stays — see the header of `demo/make-admin.mjs` for why the exception is bought rather
than taken.

Build the panel and serve it from the API, same origin, exactly as production does:

```sh
cd web && NEXT_PUBLIC_API_BASE_URL="" NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build && cd ..

cd server && DATABASE_URL=postgres:///nfc_demo \
  APP_KEY=tsk_9880d49f83794967790deb8a2c8f3dd46633cc78104c2f65 \
  PORT=8082 PUBLIC_DIR=../web/out node server.js &
cd ..
```

Two notes on those two lines:

- **`APP_KEY` is the value in `android/branding.properties` and `API.swift`**, on purpose.
  It is committed in cleartext there and is not a secret (it is compiled into every APK).
  Using it means the shipping app binaries talk to the demo server with **no rebuild and no
  edit** — which is the only reason the Android clip is of the real app.
- **Port 8082, not 8080.** Nothing sacred about it; 8080 was taken on the machine this was
  written on. If you change it, change `DEMO_BASE` / `DEMO_API` and `tls-front.mjs`'s
  `--upstream` with it.

Re-seeding is safe and idempotent-by-truncation: `psql -d nfc_demo -f demo/seed.sql` again
gives the same screens rather than four more months of shifts.

### What the seed contains

6 workers (5 active), 3 clients, 4 contacts, 6 buildings, 9 inventory items, 4 months of
shifts (~340), 8 material requests across every status, and contract history including one
real price change 45 days ago.

Three things in it are deliberate and are what make the screens worth looking at:

| In the data | On screen |
|---|---|
| One shift running right now | *Gerade im Einsatz* on the dashboard |
| Two auto-closed shifts nobody has resolved | excluded from pay, and reported per building (decision-10) |
| One building with no contract and no coordinates | *Kein Vertrag hinterlegt*, and a row in the table under the map |
| One material request nobody has priced | counted separately, never as zero |
| Contract prices derived from the hours actually worked | margins of 19 / 15 / 9 / 3 / **−6** % instead of an invented 40 % |

That last row matters. Prices are **not** typed into the seed; `demo/seed.sql` measures the
payable labour of the previous calendar month per building and prices each one at a chosen
margin, rounded to whole tens of euro. Typed-in prices produced a first draft where every
building ran at 40–70 %, which nobody in this trade would believe.

---

## 2. The admin panel

```sh
node demo/record-admin.mjs
```

Writes `docs/media/admin-walkthrough.mp4` and eleven PNGs. About three minutes.

**It covers every screen in the sidebar and the run FAILS if it does not.** The list is not
kept in anybody's head: the recorder reads `PRIMARY_NAV` out of `web/lib/nav.ts` and refuses to
finish if the walkthrough never opened one of those paths. The cut before this one silently
skipped `/payroll/`, `/clients/` and `/inventory/` — payroll being, on a product that exists to
pay people, the screen that matters most.

**Re-seed first if you want the same video.** The walkthrough types `12` into *Zielmarge*
and approves one material request, so a second run without a re-seed opens on a screen that
is already graded:

```sh
psql -q -d nfc_demo -f demo/seed.sql && DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs
node demo/record-admin.mjs
```

It drives real Chrome over the DevTools Protocol (`demo/cdp.mjs`, no Puppeteer, no
Playwright, no dependency). Frames are captured with `Page.startScreencast` and handed to
ffmpeg with **real** per-frame durations, so the playback speed is the speed it happened at.
Nothing is sped up, cut or annotated.

### The map is deliberately absent

`/analytics/` says, in German, *"Dieser Build enthält keinen Google-Maps-Schlüssel, daher
wird keine Karte gezeichnet"*, and the table underneath carries every building. **That is
what production does today** — `ops/deploy.sh` passes only `NEXT_PUBLIC_DEFAULT_LOCALE`, so
the deployed bundle has no key either (blocker 2 in `backlog/docs/V2-FEATURES.md`). The
recording shows the shipped behaviour rather than a nicer one.

To record it *with* a map, once that blocker is cleared:

```sh
cd web && NEXT_PUBLIC_API_BASE_URL="" NEXT_PUBLIC_DEFAULT_LOCALE=de \
  NEXT_PUBLIC_GOOGLE_MAPS_KEY="$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)" pnpm build
```

and serve on **`127.0.0.1:8080`** — the browser key is restricted by HTTP referrer and that
origin is on the allow-list while `127.0.0.1:8082` is not. Street View thumbnails will
still not appear: the Street View Static API is switched off on the Google account and
answers `REQUEST_DENIED` (blocker 3 in `V2-FEATURES.md`).

---

## 3. Android

The APK is the **shipping** debug build. `android/branding.properties` is not touched, so
`BuildConfig.TAG_HOST` is still `timesheets.exe.xyz` and the URL in the recording is the
real tag URL off the wall. Everything that redirects it to the demo server happens inside
the emulator.

### 3.1 A certificate, once

`Api.kt` builds its base URL as `https://${BuildConfig.TAG_HOST}` and that is correct — a
worker's hours must not travel in cleartext, and it is not being weakened for a recording.
So the demo needs real TLS under that name:

```sh
mkdir -p /tmp/ts-demo/tls && cd /tmp/ts-demo/tls

openssl req -x509 -newkey rsa:2048 -sha256 -days 30 -nodes \
  -keyout ca.key -out ca.pem \
  -subj "/CN=NFC TimeSheets DEMO CA/O=local demo only" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/CN=timesheets.exe.xyz"

printf 'subjectAltName=DNS:timesheets.exe.xyz,DNS:localhost,IP:127.0.0.1,IP:10.0.2.2\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' > ext.cnf

openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial \
  -out server.pem -days 30 -sha256 -extfile ext.cnf
```

The key never leaves `/tmp`. It is a 30-day throwaway and `*.pem` / `*.key` are gitignored
anyway.

### 3.2 The TLS front

```sh
node demo/tls-front.mjs                 # https :8443 -> http 127.0.0.1:8082
```

This is a **demo prop**, not part of the product. `server/server.js` has no TLS in it and
must not grow any: in production the exe.dev proxy terminates TLS (decision-16).

### 3.3 Emulator, SDK and build

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

emulator -avd ts-demo -no-snapshot -no-boot-anim -no-audio -memory 3072 -cores 4 &

cd android && ./gradlew :app:assembleDebug && cd ..
```

`ts-demo` is a Pixel 7 AVD on `system-images;android-36;google_apis;arm64-v8a` — see
`android/README.md § Emulator` for creating it. **`google_apis`, not
`google_apis_playstore`**: the Play image locks `/system` and the next step needs root.

### 3.4 Point the emulator at the demo server

```sh
sh demo/android-setup.sh
```

Installs the APK, forces `de-AT`, then does three things **inside the emulator only**:

1. `adb reverse tcp:443 tcp:8443` — binds port 443 **on the device**, where adbd is root,
   and forwards it to the Mac's 8443. This is why no `sudo` and no `/etc/hosts` edit is
   needed on the Mac.
2. bind-mounts a hosts file sending `timesheets.exe.xyz` to `127.0.0.1`.
3. bind-mounts the system CA store with the demo CA added — an app targeting API 24+
   ignores the *user* certificate store, so a user cert would achieve nothing.

Both mounts are made in **init's and zygote's** mount namespaces via `nsenter`, because apps
are forked from zygote and inherit its namespace; a mount made in the adb shell alone is
invisible to the app. Nothing survives an emulator restart — re-run the script after every
cold boot.

Verify:

```sh
adb shell cat /system/etc/hosts                              # timesheets.exe.xyz -> 127.0.0.1
adb shell ls /apex/com.android.conscrypt/cacerts | wc -l     # one more than stock
```

**If `system_server` starts crash-looping**, the host is starved, not the mounts: the
Android watchdog kills it after 63 s of a blocked main thread. Close some applications and
wait; `demo/android-setup.sh` waits for the package service rather than for
`sys.boot_completed`, which is what stops an install landing in that window.

### 3.5 Record

```sh
node demo/record-android.mjs
```

Writes `docs/media/android-journey.mp4` and four PNGs. About two and a half minutes. It mints
its own enrolment code through `POST /admin/workers/:id/enrolment-code`, clears the app so it is
a first launch, and burns the captions in with timings it measured rather than guessed.

**The emulator must be German, not just the app.** `demo/android-setup.sh` sets the app locale,
but the runtime notification permission alert is drawn by the *system* permission controller in
the *system* locale: on an `en-US` emulator its button says "Allow", the German tap missed, the
alert stayed up covering the app, and the next stage failed with `Material vanished` — a true
statement about a screen that was not the app. Set it once and reboot:

```sh
adb root && adb shell setprop persist.sys.locale de-AT && adb reboot
#   ... then re-run demo/android-setup.sh, because nothing it mounts survives a reboot
```

**The NFC tap is mocked and the video says so, twice, in white on black.** No emulator has
NFC hardware: `pm list features` lists no `android.hardware.nfc`, `NfcAdapter.getDefault
Adapter()` returns null, and the app's own screen says *"Dieses Telefon hat kein NFC"*. The
mock is `am start -a android.intent.action.VIEW -d <tag url>`, which is the same intent the
OS delivers after the radio reads a tag. Everything downstream is the real code path; the
radio is not exercised.

The intent is delivered with `-n <activity>` rather than by App Link resolution, because
**App Links do not verify**: `assetlinks.json` has an empty `sha256CertFingerprints` array
because no signing key exists yet, so on a real handset a tag opens Chrome. See
`android/README.md § App Links` and blocker 7 of `V2-FEATURES.md`.

---

## 4. iOS

**The verdict in the first draft of this file — "the journey could not be produced, three
blockers" — was wrong on two counts of three, and the third has a clean way round.** All of
it is now scripted. What follows is what each blocker actually was, measured.

### 4.1 Setup, once per simulator

```sh
sh demo/ios-setup.sh                       # CA, boot, trust, build, install  (~15 s)
sh demo/ios-setup.sh --allow-notifications <location-uuid>   # once; needs Simulator.app
sh demo/ios-setup.sh --prove-release       # no demo hook survives in Release
```

`--allow-notifications` is the one step that is not headless. The app-icon badge is the
out-of-app signal iOS delivers today, a badge needs notification authorization, and
`xcrun simctl privacy` has no `notifications` service — so the alert is answered through
Accessibility, by button description rather than by coordinates. The grant lives in
SpringBoard, not in the app container, so `demo/record-ios.mjs` wiping the container leaves
it intact and every recording after that one is headless.

### 4.2 Port 443: real, and irrelevant

`node -e 'require("net").createServer().listen(443,"127.0.0.1")'` really does fail with
`EACCES`, and a simulator has no `adb reverse` to lean on. But `API.base` is
`https://\(TagLink.host)`, `TagLink.host` is `Branding.tagHost`, and that reads the
`TSTagHost` Info.plist key — which Xcode substitutes from the `TS_TAG_HOST` **build
setting**. A build setting can be given on the xcodebuild command line, and **the value can
carry a port**:

```sh
xcodebuild ... -sdk iphonesimulator TS_TAG_HOST=127.0.0.1:8443 CODE_SIGNING_ALLOWED=NO build
/usr/libexec/PlistBuddy -c 'Print :TSTagHost' .../NFCTimeSheets.app/Info.plist
#   -> 127.0.0.1:8443          while Branding.xcconfig still says timesheets.exe.xyz
```

`Branding.xcconfig`, `Info.plist`, `project.pbxproj` and the entitlements are all untouched —
`git status` is clean after `ios-setup.sh`, and the script re-reads the built `Info.plist` and
refuses to install if the override did not land. No `sudo`, no `/etc/hosts` edit.

One consequence, stated because it is load-bearing: `TagLink.locationId` compares
`URLComponents.host` (no port) against `Branding.tagHost` (with port), so a build configured
this way **cannot parse a universal link at all**. That costs nothing, because of 4.4.

### 4.3 Sign in with Apple, with no Apple ID

`demo/demo-server.mjs` is `server/server.js` with exactly one thing swapped: where Apple's
public keys come from. It generates an RSA key per process, mints a real RS256 identity token
for an invented address in the seed, and hands its own JWKS to `setKeyFetcherForTest` — the
seam `server/check-api.js` already uses.

**Nothing in `server/lib/apple.js` changes**, and it was falsified rather than assumed:

| token | result |
|---|---|
| valid | `200` `{"worker":{"name":"Marta Nowak"}}` |
| tampered signature | `401 invalid_token` |
| replayed with the wrong nonce | `401 invalid_token` |
| `alg=none` downgrade | `401 invalid_token` |

A token minted here is worthless to the live server, which fetches Apple's real keys. The
process refuses to start unless the database is literally named `nfc_demo` and every host in
play is loopback.

### 4.4 The universal link: genuinely impossible, and what is done instead

This one is real, and it was established three ways rather than by trying twice:

```
xcodebuild -showBuildSettings   ->  ENTITLEMENTS_ALLOWED = NO  (iphonesimulator)
                                    ENTITLEMENTS_ALLOWED = YES (iphoneos)
forcing ENTITLEMENTS_ALLOWED=YES -> codesign -d --entitlements emits an EMPTY dict
swcutil dump, inside the sim     -> 0 applinks registrations
both apps terminated, openurl    -> MobileSafari woke. The app did not.
```

No entitlements means no `com.apple.developer.associated-domains`, which means iOS never
claims the link for this app. **That is a property of the simulator SDK, not of this app** —
the same tap works on a device and is what workers use daily.

So `NFCTimeSheets/DemoHooks.swift` injects the location id at the point the URL parse would
have produced it: through `TagLink.normalizedUUID`, the trust boundary that keeps anything not
UUID-shaped off the wire, into the same `TapInbox` that `onOpenURL` and
`onContinueUserActivity` feed. Every line after the parse is the shipping code.

**The whole file is inside `#if DEBUG`**, it arms only when the launch argument is present
**and** `API.base` is loopback, and it pins a yellow *"DEMO BUILD · NFC is MOCKED"* band to the
top of the window for as long as it is armed. `sh demo/ios-setup.sh --prove-release` proves a
Release build carries none of it:

```
RELEASE bundle: 8 files,  0 demo markers, no dylib
DEBUG   bundle: 10 files, 4 markers — all inside NFCTimeSheets.debug.dylib
```

That last line is why the check greps **every file** in the `.app`. Grepping only the main
executable returns 0 on the Debug build too, which is a false pass.

### 4.5 Record

```sh
node demo/record-ios.mjs
```

Writes `docs/media/ios-journey.mp4` and four PNGs. About two minutes. It wipes the app's data
container rather than uninstalling — the notification grant belongs to SpringBoard and an
uninstall would throw it away and put a permission alert in the middle of the take.

Two things it does that are not obvious:

- **It launches with `-AppleLanguages "(de-AT)"`.** The product ships German (decision-8) and
  the emulator is forced to German too. Without it the iOS pane read *Log / Materials /
  History / Settings* under a shared caption promising *"Verlauf is gone from the tab bar"* —
  a side-by-side whose two halves were not the same product.
- **It refuses to start if the demo worker already has an open shift.** The server is
  authoritative for open shifts (decision-19), so a leftover from a run that died mid-journey
  turns the first tap of the next run into a clock-*out*, and the takeover screen the clip
  exists to show never appears. That cost a take on the Android side before the check existed.

### 4.6 One bug this recording found, which is not a demo bug

On a **fresh install** the app shows *"Your session ended. Sign in again."* in red.
`Session.restore()` calls `GET /auth/session` unconditionally; with no cookie that is a 401;
the `.sessionRejected` observer sets `signedOut(reason:)` on a state that was `.unknown` a
moment earlier (`Auth.swift:240`). It is reachable on a real phone, and the string is hardcoded
English in a German-default product. **The recording shows it and says so on screen** rather
than editing around it.

---

## 5. Both devices, side by side

```sh
node demo/record-ios.mjs && node demo/record-android.mjs && node demo/compose-devices.mjs
```

Writes `docs/media/both-devices.mp4`. Both recorders walk the **same stages** from
`demo/journey.mjs`, in the same order, with the same minimum durations, and each writes the
boundaries it actually hit to `/tmp/ts-demo/<platform>-stages.json`. The composer aligns on
those boundaries.

**The only edit, stated:** where one device finished a stage sooner, its last frame is held
(`tpad=stop_mode=clone`) until the other catches up. Nothing is sped up, slowed down, cut or
reordered, and a held frame is visible as a still picture.

Side by side rather than sequential because the differences are the interesting part — Sign in
with Apple against an admin-issued enrolment code (decision-26), an icon badge against a
lock-screen notification. Sequentially those are two minutes apart and nobody holds them in
their head. Judged by looking at the output at 100%: at 400 px per device the German labels,
the running clock and both tab bars are legible.

### The before / after cards

The film opens on two cards, each two real screenshots of two real builds in the same two
panes as the journey. The Android "before" is `docs/media/before-android-shift.png`, produced
by this same recorder against this same seed on 3 August.

The iOS "before" is `docs/media/app-shift.png` **as it stood at commit 33e66b2** — the build of
30 July, and the only honest photograph of the iPhone app before the takeover shipped. That
file was deleted from the tree because every row in it is labelled with the operator's **real
client**. `demo/compose-devices.mjs` recovers it from the object store, paints the four name
rows out, and then **decodes the written PNG back to grey and refuses to continue unless every
box is a single flat value**. A mask that is trusted rather than checked is how a name ships.

> **The deletion did not remove that name from this repository.** The blob is still reachable
> at `git show 33e66b2:docs/media/app-shift.png` and will stay reachable to anyone who clones,
> until somebody rewrites history and force-pushes. That is the owner's call to make; it is
> recorded here so it is not forgotten.

## What nothing here can do at all

- **A real NFC tap, on either platform.** Physics. `docs/media/demo-write-tag.mp4` shows a
  blank tag being provisioned with NFC Tools on a real phone; the tap itself is not filmed
  anywhere honest.
- **Anything needing a Play Console account or an Android signing key.** Both are the
  owner's to create — `android/README.md § Signing` and `V2-FEATURES.md`.

### One thing that did touch the live host, and should be recorded as such

`xcrun simctl openurl` opened Safari on `https://timesheets.exe.xyz/t?l=…` three times
while the universal-link behaviour above was being established. That is a `GET` of the
public static landing page — no session, no demo data, no write, the same request any
stranger's phone makes. No other command in this document reaches the live server, and the
two recorders refuse to.

---

## Check

```sh
sh demo/check-guards.sh      # 16 checks, ~3 s
node demo/check-captions.mjs # caption band, ~1 s
```

`check-guards.sh` runs every refusal for real — the seed and the admin-maker against a
throwaway database that is *not* `nfc_demo`, and the two recorders plus the TLS front
against `https://timesheets.exe.xyz`. A guard nobody exercises is a comment. Skips with
exit 0 when no Postgres is reachable, like every other check in this repo.

It was falsified before being trusted: with the seed's guard replaced by `IF false`, it
reports `2 FAIL` — the truncation *and* the rows written after it.

**Four of the sixteen exist because the URL host is not the only way to choose a server.**
`postgres:///nfc_demo?host=timesheets.exe.xyz` and a bare `PGHOST=timesheets.exe.xyz` both
reached the live host past a guard that only inspected the URL's hostname: libpq honours a
`host` query parameter *over* the URL host, and `pg` falls back to `$PGHOST` when the URL
names none. `demo/db-guard.mjs` is now the single place that decides, and it checks the
query parameters and the environment as well as the URL.

Those four cases assert on the **wording** of the refusal, not merely a non-zero exit. With
the guard removed, `make-admin.mjs` still exited non-zero — because it dialled the live host
and the connection failed. A test that reads exit codes alone passed that, for the wrong
reason, and would have kept passing while the hole was open.

`check-captions.mjs` renders six seconds of grey through the real `captionFilter` with the
caption boundaries deliberately landed on frame times, then counts ink in the band: more
than one caption on any frame is a failure. It exists because `between(t,a,b)` in ffmpeg is
inclusive at **both** ends, so a caption whose `until` equalled the next caption's `at` drew
both on the boundary frame — two overprinted lines, once in `both-devices.mp4` and once in
`admin-walkthrough.mp4`. `burnin.mjs` now emits half-open `gte(t,at)*lt(t,until)`.

---

## Files

| File | What |
|---|---|
| `demo/seed.sql` | invented demo data; refuses any database not named `nfc_demo`, and any server that is not loopback |
| `demo/db-guard.mjs` | the one place that decides whether a `DATABASE_URL` is the local demo DB — name, `?host=`/`?hostaddr=`, URL host, and `$PGHOST`/`$PGHOSTADDR` |
| `demo/make-admin.mjs` | the published demo login; same guard, applied before the first query |
| `demo/cdp.mjs` | Chrome DevTools Protocol client, no dependencies |
| `demo/png.mjs` | one screenshot writer (128-colour palette, halves the file) |
| `demo/burnin.mjs` | the caption band, shared by all four recorders; measures each line and shrinks it rather than letting `drawtext` clip it |
| `demo/journey.mjs` | the one worker journey, as stages, so the two device clips are the same story told twice |
| `demo/record-admin.mjs` | the admin walkthrough and its stills; asserts it covered every sidebar screen |
| `demo/tls-front.mjs` | throwaway HTTPS in front of the demo API, for the phone. Loopback on both sides |
| `demo/android-setup.sh` | points the emulator at the demo server; touches nothing on the Mac |
| `demo/record-android.mjs` | the Android journey, with captions burned in |
| `demo/demo-server.mjs` | the demo API: `server.js` with Apple's JWKS swapped, and nothing else |
| `demo/ios-setup.sh` | builds with `TS_TAG_HOST` overridden, trusts the demo CA, proves Release is clean |
| `demo/record-ios.mjs` | the iOS journey, with captions burned in |
| `demo/compose-devices.mjs` | the two clips side by side, plus the before / after cards |
| `demo/check-guards.sh` | proves every refusal still refuses — 16 cases, matched on wording |
| `demo/check-captions.mjs` | proves no frame carries two captions |
