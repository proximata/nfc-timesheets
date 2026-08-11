---
id: TASK-51
title: >-
  Required vs optional fields: mark them, and let optional ones be filled in
  later
status: To Do
assignee: []
created_date: '2026-08-11 23:02'
labels:
  - web
  - admin
  - ux
  - server
dependencies: []
priority: high
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TWO HALVES OF ONE COMPLAINT: forms do not say what is actually required, and they demand things up front that could be supplied later. Both slow down the moment that matters - adding a worker or a building while standing in front of one.

HALF ONE - SAY WHAT IS REQUIRED. Every form in the admin panel marks required fields
explicitly and consistently. Today the rules live only in the server validator and the user
discovers them by being rejected. Ground truth, do not guess it:
  - workers: only  is required. email, phone and hourly rate are ALL optional
    server-side today (v.optionalEmail, v.optionalPhone). If the form implies otherwise it
    is lying.
  - locations, clients, contacts, inventory: read each validator and mark accordingly.
Marking must be visible without hover (mobile has no hover - see TASK-50), and announced to
screen readers via aria-required, not conveyed by a red asterisk alone.

HALF TWO - LET THE REST WAIT. Creating a worker should need a name and nothing else; a rate
and a phone number can follow. The endpoints already allow this. The work is making the UI
match, and making a half-filled record VISIBLY incomplete rather than silently fine.

THE TRAP, and it is a payroll trap: a worker with NO hourly rate appears in payroll at
zero. Streamlining creation must not quietly produce people who are paid nothing. So an
incomplete worker must be flagged where it matters - on the worker row AND in payroll,
which must name them rather than silently sum them as 0. Decide explicitly whether a shift
for a rate-less worker is an exclusion (like unresolved auto-closed shifts, which are
already counted and named) or a zero. It must never be an invisible zero.

WORKER MODEL CHANGE, as requested: the owner asked to modify the worker model. Confirm the
intended shape before migrating - the fields in play are name, email (Sign in with Apple
credential on iOS), phone (calling only), hourly rate, active, and the enrolment code
columns. Any new field must state whether it is required, and no existing row may be
invalidated by the change.

i18n parity and accessibility apply as everywhere else.
<!-- SECTION:DESCRIPTION:END -->
