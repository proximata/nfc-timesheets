---
id: decision-7
title: Desktop-first web admin - no mobile layout (blocker message)
date: '2026-07-28 13:51'
status: accepted
---
## Context

Admin panel has complex views (map, tables, side panels). Building responsive layouts for all breakpoints is significant effort for a pilot.

## Decision

Below 1024px viewport: show full-screen blocker message "NFC TimeSheets Admin is designed for desktop." Above 1024px: full sidebar nav + content layout. No responsive admin for this iteration.

## Consequences

- Faster development — one layout to build and test
- Admin on tablet/phone blocked entirely
- Acceptable: admin tasks are office work, not field work. Workers use the iOS app.
