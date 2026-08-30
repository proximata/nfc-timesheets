---
id: decision-54
title: >-
  Zone creation and binding move to the operator app; zones may exist unbound;
  the operator interface is gated behind sign-in; one shared code form serves
  every login
date: '2026-08-26 17:11'
status: accepted
---

**ACCEPTED 2026-08-26 by the owner**, in real time, in the same conversation that ordered
it.

Amends decision-43 (zones), decision-45 (operator identity), decision-47 (zone
verification), and extends decision-48/decision-51 (SMS onboarding) to operators. Nothing
in those records that this one does not name is touched: the tagHost/apiHost split, the
verify-before-clock-in gate, and the SMS-is-a-second-channel rule for workers all stand
exactly as written. (decision-47's HOIV building grandfather was later retired outright by
decision-69, unrelated to this record.)

## Context

Until this session, a zone could only be created by an ADMIN, at a desk, days after an
operator wrote and reported a physical tag (`POST /admin/tags/:id/resolve-zone`,
`POST /admin/zones`). `zones.location_id` was `NOT NULL` — a zone without a building could
not exist as a row at all. The operator interface itself (Write a tag / Test a tag) was
reachable from the sign-in screen with no login of any kind; each screen gated the ACTION
(write, verify) behind an inline operator-code field, but never gated being IN the screen.
Worker sign-in already offered SMS and an admin-issued code as two visibly different
sections; operator sign-in was a third, visually different inline field; SMS was never
offered to operators at all (decision-45 §6/§7 named this explicitly as deferred: "extending
SMS to them is a follow-up decision").

The owner ordered all of this changed in one sitting: an operator picks the building for a
zone at write time (or explicitly skips it), a zone may sit unbound until an operator binds
it later — from the app only, never the admin panel — the whole operator interface sits
behind a login gate, and that gate uses the SAME form as worker sign-in, with a Request SMS
button, autofill/paste support on both platforms.

## Decision

**1. A zone may exist with no building.** `zones.location_id` becomes nullable
(migration 013). `activePlace` needed no change: its zone branch already INNER JOINs
`locations`, so an unbound zone was already unresolvable to a tap — that behaviour is now
exercised instead of merely implied. The admin zones list (`GET /admin/data`) moves to a
LEFT JOIN so an unbound zone stays visible to an admin, read-only.

**2. Zone creation is an OPERATOR action, never an admin one.**
`POST /admin/tags/:id/resolve-zone` is deleted, following decision-47's own precedent for
`resolve-building` exactly: retired, pinned by a check that the route now 404s, not left
importable. `POST /admin/zones` keeps editing an EXISTING zone (name, note, area, serial,
active) — that stays admin's job — but refuses to CREATE one (a request with no `id` is a
clear, named refusal, not a 404, since the route still exists for updates). The building
creation drawer's "optional first zone" step is removed from `web/app/locations/page.tsx`
for the same reason. **decision-44's adopted-hardware tag-serial walk is untouched** — that
is a different mechanism (a zone that already exists adopting a third-party tag's UID), not
zone creation, and stays exactly where it is.

Replacing it: `POST /operator/tags/:id/resolve-zone {name, location_id?}`, `auth:
"operator"`. Same CTE-stamp-and-insert shape as the admin route it replaces.
`location_id` is OPTIONAL — omitted, the zone lands unbound.

**3. Binding and unbinding an existing zone are OPERATOR actions.**
`POST /operator/zones/:id/bind {location_id}` and `POST /operator/zones/:id/unbind {}`,
both `auth: "operator"`. Bind refuses (409) a zone that already has a building — rebinding
is unbind-then-bind, never a silent move. Bind clears `verified_at`: a card was proved
against a DIFFERENT context (no building, or none at all) and that proof does not carry
over. Unbind relies on the database, not application logic, to refuse a zone with shift
history: `shifts_start_zone_fk`/`shifts_end_zone_fk` are composite FKs on `(zone_id,
location_id)`, so clearing `location_id` while a shift still references the zone raises
23503, caught and surfaced as `409 zone_has_shifts`. No new integrity code was written for
this — the constraint decision-43 already shipped does the whole job.

**4. The operator interface requires sign-in before it is reachable, on both platforms.**
The two direct "Write a tag" / "Test a tag" links on the worker sign-in screen are replaced
by one operator entry point that shows the sign-in form first when `!operatorReady`, and
the two actions directly once an operator session already exists on disk (unchanged:
reading the stored cookie, no network call, nothing to fail with no signal). This reverses
iOS's earlier removal of a dedicated operator sign-in screen (`OperatorSignInScreen.swift`,
retired when the two-direct-link design shipped) — the reasoning that replaced it was
correct for its own requirement ("don't gate reaching the screen, gate the action") and is
superseded here by an explicit one ("don't reveal the screen at all").

**5. One shared code-entry form serves every login, worker or operator.** Phone field +
"Request SMS" button + one code field + one submit button. The code field accepts EITHER
shape without asking which: a live SMS challenge (`sentTo != nil`) makes it a 6-digit OTP
field; otherwise it is the 8-character Crockford-base32 enrolment code. These remain two
genuinely different credentials with two different security arguments (lib/enrolment.js's
and lib/sms.js's arithmetic blocks are untouched) — what unifies is the FORM, not the wire
shape. This replaces worker sign-in's two separately-styled sections with one, and replaces
operator sign-in's bespoke inline field with the same one, parameterised by role.

Operators gain SMS sign-in to make that form meaningful for them: `POST
/auth/operator-sms/request {phone}` and `POST /auth/operator-sms/verify {phone, code}`,
mirroring `POST /auth/sms/request`/`verify` exactly — same `otp_challenges` table (phone-
keyed, not role-keyed), same decision-51 disclosure posture (`404 unknown_phone` for a
number not on file), own rate-limit bucket (`smsotpop:`, not `smsotp:`) for the same reason
`enrolop:` is not `enrol:` (decision-45 §6): a stranger guessing one role's codes must not
lock out the other role enrolling from the same address.

**6. SMS autofill on both platforms.** iOS keeps `.textContentType(.oneTimeCode)` on the
code field, active only while in OTP mode. Android adds a platform autofill hint for the
same field (Compose `ContentType.SmsOtpCode` if the pinned Compose UI version has it
stable; the SMS User Consent API — no manifest permission, no app-hash coordination with
the SMS body — as the fallback otherwise). Neither is a new server-side concern: the SMS
body (`renderOtpSms`) is unchanged.

**7. The zone page.** Selecting an already-bound zone in Test a tag now shows, after a
successful (or already-true) verify: the zone's name and building, verified status, the
CURRENT month's shifts at that zone — worker name, start, end, duration; no rate, no money,
no client name, keeping faith with decision-6/decision-42/decision-43's "a zone is not a
costing unit" line — paginated, plus a total-hours figure for the month. New reads only:
`GET /operator/zones/:id` (state, for branching bound-vs-unbound) and `GET
/operator/zones/:id/shifts?month=&page=` (`auth: "operator"`). Selecting an UNBOUND zone
shows the building picker (pick one, or leave it and choose a different zone from the
worklist) instead of attempting a scan — `activePlace` cannot resolve an unbound zone, so
there is nothing yet to verify.

## Consequences

- An admin can no longer create a zone or a reported-tag resolution from the panel, full
  stop. If the app is unreachable (broken phone, no operator on site), there is currently
  no desk-only recovery path — a real cost, accepted for the win of "one place a zone is
  ever born", and worth a follow-up if it bites.
- `zones.location_id` being nullable is a real schema loosening on a table two composite
  FKs depend on. Both are designed around it correctly (see §3), and
  `server/check-api.js` gets a case that proves the unbind-with-shifts refusal rather than
  trusting the read of the constraint.
- Operators now see worker names and shift times for a zone, which they could not before.
  Deliberate, asked for by name, and bounded to hours/times only — never a rate, a euro
  figure, or a client name.
- The next physical inconsistency this invites: a zone can sit unbound indefinitely,
  invisible to `activePlace`, visible only in the admin's read-only list and the operator's
  own worklist. That is the intended resting state for "card written, building not yet
  decided", not a bug.
