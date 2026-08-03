# Re-recording the demo

Every clip and screenshot in `docs/media/` is produced by the scripts in `demo/`, against a
**local** database seeded with invented data. Run the commands below and you get the same
files. Change a screen, re-run the one script, commit the new file.

**Written 2026-08-03.** What was and was not produced, and why, is at the bottom under
*What could not be recorded here* — read that before you conclude something is broken.

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

Writes `docs/media/admin-walkthrough.mp4` and eight PNGs. About two minutes.

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

Writes `docs/media/android-journey.mp4` and three PNGs. About 90 seconds. It mints its own
enrolment code through `POST /admin/workers/:id/enrolment-code`, clears the app so it is a
first launch, and burns the captions in with timings it measured rather than guessed.

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

## What could not be recorded here, and exactly what it needs

### iOS: the journey could not be produced. Three separate blockers.

The iPhone app **builds and runs** — that much was checked, not assumed:

```sh
cd NFCTimeSheets
xcrun simctl boot "iPhone 17"
xcodebuild -project NFCTimeSheets.xcodeproj -scheme NFCTimeSheets \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/ts-demo/ddata TS_TAG_HOST=demo.invalid build
xcrun simctl install booted /tmp/ts-demo/ddata/Build/Products/Debug-iphonesimulator/NFCTimeSheets.app
xcrun simctl launch booted io.github.qwadratic.NFCTimeSheets
```

`** BUILD SUCCEEDED **`, the app launches and the Sign in with Apple screen renders.
`TS_TAG_HOST=demo.invalid` on the command line reaches Swift through the `TSTagHost`
Info.plist key, which was confirmed in the built bundle — so the app could not have reached
the live server even by accident. **`project.pbxproj` and `Branding.xcconfig` were not
touched**; the override is a command-line build setting.

Past that point, three things stop a recording, and each needs something an agent cannot
supply:

**1. The API must answer on port 443 under the name `timesheets.exe.xyz`.** `API.base` is
`https://\(TagLink.host)` with no port, so unlike Android there is no `adb reverse` to lean
on, and macOS refuses a non-root process port 443 (`EACCES`, measured). **You** can do it:

```sh
sudo sh -c 'printf "\n127.0.0.1 timesheets.exe.xyz\n" >> /etc/hosts'
sudo node demo/tls-front.mjs --port 443 --upstream 127.0.0.1:8082
xcrun simctl keychain booted add-root-cert /tmp/ts-demo/tls/ca.pem
```

Build **without** the `TS_TAG_HOST` override for this, so the app uses the real host.
Remember to take the `/etc/hosts` line out afterwards, or your browser cannot reach the real
site either.

**2. Sign in with Apple needs a real Apple ID signed into the simulator.** There is no
enrolment-code path on iOS (decision-26 is Android-only, deliberately, while the iPhone
pilot runs). So the simulator has to be signed in under *Settings → Sign in to your iPhone*,
and the demo worker row has to carry that Apple ID's address:

```sh
psql -d nfc_demo -c "UPDATE workers SET email='<your apple id>' WHERE name='Marta Nowak'"
```

That address is yours, it stays in your local `nfc_demo`, and it is the one exception to
"no real person in the demo data". Note it, and do not commit a dump of that database.

**3. `simctl openurl` does NOT hand a universal link to the app. Verified, twice.**

This one was expected to work and does not, so do not lose an hour to it:

```sh
xcrun simctl openurl booted "https://timesheets.exe.xyz/t?l=<uuid>"
# -> opens Safari on the /t landing page. The app is not launched.
```

It was tried with an ad-hoc build and again with `DEVELOPMENT_TEAM=6Y842FE8Q4` and
`-allowProvisioningUpdates`. The second build's simulated entitlements are correct —

```
application-identifier = 6Y842FE8Q4.io.github.qwadratic.NFCTimeSheets
com.apple.developer.associated-domains = [applinks:timesheets.exe.xyz]
```

— and they match the AASA Apple's CDN serves for the host
(`{"applinks":{"details":[{"appID":"6Y842FE8Q4.io.github.qwadratic.NFCTimeSheets","paths":["/t*"]}]}}`).
Safari opened anyway, both times.

**This is a simulator limitation, not a product defect.** The tap works on real hardware —
that is what is in daily use. If you want the handoff on a simulator, the route to try is
`applinks:timesheets.exe.xyz?mode=developer` in the entitlement plus a locally served AASA,
which means editing `NFCTimeSheets.entitlements` — the file decision-24 requires to stay a
checked literal. **Do not leave that edit in a build that reaches TestFlight.**

Fixing 1 and 2 alone gets you the app talking to the demo server. Recording *"the tag URL
opens the app"* on a simulator additionally needs 3, or a real iPhone and
`xcrun devicectl` / QuickTime screen recording from the device.

### Things nothing here can do at all

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
sh demo/check-guards.sh
```

Runs all four refusals for real — the seed and the admin-maker against a throwaway database
that is *not* `nfc_demo`, and the two recorders plus the TLS front against
`https://timesheets.exe.xyz`. A guard nobody exercises is a comment. Skips with exit 0 when
no Postgres is reachable, like every other check in this repo.

It was falsified before being trusted: with the seed's guard replaced by `IF false`, it
reports `2 FAIL` — the truncation *and* the rows written after it.

---

## Files

| File | What |
|---|---|
| `demo/seed.sql` | invented demo data; refuses any database not named `nfc_demo` |
| `demo/make-admin.mjs` | the published demo login; same guard |
| `demo/cdp.mjs` | Chrome DevTools Protocol client, no dependencies |
| `demo/png.mjs` | one screenshot writer (128-colour palette, halves the file) |
| `demo/record-admin.mjs` | the admin walkthrough and its stills |
| `demo/tls-front.mjs` | throwaway HTTPS in front of the demo API, for the phone |
| `demo/android-setup.sh` | points the emulator at the demo server; touches nothing on the Mac |
| `demo/record-android.mjs` | the Android journey, with captions burned in |
| `demo/check-guards.sh` | proves all four refusals still refuse |
