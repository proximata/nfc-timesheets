---
id: TASK-47
title: 'Feedback screen: let a worker tell the director something is wrong'
status: To Do
assignee: []
created_date: '2026-08-11 19:12'
labels:
  - ios
  - android
  - server
  - web
dependencies: []
priority: medium
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. The system is silent in one direction. A worker who cannot clock out, finds a tag dead, or sees a wrong shift has no way to say so from inside the app - the only channel is phoning the director, which means it usually goes unreported and the director learns about it from a payroll number that looks wrong weeks later. The adopted-tag incident on 2026-08-11 is exactly this: the worker knew immediately, the director found out because they happened to be watching.

SHAPE. A screen reachable from Settings on BOTH platforms: free text, send, done. Not a chat, not a ticket system, no threading, no attachments in v1.

  - server: material_requests already models 'worker writes free text, admin acts on it'
    and has a lifecycle and an admin queue. DECIDE FIRST whether feedback is a second kind
    of row in that table (a  column) or its own table. Reusing it is cheaper and puts
    feedback in a queue the director already checks; the argument against is that a
    material request is a THING TO BUY and feedback is not, so the shared lifecycle
    (approved/ordered/arrived) would be nonsense for it. Lean reuse-with-kind ONLY if the
    lifecycle can be made to fit honestly; otherwise a small table is cleaner than a table
    whose states mean two different things.
  - worker sees their own submissions and whether they were read. Silence is what makes
    people stop reporting.
  - admin sees them somewhere obvious, not a screen nobody opens.
  - offline: queued like everything else, because the moment someone wants to report a
    problem is often the moment the network is bad.
  - i18n: German default with English parity, like every other screen.
  - accessibility is not optional here: this is the screen someone uses when frustrated.

MUST NOT: block or complicate clocking in. Feedback is strictly secondary to the tap path
and must never sit between a worker and a shift.

Include the app version, platform and OS version automatically with each submission - the
director cannot ask a cleaner what build they are on, and without it a report is unactionable.
<!-- SECTION:DESCRIPTION:END -->
