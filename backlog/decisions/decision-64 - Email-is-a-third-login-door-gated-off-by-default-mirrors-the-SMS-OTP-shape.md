---
id: decision-64
title: 'Email is a third login door, gated off by default, mirrors the SMS OTP shape'
date: '2026-08-29 21:45'
status: accepted
---
## Context

TASK-320: the owner asked for email auth plus email fields. Confirmed current state before
designing this: `workers.email` already exists (migration 002) but is vestigial - it was added
for Sign in with Apple eligibility, and decision-50 (accepted) retired Apple Sign-In from the
worker app entirely, so no live code path reads it today. `operators` has no email column at
all. decision-50 names SMS OTP and the enrolment code as the two sanctioned worker/operator
login doors - this decision adds a THIRD, the same way decision-50 itself required a named
decision rather than a silent addition.

Phone-based login is NOT a bare column on `workers`/`operators` - decision-45 built a separate
`phone_identities` registry (one phone number, claimable by exactly one worker OR operator)
plus `otp_challenges` (the live-code table, FK'd to that registry) specifically because a
phone number can move between people and needs claim/release semantics. Email has the exact
same shape of problem, so this decision mirrors that architecture rather than bolting email
onto the old vestigial `workers.email` column, which stays as-is (unrelated, still dead).

No email-sending capability exists anywhere in this codebase today (confirmed by grep - no
nodemailer/SES/SendGrid/Resend/SMTP anything). This is a real, new external dependency, the
same category of bootstrapping SMS/Twilio needed - the code ships now, gated to no-op cleanly
until the owner provisions a real account and API key, exactly as `smsConfigured()` already
does for Twilio.

## Decision

1. New tables mirroring the phone shape exactly: `email_identities` (email TEXT PRIMARY KEY,
   nullable `worker_id`/`operator_id` FKs with a CHECK that exactly one is set, claimed_at) and
   `email_challenges` (FK to `email_identities.email`, code_hash, expires_at, attempts,
   consumed_at, created_at - the same shape as `otp_challenges`). The implementing agent reads
   migrations 002, 007, 009, 011, 012 in full and mirrors their claim/release/expiry mechanics
   precisely rather than reinventing them.
2. A new feature flag `email_login` (migration pattern of 015/016), OFF by default, following
   decision-57's "opt-in, defaults off everywhere" rule.
3. New routes mirroring the SMS OTP shape exactly: `POST /auth/email/request` +
   `/auth/email/verify` (worker), `POST /auth/operator-email/request` + `/verify` (operator).
   A 6-digit numeric OTP, matching the existing SMS OTP shape (this is a normal-strength
   secret over a short TTL, not the enrolment code's low-entropy-by-design case - decision-63
   does not apply here).
4. `server/lib/email.js`, modeled directly on `server/lib/sms.js`'s structure:
   `emailConfigured()` resolves an API key from env and returns false (never throws) if
   absent - the whole feature stays inert with zero behavior change until BOTH the flag is on
   AND a real provider is configured, mirroring `smsConfigured()`'s "a var that is present but
   malformed counts as missing" rule. Provider: Resend's plain REST API (`POST
   https://api.resend.com/emails`, Bearer auth, JSON body) - picked for the same reason
   Twilio's raw HTTP API was picked over an SDK (decision-23's dependency minimalism: no new
   npm dependency, `fetch` is stdlib). `RESEND_API_KEY` goes in psst/production `/etc/nfc/env`
   when the owner is ready, the same way `TWILIO_*` did.
5. `GET /auth/capabilities` gains an `email` boolean field (mirrors `sms`), true only when
   `emailConfigured() AND email_login flag enabled`.
6. Admin-web gains an editable email field on both Workers and Operators pages, admin-
   provisioned the same way phone numbers are today (not self-service) - going through the new
   `email_identities` claim path, not the old `workers.email` column.
7. OUT OF SCOPE for this decision's first build: any mobile-app UI to actually sign in via
   email. The shared code-entry screens on both platforms are being actively restructured by a
   separate concurrent workflow (decision-60/61 UX-unification pass) - adding a third door to
   those exact screens right now is a same-file collision risk, not a design decision. Mobile
   email-login UI is a named follow-up once that other work lands, tracked as a continuation of
   TASK-320, not a new decision.

## Consequences

- A real new external account (Resend, or whatever the owner ultimately prefers) is required
  before this door does anything - same bootstrapping shape as SMS/Twilio was.
- decision-50's "two sanctioned doors" framing is superseded to "three" the moment `email_login`
  is ever turned on - decision-59's "hide every SMS-shaped door when its flag is off" rule
  extends naturally to email (hide the email door when `email_login` is off), and should be
  read as covering it without needing a fourth decision to say so explicitly.
- `workers.email` (the decision-22/Apple-Sign-In-era column) stays exactly as it is - dead,
  unrelated, not reused, not removed by this decision.

