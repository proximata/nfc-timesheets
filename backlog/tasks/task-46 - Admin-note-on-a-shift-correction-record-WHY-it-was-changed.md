---
id: TASK-46
title: 'Admin note on a shift correction: record WHY it was changed'
status: To Do
assignee: []
created_date: '2026-08-11 19:11'
labels:
  - server
  - web
  - admin
  - schema
dependencies: []
priority: high
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TRIGGERED BY A REAL INCIDENT, 2026-08-11. A worker clocked in on an adopted tag and could not clock out, so the director had to close the shift by hand from the admin panel. The hours are now right and the REASON is nowhere: the row looks identical to a shift someone edited for any other motive, or for none.

WANTED. A free-text note captured at the moment a shift is corrected or hand-created, shown wherever a corrected shift is shown. This is the audit trail for every hand edit, not a feature for this one incident.

WHY IT MATTERS BEYOND TIDINESS: the payroll screen already counts corrected and hand-entered shifts separately, and the whole point of that is a human reviewing numbers before paying them. 'Why is this one different' is the question that review asks, and today the system cannot answer it. It is also the difference between an edit that is defensible months later and one that looks like someone quietly changing hours.

SHAPE, to be confirmed while building:
  - migration: shifts.correction_note TEXT NULL. Nullable, because every existing row has
    no note and inventing one would be a lie.
  - PATCH /admin/shifts/:id and POST /admin/shifts accept an optional note; validated and
    length-bounded at the trust boundary like every other free-text field.
  - the note is REQUIRED when the edit changes start_time or end_time, and optional
    otherwise - a typo fix in a location should not demand an essay.
  - shown on the shifts screen and anywhere a corrected shift is surfaced, in full, never
    truncated to a tooltip.
  - GDPR: the note is written by an admin about a worker, so it is personal data. It must
    never reach the client portal payload, which stays exactly {building, date, first name,
    minutes}.

NOT IN SCOPE: a full edit history table. One note per shift, overwritten on re-edit, is the
lazy version that answers the question actually being asked. If per-edit history is ever
needed, that is a separate task and a separate table.
<!-- SECTION:DESCRIPTION:END -->
