---
id: TASK-331
title: >-
  OWNER DECISION: email_identities is exactly-one-owner while phone_identities
  is at-least-one, so one mailbox cannot be both a worker and an operator door
status: Done
assignee: []
created_date: '2026-08-29 23:55'
updated_date: '2026-08-30 05:03'
labels:
  - server
  - decision
  - decision-64
dependencies: []
priority: medium
ordinal: 249000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by the TASK-320 build agent in its own report and in migration 020's header, and CONFIRMED by the review gate reading both migrations side by side. Filing it so it stops living only in a report nobody re-reads.

THE ASYMMETRY, measured at HEAD:
  db/migrations/007_operator_identity.sql:81
    CONSTRAINT phone_identities_claims CHECK (worker_id IS NOT NULL OR operator_id IS NOT NULL)
    -> AT LEAST ONE. One row may carry BOTH, deliberately, so one human on one number can be
       a worker and an operator. 007's own comment says so.
  db/migrations/020_email_identities.sql:74
    CONSTRAINT email_identities_one_claim
      CHECK ((worker_id IS NOT NULL) <> (operator_id IS NOT NULL))
    -> EXACTLY ONE. One mailbox = one role, permanently.

THE BUILD AGENT WAS NOT WRONG TO DO THIS. decision-64 section 1 literally says 'a CHECK that
exactly one is set', and the agent implemented the decision as written and flagged the
divergence from 007 rather than quietly harmonising. 020's header already carries the upgrade
path. This task exists because the DECISION is what needs revisiting, not the code.

CONSEQUENCES OF LEAVING IT AS-IS:
  - a supervisor who cleans as well as supervises needs two mailboxes to hold two doors, but
    only one phone number to hold both. Same person, two different rules.
  - release became a plain DELETE (one statement) instead of releaseWorkerPhone's two, so the
    two identity tables now have visibly different release code for no reason a reader can see
    from the code alone.
  - it is a CHECK on a table with no rows on any live box today. Changing it later is a
    migration on an empty table now, and a data migration once anyone has claimed an address.
    The cost of deciding is lowest right now.

IF THE ANSWER IS 'HARMONISE': migration 020's header states the shape - relax the CHECK to
007's at-least-one, and give the claim route an ON CONFLICT branch so a second role adds its
column to the existing row instead of failing. Release then has to mirror releaseWorkerPhone:
null the one column, delete the row only when both are null.
IF THE ANSWER IS 'KEEP EXACTLY-ONE': say so in a decision record that amends decision-64 and
explains why email differs from phone, so the next reader does not file this again.

MUST NOT REGRESS EITHER WAY: an address claimed by one person is still refused to another
(409, and the admin web already shows the same refusal wording as the phone field); releasing
an address still CASCADEs its email_challenges away; the four auth routes stay two-gate 503.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a decision record exists that either amends decision-64 to at-least-one or explains why email stays exactly-one
- [x] #2 if harmonised: one address can carry a worker AND an operator claim, and releasing one role leaves the other intact - driven against a real DB
- [x] #3 either way, the cross-person 409 and the CASCADE of email_challenges are proven unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed (commit 36f2b0c): decision-64 amended in place, migration 020's CHECK renamed email_identities_claims (at-least-one, matches phone_identities exactly), putWorkerEmail/putOperatorEmail gained putWorkerPhone's adopt-the-other-half ON CONFLICT branch. Independently re-verified against a fresh 19-migration DB and the real HTTP admin routes: one address claims both a worker and an operator identity, releasing one half leaves the other intact and the row survives, releasing the last half deletes the row; cross-person conflict is now a same-role-only 409.
<!-- SECTION:NOTES:END -->
