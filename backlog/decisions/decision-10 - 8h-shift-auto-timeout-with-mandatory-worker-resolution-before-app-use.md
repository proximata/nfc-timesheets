---
id: decision-10
title: 8h shift auto-timeout with mandatory worker resolution before app use
date: '2026-07-28 13:51'
status: accepted
---
## Context

Workers may forget to check out. Unresolved shifts corrupt payroll data. Need a forcing function that ensures every shift has a verified end time.

## Decision

Multi-layer approach:
1. **Server cron** (every 15min): auto-closes shifts >8h, sets `autoFinished=true`, `needsCorrection=true`. Shift locked and excluded from payroll.
2. **iOS local notification** at T+8h: motivational message about payroll exclusion.
3. **Mandatory resolution modal** on app launch: if unresolved shifts exist, worker MUST set real end time one-by-one before accessing the app. Progress indicator ("1 of 3"). No skip/dismiss.
4. Resolved shifts: `needsCorrection=false`, `manualFinish=true`. Now count in payroll. Color-coded in admin panel (amber for auto-finished pending, purple for manually corrected).

## Consequences

- Zero unresolved shifts in payroll — guaranteed by blocking app access
- Workers motivated by payroll exclusion message
- Admin sees which shifts were corrected (trust but verify)
- Edge case: worker never opens app again → shift stays excluded from payroll forever (correct behavior — unverified hours shouldn't be paid)
