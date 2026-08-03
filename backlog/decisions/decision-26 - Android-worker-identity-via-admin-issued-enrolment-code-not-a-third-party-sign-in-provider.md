---
id: decision-26
title: >-
  Android worker identity via admin-issued enrolment code, not a third-party
  sign-in provider
date: '2026-08-03 14:05'
status: accepted
---
## Context

decision-22 made worker identity Sign in with Apple, closing a real vulnerability: the server
had been trusting `worker_id` from the request body, so anyone could file shifts as anyone.
That decision noted Google sign-in was rejected "for MVP" and would become relevant "when the
Android app lands". It has landed, and Sign in with Apple does not survive the move.

The Android app was built with no sign-in at all and fails visibly by design, waiting on this
record. Six places in the shipped Android code reference it.

Three options were weighed:

**A — Apple's Sign in with Apple web flow on Android.** Keeps one identity system and one
`workers` table. Rejected because it fails on *users*, not on engineering: an Android-owning
cleaner has no Apple ID and cannot reasonably be asked to create one on an Android phone to
clock in at a building. Identity that depends on owning a competitor's hardware is not
identity, it is a hiring filter.

**B — Add Google sign-in.** Rejected on account linking. Email is the only join key between a
provider and a `workers` row, and Apple hands back `privaterelay.appleid.com` addresses. One
human signing in with Apple on an old iPhone and Google on a new Android becomes two worker
rows, two sets of shifts and two payslips — a payroll-correctness bug with no clean automatic
repair. It also adds a second token verifier to the trust boundary.

**C — Admin-issued enrolment code.** Chosen.

## Decision

The admin generates a short enrolment code for a specific worker in the web panel. The worker
types it once on first launch; the app exchanges it for the same `worker_sessions` row that
Sign in with Apple already produces.

This is one session system with two enrolment mechanisms, not two identity systems. Everything
downstream — `worker_id` comes from the session and never from the request body (decision-22) —
is unchanged, which is the property that made this safe to add.

iOS keeps Sign in with Apple. It works, it is live and in daily use, and replacing the auth path
of a shipped app mid-pilot to gain consistency is not a trade worth making.

Codes are:
- **bound to one worker** — the admin issues a code *for a person*, so one active code per
  worker replaces any previous one. This needs no separate table.
- **stored hashed**, never in plaintext, and shown to the admin exactly once.
- **single-use** — redeeming clears it.
- **expiring** — an enrolment code is the first expiring secret in this system, which is the
  real cost of this option and is stated here rather than discovered later.
- **revocable** in one click, because a code read aloud over the phone to the wrong person is
  the expected failure mode.
- **rate-limited** at the trust boundary, generically errored, and never logged.

## Consequences

Good:
- Works on any phone. No dependency on a platform vendor's account system for the ability to
  clock in and get paid.
- Matches how enrolment already happens: the admin is already adding the worker by hand.
- Removes the Hide My Email two-pass dance for anyone enrolled this way — no relay address to
  copy back into the panel.
- No new server dependency, no second token verifier.

Costs, honestly:
- The system's first expiring secret. Expiry and revoke are therefore not optional extras;
  they are part of the feature.
- A code is a bearer credential in transit — typically spoken or messaged to a worker. It is
  low entropy compared to an OAuth token, so rate limiting is load-bearing, not defensive
  garnish. Short expiry plus single use plus rate limiting is what makes 40-ish bits safe.
- Two enrolment paths means two paths to keep correct. Mitigated by both terminating in the
  same `worker_sessions` row.

Upgrade path: if the two paths ever drift or the Hide My Email friction annoys on iOS too,
enrolment codes can become the single mechanism on both platforms and decision-22's Apple flow
retires to "one way to get a session". Do not do that while the iOS pilot is running.
