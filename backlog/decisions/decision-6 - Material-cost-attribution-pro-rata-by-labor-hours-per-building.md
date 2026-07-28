---
id: decision-6
title: Material cost attribution - pro-rata by labor hours per building
date: '2026-07-28 13:51'
status: accepted
---
## Context

Cleaning materials are shared across buildings and workers, but labor is attributed per-building. Need to allocate material costs to buildings for P&L analysis. Three options considered: (A) company-wide overhead, (B) worker assigns to building on request, (C) pro-rata by labor hours.

## Decision

Option C: pro-rata split based on labor hours per building. If Building X accounts for 30% of total labor hours in a period, it gets 30% of material costs attributed.

## Consequences

- Enables identifying high-cost buildings (more area = more labor + proportional materials)
- No manual attribution burden on workers (option B rejected — nobody will do it)
- More granular than company-wide overhead (option A) — allows per-building P&L
- Implementation in 3B; 3A just needs the data model to support it
