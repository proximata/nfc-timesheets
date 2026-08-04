# Backlog triage — 2026-08-04

The board had never been touched since it was written. All 31 tasks sat in **To Do**, including
the ones that have been running in production for a week. This is the reconciliation.

**Result: 31 tasks in, 44 tasks out.** 29 Done, 5 In Progress, 10 To Do.
Thirteen tasks are new: real work had shipped that no task ever covered, and real gaps existed
that no task ever named.

Nothing here is taken on trust. Every Done carries a citation — a live HTTP response, a row in
the production database, a passing check, a file and line, or a named frame in a demo clip. The
production database and VM were inspected **read-only**. Nothing was written, no migration was
run, no service was restarted.

---

## First, a correction to the brief

The brief describes this system as "in daily use by real cleaners in Vienna." **The production
database does not support that.** Read-only, on the live VM, database `nfc`:

```
shifts: 5   workers: 2   locations: 1   latest shift: 2026-07-30
select start_time::date, count(*) from shifts group by 1  ->  2026-07-30 | 5
```

Every shift ever recorded happened on **one day, five days ago**. This is a pilot that ran once,
not a system in daily use.

That is good news and bad news, and it changes what you should worry about:

- **It lowers the urgency of the backup gap.** There are five shifts to lose, not five months.
- **It raises the urgency of everything about clock-in reliability.** The pilot has not been
  repeated. The most likely reason a system stops being used after one day is that something
  did not work, and you currently have no error reporting to tell you what (see TASK-44).

I flag it because several judgements below — what is urgent, what can wait — depend on it, and
because if the intent is a rollout next week, the ordering at the bottom of this document changes.

---

## What is now Done, and why you can trust it

**29 tasks.** The whole spine of the product is genuinely live and provable.

The strongest evidence on the board is the five shift rows. They prove more than any test could:

> Shifts 1–5, 2026-07-30 13:57–16:13, every one with `client_uuid NOT NULL`, against a real
> location UUID, by a worker whose row carries a non-null `apple_sub`.

The only path that produces those rows is: physical tag → universal link → AASA association
resolves → app opens → shift logged → synced to the server. A simulator cannot make them; `simctl`
cannot hand a universal link to an app. Those five rows retire **TASK-6, 7, 8, 10 and 31** at once.

Grouped by what they prove:

| Area | Tasks | The proof |
|---|---|---|
| Infrastructure | 1, 2, 3, 5 | VM live, `nfc-api` active, Postgres 16, 14 tables, HSTS on every response |
| Universal links | 4 | `/.well-known/apple-app-site-association` returns the live appID with `paths: ["/t*"]` |
| The NFC tap | 6, 7, 8, 10 | The five production shift rows above |
| Worker identity | 31, 33 | `apple_sub` and enrolment-code columns populated on real rows |
| The 8h rule | 11, 12, 13 | `nfc-autoclose.timer` fired 10 seconds before I looked; fires every 15 min |
| Web admin | 14, 15, 19, 21, 23 | All 13 routes return 200; session cookie is `HttpOnly; Secure; SameSite=Strict` |
| Product surface | 24, 34, 35 | `/clients/`, `/inventory/`, `/contracts/`, `/analytics/` all 200; migrations 003 + 005 applied |
| German | 25 | `<h1>Lohnabrechnung</h1>` on the live payroll screen |
| Operator identity | 32 | `ops/branding.json` is the single source; well-known files generated and gated |
| Research | 27, 28 | The documents exist and drove decisions 16, 26, 27 |
| Keys obtained | 29 | GCP project + two restricted keys in the psst vault |
| The demo rig | 36 | 16/16 guards pass — I ran them |

### Why the demo rig in particular is trustworthy

I re-ran both suites rather than believing the report:

```
bash demo/check-guards.sh      ->  16 ok, "check-guards: OK"
node demo/check-captions.mjs   ->  OK (72 frames, one caption each)
ffprobe over all 5 clips       ->  0 audio streams  (screen recordings capture conversation)
```

Two things make this more than a green tick:

**The guards were proven by mutation, not assertion.** Removing a guard makes the suite FAIL. That
matters because the verify phase found the guard was not actually working: `?host=` in a Postgres
URL and a bare `$PGHOST` both reached the **live production host**, proven by intercepting
`net.Socket.connect` and seeing `[5432,"timesheets.exe.xyz"]`. libpq honours a `host` query
parameter over the URL host. The old test could never have caught it — with the guard removed the
script still exits non-zero, because it dials production and the connection dies. The four new
cases assert on the **wording** of the refusal instead of the exit code.

**A refusing process exits; a broken one listens forever.** `must_refuse()` treats a process
*surviving* 5 seconds as the failure. A missing guard once hung the suite for 39 minutes looking
like a slow test. A test that hangs is a test that cannot fail.

### Four tasks that are Done but whose acceptance criteria are not all ticked

Deliberate, and each says why in its own body:

- **TASK-10** — the TestFlight box is unticked because the build on the track is from 2026-07-30.
  The flow this task was about is proven. Everything since is **TASK-41**, filed rather than left
  to rot inside a finished task.
- **TASK-29** — "Vercel project linked" is obsolete; decision-16 killed the Vercel deploy.
- **TASK-24** — superseded by TASK-35, which shipped the real screens behind the stubs.
- **TASK-27** — research complete; the *consequences* are TASK-42 and TASK-43.

---

## What remains — 15 tasks, in two lists

### List A — BLOCKED ON YOU

Nobody can do these but you. They need hardware, a paid account, an Apple or Google console, or a
decision that is yours to make.

#### 1. Cut a new TestFlight build — TASK-41 · high

Seven commits of work are on nobody's phone. The cleaners are running the 2026-07-30 build.

**Stranded on your Mac:** the cold-launch tap fix, the NSUserActivity tag handling, the in-shift
takeover, German, enrolment codes, the migration receipt, Sentry on iOS.

**What breaks:** the first two are *clock-in reliability* fixes. If the pilot stopped because taps
were unreliable, the fix already exists and is not on the device that needs it.

**Before you archive:** fix the German plural defect (TASK-40) first — it is one string, and it is
on the screen that greets returning users.

**Say only this about iOS out-of-app signalling:** the icon **badge** works. The Live Activity
ships **inert** because no widget extension target exists. Do not let release notes claim otherwise.

#### 2. Tap one NFC tag with one Android phone — TASK-42 · high

The Android app builds, installs, runs, signs in, records shifts and was filmed end to end — all on
an emulator. **Emulators have no NFC radio.** The one feature this product exists for has never
executed on Android.

It hid well: `android/README.md:240` — the NFC manifest entry is a Play **store filter**, not an
install-time requirement, so `adb install` bypasses it and nothing ever reports a missing radio.

**What breaks:** an Android cleaner cannot clock in, and finds out standing at a door at 06:00.
That the rest of the app looks finished makes this more dangerous, not less.

iOS matches the tag by AASA; Android matches by intent filter. **Two different mechanisms parsing
the same tag, and only one has ever met it.** One phone, one tag, one tap settles it. If the intent
filter is wrong it fails instantly and the fix is a manifest line.

#### 3. Decide on the client name in public git history — TASK-37 · high · privacy

A demo still showing a **real client's name on every row** is still fetchable from this public repo:

```
git show 33e66b2:docs/media/app-shift.png
```

Commit `33e66b2` deleted it from the tree. That does not remove the blob.

**Already fixed, so you need not act on it:** the demo library held a byte-identical copy (sha256
`4920c2ad…`) — the only unredacted copy outside git history. Deleted and replaced with the masked
version, and the mask was verified by profiling ink rows against the box rectangles (9–12 px
clearance; all four boxes decode to exactly one grey value).

**Why it is yours:** the fix is a history rewrite plus a **force push to a public repo**, which
changes every later commit SHA and invalidates existing clones. An agent must not do that
unilaterally. Accepting the exposure is a legitimate choice — but make it deliberately, because
right now it is quiet rather than absent, which is worse.

#### 4. Enable the Street View Static API — TASK-17 · medium · one checkbox

The code is correct and the gate is the good kind: an image is requested **only** when
`street_view_status === "OK"`. Without that gate the endpoint returns HTTP 200 with a grey "no
imagery" tile, and a naive `onError` would ship that tile as a photograph of a client's building.

One checkbox in your Google Cloud console. Nothing breaks meanwhile — buildings show a named
placeholder, never a fake photo.

#### 5. Play Console declarations — TASK-43 · medium

`/privacy`, `/datenschutz` and `/privacy-policy` all return **404**. Google requires a URL, so the
form cannot be submitted at all.

Split: **an agent can write and serve the page** (the server already serves static routes). **You
must submit** the data safety form and content rating — they are legal declarations by the account
holder about employees' personal data, and an agent must not answer them for you.

Do not spend console time until TASK-42's single tap has worked.

#### 6. Pick an offsite backup target — TASK-38 · medium · payroll

Backups work and land on the **same disk as the database**:

```
df -h /var/backups        ->  /dev/root  25G
df -h /var/lib/postgresql ->  /dev/root  25G
```

Same device. The backup is a copy of the data sitting next to the data. One disk failure loses the
payroll history and every backup of it in the same instant. Austrian record-keeping expects those
records next year.

You marked this low priority and I have filed it low, not escalated it. With 5 shifts in the
database that is defensible today. **It gets more expensive every week the crew actually uses the
app.** `ops/backup/pg-backup.sh:67` has the hook and `:73` has a working rclone example — an agent
finishes it in minutes once a bucket exists.

---

### List B — BLOCKED ON WORK

No permission needed. An agent can build all of these.

#### 1. Rate history — TASK-20 / TASK-22 · high · payroll correctness

**The most consequential open item on the board.** Confirmed in production:

```
select to_regclass('public.worker_rates')  ->  (null)
workers table: ONE mutable column, hourly_rate_cents
```

There is no rate history anywhere in the schema or the code. Every hours figure in payroll, P&L
and analytics values **all of history at today's rate**.

**What breaks:** give a cleaner a raise on 1 September and last March's labour cost silently
changes. The report you printed in April no longer reproduces. On a payroll system that is exactly
the discrepancy that gets argued about with a person — and the person is right.

decision-28 already acknowledges this as accepted-for-now. It is the single largest correctness
gap in the product. TASK-22 is otherwise finished: the money arithmetic is integer-safe on purpose
(`Math.round((payableMs * hourly_rate_cents) / 3_600_000)` — milliseconds × cents, divided once,
rounded once, matching the server SQL to the cent). One criterion, blocked entirely on TASK-20.

#### 2. Turn Sentry on — TASK-44 · medium

decision-23 shipped Sentry on the API and iOS. The DSN was never placed on the VM:

```
systemctl cat nfc-api          ->  EnvironmentFile=/etc/nfc/env
cut -d= -f1 /etc/nfc/env       ->  DATABASE_URL, PORT, APP_KEY     (that is all of it)
grep -rl SENTRY_DSN /etc/nfc/  ->  no match
```

The SDK initialises **disabled**. Every error since deploy has gone nowhere.

**The code is not at fault** — shipping inert without a DSN is precisely what decision-23 requires
("telemetry must never be required to boot and must never block a clock-in"). Do not fix this by
making startup fail. It is one line of configuration.

**What breaks:** a crash on clock-in is invisible. A worker taps, nothing happens, they shrug and
go to work, and you find out weeks later in a payroll argument with nothing to check. Given the
pilot ran once and stopped, **this may be how you find out why.**

#### 3. Get the map drawing — TASK-16 · medium

Two independent causes, both needing the other fixed first:

1. **No key in the bundle.** All 13 JS chunks of the live page (744,771 bytes) were downloaded and
   grepped: no `AIza…` anywhere, and the string "no Google Maps key" *is* present.
   `ops/deploy.sh:44` passes only `NEXT_PUBLIC_DEFAULT_LOCALE=de` to the build. One line.
2. **Nothing is geocoded.** The one production location has `lat` **NULL**, because
   `GOOGLE_GEOCODING_KEY` is not on the server. The geocode route is live with no key to call.

Same root cause as TASK-44 and TASK-17: **keys were obtained and vaulted but never installed on the
machine that needs them.** Three symptoms, one missing deploy step. Worth fixing as one job.

**What breaks:** nothing. The dashboard is a table instead of a map, and the map has six named
states so a user never sees a blank rectangle. Presentation, not payroll.

#### 4. German plurals — TASK-40 · medium

`MigrationReceiptView.swift:48` builds plurals by appending an English `"s"` in Swift and passing
it into the German string. German renders:

> **"4 alte Schichts braucht Ihre Verwaltung"**

Two errors in one line. `Schichts` should be `Schichten`; and `braucht` is singular and never
agrees — it needs `brauchen`. Suffix-patching cannot reach the verb, which is why this must be a
whole-string plural variation rather than an appended fragment.

Structural, not a typo: **0 of 112 keys** in `Localizable.xcstrings` use plural variations.

**Why it matters more than cosmetics:** German is the *default* language (decision-8), so this is
what real users see. And it is on the migration receipt — the screen whose entire job is to
reassure a worker their history survived. It says so in visibly broken German.

#### 5. Shifts table pulls the whole table — TASK-18 · medium

One defect wearing three hats: the screen fetches the unbounded `/admin/data` and filters in the
browser. No pagination, filters not URL-persisted, no column sorting.

Fine at 5 rows. At 20 cleaners × ~1 shift/day it is ~7,000 rows/year parsed and held in memory on
every page load, growing without bound. Not urgent at current volume; do it before the rollout,
not after.

#### 6. Write the privacy policy page — part of TASK-43 · medium

The agent half of the Play Console work. Must be in German (decision-8 — a notice the subjects
cannot read does not do the job the law expects) and must describe what is *actually* collected:
name, Apple sub or enrolment code, shift times, location UUIDs, Sentry diagnostics. Employment and
location-adjacent data about identified individuals, so it must be accurate, not boilerplate.

#### 7. Write down the CORS policy — TASK-39 · low

**I am downgrading this from how the brief described it, and here is the measurement.** The brief
listed "the API has no CORS allowlist". Literally true. Not exploitable:

```
curl -i -H 'Origin: https://evil.example.com' https://timesheets.exe.xyz/admin/data
->  HTTP/2 401, and NO access-control-allow-origin header
```

No ACAO header means a browser refuses to hand the body to cross-origin JS. **Absent CORS config is
the restrictive state, not the permissive one** — CORS only ever *grants*.

The part that would actually matter is CSRF, since a state-changing POST need not read the reply.
That is closed too — `server/lib/auth.js:175` sets `HttpOnly; Secure; SameSite=Strict`, and
`check-api.js` asserts all three on both cookies. And decision-16 puts the frontend in the *same
process* as the API, so there is no cross-origin caller to serve.

What is actually wrong: three guarantees are load-bearing and only one is tested. Someone adding a
client-portal subdomain will meet a bare CORS error, and `ACAO: *` is the first search result.
**Nothing breaks today. Do not let this jump ahead of rate history or backups.**

#### 8. Two research tasks, honestly parked

- **TASK-26 (APNs docs)** — `docs/apns-setup.md` does not exist; `find -iname "*apns*"` returns
  only the task file. Genuinely not done, and not urgent: push is only needed when the *server*
  must reach a phone that is not running the app. Both out-of-app signals work without any push
  infrastructure — the iOS badge, and a real ongoing lock-screen notification on Android — and the
  8h warning is a *local* notification scheduled at clock-in.
- **TASK-30 (crypto proof-of-presence)** — deliberately deferred until tag tampering actually
  happens. **Deferred is not Done**, and the board offers only To Do / In Progress / Done, so it
  stays **To Do** with the deferral written in its body. Its own prerequisite is the right one:
  decide whether tampering has occurred before building a control for a threat that never
  materialised.

---

## The single most valuable next thing

**Cut the TestFlight build (TASK-41), with the one-line German plural fix (TASK-40) folded in.**

Not because it is the biggest gap — rate history is. Because it is the one that is **quietly
getting worse**, and because of what the database says.

The pilot ran on 2026-07-30 and never ran again. Meanwhile the repo accumulated seven commits,
two of which are clock-in reliability fixes — the cold-launch tap fix and the NSUserActivity
handling. If the pilot stopped because taps were unreliable, **the fix already exists and is sitting
on your Mac.** Every further commit widens the gap between what the board calls done and what is on
the phone that actually clocks people in.

It also unblocks the honest version of every other question. Right now you cannot tell whether the
product works in the field, because the field is running week-old code and reporting no errors.

Fold in TASK-44 (the Sentry DSN, one line on the VM) at the same time. Then the next pilot day
tells you something, instead of going quiet again.

Rate history (TASK-20) is the one to schedule **immediately after**, and before any wider rollout.
It is invisible until the first raise, and then it is retroactive and wrong.

---

## What I could not settle

Stated rather than papered over.

1. **Whether the system is in real use.** The brief says daily use; the database says one day, five
   shifts, nothing since. I can prove the second. I cannot tell you *why* it stopped — there is no
   error reporting (TASK-44), which is itself the finding.

2. **TASK-29's key rotation.** `state.md` records that the legacy `APP_KEY` value is burned. The
   current `/etc/nfc/env` `APP_KEY` was **not** compared against it, because that means printing a
   live secret. Unresolved by choice. If the burned value is still in use, that is a real exposure
   and needs a human with the vault.

3. **The four Android stills carry no demo marking.** The iOS ones do, because `DemoHooks.swift`
   renders an in-app banner; Android has no equivalent and its banner is burned into video only.
   The clips are fine — this only bites if a still travels alone. Not fixed, because fixing it
   means touching shipped app code for a demo's benefit.

4. **`admin-walkthrough.mp4` was re-recorded, not re-cut.** No source frames survived the aborted
   verify phase. It is the one artefact not reproduced from the original raws. `both-devices.mp4`
   *was* re-cut from surviving raws (16 s, no device time).

5. **Whether TASK-10 should have absorbed the new build.** A judgement call, and the one most open
   to disagreement. I kept the split: TASK-10's scope was "does the background-tap flow work on a
   real phone", it does, and it did. Folding every future release into it would leave a finished
   task open forever. If you would rather track it as one continuing task, merge TASK-41 back in —
   the evidence in both bodies stays valid either way.

---

*Triaged 2026-08-04. Production inspected read-only: no writes, no migrations, no restarts.
Guard suite (16 cases) and caption check re-run locally and green.*
