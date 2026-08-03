# NFC TimeSheets — Project State

**Last updated**: 2026-07-28 grooming session  
**Current iteration**: 3A (demo → pilot)  
**Status**: 3A implemented (server, schema, ops, web admin shell, iOS rewrite). Not deployed.
See `backlog/docs/BLOCKER-FIX-REPORT.md` for what still blocks deploy.

## Confirmed Facts
- **Operator identity lives in `ops/branding.json`** (decision-24). The three lines below are a
  copy for readers; the file is the source and `node ops/check-branding.mjs` enforces it.
  Rebranding runbook: `ops/REBRAND.md`.
- Apple Developer Team: `6Y842FE8Q4`
- Bundle ID: `io.github.qwadratic.NFCTimeSheets`
- TestFlight: active, v1.0 build 1+ on internal track
- Server VM: `timesheets.exe.xyz` (exe.dev), Node 22 + Postgres 16, systemd unit `nfc-api`
  running as the unprivileged `app` user (decision-16, decision-18). The old root/`setsid`
  arrangement is retired.
- Auth: APP_KEY (baked into the app binary; the legacy value is BURNED and must be rotated
  before the proxy goes public). No ADMIN_PIN — removed by decision-20; the web admin uses
  email + password (`admins` table, `server/bin/create-admin.js`). Never write a live secret
  into this file; `legacy-backup/` and `.vm-legacy-backup/` are gitignored for that reason.
- AASA: was on GitHub Pages (`qwadratic.github.io`), moving to exe.xyz
- NFC tags: blank NTAG213/215, need NDEF URI write
- City: Vienna
- Test data: throwaway (2 workers, 1 location, 3 shifts)

## Decisions Made (this session)
- Postgres replaces JSON file store
- Background NFC (Path C) is priority #1
- AASA served from exe.xyz (GitHub Pages dropped — MIME type issue)
- NFC tag URI: `https://timesheets.exe.xyz/t?l=<LOCATION_UUID>` (decision-21 — the UUID, never
  the slug: a guessable id on an unlocked tag enumerates every building)
- Manual scan button removed, replaced with "approach tag" passive UI
- Web admin: Next.js App Router + pnpm + Biome, desktop-first
- Mobile web: blocker message, no responsive layout
- 8h shift auto-timeout: local notification + server cron
- Material cost attribution: pro-rata by labor hours per building (3B)
- Hourly rates + payroll calc: in 3A scope
- P&L, contracts, material requests: 3B (stubs only in 3A)
- No Docker, no PM2 — systemd on the exe.dev VM (decision-1, decision-18)
- No export this iteration
- Android: research only, no implementation

## Bugs Fixed (this session)
- Server admin shift sort: was garbled string concat, now `b.start.localeCompare(a.start)`
- Server README: was lying about Cloudflare D1, now accurately describes plain Node + JSON

## Confirmed (this session)
- ✅ NFC tag URI path: `/t?l=<LOCATION_UUID>`
- ✅ 8h auto-timeout: the timer auto-closes the shift, the app forces resolution before the
  next tap. Two flags, two facts (decision-10): `auto_closed` = the timer did it,
  `corrected_at` = a human fixed it. The old single `manualFinish` flag is GONE — it was set
  by both and so could distinguish neither.
- ✅ v2 stubs: Material Requests, P&L Dashboard, Contract Management, Building Analytics
- ✅ Location ID encoded in NDEF URI (option A), not hardware UID

## Skills Installed
- `requirements-gathering` (project-local)
- `using-exe-dev` (project-local)
- `nextjs-app-router-patterns` (project-local)
- `biome-js` (project-local)
- `exe-dev-knowledge` (available in other agent dirs)

## Artifacts
- `Backlog.md` — 20 tasks, MoSCoW prioritized, with acceptance criteria + dependencies
- `APPS-101.md` — original roadmap (still valid as reference)
- `server/README.md` — corrected to match actual implementation
