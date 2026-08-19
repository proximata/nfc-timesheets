# Onboarding workflows — run in this order

Five isolated workflows. None is launched. Each work item is PLANNED by claude-sonnet-5
(ultrathink, writes nothing) and BUILT by a second claude-sonnet-5 agent that receives the
plan. Verification stays on claude-opus-5: its job is to disbelieve both. Each is a complete script for the `workflow`
tool. They are ordered so no two ever own the same files, and so that the thing you need
first (an operator who can log in) ships first.

    W0  is already running (tag_host_split_then_zones). WAIT for it. It owns
        sql/, server/, web/ and android/ right now. Starting anything below before it
        finishes will lose writes — that has already happened once in this project.

| # | file | ships | owns |
|---|---|---|---|
| W1 | `w1-reset-and-operator.mjs` | empty database, operator identity by phone, roles | sql/ server/ web/ |
| W2 | `w2-android-update-and-logs.mjs` | in-app update, admin-only send-logs | android/ + one server route |
| W3 | `w3-tag-onboarding.mjs` | scan/write a tag on the phone, unbound tag cards in admin | android/ server/ web/ |
| W4 | `w4-feed-and-client-access.mjs` | activity feed, read-a-tag history, client QR access | web/ server/ android/ |
| W5 | `w5-twilio-sms.mjs` | SMS login, replacing enrolment codes | server/ android/ |

Run W1, verify, then W2, and so on. Each ends with a verify phase and a deploy decision.
Do not run two at once. The rule is not politeness: they share `web/messages/*.json`,
`server/routes/admin.js` and `web/lib/nav.ts`, and concurrent writers to those files have
cost this project a full run before.

## What each one assumes from the one before

- W2 assumes W1's roles exist, because the send-logs button is admin-only and "admin" is a
  role, not a flag.
- W3 assumes W2 shipped, because the tag flow is the first thing you will debug in a
  stairwell and you will want logs from a phone you cannot plug in.
- W4 assumes W3, because the feed's first events are tag events.
- W5 is last on your instruction. It replaces a working enrolment mechanism, so it is the
  one change that can lock every worker out at once.

## iOS

You asked for a minimal iOS build for the onboarding draft only, then Android-only after.
That is W3's optional last phase, and it is the one part I would push back on — see
`ITERATIONS.md`.
