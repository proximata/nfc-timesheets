
## Project: NFC TimeSheets

NFC-based shift tracking for a Vienna cleaning company. Workers tap NFC tags at building entrances to clock in/out. Admin manages workers, locations, and reviews hours/payroll.

### Architecture

- **iOS app** (`NFCTimeSheets/`): SwiftUI + SwiftData + CoreNFC. Background NFC via universal links. TestFlight distribution.
- **Server** (`server/`): Node.js REST API on exe.dev VM (`schimmer-glanz.exe.xyz`, the `apiHost` — decision-40). Postgres 16. systemd (decision-18, replaced PM2).
- **Web admin** (`web/`): Next.js App Router, pnpm, Biome, TypeScript. Desktop-first. Served from same VM.
- **AASA + landing** page served from the same Node server at `/.well-known/apple-app-site-association` and `/t`.
- **GitHub Pages** (`pages/`): DEPRECATED for AASA. Kept for reference only.

### Key files

- `NFCTimeSheets/NFCTimeSheets/ContentView.swift` — main app UI + API layer
- `NFCTimeSheets/NFCTimeSheets/NFCReader.swift` — NFC tag UID reader
- `NFCTimeSheets/NFCTimeSheets/NFCTimeSheetsApp.swift` — SwiftData models (Shift, Site)
- `server/server.js` — REST API
- `APPS-101.md` — original NFC roadmap (reference)
- `Backlog.md` — iteration 3A backlog (canonical is in `backlog/tasks/`)
- `state.md` — project state snapshot
- `backlog/decisions/` — architectural decision records (ADRs)

### Desktop APK copy

`~/Desktop/` holds exactly ONE signed release APK for this project, filename carrying its
version tag (e.g. `nfc-timesheets-0.5.5-12-release.apk`). A new release REPLACES it — delete
the old file, `cp -p` the new one in. Never leave multiple versions side by side on the Desktop.

### Apple Developer

**Source of truth is `ops/branding.json`, not this list** (decision-24). The values below are a
convenience copy; if they ever disagree with `branding.json`, `branding.json` wins and
`node ops/check-branding.mjs` is what says so. Shipping under a different signing identity:
`ops/REBRAND.md`.

- Team ID: `6Y842FE8Q4`
- Bundle ID: `io.github.qwadratic.NFCTimeSheets`
- TestFlight: active, internal track
- Associated Domains: a literal in the entitlement on purpose — templating it makes an
  unconfigured build emit `applinks:` and kills universal links. It currently reads
  `applinks:schimmer-glanz.exe.xyz`, i.e. the RENAMEABLE host: iOS is not yet on the two-host
  model (decision-40). Works today because the API host serves the association files too.

### Hosting

- **API + DB**: exe.dev VM `schimmer-glanz.exe.xyz` (the `apiHost` — SSH: `ssh schimmer-glanz.exe.xyz`). **systemd** + Postgres on localhost. No Docker (decision-1); systemd replaced PM2 (decision-18). Supabase is deferred, not rejected (decision-16).
- **Frontend**: static Next.js export served by the same Node API process (decision-16). NOT Vercel — decision-11 is superseded. Cloudflare Pages (decision-14) is deferred.
- **AASA + assetlinks + `/t`**: served from the TAG host `timesheets.exe.xyz` — its own tiny VM,
  stock nginx, three static files, public proxy, no DB and no code (`ops/tag-host/`,
  decision-40). The API host serves the same bytes as a fallback.
- Auto TLS via exe.dev proxy (API) and Vercel (frontend)

**Why two domains at all** (decision-40, still `status: proposed` in the record but already the
live split — flag this to the owner next time that decision is touched): a tag host written
onto a physical NFC card cannot be renamed without a site visit per building, so it has to be
permanent (`timesheets.exe.xyz`); the API/DB box is just a server, so it stays renameable
(`schimmer-glanz.exe.xyz`, née `timesheets.exe.xyz` — the July rename that killed a live tag is
the reason this split exists at all). The reason is **background NFC tap resolution and Android
App Link verification** — the tag's host must serve `assetlinks.json`/AASA itself, and Android's
`autoVerify` fails for every host in the intent filter if even one of them stops answering. It is
**not** about push notifications: the 8h shift-timeout reminder (decision-10, TASK-12) is a local
on-device notification and has no host dependency of any kind.

### Workflow Review Gate

When executing tasks via workflows, the decision compliance check is a **dedicated review agent** that runs AFTER all implementation tasks complete — NOT inside each task. The review gate agent:

1. Reads ALL files in `backlog/decisions/` (use `ls backlog/decisions/` then read each)
2. Reads all code changes produced by the implementation tasks
3. Verifies no new code contradicts any accepted decision
4. Checks code quality: style consistency, duplication, error handling
5. Reports violations with decision ID + offending code
6. BLOCKS completion if violations found

Each implementation task should be formulated to unambiguously specify HOW to implement with regards to decisions. But the review gate is the safety net.

**The gate also runs this project's existing whole-surface checks, not just a re-read of the
diff** — `node ops/check-branding.mjs` (host/appID drift across iOS/Android/web) and, for any
run that touches `NFCTimeSheets/`, `NFCTimeSheets/checks/run.sh`. Both already exist and
`deploy.sh` already runs `check-branding` as step 0 before a build — but that is DEPLOY time,
after the workflow has already told the owner "done". A workflow's own final report must run
these too and quote every non-`ok`/non-`FAIL`-free line (`check-branding` prints `TODO` lines
for known, accepted gaps — e.g. iOS still names the renameable host, not the permanent tag
host, TASK-188 — and those belong in the report a human actually reads, not only in a script's
stdout nobody re-runs).

Concrete case this caught (2026-08-25): the `ios_tag_writing_and_operator` run
(TASK-246/decision-49) shipped new UI that shows an operator a `Will write https://…` URL, and
its Verify phase proved the byte encoding, the overwrite guard and the untouched entitlement —
rigorously — but never ran `check-branding.mjs`, so the pre-existing "iOS still names
schimmer-glanz.exe.xyz, not the permanent tag host" TODO stayed buried in that one check's own
output instead of reaching the run's summary. Separately, the entitlement's own doc
(`docs/NFC-WRITE-SETUP.md`) has always said "NDEF is App Store error 90778 — read the array
before you build", enforced by nothing but a human's eyes; it regressed for real the same day.
Both gaps are now closed the same way — as a CHECK, not a paragraph:
`NFCTimeSheets/checks/entitlement-format-check.swift` (wired into `checks/run.sh`) fails if
`com.apple.developer.nfc.readersession.formats` is ever anything but exactly `["TAG"]` or
absent; `check-branding.mjs`'s TODO line for TASK-188 already existed and just needed a workflow
that actually runs it and repeats what it says.

Decision checklist (keep updated as decisions are added):

- No Docker (decision-1)
- Postgres for persistence (decision-2)
- Next.js + pnpm + Biome, no ESLint/Prettier (decision-3)
- AASA on exe.xyz (decision-4)
- NFC location = URI-encoded ID (decision-5)
- Material costs pro-rata by labor hours (decision-6)
- Web admin desktop-only + mobile blocker (decision-7)
- All strings externalized for i18n (decision-8)
- npm versions pinned exact (decision-9)
- 8h shift auto-timeout + mandatory resolution (decision-10)
- ~~Frontend on Vercel~~ (decision-11) — SUPERSEDED by decision-16
- Supabase (decision-12) DEFERRED and its free-tier risk (decision-13) MOOTED by decision-16
- Cloudflare Pages for the admin panel (decision-14) DEFERRED by decision-16
- Tag hostname stays `timesheets.exe.xyz`, tags left unlocked (decision-15)
- TWO HOSTS: `tagHost` (timesheets.exe.xyz) is PERMANENT — it is written on physical cards and
  serves only the association files + `/t`; `apiHost` (schimmer-glanz.exe.xyz) is renameable.
  The app parses the tag host and talks to the API host. The API host must NEVER be in an
  `autoVerify` intent filter. `ops/branding.json` carries both (decision-40, amends d15 + d24)
- Everything server-side on the one exe.dev VM; no framework, no ORM, no router (decision-16)
- next-intl, English messages for MVP (decision-17)
- systemd, not PM2 (decision-18)
- Shift posted at clock-IN; server is authoritative for open shifts (decision-19)
- Web admin uses email + password; the admin PIN is gone (decision-20)
- Tag URI carries the location UUID, never the slug (decision-21)
- Worker identity via Sign in with Apple; identity comes from the session, never the body (decision-22)
- Sentry on API + iOS; server deps are now `pg` + `@sentry/node` and nothing else. Telemetry
  must never be required to boot and must never block a clock-in (decision-23, amends decision-16)
- Operator identity is configuration: `ops/branding.json` is the single source, the well-known
  files are generated (`ops/gen-wellknown.mjs`) and committed, the AASA appID list is
  append-only, the iOS entitlement stays a checked literal, and `ops/check-branding.mjs` +
  `server/wellknown/verify.sh` are the gates (decision-24)
- A worker's `hourly_rate_cents` is REQUIRED and `> 0`. No DEFAULT, no inactive-row exemption,
  and the `Kein Stundensatz` / `Nicht bewertet` machinery is deleted (decision-41)
- Revenue is a typed, append-only monthly fact per building (`location_revenue`); the contract
  is a SUGGESTION and is never accrued into the P&L (decision-42, amends decision-28)
- ZONES are a child of `locations` and carry `area_sqm` (NULLable). The building's area is
  `SUM()`, never stored. **`zone_state` ('zoned'/'unzoned') is PRESENTATION ONLY** — a grey pin
  and a sentence. It must never touch `locations.active`, tap resolution, payroll, the P&L or
  the portal: an unzoned building clocks workers in exactly as before, and a BUILDING UUID on a
  card resolves to the BUILDING for ever (decision-43, SUPERSEDES decision-37)
- A tag serial is a column on a zone delivered through the roster; `KnownTags.kt` is deleted
  only AFTER a zone row carries the serial (decision-44) — and, per decision-47, only after that
  zone is VERIFIED
- A zone is NOT a clock-in target until an OPERATOR test-scans its card in the field
  (`zones.verified_at`, `POST /operator/zones/:id/verify`, which posts no shift and cannot).
  Minting a NEW building-level tag is retired: `POST /admin/tags/:id/resolve-building` is DELETED
  and a new building is created tag-free via `POST /admin/locations`, then the reported card
  becomes its first zone. **The HOIV building card is grandfathered BY NAME and is not
  deprecated** — the gate is ZONE-only and `activePlace`'s building branch is untouched
  (decision-47, AMENDS decision-43; `backlog/docs/ZONE-VERIFICATION.md`)
- iOS writes tags again, for TAG WRITING and the OPERATOR TEST SCAN only. `NdefTag.kt` and
  `WriteGuard.kt` are PORTED clause for clause, not reinvented; the operator session is its own
  cookie jar and its own `URLSession` so no request ever carries `ts_worker` and `ts_operator`
  together; ZERO new server endpoints; `/admin/tags/resolve-*` is the WEB ADMIN's, never the
  phone's. The `com.apple.developer.nfc.readersession.formats = ["TAG"]` entitlement and the
  Xcode capability are the OWNER's one click — no agent edits the entitlement or
  `project.pbxproj`; the code degrades in words instead (decision-49, `docs/NFC-WRITE-SETUP.md`)

~~decision-37~~ (zones, no area) is SUPERSEDED by decision-43 and nothing from it shipped.

Decisions can only be changed by creating a new decision record that supersedes the old one.

### i18n

Default language: German (Austrian business German), English kept in the switcher (decision-17).
No hardcoded user-visible strings, on either platform, ever.

**Every new page/screen ships with BOTH `web/messages/en.json` and `web/messages/de.json`
complete, at the same time it ships — never as a follow-up.** Concretely, before calling a
screen done:
- every string on it goes through `useTranslations`/`t()`, never a bare JSX literal
- the same keys exist in both message files with the same argument placeholders
  (`scripts/check.mjs` gates key-SET parity automatically — run it)
- but the check only proves the two files agree with EACH OTHER, not that a given page
  actually uses them: a page can hardcode text in one language and still pass. Grep the new
  file for `useTranslations` yourself; its absence is the tell (this is exactly how
  `web/app/tags/page.tsx` shipped German-only with zero i18n, found 2026-08-24).
- same rule for Android (`res/values/strings.xml` German default, `res/values-en/`) and iOS
  (`Localizable.xcstrings`) — a new screen on either app ships both languages too.

**Adding a translatable string — same procedure on every platform, no matter which feature:**
1. Never write a bare string literal in UI code. Add a key instead.
2. Add that key to BOTH language files in the SAME commit — `web/messages/en.json` +
   `de.json`, `res/values/strings.xml` (German) + `res/values-en/strings.xml`,
   `Localizable.xcstrings`'s `de` AND `en` entries. There is no follow-up-commit exception.
3. Reference it only through the platform's lookup, never interpolate around it:
   `useTranslations()`/`t('namespace.key')` on web, `stringResource(R.string.key)` /
   `context.getString()` on Android, `String(localized:)` / a `LocalizedStringKey` on iOS.
4. Run the gate that exists: `pnpm verify` runs `web/scripts/check.mjs`, which checks
   `en.json`/`de.json` key-SET parity, ICU/plural-argument parity, and non-empty values — web
   only, and it proves the two files agree with EACH OTHER, not that your new file calls `t()`.
   Grep your new file for `useTranslations` yourself; its absence is the tell (this is exactly
   how `web/app/tags/page.tsx` shipped German-only, found 2026-08-24).
5. Android and iOS have no automated parity gate yet — the check there is a manual read of
   both files side by side before calling the screen done.

### Dependencies

- Pin all npm versions exact (no `^` or `~`)
- `.npmrc` must have `save-exact=true`
- Prefer latest stable minus one minor for major deps
- Use pnpm, never npm or yarn

### Local dev environment assumptions

Gotchas discovered the hard way on this Mac. Not portable — see closing note.

**Shell / tooling**
- `rtk` (this project's shell wrapper) mangles output: prefixes `grep` with line numbers
  unasked, strips `ls` fields so sizes read 0KB. For scripted/parsed output use absolute paths:
  `/usr/bin/grep`, `/bin/ls`, `/usr/bin/awk`, `/usr/bin/git` — not the rtk-wrapped versions.
- `setsid` does not exist here — use `nohup`.
- `/usr/bin/cat` does not exist at that literal path — use plain `cat` via `PATH`, or verify first.
- macOS `ps` has no Linux `etimes` field — parse BSD-style `etime` instead. When killing a
  specific process (e.g. headless Chrome), match on `ps -o comm=` (actual executable), not the
  full command line — an agent's own shell args can contain the same substring and get killed.
- Headless Chrome with flags like `--dump-dom` can hang forever at 0% CPU if the page never
  settles — always wrap it with an explicit timeout.

**Android toolchain**
- No system Java, no Android SDK by default. `apksigner`, `gradlew`, `apkanalyzer` all fail
  with "Unable to locate a Java Runtime" unless exported first:
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` (Android Studio's
  bundled JBR) and `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` (Homebrew's
  cmdline-tools). Export both before any `android/`, `gradlew`, or `apksigner`/`apkanalyzer` call.
- NFC does not work on Android emulators — needs a physical device. Xcode Simulator likewise
  can't receive a real universal-link NFC tap (Safari opens instead of the app) — DEBUG-only
  mock hooks exist in both codebases for this, gated unreachable in release builds.

**Secrets / psst**
- `psst` is PROJECT-SCOPED. `psst get <NAME>` run outside the project root does not error — it
  silently returns the literal string `Run: psst init` instead of the secret. Looks like a
  missing-secret bug, is actually a cwd bug. Always `cd` to project root first.
- `psst export --tag <tag>` silently IGNORES `--tag` and dumps the whole vault — never use it
  to scope a sync. Instead `psst list --tag <tag>` then `psst get <name>` per name.
- The pre-commit gate (`psst scan --staged` in `.githooks/pre-commit`) has no length/entropy
  floor — can false-positive-block a commit on a short number that happens to match a vaulted
  secret (e.g. a vaulted PORT number), or on a line that only REMOVES an already-committed
  secret occurrence. Workaround: `PSST_SKIP_SCAN=1 git commit ...`. Never skip gitleaks too.
- gitleaks has two different scopes: `gitleaks detect` scans commit HISTORY only. To scan the
  working tree (uncommitted/untracked files) use `gitleaks dir .` instead.

**SSH / remote**
- Two long-lived-connection setups already configured for exe.dev VMs: (a) OpenSSH
  ControlMaster in `~/.ssh/config` for `Host *.exe.xyz` / `exe.dev`
  (`ControlPath ~/.ssh/cm/%C`, `ControlPersist 10m`) so plain ssh/scp/rsync reuse one
  TCP+auth handshake; (b) `~/.pi/agent/bin/rsh`, a tmux-backed persistent shell tool
  (open/run/send/peek/status/close/ls) for multi-step remote work where state (cwd, env,
  sudo timestamp) must persist between commands. Prefer `rsh` over one-shot `ssh` whenever
  more than one remote command is needed in sequence.
- exe.dev VMs on the "exeuntu" base image ship pi/claude/codex as pre-installed static Bun
  binaries but have NO system node/npm by default — `pi install npm:...` fails with
  "Executable not found in $PATH: npm" until `sudo apt-get install -y nodejs npm` runs first.

**Git hazards**
- `git stash -u` (include untracked) creates a 3-parent stash commit (tracked+untracked+index).
  A forced `filter-branch` across all refs afterward silently DROPS that third parent —
  popping the stash later only restores tracked edits, losing untracked work silently.
  Possible recovery: `git checkout refs/original/refs/stash^3 -- .`. Never rewrite history
  while untracked work sits in a stash.
- `gh` on this machine is authenticated as GitHub account `qwadratic`; the repo itself now
  lives under the `proximata` org (transferred from qwadratic's personal account) —
  pushes/PRs act as that authenticated user against the proximata org repo.

**workflow tool quirks (pi-dynamic-workflows)**
- The `workflow` tool's script parser is not plain JS: it statically scans the ENTIRE script
  source — including prose inside agent prompt strings — for banned tokens before running
  anything (includes certain nondeterministic built-ins and the backtick character). A
  backtick-delimited code span in prompt prose, or array-destructuring a `parallel()` result
  directly (e.g. three names from one `const`), both cause an immediate parser-level syntax
  error with ZERO agents run. Avoid backticks in prompt prose; index `parallel()` results by
  position instead of destructuring.
- The `name` parameter only accepts the 5 built-in workflow names (deep-research,
  adversarial-review, code-review, multi-perspective, codebase-audit). To run a custom
  prepared `.mjs` script, pass its full text content via the `script` parameter — a file path
  string does nothing.
- Overlapping runs sharing one git index and one working tree have already put one run's
  uncommitted code into another run's commit, and left orphaned processes on the fixed ports
  the demo probes use. Before launching any run whose agents will EDIT files, see
  `ops/WORKTREES.md` (TASK-210) — one git worktree per run, or `git commit -o <path>` as the
  cheap fallback for a short single-file run. Never `git add -A` either way.

**Backlog.md CLI**
- `backlog task create` (and similar interactive commands) HANG FOREVER on stdin when run by
  an agent — always append `</dev/null`.
- `backlog task list --plain` has been observed to return empty To-Do/In-Progress sections
  even when such tasks exist on this project's board — when that happens, grep `status:`
  directly in `backlog/tasks/*.md` instead of trusting the CLI output.

**Local ports / services**
- Port 3000 already has a pre-existing, unrelated node process listening and answering 307
  redirects on this Mac — any local web preview/dev-server work must use port 8080 instead,
  never assume 3000 is free.
- The Google Maps browser API key for this project is HTTP-referrer-restricted to exactly
  `https://schimmer-glanz.exe.xyz/*`, `http://localhost:3000/*`, and `http://127.0.0.1:8080/*`
  — nothing else. Any local map prototype must be served over `http://127.0.0.1:8080` (a real
  HTTP server, e.g. `python3 -m http.server`) with the key injected at serve time; opening it
  as a `file://` URL always fails with `RefererNotAllowedMapError`, and other ports/hosts are
  silently rejected too. This has caused repeated false "the map is broken" scares — check the
  port before concluding the map itself is broken.
- `gcloud` and the `supabase` CLI are pre-installed and pre-authenticated at
  `/opt/homebrew/bin`; the `vercel` CLI is installed but NOT logged in (would need interactive
  login before any vercel-dependent step — Vercel is not part of this project's current
  architecture though, so likely moot).

This section documents THIS machine's setup, discovered from real incidents — it is not a
portability guarantee for any other machine.

<!-- BACKLOG.MD GUIDELINES START -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Use the detailed guides when needed:
- `backlog instructions task-creation` for creating or splitting tasks
- `backlog instructions task-execution` for planning and implementation workflow
- `backlog instructions task-finalization` for completion and handoff

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
