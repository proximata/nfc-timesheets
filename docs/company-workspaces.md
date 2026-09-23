# Company workspaces

Approved product direction: Backlog doc-1. Implementation: TASK-340, TASK-341, TASK-342.

## Boundaries

One Node API, one PostgreSQL database, one static Next.js export. The permanent tag host,
tag UUIDs, app binaries and worker/operator authentication contracts remain unchanged.
`clients` still means a cleaning company's customer; a `tenant` means a cleaning company.

Migration 022 backfills all existing business and identity records to tenant 1. Tenant 0
is reserved for platform administrators; they do not implicitly act as a company admin.
Normal requests derive company scope from the verified server session. PostgreSQL FORCE
ROW LEVEL SECURITY hides other companies' rows; composite foreign keys prevent cross-company
references, including audit references, identity claims, zones and inventory requests.
Database scope is transaction-local and a missing application context fails closed.
The API refuses database roles with SUPERUSER or BYPASSRLS. This is a deployment prerequisite,
not an environment switch to disable protection. Migration/backup credentials remain separate.

Credential bootstrap (password, Apple, enrolment code, SMS/email), bearer-token portal and
explicit platform routes are narrowly marked system operations. Phone/email identities and
enrolment hashes remain globally unique: one identity can hold worker and operator roles in
the SAME company. Cross-company membership/switching is outside this first release.
Public portal links retain their existing minimal per-building response, not company access.

Feature flags are shared release configuration. Legacy tenant-1 maintenance access is retained;
new company administrators cannot change platform flags. The existing tenant-1 sign-in rate
setting remains the platform-wide limit; company margin settings are private to that company.

## Provisioning and presentation

Platform admins create workspaces and expiring, single-use invitations. Owners choose their
own passwords. Invitations are credentials: plaintext is returned once, stored only hashed,
placed in URL fragments and never sent automatically. Reissuing revokes the previous invitation.
The platform creates its initial account interactively with `server/bin/create-admin.js --platform`.
Existing company accounts are not automatically promoted.

Company navigation has five primary destinations: overview, workers, buildings, calculations,
materials. Advanced screens stay reachable through contextual links. Setup is a view of persisted
company, building and worker facts, followed by actual tag verification and a real first shift.
Navigation alone never marks a company ready and the wizard never fabricates a paid shift.
Plain home opens the appropriate company/platform overview; the existing map and operational
ledger remain together at `/map/`. Old root bookmarks carrying filters forward to that map.
Platform provisioning and privileged mutations append to the shared decision-65 `action_log`.

Initial calculation cards use the existing current-rate method, clearly labelled as an estimate.
They do not claim a paid amount, a debt balance, or frozen historical payroll. A payment ledger
and effective-dated rates require their own implementation before those claims can be made.

## Deployment

No production migration or deployment is performed by this branch. Before deploying, take a
database backup, dry-run migrations and confirm the runtime login is NOSUPERUSER NOBYPASSRLS.
Run the auto-close SQL shipped with the same release: it explicitly declares its maintenance
scope. Old ad-hoc SQL without a company/system scope will see no business records under RLS.
Local tests use a throwaway schema and a separate restricted runtime role, never postgres for
API queries. Existing IDs, printed cards, timestamps, rates and session tokens are preserved.

## Verification

Local verification on 2026-09-23:

- `node server/check-api.js`: PASS against real loopback PostgreSQL, restricted runtime role.
- `node server/check-workspaces.js`: PASS; actual migrations, two companies, single-use/rotated
  invitations, foreign tag rejection, RLS, composite references, concurrent pooled requests,
  concurrent tag reports and rejected identity replacement preserving previous login details.
- Independent earlier extended API matrix: 59 checks; Android emulator exercised real worker
  and operator sessions against the two-company API. Physical NFC and iOS were not verified.
- `pnpm verify` was run: four pre-existing Windows path assertions fail in `scripts/check.mjs`
  (HomeMap path, two locations checks and required worker rate path). Per user instruction,
  path separators were not rewritten. DE/EN key and ICU parity checks pass.
- `pnpm lint` passes with one existing optional-chaining warning at payroll/page.tsx:749;
  `pnpm typecheck` and `pnpm build` pass independently.
- `node ops/check-branding.mjs`: OK with no TODO lines.
- Standalone migration-runner check unavailable because psql is not installed; actual migration
  SQL was exercised in the API fixture and independently under a non-superuser schema owner.

Screenshots and browser action matrices are local artifacts in
`captures/company-workspaces/`. Android evidence is in `android/captures/company-android/`.
All examples use synthetic local records. Google address autocomplete was unavailable without
its configured browser key; manual address entry was exercised.
