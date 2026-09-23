# Product page and planned cleaning assignments

Owner-authorized scope, 23 September 2026 (TASK-343–345).

## Public product page

`/product/` is a responsive, public, bilingual static Next.js page. Existing `/` role routing,
login, invitation links and hosting stay unchanged. The public page may be indexed; admin
pages retain noindex. Animations are CSS/SVG and respect reduced-motion preferences.

Offer: EUR 300/month for up to 10 employees; first month free; additional employees priced
by agreement. This is an invitation to request access, not a payment checkout or an
automatically activated subscription. A work email and company name are stored through
`POST /public/trial-requests`; no email is sent and no account is created. Duplicate emails
get the same acknowledgement without overwriting the original request. Per-IP throttling
uses its own bucket. The platform inbox lists the newest 200 requests; tenant admins and
workers cannot read them. Personal data is never included in marketing screenshots.

## Planning is separate from recorded work

`planned_shifts` stores a worker, building, time window and optional instructions. This
table is never joined into payroll, P&L or NFC eligibility. Workers can still clock in at
an authorized building without a plan. Clock-in remains authoritative on the server
(decision-19); creating a plan does not create a shift.

Assignments use company RLS and composite tenant foreign keys. Admin create/update checks
active workers/buildings, future start, positive duration up to 24 hours and no overlapping
uncancelled assignments for the same worker. A transaction advisory lock per company makes
the overlap check atomic, including edits that move a plan to another worker. Touching end
and start boundaries is allowed. Version checks prevent stale edits; creation UUIDs make
retries idempotent. Cancellation retains the row for history. Started plans cannot be edited.

The admin week board uses Vienna time and can create, edit and cancel assignments. The
Android worker home shows only the signed-in worker's uncancelled assignments from now
through the next 31 days (up to 200), with refresh, loading, error and empty states. There
is no new navigation tab and no push reminder in this version. iOS scheduling is not added
in this iteration; its existing NFC behavior is unaffected.

## Report date selection

Relative periods keep their existing meaning. A custom range uses explicit calendar dates
and follows the existing Vienna half-open API convention, with an inclusive end date in the
UI. All report links and exports must carry the same range. No payroll math or rate history
changes are authorized here (decision-28).

The company navigation gains Schedule alongside the existing five core destinations,
amending decision-72's presentation scope. The public page is separate from that navigation.
Custom dates extend decision-38's shared URL vocabulary; malformed dates fall back safely.

## Delivery

Migrations 024 and 025 are additive. No production migration or deployment is performed by
this work. The existing API runtime role must receive privileges on new tables/sequences
through the normal migration/deployment process. Tests use disposable local schemas and
restricted roles, not production data.
