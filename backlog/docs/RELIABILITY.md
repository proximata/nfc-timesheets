# RELIABILITY — what happens when it breaks, and who finds out

Written 2026-08-20 after breaking **production** on purpose: Postgres stopped mid-request,
the API restarted with a shift open, the VM rebooted twice with a shift open, the disk
filled to 4 MB, the tag host's nginx stopped, a live worker session expired mid-shift,
concurrent taps, a doubly-redeemed sign-in code, and a migration lock held across the
nightly dump. Everything was restored and the row counts checked afterwards.

Reproduce the whole thing:

```
./ops/break-timers.sh          # the two background jobs, shown doing their job, RED first
./ops/break-infra.sh           # six infrastructure failures  (SKIP_REBOOT=1 to skip § 4)
./ops/break-taps.sh            # nine things that happen at a door
./ops/check-timers-ran.sh      # an enabled timer proves nothing — assert the service RAN
./ops/check-timers-ran-mutants.sh
./ops/check-unit-drift.sh      # the repo's unit file vs what systemd LOADED vs what is running
./ops/check-unit-drift-mutants.sh
node demo/check-load-failure.mjs --mutate
```

Nothing here is a prediction. Every line is something that was done to the live box and
watched.

---

## The ranking

Ordered by **what it costs the person who meets it**, not by how interesting it is.

| # | Failure | The cleaner | The director | Recovers alone? | Anyone told? |
|---|---|---|---|---|---|
| 1 | shift stranded on a phone | nothing — it looks sent | hours simply absent | ~~✗ never~~ **✓ on its own** | ~~nobody, ever~~ **worker + office** |
| 2 | worker session lapses mid-queue | red line, hours gone | short payroll | ~~✗~~ **fixed** | phone only |
| 3 | Sentry blind | — | — | n/a | **nobody** |
| 4 | 8h net dies silently | unbounded shift | wrong hours | ✗ | **nobody** (6 days) |
| 5 | Postgres down | tap retried, lands later | panel says so | ✓ ~2 s | journald only |
| 6 | API restart / reboot | nothing at all | ~21 s blank | ✓ | — |
| 7 | disk fills | nothing at all | nothing | ✗ | backup unit only |
| 8 | tag host down | nothing at all | nothing | ✗ | nobody |
| 9 | migration ✕ nightly dump | door stalls | deploy stalls | ✓ | deploy output |
| 10 | backups all on one disk | — | everything, once | ✗ | — |

---

## 1 · A shift stranded on a phone — TASK-225 — **FIXED AND PUBLISHED, 0.5.1 / 8**

**The finding below stands as written; everything it describes was true of 0.4.1 / 6 and
is no longer true of the build the box now serves.** What changed, and where the evidence
is, is at the end of this section — read the finding first, because the shape of the bug is
why the fix is built the way it is.

**Nobody can find out. That is the whole finding.**

A cleaner taps in a basement with no signal. The offline queue does its job: the row is
written locally, correctly, and `ApiFailure` classifies the failure retryable so nothing
throws it away. But `data/ShiftSync.kt` says plainly in its own header that there is **no
background worker** — the queue drains on a tap, on pull-to-refresh, and when the log
screen appears. If the worker does not open the app again while they have signal, that
shift exists on exactly one phone and nowhere else, indefinitely.

Three consequences, none of them visible from the office:

- **the 8h net does not apply.** `ops/sql/autoclose.sql` operates on `shifts`; a row that
  was never posted cannot be matched. `core/ShiftSignal.kt` computes the same boundary
  locally, but only to flip the display to `8:00:00+` — nothing closes the local row.
- **payroll is quietly short**, and a shift that was never posted is indistinguishable
  from a shift that never happened.
- **the question cannot even be asked.** No route reports "whose phone has not synced".
  `worker_sessions` has no last-seen column.

> **What the director sees:** a month that is a few hours light, with no way to tell
> whether that is absence, forgetfulness or a phone in a pocket.

The cheap half of the fix is *detection*, not delivery: stamp a last-seen on
`worker_sessions` and put "Telefon zuletzt gesehen: vor 3 Tagen" on the Workers screen.
WorkManager makes it rare; the timestamp makes it **visible**, and a fix nobody can observe
is a fix nobody can trust.

### What shipped, and what it is measured against

Both halves, and the detection half went in first for exactly the reason above.

| | what | where |
|---|---|---|
| delivery | JobScheduler job 225, `NETWORK_TYPE_ANY`, `setPersisted(true)`, exponential backoff from 30s | `sync/SyncScheduler.kt`, `sync/ShiftSyncJob.kt` |
| order | oldest first, OPEN before CLOSE, a failed OPEN drops its own CLOSE from the pass; idempotent on the **existing** `client_uuid` | `core/SyncPlan.kt`, pure |
| the worker sees it | shift screen, log screen **and the sign-in screen**, German, with the time of the last attempt — "never tried" is its own sentence | `core/PendingWork.kt` |
| the office sees it | three `X-Pending-*` headers on requests already being made → four `workers` columns | migration 009, `server/lib/phones.js`, `/workers/`, `/payroll/` |

**Not WorkManager, and the reason is written down** — it is a wrapper over `JobScheduler`
on API 23+ and buys chained and observable work, of which this app needs none.

**The ceiling is printed on the worker's screen, not just in a comment.** A force-stopped
app runs no jobs until a human opens it; Doze can delay by hours; backoff caps at 5h. None
of it costs money — `start_time` and `end_time` are stamped **on the phone at the tap**, and
the proof asserts a late row against the tap's own clock.

**Proven by taking the network away, on a real Android instance, against production.**
`demo/prove-offline-push.mjs` — 9 phases, radio off with `svc`, the queue read out of the
phone's own SQLite, the rows counted in production Postgres. Final run **OK with 6
assertions observed RED in the same run**: no job over an empty queue; a signed-in close for
an unknown shift → `404 unknown_shift`; the phone rewound to 'never delivered'; force-stop
cancelling the job; the session deleted server-side. Reproduce:

```
ADMIN_EMAIL=… ADMIN_PASSWORD=… WORKER_ID=… node demo/prove-offline-push.mjs
```

**Three defects this run found that no amount of reading the source could have.**

1. **The ordering RED was an auth failure in an ordering costume.** § 3 sent its bogus
   close with no credentials and accepted `404 || 401`. It got 401 from `requireAppKey`,
   *before the route ever looked for a shift* — so it printed RED while proving nothing.
   Delete `unknown_shift` from `routes/app.js` and the run stayed green. Now sent with the
   phone's own cookie **and** app key, required to be 404 **and** `unknown_shift`.
2. **An empty queue armed a job — but only OFFLINE**, which is the only case this feature
   exists for. Force-stopped first, so the state starts at `unknown`:

   | build | launch ONLINE, empty queue | launch OFFLINE, empty queue | offline TAP |
   |---|---|---|---|
   | 0.5.0 / 7 | `unknown` | **`waiting`** ← armed for nothing | `waiting` |
   | 0.5.1 / 8 | `unknown` | `unknown` ← nothing armed | `waiting` |

   Online the platform runs the job at once, finds nothing and clears it, so the defect is
   invisible. Offline it waits for a signal that will give it nothing to do. That is the
   profile EMUI and MIUI move to **RESTRICTED**, and a restricted app runs no jobs at all —
   it would have taken this whole feature down on exactly the handsets a cleaning company
   buys. The last column is the half that matters as much: **0.5.1 still arms when there IS
   work.**
3. **Settings cried wolf.** Once an idle phone holds no job, the two-state line printed
   „Nicht eingeplant. Wartende Schichten gehen erst hinaus, wenn Sie die App öffnen" in the
   **error colour** over a phone with no waiting shifts — rows that do not exist, in red,
   permanently. A third, uncoloured sentence now covers the healthy phone; the platform's
   refusal reason is still shown after the queue drains, because that is the evidence.

**It is in the field's reach, which is a separate claim from "it is fixed".** The box was
still serving 0.4.1 / 6 while all of this sat in git. Now: versionCode **8**, versionName
**0.5.1**, signer SHA-256 `6c786899…2c42996c` (matches the live `assetlinks.json` on the tag
host, so App Links still verify). A phone was driven through the whole path on the **field**
build — clean install of 0.4.1 / 6, signed in, Settings reads „Installiert: 0.4.1 (6)" and
**„Version 0.5.1 ist verfügbar."** with a Herunterladen button.

**Still open, filed:** TASK-233 (the force-stop caveat is below the fold at 1080×2400 —
moved, never deleted) and TASK-234 (a job armed for real work is not cancelled when the
foreground pass delivers it instead; the app calls `schedule`/`getPendingJob` and never
`cancel`).

**Still not knowable from here:** a real radio in a real basement. `svc wifi disable` is a
clean, instant loss of connectivity; a basement is a slow, flapping one. And no card has
ever been written on real hardware (TASK-222, the owner's).

---

## 2 · A lapsed session used to throw away hours — FIXED, commit e6c0a58

Measured by expiring a live worker session on production while a shift ran
(`ops/break-taps.sh` § 8). The server was never the problem: 401, the shift stays open, the
8h timer would still close it.

The phone was. 401 was not in `ApiFailure.isRetryable`, so `SyncPlan.blocksRow` returned
true, `ShiftSync` called `markFailed(blocked = true)`, and `SyncPlan.plan` skipped that row
**for ever** — nothing anywhere clears `sync_blocked` except `markOpenSynced` /
`markCloseSynced`, and both are unreachable for a row that is never planned again. Signing
back in did not revive it.

That a 401 is about the *credential* and not the payload was **measured, not argued**: the
session was restored and the identical request replayed. `200`.

A 90-day session makes this sound rare. It is not — `requireWorkerSession` joins `workers`
and requires `active`, so **deactivating and reactivating a worker in the admin panel**
401s every call in between.

`invalid_code` stays terminal, and that carve-out is load-bearing: a sign-in code is
single-use and rate-limited (decision-26), so anything retrying a rejected one burns the
worker's attempts and locks the phone out for fifteen minutes.

Also fixed: `err_unauthorized` read *"Diese App-Version wurde vom Server abgelehnt. Bitte
aktualisieren."* `lib/auth.js` answers `401 unauthorized` for a bad app key **and** for an
expired session, so that string sent a cleaner whose session merely lapsed off to update an
app that was fine.

---

## 3 · Sentry has never been loaded, and journald is the whole of observability — TASK-224

The docs said "deployed and blind because `SENTRY_DSN` was never set". It was worse than
that, and the smaller half was the one everyone knew about.

```
/proc/<pid>/cmdline   /usr/bin/node /srv/nfc/server.js      ← no --import
SENTRY_DSN            unset
```

`instrument.mjs` must be loaded with `node --import` or it is not loaded at all — its own
header says why: `import` from inside `server.js` runs after `pg` and `node:http` are
already loaded. So **the SDK was not in the process**, and the one action everybody believed
would turn telemetry on — set the DSN, restart — would have produced exactly nothing. The
next person to look would have concluded Sentry itself was broken.

The `--import` half is now fixed (§ *Two files that were documents*, below). The DSN half is
not, so nothing still leaves the box.

**What that costs, concretely.** `ops/break-infra.sh` § 2 stopped Postgres and posted a real
clock-in. The complete record of that failed clock-in, anywhere in the world:

```
[500] POST /shifts/open: connect ECONNREFUSED 127.0.0.1:5432
```

One line. In journald. On the same VM as the database that failed. Not aggregated, nothing
watching it, rotating in roughly a month under the default `SystemMaxUse` (144 MB used).
There is **no monitoring agent of any kind** on the box — the running services are `cron`,
`dbus`, `nfc-api`, `postgresql`, `journald`, `logind`, `timesyncd`, `user@1000`. That is the
list.

> A clock-in that fails in a stairwell is discovered by a human reading a phone screen and
> telephoning the office. A cleaner who is not paid for a shift finds out at the end of the
> month.

---

## 4 · The 8h safety net was dead for six days and nothing said so — TASK-226

Read out of the journal, not predicted:

```
1677  UPDATE 0
 555  psql: error: /srv/nfc/ops/sql/autoclose.sql: Permission denied
   3  UPDATE 1     (all three from this run's own seeded shifts)
```

`nfc-autoclose.service` runs as `User=postgres` and reads a file `ops/deploy.sh` rsyncs as
`0640 exedev:app` under `0750` directories. Between **2026-07-28T17:45Z and
2026-08-03T12:15Z** psql could not open it. It exited 1. systemd marked the unit failed,
**555 consecutive times over six days**, and the safety net decision-10 promises the owner
did not exist for that week.

Nothing noticed, because `systemctl list-timers` was green throughout: **a timer's health is
whether it FIRED**, not whether what it fired succeeded. No unit on this box has an
`OnFailure=`.

It works today only because `postgres` is now in the `app` group. That membership is in no
commit, no unit file, no runbook and no deploy script. **Provision a fresh VM from
`runbook-vm-provisioning.md` and the outage comes back exactly.**

`ops/check-timers-ran.sh` is the assertion that was missing. Per timer: not failed, last
execution exited 0, fired inside its own window, and — the arm that would have gone red on
2026-07-28 — the unit's `User` can actually **read the file the unit reads**. The mutant
runner re-creates the fault on the box (`gpasswd -d postgres app`, `chmod 0600`) and reverts
in a trap.

### And the timers now actually do something, observed

Both had gone their whole lives unobserved: 1677 lines of `UPDATE 0`, and 20 dumps nobody
had ever fed back into a Postgres.

| what | result |
|---|---|
| 9h shift, real unit | closed at `start+8h`, `auto_closed=true`, `corrected_at=NULL` |
| 7h shift, same run | **still open** — the window is a window, not a broom |
| run it twice | `UPDATE 0` — idempotent, as `autoclose.sql` claims |
| the closed shift | lands in the worker's resolution queue, not in payroll |
| fresh dump restored | fingerprint **identical** to production |
| previous dump restored | **different**, RED first — the comparison can tell two databases apart |
| schema round trip | same 61 indexes, `shifts_one_open_per_worker_idx` present, 8 migrations |

---

## 5 · Postgres refuses connections mid-request — no human needed

| observation | measured |
|---|---|
| the API process | stays **up**. Same PID before and after. No crash loop. |
| a clock-in | `500` → phone classifies **retryable** → queued → replay lands `201` |
| `/health` | goes `500`. A real health check, not a liveness ping. |
| the panel | HTML `200`, `/admin/data` `500` |
| recovery | **2 s** after Postgres returned, unaided |

The unchanged PID is the proof, not the recovery. `Restart=always` would also produce a
healthy box after a crash loop, and that is a *worse* outcome — a restart drops every
in-flight request. An unchanged PID says `pg.Pool` re-dialled inside a process that never
went away.

**Hours are delayed, not lost.**

> **What the director saw, before commit 5456650:** a red error line *and*, beneath it in
> brighter, larger type, a permanent `Wird geladen…`. Two contradicting statements, the
> louder of them false; desaturated, the failure ranked *below* the spinner. On `/objekte`
> the error sat ~370px above a table that said `Objekte werden geladen …`, so a director
> reading the table never saw it. Twelve screens, one condition each. Re-photographed after
> deploying: the table now says what happened. `demo/check-load-failure.mjs` holds it.
> The remaining half — `.form-error` being colour and nothing else, and create buttons
> staying bright and enabled on a dead screen — is TASK-229.

---

## 6 · The API restarts, and the whole VM reboots

Both done with a shift **open**.

- **restart**: `GET /shifts/open` still returns the running shift, so the phone re-arms its
  lock screen and its ongoing notification with no worker action. The worker session
  survives because it is a row, not process memory — a server keeping sessions in a `Map`
  would pass every other assertion here and log the cleaner out.
- **reboot**: serving again in **~21 s**, nobody logged in. `postgresql`, `nfc-api`,
  `nfc-autoclose.timer`, `nfc-backup.timer` all came back on their own; the running shift
  was still running; the tag host, being a different VM, never noticed.

Done twice — the second time to prove the new `User=app` unit survives a cold boot.

`network.target` and not `network-online.target` in the unit is deliberate:
`systemd-networkd-wait-online` is **disabled** on this VM, so the online target buys nothing
and risks the 120 s wait-online timeout. The API tolerates a database that is not up yet
anyway — see § 5.

---

## 7 · The disk fills

Filled to **4 MB free** on the live box.

- a clock-in and a clock-out **both still worked**. A shift row is a few hundred bytes and
  Postgres has WAL already allocated.
- the backup still succeeded — 4 MB is plenty for a 7 KB dump. *On a real payroll database
  it would not be*, and the honest reading of this section is that the database is currently
  too small for the disk to be the acute risk.
- pg-backup.sh's protections are real: `MIN_BYTES`, `gzip -t`, a header check, and rotation
  that runs **only after** a clean verify, so a full disk cannot rotate good dumps away in
  favour of a truncated one.

**Nothing on this box alerts on free space.** The backup failing is the only signal, it goes
to journald, and journald is on the same disk.

---

## 8 · The tag host goes down entirely

`nginx` stopped on `timesheets.exe.xyz` — the host printed on the cards on the walls.

- **a cleaner still clocks in.** `201`. The card's URL is parsed on the phone and the shift
  goes to the API host, which is a different machine. **The two-host split earns its keep
  here** (decision-40).
- what stops: a phone **installing the app right now** cannot verify App Links, so its taps
  open a browser instead of the app until the host is back.
- **nothing corrupts.** The tag host has no database and no writes — there is no state on it
  to lose, only availability. No card needs rewriting.
- the API host serves the same association bytes, and that is **not** a fallback: assetlinks
  is fetched per *hostname*, and the card names the tag host.

---

## 9 · A migration queueing behind the nightly dump — TASK-228

`nfc-backup.timer` fires at 00:13; `db/migrate.js` runs whenever anyone deploys. Nothing
schedules around anything and neither sets a lock timeout.

The hazard is locks, not corruption. `pg_dump` holds `ACCESS SHARE` on every table for the
whole dump; `ALTER TABLE` needs `ACCESS EXCLUSIVE` and queues — and Postgres then queues
**every later query on that table behind the queued ALTER**, because lock requests are
ordered. Measured, holding `ACCESS EXCLUSIVE` on `shifts` for 12 s:

```
the dump queued ~11s for its lock, and still produced a VERIFIED dump
a SELECT on shifts issued inside the window waited 9s for an answer
```

That SELECT is the query a clock-in makes. Ordering *was* the measurement: timing it after
the dump returned found the lock already released and reported 0 s — a check that would have
said "no collision" while describing the collision correctly in its own comment. An
unauthenticated `POST /shifts/open` would have been worse still: it 401s before touching the
table and reports healthy milliseconds while the table is unusable.

Today the dump is milliseconds and the window is invisible. `SET lock_timeout` in
`migrate.js` is the fix, and it fails the *deploy* instead of the *door*.

---

## 10 · Every backup is on the same disk as the database — TASK-227

```
/var/backups/nfc     /dev/root
/var/lib/postgresql  /dev/root
```

`pg-backup.sh` says this about itself, in capitals, at the top. The offsite hook underneath
is still a commented-out TODO with three options and no choice made.

The backup itself is now proven good (§ 4): it runs, it restores, the restore is identical
to production, the schema survives, it fails loudly rather than truncating, and it survives
colliding with a migration lock. **It is simply in the wrong place.** It protects against
`DROP TABLE`, a bad migration and a fat-fingered edit. It protects against nothing that
kills the disk or the VM — and decision-16 made hardware failure our risk.

This is payroll data.

---

## What held, under a real race

`ops/break-taps.sh`, with curl processes started together and reaped together. A sequential
pair proves the *handler* is idempotent; only a genuine race proves the *index* is.

| done at a door | outcome |
|---|---|
| two identical taps at once | `200` + `201`, **one** row, no 500 |
| two taps, different keys, at once | `409` + `409`, still one open shift |
| the same tap replayed later | `200 duplicate:true`, the stored row |
| a replay claiming a start 5h earlier | stored `start_time` **unchanged** — a retry cannot inflate a payslip |
| a tap while a shift is open | `409 shift_already_open`, **with** the offending shift |
| a tap at a different building | `409`, no row written |
| a close naming another building | `422 wrong_building`, shift left open |
| a clock-out with no clock-in | `404 unknown_shift`, nothing invented |
| two clock-outs at once | `200` + `200`, one `end_time` |
| one sign-in code, two phones at once | exactly one `200`, exactly one new session, loser gets the byte-identical `invalid_code` body (decision-26) |

### The 8h timer racing a tap-out — both arms

The race is not ours to schedule, so the second arm was run **deterministically** rather than
left to a re-run and a hope.

- **worker wins** → a clean, human-confirmed close; the timer's UPDATE matches zero rows
  because `end_time` is no longer NULL.
- **timer wins, worker taps out late** → `200 duplicate:true` (no error at a door for a
  shift the server already closed), still `auto_closed=true` and `corrected_at=null` so the
  app routes to the **resolution screen** instead of pretending the tap counted, and
  `end_time` stays `start+8h` — nobody is paid for the gap.

Both losers are safe **by construction, not by timing**: `autoclose.sql`'s WHERE requires
`end_time IS NULL` and its SET makes it non-NULL, so a row can match at most once ever; and
`closeShift`'s UPDATE carries the same clause and falls back to re-reading the winner.

---

## Two files that were documents and are now artefacts

`ops/systemd/nfc-api.service` had never been compared to the box. They disagreed about the
two lines that matter most:

```
repo  ExecStart=/usr/bin/node --import /srv/nfc/instrument.mjs /srv/nfc/server.js
box   ExecStart=/usr/bin/node /srv/nfc/server.js
repo  User=app
box   User=exedev
```

The first is § 3. The second is that the API ran **for months as a sudo-group account with a
login shell**, while `ops/deploy.sh`'s own comment explains why it must not: *"app is a
--system user with no shell and no sudo: if the API is ever popped, it cannot rewrite its own
code, and it cannot escalate the way the sudo-group exedev could."*

`deploy.sh` step 5b now installs the units and runs `check-unit-drift.sh`, which compares
`systemctl cat` — what systemd **loaded**, not what is on disk — and `/proc/<pid>/cmdline` of
the process actually serving. A unit edited without a `daemon-reload` passes a file
comparison and is still not running.

Verified live: running as `app` with `--import`; `/health`, the panel, both association
files and `/app/download` (sha `bf3ff8be…`, byte-identical to the file on disk) all 200; a
cold reboot comes back serving in 21 s still as `app`; `smoke-live` 82 assertions green.

---

## What this run did NOT test

- **a real phone losing signal in a real basement.** The queue's behaviour is proven in pure
  Kotlin and its ceiling is measured by reading the source; no radio was involved.
- **Postgres corrupting itself.** The disk was filled, not damaged. A torn page, a bad
  sector or a `fsync` lie is a different failure and nothing here speaks to it.
- **the map flake** (TASK-206) — untouched by this run, and still unproven against a warm
  human browser.
- **anything on a physical card** (TASK-222) — the owner's, by hand.
- **more than one concurrent worker.** Every race here is one worker's two requests. Twenty
  cleaners tapping at 06:00 is a load question, not a correctness one, and it has not been
  asked.
