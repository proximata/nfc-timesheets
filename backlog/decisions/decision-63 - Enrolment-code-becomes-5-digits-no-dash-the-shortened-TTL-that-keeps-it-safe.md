---
id: decision-63
title: >-
  Enrolment code becomes 5 digits, no dash - the shortened TTL that keeps it
  safe
date: '2026-08-29 21:45'
status: accepted
---
## Context

TASK-319: the owner asked to simplify the enrolment code to 5 digits, no dash. Today's code
(server/lib/enrolment.js) is 8 characters of Crockford base32 - 40 bits, ~1.1 trillion
possibilities - shown hyphenated (XXXX-XXXX), with a 5-day TTL (raised from 60 minutes on
2026-08-17 after a real failure where a code expired before a worker could redeem it).
enrolment.js's own header is explicit that its whole design is arithmetic, not a guess, and
instructs redoing that arithmetic if the alphabet, length, TTL, or either rate limit changes -
so the numbers below are that redo, not an invented substitute.

A 5-digit numeric code is 10^5 = 100,000 possibilities. THE ARITHMETIC IN enrolment.js's OWN
HEADER SHOWS THIS DOES NOT SURVIVE THE CURRENT 5-DAY TTL AT THE CURRENT 30/min GLOBAL
VERIFICATION CEILING: at that ceiling, attempts buyable over 5 days = 30 * 60 * 24 * 5 =
216,000, which EXCEEDS the entire 100,000-code keyspace more than twice over - an attacker is
mathematically guaranteed to hit some live code well inside the 5-day window, even with only
one code live at a time, without needing to be clever about it. No rate-limit number alone
fixes this while the TTL stays at 5 days, because the keyspace itself (100,000) is too small
for a multi-day exposure window under this system's own threat model (every live code is a
valid answer to an unscoped guess, per the file's own "shared search space" framing) - the TTL
is the only lever big enough to move.

## Decision

1. `ALPHABET` becomes `"0123456789"` (digits only - the request said digits, so letters are
   dropped entirely, not shortened-but-still-mixed). `CODE_CHARS` becomes 5. `CODE_RE` becomes
   `/^[0-9]{5}$/`. The normalisation step keeps stripping hyphens/spaces on input (harmless,
   people will still sometimes type them out of habit) but the alias-ambiguous-letters step
   (O->0, I/L->1) is deleted - there are no letters left to alias.
2. Display drops the hyphen entirely, both in `renderEnrolmentSms`'s `display` value and
   admin-web's shown code: it is just the 5 digits, no grouping.
3. Applies to BOTH worker and operator codes - they already share one implementation
   (migration 007's own comment: "same shape, same hashing... same pair constraint").
4. `CODE_TTL_MS` drops from 5 days to 15 minutes. This is the real, load-bearing tradeoff of
   this decision, and it undoes the 2026-08-17 usability fix: a code must now be read out and
   used almost immediately, or reissued. This is not a smaller version of the old design, it
   is a different design with a different failure mode, chosen because the small keyspace
   leaves no other lever - see Context.
5. **PER-IP IS THE PRIMARY DEFENCE; THE GLOBAL CEILING IS A BACKSTOP.** (Amended in place by
   TASK-330 - nothing had shipped anywhere, so the numbers below are the only ones that have
   ever existed outside this record's first draft.)

   This section first said the opposite: it tightened the global ceiling from 30/min to 5/min
   and left the per-IP limiter alone. That was correct about CONFIDENTIALITY and wrong about
   AVAILABILITY, and the two call sites made it worse than a tuning mistake. `fail()` throws,
   and both routes called `checkGlobalEnrolmentRate()` BEFORE `checkLoginRate(bucket)`, so a
   request refused by the shared ceiling never reached the per-IP limiter and never charged
   its own bucket. One address posting junk five times a minute could therefore hold the
   shared budget at zero for every worker AND operator - the enrolment code is currently the
   ONLY door for both, since `sms_login` and `email_login` are seeded off - indefinitely, at
   no cost to itself.

   The shape that replaces it:

   a. **Order.** `checkLoginRate(bucket)` runs FIRST at both call sites, so the requesting
      address is always charged its own penalty regardless of global state, and an address
      already locked out is refused without spending anyone else's budget.
   b. **Per-IP tightens to 3 consecutive failures** for enrolment-code verification
      (`ENROL_FAIL_LIMIT`), against the 5 a password login keeps. The backoff SHAPE is
      unchanged - 30s doubling to a 15-minute cap - because inventing a second mechanism here
      would be a new thing to get wrong. 3 and not 1: a worker reading five digits off a
      message can fumble one, and fumble the retry; the third consecutive failure is where
      "tired" stops being the likelier explanation. A single address is thereby bounded to a
      3-guess burst and then ~4 guesses per 15 minutes.
   c. **The global ceiling becomes 15/min**, re-derived rather than restored to 30. With (b)
      bounding one address to a 3-guess burst, saturating 15/min needs at least FIVE distinct
      addresses sustained every window - i.e. it can only be reached by a genuinely
      DISTRIBUTED attacker, which is the one thing per-IP limiting cannot bound and therefore
      the only job left for a global ceiling. No single address can exhaust it alone at its
      new per-IP rate, which is the property that was missing.
   d. **Tripping the global ceiling raises an alert immediately** (one Sentry event per
      window, never one per refused request), because at these numbers the trip itself is the
      signal: it means five or more addresses are guessing codes at once, which no amount of
      one-confused-worker explains.
6. Redone arithmetic at these numbers (mirroring lib/enrolment.js's own worked format):
   keyspace 10^5 = 100,000. Attempts buyable in the 15-minute TTL at the 15/min global
   ceiling = 15 * 15 = 225.
   P(a hit against any ONE live code in its lifetime) = 225 / 100,000 = 2.25e-3 (~1 in 444).
   P(a hit against the pessimistic ceiling of 50 simultaneously live codes) =
   225 * 50 / 100,000 = 0.1125 (~1 in 9).
   SINGLE-ATTACKER CASE, which is the realistic one and which the first draft did not state
   separately: one address gets 3 guesses, then ~4 per 15 minutes, so ~7 attempts against one
   code's whole lifetime = 7e-5 (~1 in 14,000) - BETTER than the first draft's per-IP
   allowance of 5-then-backoff.
   The distributed figures are within ~3x of the first draft's 7.5e-4 / 1-in-27 and remain
   openly weaker than the 8-character design's ~1-in-12M, accepted as such: the
   50-simultaneous-codes case remains as implausible as lib/enrolment.js already conceded
   ("the anomaly worth looking at" on its own), realistic usage (1-3 live codes, per the
   ~20-worker headcount) sits at 2.25e-3 to 6.75e-3, and reaching either figure now requires
   five or more coordinated addresses sustaining the attack for a full code lifetime while
   an alert is firing. That is the trade: a ~3x weaker distributed-attacker bound, bought
   with the removal of a total, free, single-address denial of service on the only sign-in
   door either app has.

## Consequences

- A code must be redeemed within 15 minutes of issue or it expires and needs reissuing - the
  exact operational problem the 2026-08-17 TTL extension was fixing returns. The owner is
  choosing "5 digits, no dash" knowing this trade explicitly, not silently.
- Security margin drops from ~1-in-12M to roughly ~1-in-444 (typical case) / ~1-in-9
  (pessimistic 50-live-codes case, distributed attacker only) per code lifetime - openly weaker, bounded, not broken, but
  a real and material change to this system's auth posture that the next person touching
  enrolment.js needs to know was a deliberate, computed tradeoff, not an oversight.
- A worker who mistypes their code three times in a row waits 30 seconds. That is the visible
  cost of §5(b), and it is the same backoff /admin/login has always had, just starting two
  failures earlier. A fourth attempt during the lockout answers 429 with `retry-after`.
- The global ceiling is now expected NEVER to trip in normal operation. If it does, that is an
  incident to look at, not a limit to raise - raising it re-opens §6's arithmetic.
- If the owner later wants both convenience AND the original margin, the only way out
  (unimplemented, noted for later) is narrowing what a wrong guess is checked against - e.g.
  requiring the phone number or a name alongside the code so a guess only competes against
  ONE person's live code instead of every live code system-wide - a materially bigger UX
  change than this decision makes, deliberately deferred rather than folded in here.

