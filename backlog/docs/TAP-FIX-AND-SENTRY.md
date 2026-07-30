# The tap fix, your four old records, and turning Sentry on

Verified against the files on disk, not against anybody's report. Everything below that says
"measured" was run.

---

## BLOCKING — read this first

**1. Nothing is on TestFlight yet. The iOS Sentry code has never been compiled.**
`sentry-cocoa` is not in the Xcode project, so every line that talks to Sentry sits behind
`#if canImport(Sentry)` and the compiler skips it entirely. The app builds and the tap fix and
the migration are fully typechecked and fully checked — but the Sentry calls inside
`Telemetry.swift` were written from documentation, and **no compiler has ever seen them**.
Expect to fix a method name or two the first time you build after step 2 below. That is normal
and it cannot break anything before you do it.

**2. You have no Sentry account.** Until you make one, both halves run with telemetry switched
off and behave exactly as they do today. That is deliberate: measured, with `SENTRY_DSN` unset,
the API boots, serves, logs and passes all 86 checks.

**3. One thing genuinely cannot be verified until DSNs exist:** whether the phone actually
attaches its trace headers to our requests. The server half is proven (see the last section);
the phone half is standard SDK behaviour that nobody can observe without an account.

**4. Not blocking, but know it:** `/shifts/mine` did not exist on the server. The phone's
migration calls it. I implemented it (`server/routes/app.js`) and pinned it with a check —
without it, a device holding a certain kind of old record would have retried the migration
forever. Your four records do not need it, so this was insurance, not a rescue.

---

## What was wrong with the tap

The app kept its own little address book of the buildings you clean, downloaded from the server.
When you tapped the tag, the app looked the building up in that address book first, and if it
wasn't there it refused the tap and said *"Unknown tag — this location isn't registered."*

The problem is **when** it looked. Tapping the tag is what *launches* the app. At that instant
the app has just started, it hasn't spoken to the server yet, and the address book is empty — so
a perfectly good tag was checked against a blank page and turned away. On a phone that had never
successfully opened the app before, the tap could essentially never work. You were standing at
the door with a valid tag and the app said the building didn't exist.

That check is gone. **A tap now always writes the shift down on the phone first**, immediately,
before anything else, and then sends it. The server — which actually knows which buildings are
real — is the one that decides whether a location is valid, and if it says no, that shift turns
red in your list with an explanation. A missing building *name* is cosmetic; a missing *shift* is
unpaid work, and that was the wrong way round.

There was a second, quieter version of the same mistake underneath it: if you had any old shift
waiting to be given a finish time, the app refused to record a new tap until you'd dealt with it.
So: 06:02, you tap, the app says "fix this three-day-old shift first", you fix it, you tap again
at 06:05 — and three minutes of paid time never existed, and only if you bothered to tap again at
all. Now the tap is recorded first and *then* the fix-it screen comes up. The pressure to correct
old shifts is unchanged; the lost time is gone.

**Verified:** a tap that arrives before the app has finished starting is held and applied exactly
once; a tap that arrives while the app is open is applied exactly once; neither ordering loses it
or double-counts it, and two deliveries of the same physical tap within 3 seconds still count as
one. (`NFCTimeSheets/checks/tap-inbox-check.swift` — `tap-inbox-check: OK`.)

---

## Your four old records: what happens, and what you will see

The four rows reading **"Unknown location — 0h 0m"**, dated 19, 22, 26 and 28 July, are leftovers
from the version of the app before the rewrite. They have no building attached and no measurable
hours, which is why they've been sitting there saying *"This shift is missing its location and
can't be sent."* They cannot be sent, cannot be invoiced and cannot be paid, and there is no
honest way to work out which building they belonged to — so nothing invents one.

**On the next launch, all four are copied into an archive file on the phone, and then removed
from your list.** Not deleted-and-forgotten: copied first, the copy is read back to confirm it
actually saved, and only then are the rows removed. If the app is killed at any point in the
middle, nothing is lost and it simply does it again next time.

**What you will see:** once, a screen titled **"App update"** saying *"We cleaned up 4 old
records"*, listing each one with its date, with the explanation *"These came from an older
version of the app. They had no building and no hours, so they could not be sent and could not be
paid. A copy is kept on this phone."* Tap Done. It never comes back on its own.

Afterwards it is permanently under **Settings → Migration history**, reading from the archive
file, so if you dismiss it at a door at 06:00 you can still find out later what left your phone
and why.

**What will never happen**, checked explicitly:

| Case | Result |
|---|---|
| Old row with **hours** but no building | **Kept**, flagged orange, "your admin has to enter it — it has not been lost" |
| A shift exactly 60 seconds long | **Kept.** Anything a minute or over is hours, and hours are never deleted |
| A healthy shift, or one running right now | **Untouched** |
| Any row | **Never** gets a made-up building or a made-up duration |

Measured, against those exact four rows:

```
=== the four rows on the owner's phone ===
19 Jul 2026  Unknown location  0h 0m -> archiveAndDelete
22 Jul 2026  Unknown location  0h 0m -> archiveAndDelete
26 Jul 2026  Unknown location  0h 0m -> archiveAndDelete
28 Jul 2026  Unknown location  0h 0m -> archiveAndDelete

=== rows that must NEVER be deleted ===
6h at an unknown building                  -> keepBlocked
exactly 60s, no building                   -> keepBlocked
a healthy completed shift                  -> leaveAlone
a shift running RIGHT NOW                  -> leaveAlone
```

The "0h 0m" cutoff isn't a guess: the app prints anything under a minute as "0h 0m", so the rows
being cleared are exactly the ones already shown to you as zero.

### The mechanism underneath it, for the next update

You asked for something reusable, not a one-off. What is there:

- A version number stored on the phone, and an **ordered list** of steps. A worker who skipped a
  version runs 1, 2, 3 in turn — not one big `if`.
- Each step **saves its work before** the version number moves. So the worst possible outcome is
  "did the work, will harmlessly do it again", never "skipped the work".
- A phone that never had the old app runs the **same** step, it matches zero rows, and nothing
  happens. Not a special case — genuinely the same code path, and no network call.
- If a step fails, the whole chain stops, the version stays put, the app opens normally anyway,
  and it retries next launch.

Measured:

```
pass 1 (legacy device, version 0): ran [1], version now 1
pass 2 (same device, rerun):       ran [],  version now 1
fresh install (no old rows):       ran [1], version now 1  <- same step, matches nothing
skipped a version (applied 1):     ran [2, 3], version now 3  <- ordered, not one `if`

killed mid-step: step 2 threw; chain stopped
ran [1], version stayed at 1  <- step 2 retried next launch, 3 never skipped
```

---

## What YOU have to do

You have no Sentry account. Start here.

### Step 1 — make the account and two projects (~5 minutes, in a browser)

1. Go to **sentry.io** → Sign up. Pick the **EU (Frankfurt) region** when it asks. This is
   Austrian payroll data about named people; keeping it in the EU is the whole reason to care.
2. Create the **organisation**. Any name.
3. Create **two projects inside that one organisation**:
   - Platform **Node.js**, name it `timesheets-api`
   - Platform **Apple / iOS**, name it `timesheets-ios`
4. **Both projects must be in the SAME organisation.** Two separate orgs would mean the phone's
   record and the server's record of the same tap can never be joined, which is the one thing you
   asked for.
5. For each project: **Settings → Projects → (project) → Client Keys (DSN)** and copy the DSN. It
   looks like `https://<key>@o1234567.ingest.de.sentry.io/7654321`. Keep the two apart — they are
   different strings.
6. While you are in there: **Settings → Security & Privacy → Data Scrubber → ON**. Belt and
   braces; the code already strips everything sensitive before it leaves.

### Step 2 — add the package in Xcode (this is the part only you can do)

`project.pbxproj` is yours to hand-edit, so nothing here touched it. Exact clicks:

1. Open `NFCTimeSheets/NFCTimeSheets.xcodeproj`
2. **File → Add Package Dependencies…**
3. Paste into the search field at the top right, then press Return:
   `https://github.com/getsentry/sentry-cocoa.git`
4. **Dependency Rule: "Up to Next Major Version"**, lower bound **`9.15.0`**
5. **Add to Project: NFCTimeSheets** → click **Add Package**
6. In "Choose Package Products", set **exactly one** product to target NFCTimeSheets:

   | Product | Target |
   |---|---|
   | **`Sentry`** | **NFCTimeSheets** |
   | `Sentry-Dynamic` | None |
   | `SentrySwiftUI` | None |
   | `Sentry-WithoutUIKitOrAppKit` | None |
   | `SentrySPM` / `SentryObjC` | None |

   Xcode will let you tick several. **Ticking several breaks the build.**
7. Click **Add Package**. Verify under target NFCTimeSheets → General → *Frameworks, Libraries,
   and Embedded Content* that **Sentry** is listed.
8. **Build once now.** This is where any API-name mistakes in `Telemetry.swift` surface — see
   BLOCKING #1. They are all in that one file.
9. Commit **both** `project.pbxproj` **and**
   `NFCTimeSheets.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`.

**Do not run `sentry-wizard -i ios`.** It edits `project.pbxproj` unattended and installs a
crash-symbol upload step that needs an auth token nobody has created.

### Step 3 — where each DSN goes

**iOS DSN** → `NFCTimeSheets/NFCTimeSheets/Info.plist`, the `SentryDSN` key, which is currently
an empty string:

```xml
<key>SentryDSN</key>
<string>https://…@o1234567.ingest.de.sentry.io/7654321</string>
```

Committed in the clear on purpose, reasoned exactly like `API.appKey`: it is compiled into the
app, so anyone can pull it out of an installed build, and hiding it from git protects nothing. It
grants no read and no write of company data — the worst case is somebody wasting your Sentry
quota. **Leave it empty and the SDK is never started at all**, no cost, no behaviour change.

**Server DSN** → on the VM, in `/etc/nfc/env`:

```bash
ssh timesheets.exe.xyz
sudo sh -c 'echo "SENTRY_DSN=https://…@o1234567.ingest.de.sentry.io/1111111" >> /etc/nfc/env'
sudo systemctl restart nfc-api
systemctl is-active nfc-api
```

It is deliberately **not** in the API's required-variables list. Telemetry must never be able to
stop the API from starting.

### Step 4 — deploy and confirm

```bash
cd server && node check-api.js      # expect: check-api: PASS
./ops/deploy.sh                     # gates on "no native addons" before it ships
ssh timesheets.exe.xyz 'journalctl -u nfc-api -n 30 --no-pager'
```

You should now see one line per request in journald — the thing that was missing when your tap
failed and left no trace anywhere:

```
[req] POST /shifts/open 201 34ms w=1
[req] POST /shifts/open 422 11ms w=1 err=unknown_location
[req] GET /t 200 10ms
[req] GET /portal/<redacted> 404 1ms err=not_found
```

That log works **with or without** Sentry. It is plain `console.log` into journald, which already
rotates. If you do nothing else on this page, you still get this.

One line worth knowing: **`GET /t` appearing at all means a tap fell back to Safari** instead of
opening the app. A working tap never reaches the server on that path.

---

## What the merged view will and will not show you

Once both DSNs exist, one tap on a tag becomes **one trace** you can open in Sentry:

```
nfc.tap                        (phone)   location id, cold launch?, how many buildings were cached
├─ shift.local_write           (phone)   the row written to the phone: open / close / switch
└─ shift.push                  (phone)
   └─ http.client POST /shifts/open     (phone)
      └─ http.server POST /shifts/open  (server)  ← same trace, joined automatically
         └─ pg query                    (server)
```

The join is real and **measured**: with a trace header on the way in, the server continued the
phone's trace id `aaaa…aaaa` and attached itself under the right parent span, and without one it
correctly started a fresh trace. Two things had to be fixed to make that true, both found here,
neither visible in review:

- The server was set to **refuse to continue a trace unless both sides announce the same Sentry
  organisation id**. If the iOS SDK doesn't announce one — and nobody can check that without an
  account — every single tap would have silently split into two unconnected traces, in
  production, with no error. Turned off. The protection that actually matters (rejecting traces
  from a *different* organisation) applies regardless and is untouched.
- The Sentry SDK **throws away the server's half of any 401 or 403 by default**. An expired
  session is the most ordinary way a real clock-in fails, and it would have shown as the phone
  saying "rejected" with nothing at all on the server end. Now kept. 404s are still dropped —
  that is scanner noise, and the journald log keeps every one anyway.

**What it cannot link, and no amount of code will fix:**

- **The physical tap → app launch gap.** The tag holds a web address and nothing else. Between
  your phone touching the sticker and the app starting, there is no Sentry running and no header
  to carry, so the time that takes is not measurable from inside the app and is deliberately not
  faked. App-start and the tap get separate traces, tied together by a shared `ts.launch_id` tag
  you can search on — an honest link, not an invented one.
- **Crash line numbers on iOS** will be unsymbolicated. Upload of debug symbols needs an auth
  token that doesn't exist; wiring half of it would be worse than saying so.
- **A tap in a basement with no signal** shows only on the phone. Correctly — nothing was sent.
  That is exactly the case where the phone-side half earns its keep.

### What can never reach Sentry

This is EU payroll data about named people, so it is enforced in code at the point data leaves,
not by anyone remembering. Every item below is asserted by a check that fails if it regresses:

Apple identity tokens and sign-in nonces · the `apple_sub` identifier · session cookies ·
`X-App-Key` · passwords and password hashes · worker emails · `hourly_rate_cents` ·
client-portal tokens · **query strings, whole** · request bodies · screenshots · view
hierarchies · local variables in stack traces.

The **only** identity attached to anything is the numeric worker id, which is meaningless outside
your database. Not the name, not the address, not the Apple identifier.

One of those was actually leaking and is now fixed: the Sentry SDK attaches the query string to
every request **twice** — once inside the URL, which was being stripped, and once on its own
under a separate field, which was not. Caught by driving a real request through the real server
and reading what came out at the transport, then confirmed by putting the bug back and watching
the check fail with the email address printed. That check now runs as part of `node check-api.js`
and needs no database, no network and no DSN.

---

## Everything that was run, verbatim

```
swiftc -typecheck -target arm64-apple-ios18.0  (all app sources)  exit 0
tag-link-check: OK
tap-inbox-check: OK
scrub-check: OK
migration-check: OK

check-api: PASS                 (86 cases, whole run with SENTRY_DSN unset)
check-api: SKIP (no database)   exit 0 — the 5 telemetry cases still run first
check-telemetry-wire: PASS      (6 cases, real SDK payloads, nothing transmitted)
close-flag checks: 7 pass, 0 fail

web verify: exit 0              (check + biome + tsc + next build, 11 static routes)
deploy gate: no native addons — macOS->Linux rsync safe
project.pbxproj: UNTOUCHED
```

Live boot with **no DSN at all**, which is the state you are in right now:

```
timesheets api listening on :8791
[req] GET /health 200 31ms
[req] GET /.well-known/apple-app-site-association 200 1ms
[req] GET /t 200 2ms
[req] POST /shifts/open 401 0ms err=unauthorized
```

---

## Smaller things worth knowing

- **Server dependencies went from one package to two.** `pg` + `@sentry/node` (pinned exact at
  `10.68.0`), which pulls in ~33 transitive packages and 30–60 MB of memory on the same VM that
  runs Postgres. That is a real change to a stated constraint and it is written down as
  **decision-23**, including how it fails and what was deliberately left out.
- **`ops/deploy.sh` now refuses to deploy** if any dependency ships a compiled binary.
  `node_modules` is built on your Mac and copied to a Linux box; that is only safe while
  everything is pure JavaScript. `@sentry/profiling-node` is not, and must never be added.
- **The systemd unit changed** — `node --import /srv/nfc/instrument.mjs /srv/nfc/server.js`. That
  flag is required, not cosmetic: without it, Sentry loads too late to see anything, and
  everything still *looks* healthy.
- **`AGENTS.md`'s decision checklist** was stale at decision-12; it now runs to decision-23 and
  marks which older ones were superseded.
- **Span data on iOS is not passed through the scrubber**, because the iOS SDK's `beforeSend`
  hook only covers errors, not spans. Safe today for a specific, checked reason: the app builds
  exactly one URL with a query string in it, and its only parameter is a timestamp. Written down
  at the top of `Scrub.swift` with the ceiling and the upgrade path, rather than papered over
  with an API call no compiler here can verify.
