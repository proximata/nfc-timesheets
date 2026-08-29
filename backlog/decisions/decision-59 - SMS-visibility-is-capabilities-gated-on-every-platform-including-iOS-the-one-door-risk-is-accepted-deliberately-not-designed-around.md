---
id: decision-59
title: >-
  SMS visibility is capabilities-gated on every platform including iOS; the
  one-door risk is accepted deliberately, not designed around
date: '2026-08-29 10:43'
status: accepted
---
**ACCEPTED 2026-08-29 by the owner, in real time, while reviewing a bug report.**

AMENDS decision-50 clause 1 only. AMENDS decision-54 wherever it assumed the shared
code-entry form's SMS option is always shown. Relates to decision-48 (SMS as a door),
decision-45 (`phone_identities`), and the `sms_login` feature flag (migration
016_sms_login_flag.sql, decision-57's flag mechanism).

## Context

On 2026-08-27 `sms_login` was added and wired server-side: `GET /auth/capabilities` and all
four worker/operator SMS route handlers now check it. That was believed sufficient because
Android already gates its SMS UI on `capabilities()` (`TimeSheetViewModel.kt`, `smsAvailable`)
— confirmed still true and unchanged by this record.

Two places were missed, one of them a real decision conflict, not an oversight:

1. **iOS never checked capabilities for SMS visibility, on purpose.** Decision-50 clause 1
   says so explicitly: "No `GET /auth/capabilities` gate on iOS, unlike Android — Apple's
   removal means a gate that hides SMS can leave a phone with one door, and the owner chose
   two visible doors over a hidden one." That reasoning is sound in general. It is wrong for
   THIS flag's purpose: `sms_login` exists so the operator can run controlled testing
   (UAT, staged rollouts) with SMS off, and every phone in that setting has an admin one
   phone call away who can issue an enrolment code on demand. The one-door state is not a
   trap here — it is the intended state while the flag is off.
2. **The admin web panel's "send enrolment code by SMS" button** (`web/app/operators/page.tsx`,
   `web/app/workers/page.tsx`, `smsButtonDisabled()`) reads `GET /admin/sms-status` — raw
   Twilio-configured status — and never consulted `sms_login` at all. This is a genuinely
   different feature from OTP self-service login (it is an admin manually choosing a delivery
   channel for a code that already exists), but the owner's call, stated plainly: it is still
   an SMS-related door and it hides with the rest.

The owner was shown three options (leave iOS as designed; gate iOS for operators only; gate
iOS and Android and web everywhere) and chose the third, explicitly, aware of the one-door
consequence.

## Decision

1. **`sms_login` off means every SMS-shaped door disappears from the UI, on every platform,
   full stop.** No platform-specific exception survives this record.
2. **iOS gains a capabilities check it never had.** Both `SignInView` (worker) and
   `OperatorHomeScreen`'s sign-in path (via the shared `CodeSignInSection`) fetch
   `GET /auth/capabilities` the same way Android's `TimeSheetViewModel` does, and render only
   the enrolment-code field when `sms` is false. This is new code, not a config flip — iOS has
   never called this endpoint for this purpose before.
3. **Admin web's send-by-SMS button gates on `sms_login` in addition to Twilio-configured.**
   `GET /admin/sms-status` either grows an `sms_login`-aware field or the two admin pages
   fetch `GET /flags` alongside it; either way `smsButtonDisabled()` returns true when the flag
   is off regardless of Twilio state.
4. **Android is verification-only in this record.** `smsAvailable` already gates both the
   worker and operator SMS sections correctly (confirmed by source read, 2026-08-29) — no
   Android UI change is expected, only a check proving it stays true.
5. **decision-50 clause 1 is struck.** Its text stays in decision-50 for the historical record
   of why the original choice was made; this record is what governs iOS SMS visibility going
   forward.

## Consequences

**Accepted, not mitigated:** with `sms_login` off, a worker or operator with no live
enrolment code and no admin reachable cannot sign in on any platform. This is the exact
risk decision-50 was written to avoid for the general case — accepted here specifically
because the flag's own purpose (controlled testing windows) already implies an admin is
actively present issuing codes.

**Good:** one rule ("capabilities decides visibility") instead of two, no platform-specific
carve-out to remember, and the admin panel can no longer show a control that 503s the moment
it's pressed.

**Revisit trigger:** `sms_login` is turned on permanently in production with no controlled
rollout window in sight — at that point decision-50's original one-door worry applies again
and this record should be re-examined, not silently relied on.

