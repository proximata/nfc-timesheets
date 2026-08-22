
## Project: NFC TimeSheets

NFC-based shift tracking for a Vienna cleaning company. Workers tap NFC tags at building entrances to clock in/out. Admin manages workers, locations, and reviews hours/payroll.

### Architecture

- **iOS app** (`NFCTimeSheets/`): SwiftUI + SwiftData + CoreNFC. Background NFC via universal links. TestFlight distribution.
- **Server** (`server/`): Node.js REST API on exe.dev VM (`timesheets.exe.xyz`). Postgres 16. PM2 process manager.
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

- **API + DB**: exe.dev VM `timesheets.exe.xyz` (SSH: `ssh timesheets.exe.xyz`). **systemd** + Postgres on localhost. No Docker (decision-1); systemd replaced PM2 (decision-18). Supabase is deferred, not rejected (decision-16).
- **Frontend**: static Next.js export served by the same Node API process (decision-16). NOT Vercel — decision-11 is superseded. Cloudflare Pages (decision-14) is deferred.
- **AASA + assetlinks + `/t`**: served from the TAG host `timesheets.exe.xyz` — its own tiny VM,
  stock nginx, three static files, public proxy, no DB and no code (`ops/tag-host/`,
  decision-40). The API host serves the same bytes as a fallback.
- Auto TLS via exe.dev proxy (API) and Vercel (frontend)

### Workflow Review Gate

When executing tasks via workflows, the decision compliance check is a **dedicated review agent** that runs AFTER all implementation tasks complete — NOT inside each task. The review gate agent:

1. Reads ALL files in `backlog/decisions/` (use `ls backlog/decisions/` then read each)
2. Reads all code changes produced by the implementation tasks
3. Verifies no new code contradicts any accepted decision
4. Checks code quality: style consistency, duplication, error handling
5. Reports violations with decision ID + offending code
6. BLOCKS completion if violations found

Each implementation task should be formulated to unambiguously specify HOW to implement with regards to decisions. But the review gate is the safety net.

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

~~decision-37~~ (zones, no area) is SUPERSEDED by decision-43 and nothing from it shipped.

Decisions can only be changed by creating a new decision record that supersedes the old one.

### i18n

Default language: German. For 3A: develop in English, i18n infrastructure in place, German locale files with English placeholder content. No hardcoded user-visible strings.

### Dependencies

- Pin all npm versions exact (no `^` or `~`)
- `.npmrc` must have `save-exact=true`
- Prefer latest stable minus one minor for major deps
- Use pnpm, never npm or yarn

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
