# NFC TimeSheets — Iteration 3A Backlog

**Goal**: Working demo → deployable pilot for a real cleaning crew in Vienna.  
**Focus**: Background NFC, Postgres, web admin (desktop), hourly rates, payroll view.  
**Scope discipline**: 3B stubs visible in UI for demo purposes (Material Requests, P&L Dashboard, Contract Management, Building Analytics).

---

## Theme 1: Infrastructure

### TASK-101 · Provision fresh exe.dev VM with Postgres
**Priority**: Must  
**Category**: Infra  
**Dependencies**: None  
**Description**: Create new exe.dev VM. Install Node 22 LTS, Postgres 16, PM2. Configure PM2 to run the server process with systemd startup hook. Postgres listens on localhost only, password auth.  
**Acceptance Criteria**:
- `ssh <newvm>.exe.xyz` connects
- `psql -U timesheets -d timesheets` connects
- `pm2 status` shows server process
- `pm2 startup` configured so server survives VM restart
- Old `timesheets.exe.xyz` VM preserved as rollback until 3A complete

### TASK-102 · Database schema (Postgres)
**Priority**: Must  
**Category**: Server  
**Dependencies**: TASK-101  
**Description**: Design and apply Postgres schema. Tables: `workers`, `locations`, `shifts`, `buildings` (with owner info, contract annual amount, address, coordinates, photo URL), `hourly_rates` (worker_id, rate, effective_from). Shifts reference worker + location by FK. Add indexes on shifts(worker_id, start), shifts(location_id, start).  
**Acceptance Criteria**:
- Schema applied via migration SQL file checked into repo
- FK constraints enforce referential integrity
- `\dt` shows all expected tables
- Seed script exists for dev data (workers, locations, a few shifts)

### TASK-103 · Rewrite server from JSON store to Postgres
**Priority**: Must  
**Category**: Server  
**Dependencies**: TASK-102  
**Description**: Replace `data.json` reads/writes with Postgres queries. Keep same REST API contract (app compatibility). Use `pg` (node-postgres) — already a well-known, minimal driver. Connection pool. Env vars for `DATABASE_URL`. Keep existing `X-App-Key` and `X-Admin-Pin` auth.  
**Acceptance Criteria**:
- All existing API endpoints return same shape responses
- iOS app works without changes against new server
- `data.json` no longer read or written
- Server handles concurrent POST /shifts without data loss
- PM2 restarts don't lose data

### TASK-104 · Serve AASA from exe.xyz server
**Priority**: Must  
**Category**: Infra  
**Dependencies**: TASK-103  
**Description**: Server responds to `GET /.well-known/apple-app-site-association` with correct JSON, `Content-Type: application/json`, no redirect. Serves the `/t` path as a landing page (for non-app browsers). Update iOS app's Associated Domains entitlement from `qwadratic.github.io` to the new exe.xyz hostname.  
**Acceptance Criteria**:
- `curl -I https://<vm>.exe.xyz/.well-known/apple-app-site-association` returns 200 + `application/json`
- AASA JSON contains correct `appIDs` array with team ID `6Y842FE8Q4`
- `/t` returns HTML landing page with App Store link placeholder
- iOS app's entitlements file updated

### TASK-105 · DNS / hostname cutover
**Priority**: Must  
**Category**: Infra  
**Dependencies**: TASK-101, TASK-104  
**Description**: Either rename new VM to `timesheets` (so it gets `timesheets.exe.xyz`) or set up custom domain pointing to new VM. App's `API.base` URL must remain stable or be updated in a new TestFlight build.  
**Acceptance Criteria**:
- `https://timesheets.exe.xyz/health` returns `{"ok":true}` from new VM
- AASA accessible at `https://timesheets.exe.xyz/.well-known/apple-app-site-association`
- Old VM decommissioned or renamed to `timesheets-old`

---

## Theme 2: Background NFC (Path C)

### TASK-201 · Write NDEF URI records to NFC tags
**Priority**: Must  
**Category**: iOS / Physical  
**Dependencies**: TASK-104  
**Description**: Using NFC Tools app, write NDEF URI record `https://timesheets.exe.xyz/t` to each blank NTAG213/215 tag. Document the tag UID ↔ location mapping.  
**Acceptance Criteria**:
- Each tag reads back correct NDEF URI via NFC Tools "Read" function
- Tag UID matches what's registered (or will be registered) as a location in the system

### TASK-202 · iOS: handle background NFC launch via universal link
**Priority**: Must  
**Category**: iOS  
**Dependencies**: TASK-104, TASK-201  
**Description**: Add `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)` handler to ContentView. When iOS delivers a background tag read (universal link from NDEF), extract the tag's UID from the NFC payload and trigger the same start/stop logic as the current manual scan. The NDEF URI launches the app; the app must still read the tag UID — background tag reading delivers NDEF payload (the URL), not the raw UID. **Key design question**: if we need the hardware UID (which background read doesn't give us), we need to encode the location identifier INTO the NDEF URI (e.g., `https://timesheets.exe.xyz/t?loc=LOCATION_ID`). This avoids needing a second NFC scan.  
**Acceptance Criteria**:
- Tapping phone to NDEF tag (without app open) shows iOS notification
- Tapping notification opens app and starts/stops shift for that location
- No manual "Scan" button tap required
- Works on iPhone XS and newer (background tag reading requirement)

### TASK-203 · Encode location ID in NDEF tag URI
**Priority**: Must  
**Category**: iOS / Physical  
**Dependencies**: TASK-102 (location IDs in DB)  
**Description**: NDEF URI becomes `https://timesheets.exe.xyz/t?l=<LOCATION_UUID>` (or short ID). The app parses the URL on launch to identify which location was tapped. This decouples the system from hardware UIDs for background reads. Tags rewritten once with location-specific URIs.  
**Acceptance Criteria**:
- Each physical tag has a unique URI with its location ID
- App correctly parses location from the incoming universal link URL
- Server's `/t` landing page still works (ignores query param, shows generic page)

### TASK-204 · Remove manual scan button, add "approach tag" UI
**Priority**: Must  
**Category**: iOS  
**Dependencies**: TASK-202  
**Description**: Replace the "Tap to Start" button + NFC reader trigger with a passive UI: illustration/icon showing phone near tag, text "Hold your iPhone near the tag to start/end your shift". Keep in-app NFC scan as hidden fallback (e.g., triple-tap on the illustration) for edge cases.  
**Acceptance Criteria**:
- Default Log tab shows instructional UI, no prominent scan button
- Worker can start/end shift purely via background NFC tap
- Hidden manual scan still accessible for troubleshooting

### TASK-205 · TestFlight build with Path C
**Priority**: Must  
**Category**: iOS  
**Dependencies**: TASK-202, TASK-204  
**Description**: Archive and upload new build to TestFlight. Bump build number. Test full flow: background tag tap → notification → app opens → shift logged → synced.  
**Acceptance Criteria**:
- Build appears in TestFlight internal track
- Full Path C flow verified on physical device
- AASA association works (Notes long-press test: paste `https://timesheets.exe.xyz/t?l=xxx`, long-press, "Open in NFCTimeSheets" appears)

---

## Theme 3: Shift Auto-Timeout

### TASK-301 · Server-side cron: auto-finish shifts > 8h
**Priority**: Must  
**Category**: Server  
**Dependencies**: TASK-103  
**Description**: PM2 cron or `setInterval` in server process. Every 15 min, query open shifts older than 8h. Set `end = start + 8h`, `autoFinished = true`, `needsCorrection = true`. Shift is **locked** — excluded from payroll until worker resolves it. API exposes `GET /shifts/unresolved?worker=X` for the app to pull pending corrections.  
**Acceptance Criteria**:
- Shift open > 8h auto-closed with `autoFinished: true`, `needsCorrection: true`
- Auto-closed shift **excluded** from hours/payroll aggregation
- `GET /shifts/unresolved?worker=X` returns only that worker's unresolved shifts
- Server log records each auto-closure
- Shift locked: no further clock-in/out events accepted for it

### TASK-302 · iOS: local notification at 8h
**Priority**: Must  
**Category**: iOS  
**Dependencies**: None  
**Description**: When shift starts, schedule `UNNotificationRequest` for T+8h: "Your shift at [location] was auto-finished. Open the app to confirm your hours — it won't count toward payroll until you do." Cancel if shift ended normally before 8h. Request notification permission on first shift start.  
**Acceptance Criteria**:
- Notification fires at T+8h if shift still open
- Notification cancelled if shift ended normally
- Permission requested gracefully (on first shift start, not app launch)
- Tapping notification opens the app (to the resolution flow, TASK-303)

### TASK-303 · Worker correction resolution flow (mandatory)
**Priority**: Must  
**Category**: iOS  
**Dependencies**: TASK-301  
**Description**: On app launch, fetch `GET /shifts/unresolved?worker=X`. If unresolved shifts exist, present a **modal sequence** (one shift at a time, cannot be dismissed). Each card shows: location name, shift start time, "Auto-finished at [time]" label, and a date picker for the real end time. Motivational copy: "This shift won't count toward your payroll until you confirm the actual time." Worker picks the real end time → shift updated with `manualFinish: true`, `needsCorrection: false` → synced to server → next card. After all resolved, normal app access resumes. If multiple unresolved shifts, show progress ("1 of 3"). Corrected shifts remain flagged as `manualFinish: true` on the admin panel (color-coded, not a separate column).  
**Acceptance Criteria**:
- App launch blocked by resolution modal if unresolved shifts exist
- Shifts presented one-by-one with clear context
- Worker must set real end time — no skip/dismiss option
- Motivational text references payroll exclusion
- After correction: `needsCorrection: false`, `manualFinish: true`
- Corrected shift now included in payroll aggregation
- Progress indicator for multiple unresolved shifts ("1 of 3")
- Admin panel shows corrected shifts with color tint (amber→purple transition)

---

## Theme 4: Web Admin Panel

### TASK-401 · Next.js project setup
**Priority**: Must  
**Category**: Web  
**Dependencies**: TASK-101  
**Description**: Initialize Next.js (App Router) project in `/web` directory. Use pnpm, Biome (not ESLint+Prettier), TypeScript. Pin all dependency versions (not `^` or `~`). Next.js version: latest stable minus one minor (not bleeding edge). Configure Biome for lint + format. Dev server on port 3000.  
**Acceptance Criteria**:
- `pnpm dev` starts on port 3000
- `pnpm lint` (Biome) passes with zero warnings
- `biome.json` configured for TS + React
- All versions in `package.json` are exact (no ranges)
- `.npmrc` with `save-exact=true`

### TASK-402 · Auth: admin PIN login
**Priority**: Must  
**Category**: Web  
**Dependencies**: TASK-401, TASK-103  
**Description**: Simple PIN login page. POST PIN to server, get back a session token (JWT or opaque). Store in httpOnly cookie. Server validates on all admin endpoints. No user accounts — single admin PIN, same as iOS.  
**Acceptance Criteria**:
- Login page accepts PIN
- Wrong PIN shows error
- Correct PIN redirects to dashboard
- Session persists across page refreshes
- Logout clears session

### TASK-403 · Vienna map view with building pins
**Priority**: Must  
**Category**: Web  
**Dependencies**: TASK-402, TASK-102  
**Description**: Dashboard home = map of Vienna (Mapbox GL JS or Leaflet, free tier). Buildings shown as pins with thumbnail images. Clicking pin opens side panel (slide-in animation) showing building summary: name, address, photo, total hours this period, top 5 metrics. Period selector: this week / this month / this quarter / this year / all time (5 views, prioritized in that order, default = this week).  
**Acceptance Criteria**:
- Map renders centered on Vienna
- Each building appears as a pin at its coordinates
- Pin shows thumbnail (Google Street View, uploaded photo, or text placeholder)
- Side panel slides in with building summary on click
- Period selector switches all displayed metrics
- Panel closable, map remains interactive behind it

### TASK-404 · Google Street View integration for building photos
**Priority**: Should  
**Category**: Web  
**Dependencies**: TASK-102  
**Description**: On building creation (or lazily on first view), fetch Street View static image by address/coordinates. Cache URL in DB. If no Street View available or quality is poor, show text-on-colored-background placeholder with building name. Admin can optionally upload a replacement photo.  
**Acceptance Criteria**:
- Buildings with good Street View coverage show real photo
- Buildings without coverage show styled placeholder
- Admin can override with uploaded photo
- Photos cached, not re-fetched on every page load

### TASK-405 · Shifts table view with filters
**Priority**: Must  
**Category**: Web  
**Dependencies**: TASK-402, TASK-103  
**Description**: Table view of shifts. Columns: worker, building, date, start time, end time, duration, status (synced/needs correction/manual). Filters: worker, building, date range, status. Pagination (server-side, 50 per page). Joined view (worker name, building name, not raw IDs). Shifts with `manualFinish` or `needsCorrection` highlighted with color (amber for needs correction, purple for manual) — no extra column, just row background tint.  
**Acceptance Criteria**:
- All shifts visible with human-readable names
- Filters narrow results, URL-persisted (shareable filtered views)
- Pagination works with >100 shifts
- Color coding visible at a glance without reading text
- Sorting by any column

### TASK-406 · Edit individual shift
**Priority**: Must  
**Category**: Web  
**Dependencies**: TASK-405  
**Description**: Click a shift row → edit modal. Can change start time, end time. Changes logged (audit: who changed, when, old value). Save updates DB. Used rarely for corrections.  
**Acceptance Criteria**:
- Edit modal pre-fills current values
- Validation: end > start, within reasonable bounds
- Save persists to Postgres
- Audit trail stored (shift_edits table or JSONB column)
- Edited shift re-flagged as `manualFinish: true`

### TASK-407 · Workers CRUD + hourly rates
**Priority**: Must  
**Category**: Web  
**Dependencies**: TASK-402, TASK-102  
**Description**: Workers management page. List workers with current hourly rate. Add/remove workers. Set/update hourly rate per worker (with effective_from date for history). Worker card shows name + rate.  
**Acceptance Criteria**:
- Add worker with name + hourly rate
- Edit hourly rate (old rate preserved with date range)
- Remove worker (soft delete? or hard delete if no shifts?)
- Rate history queryable for payroll calculation at correct rate

### TASK-408 · Locations CRUD
**Priority**: Must  
**Category**: Web  
**Dependencies**: TASK-402, TASK-102  
**Description**: Locations management. List locations with name, address, tag UID, building owner, contract info. Add/edit/remove. Adding a location requires the NFC tag UID (typed in, since admin may not have NFC reader in browser). For 3A: building owner + contract fields present but marked "Coming in v2" if not yet populated.  
**Acceptance Criteria**:
- List all locations with key info
- Add location with name + tag UID + address + coordinates
- Edit location details
- Remove location (guard: warn if shifts exist)
- Building owner / contract fields visible as stubs

### TASK-409 · Payroll summary view
**Priority**: Must  
**Category**: Web  
**Dependencies**: TASK-407, TASK-405  
**Description**: Aggregated view: per worker, total hours × hourly rate = payroll amount. Period selector (same 5 periods as map view). Read-only aggregation. Excludes shifts with `needsCorrection: true` (unfixed). Shows count of excluded shifts as warning.  
**Acceptance Criteria**:
- Each worker row: name, hours worked, rate, gross pay
- Total row at bottom
- Period selector works
- Shifts needing correction excluded with visible count
- Correct rate applied per shift (respects rate effective_from dates)

### TASK-410 · Desktop-first layout + mobile blocker
**Priority**: Must  
**Category**: Web  
**Dependencies**: TASK-401  
**Description**: Responsive breakpoint: below 1024px, show full-screen message "NFC TimeSheets Admin is designed for desktop. Please use a laptop or desktop computer." with the app logo. Above 1024px: sidebar nav + main content area. Sidebar has nav items for: Dashboard (map), Shifts, Workers, Locations, Payroll. 2-3 click max depth to any function.  
**Acceptance Criteria**:
- Mobile/tablet shows blocker, no admin UI leaks through
- Desktop shows full sidebar + content layout
- All primary functions reachable from sidebar (1 click to section, 1-2 more to action)

### TASK-411 · v2 feature stubs
**Priority**: Must  
**Category**: Web + iOS  
**Dependencies**: TASK-410  
**Description**: Grayed-out nav items / cards with lock icon for: Material Requests, P&L Dashboard, Contract Management, Building Analytics. Tooltip or inline text: "Coming in v2". In iOS app: material request section in a new tab or in Settings, same "Coming in v2" treatment.  
**Acceptance Criteria**:
- Stub items visible in web sidebar nav
- Stub items visible in iOS app
- Not clickable / not navigable
- Visually distinct (grayed, locked icon)
- Demo-friendly: stakeholder can see the roadmap without explanation

---

## Theme 5: Research (No Implementation)

### TASK-501 · APNs prerequisites documentation
**Priority**: Must  
**Category**: Docs / Research  
**Dependencies**: None  
**Description**: Document step-by-step what the Apple Developer account owner must do to enable push notifications: APNs key generation, entitlements, provisioning profile changes, server-side requirements (token-based vs certificate-based), and Xcode configuration. Include the server architecture needed (what sends the push, how tokens are managed).  
**Acceptance Criteria**:
- Written guide in repo (`docs/apns-setup.md`)
- Covers: Apple Developer portal steps, Xcode entitlement changes, server component requirements
- Distinguishes what the developer does vs what the account owner does

### TASK-502 · Android ecosystem research
**Priority**: Must  
**Category**: Docs / Research  
**Dependencies**: None  
**Description**: Research and document: best approach to Android NFC timesheet app from macOS. Cover: Kotlin vs Java (recommendation), Android Studio on macOS, NFC API (background tag reading equivalent), push notifications (FCM), distribution (Google Play, internal testing tracks), managing iOS + Android codebases (shared server, feature parity strategy). Assess: is Kotlin Multiplatform / React Native / Flutter worth it for this use case, or are two native apps better?  
**Acceptance Criteria**:
- Written guide in repo (`docs/android-research.md`)
- Covers: language choice, IDE, NFC APIs, push notifications, distribution
- Includes recommendation with reasoning
- Addresses cross-platform options with honest trade-offs

---

## Summary

| Priority | Count | Themes |
|----------|-------|--------|
| Must     | 19    | All    |
| Should   | 1     | Street View (TASK-404) |

### Suggested execution order (dependency-driven):

```
TASK-101 (VM) ──→ TASK-102 (schema) ──→ TASK-103 (server rewrite)
                                    ──→ TASK-104 (AASA) ──→ TASK-105 (DNS cutover)
                                                        ──→ TASK-201 (write tags)
                                                        ──→ TASK-202 (iOS background NFC)
                                                        ──→ TASK-203 (encode loc in URI)
                                                        ──→ TASK-204 (remove scan button)
                                                        ──→ TASK-205 (TestFlight build)

TASK-103 ──→ TASK-301 (auto-timeout cron)
         ──→ TASK-302 (local notification) [parallel, no server dep]
         ──→ TASK-303 (worker correction flow)

TASK-101 ──→ TASK-401 (Next.js setup) ──→ TASK-410 (layout)
                                      ──→ TASK-402 (auth) ──→ TASK-403 (map view)
                                                          ──→ TASK-405 (shifts table)
                                                          ──→ TASK-406 (edit shift)
                                                          ──→ TASK-407 (workers CRUD)
                                                          ──→ TASK-408 (locations CRUD)
                                                          ──→ TASK-409 (payroll)
                                      ──→ TASK-411 (stubs)
TASK-403 ──→ TASK-404 (Street View)

TASK-501, TASK-502: parallel, no code dependencies
```

### 3B Preview (stubs only in 3A):
- Material request form (worker-side) + admin queue + warehouse notification
- Contract management (building owners, annual amounts)
- Full P&L dashboard (revenue - labor - materials, pro-rata material split by labor hours)
- Building analytics (underwater building detection, contract revision suggestions)
- Push notifications (APNs + FCM)
- CSV/PDF export
- Per-building efficiency comparison vs baseline
