---
id: TASK-361
title: Подключить сервис бронирования к Book a call
status: To Do
assignee: []
created_date: '2026-09-23 18:30'
labels: []
dependencies:
  - TASK-352
ordinal: 280000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner deferred live booking on 2026-09-23 and requested a new follow-up replacing integration scope of TASK-353. TASK-352 delivers an unavailable placeholder. Provider, organizer and availability are not selected.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Owner approves provider, organizer, duration, availability and timezone.
- [ ] #2 Booking, unavailable slots, errors, cancellation and rescheduling pass in a test calendar without duplicates.
- [ ] #3 Confirmation follows successful booking only; minimum contact data, private secrets and DE/EN UI.
<!-- AC:END -->
