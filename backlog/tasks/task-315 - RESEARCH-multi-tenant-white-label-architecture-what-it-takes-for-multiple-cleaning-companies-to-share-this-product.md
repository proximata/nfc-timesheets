---
id: TASK-315
title: >-
  RESEARCH: multi-tenant / white-label architecture - what it takes for multiple
  cleaning companies to share this product
status: To Do
assignee: []
created_date: '2026-08-29 18:44'
updated_date: '2026-08-29 18:45'
labels:
  - research
  - architecture
dependencies: []
priority: medium
ordinal: 233000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tenant isolation model chosen and written down (row-level tenant_id + Postgres RLS vs schema-per-tenant vs DB-per-tenant), with the tradeoff reasoning, not just a link
- [ ] #2 Confirmed whether tagHost/apiHost (decision-40) must become per-tenant or can stay shared - a location/zone UUID is already globally unique, so tag resolution likely does not need per-tenant infra
- [ ] #3 Two white-label depths scoped separately: (a) same app binary, per-tenant branding shown at runtime from tenant data (name/logo/color) - the light option; (b) fully separate App Store/Play Store listings per tenant (own bundle id, icon, name) - the heavy option requiring a templated build pipeline
- [ ] #4 Every existing single-tenant assumption enumerated: admins table, feature_flags table, ops/branding.json's single appName/host, and any query that has no tenant scoping today
- [ ] #5 A rough migration path from today's single-tenant schema to the chosen model, without breaking Schimmer und Glanz's live data
- [ ] #6 Explicitly out of scope: no code changes. This task is closed by a written proposal (a new decision draft is an acceptable output), not by shipping multi-tenancy.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Research done 2026-08-29 (web search, not exhaustive) - starting points for whoever picks this up:

TENANCY MODEL. Mainstream consensus (Azure SQL SaaS tenancy docs, Redis/Spree architecture
writeups) for this scale (a handful to a few dozen small companies, not thousands of
enterprises): shared database, row-level isolation via a tenant_id column plus Postgres
native ROW LEVEL SECURITY (SET app.tenant_id per session, policies on every table), not
app-code WHERE-clause discipline alone - RLS is enforced at the DB, one missed WHERE clause
in application code cannot leak another company's workers/shifts. Schema-per-tenant or
DB-per-tenant is what large/regulated multi-tenant SaaS reaches for; likely overkill here
unless a client demands hard data residency separation.

TAG/API HOST INSIGHT (worth confirming, not yet proven): decision-40's tagHost/apiHost split
is about card permanence, not tenant boundaries. A location/zone id is already a globally
unique UUID, so a SHARED tagHost + SHARED apiHost across every tenant can very likely resolve
correctly without any change to that architecture - tenant scoping would live entirely at the
data layer (tenant_id column + RLS), not in per-tenant infrastructure. If true, this removes
most of the "multi-tenant needs its own domains/VMs" fear.

WHITE-LABEL HAS TWO VERY DIFFERENT DEPTHS, cost this task to separate them:
(a) light: ONE shared app binary/App Store listing, tenant branding (name/logo/color) shown
    at runtime from data already scoped to the signed-in worker's tenant - closer to how a
    Slack-style app shows per-workspace branding inside one binary. Small.
(b) heavy: separate App Store/Play Console listings per tenant, each its own bundle id, app
    icon, and name - requires a templated build pipeline (Xcode/Gradle config per tenant,
    a CI matrix, separate signing per tenant) - real, ongoing engineering investment, not a
    one-time cost. Apple/Google review each listing independently too.
Recommend defaulting to (a) unless a client contractually requires their own store listing.

SINGLE-TENANT ASSUMPTIONS FOUND SO FAR (not exhaustive - re-audit before scoping): admins
table has no tenant column; feature_flags is a single global table (today's fun_shift_screen/
sms_login apply to everyone, not per-tenant; ops/branding.json is one static file (single
appName/tagHost/apiHost/logo) rather than per-tenant rows; workers/locations/zones have no
tenant_id anywhere in the schema.

Not researched: billing/subscription model, per-tenant admin invite flow, whether Sentry/
telemetry needs tenant tagging, data export/deletion per tenant (GDPR - each of these small
companies' worker PII should not be visible to another tenant's admin even via a bug).
EOF
)
<!-- SECTION:NOTES:END -->
