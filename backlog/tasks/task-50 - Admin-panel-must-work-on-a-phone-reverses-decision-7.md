---
id: TASK-50
title: Admin panel must work on a phone (reverses decision-7)
status: To Do
assignee: []
created_date: '2026-08-11 23:02'
labels:
  - web
  - admin
  - ux
dependencies: []
priority: high
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE OWNER ASKED FOR THIS DIRECTLY, and it REVERSES decision-7, which chose desktop-first with an explicit mobile blocker. That decision was not arbitrary - payroll tables, month-long shift lists and the P&L screen were judged unreadable on a phone, and a deliberate 'please use a desktop' message was preferred to a screen that technically renders and cannot be used. Write a decision record superseding decision-7 BEFORE the code changes, with the honest reason: the director is in buildings, not at a desk, and the panel being unreachable on a phone is worse than a cramped table.

WHAT MUST NOT HAPPEN: the desktop-only guard is deleted, every screen collapses to a scrolling mess, and the panel becomes technically-mobile and practically-useless. That is the outcome decision-7 was protecting against and it is still the likely one.

SO, PER SCREEN, decide REPLACE or STACK - do not apply one responsive rule to all eleven:
  - /shifts/, /payroll/: wide tables of numbers. On a phone these become CARDS, one row per
    card, not a horizontally-scrolling table. Payroll must keep the reconciliation line and
    the exclusion counts visible - they are the reason the number is trustworthy.
  - dashboard: already an exceptions screen, closest to mobile-ready. Highest value on a
    phone (what is wrong right now) - do this one FIRST and ship it alone if time is short.
  - /workers/, /locations/: forms. See the required-fields task; a cramped form with
    unclear requirements is where mobile data entry actually fails.
  - /pl/, /analytics/: dense, comparative, least useful on a phone. Allowed to keep a
    'better on a larger screen' note rather than being forced to fit.
  - the client portal is ALREADY mobile and stays exactly as it is.

Touch targets at least 44px, no hover-only affordances, and the existing accessibility
work must not regress. Test at 320px width - that is a real phone, not a hypothetical.

The map (TASK-48) and this task both touch the dashboard: sequence them, do not run them
concurrently on the same file.
<!-- SECTION:DESCRIPTION:END -->
