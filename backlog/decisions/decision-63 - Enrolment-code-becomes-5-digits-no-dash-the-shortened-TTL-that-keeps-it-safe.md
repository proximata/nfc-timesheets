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
5. The global verification rate limit for the enrolment-code route (lib/auth.js, currently
   30 attempts/minute for ALL callers combined) tightens to 5 attempts/minute for this route
   specifically. The existing per-IP limit (5 failures, then 30s doubling to a 15-minute cap)
   is unchanged - it already does real work against a single attacker.
6. Redone arithmetic at these numbers (mirroring the file's own worked format): keyspace
   10^5 = 100,000. Attempts buyable in the new 15-minute TTL at the new 5/min global ceiling =
   5 * 15 = 75. P(a hit against any ONE live code in its lifetime) = 75 / 100,000 = 7.5e-4
   (~1 in 1,333). P(a hit against the pessimistic ceiling of 50 simultaneously live codes) =
   75 * 50 / 100,000 = 0.0375 (~1 in 27) - openly weaker than the original design's ~1-in-12M
   figure, and accepted as such: the 50-simultaneous-codes case remains as implausible as the
   original file already conceded ("the anomaly worth looking at" on its own), and realistic
   usage (1-3 live codes, per the ~20-worker headcount this file also cites) sits at roughly
   7.5e-4 to 2.3e-3 - materially weaker than 8 characters, openly so, not silently.

## Consequences

- A code must be redeemed within 15 minutes of issue or it expires and needs reissuing - the
  exact operational problem the 2026-08-17 TTL extension was fixing returns. The owner is
  choosing "5 digits, no dash" knowing this trade explicitly, not silently.
- Security margin drops from ~1-in-12M to roughly ~1-in-1,300 (typical case) / ~1-in-27
  (pessimistic 50-live-codes case) per code lifetime - openly weaker, bounded, not broken, but
  a real and material change to this system's auth posture that the next person touching
  enrolment.js needs to know was a deliberate, computed tradeoff, not an oversight.
- If the owner later wants both convenience AND the original margin, the only way out
  (unimplemented, noted for later) is narrowing what a wrong guess is checked against - e.g.
  requiring the phone number or a name alongside the code so a guess only competes against
  ONE person's live code instead of every live code system-wide - a materially bigger UX
  change than this decision makes, deliberately deferred rather than folded in here.

