-- 8h shift auto-close. TASK-11, decision-10.
--
-- A worker who forgets to tap out must not accrue unbounded payroll hours. After 8h an open
-- shift is closed at start+8h and flagged auto_closed — "the timer closed this, no human did".
-- corrected_at stays NULL, which is what makes the shift show up in GET /shifts/unresolved
-- until the worker resolves it. Never set corrected_at here: this file is not a human.
--
-- REACHABLE SINCE decision-19. The iOS app now posts the shift at clock-IN with end_time NULL
-- and closes it at clock-out, so open shifts actually exist server-side. Before that the app
-- only ever posted already-completed shifts, end_time was never NULL, and this UPDATE could
-- match zero rows forever — the whole safety net (this file, both systemd units, the partial
-- index, /shifts/unresolved, /shifts/:id/resolve) was dead machinery.
--
-- IDEMPOTENT BY CONSTRUCTION: the WHERE requires end_time IS NULL, and the UPDATE sets
-- end_time to a non-NULL value. A row can therefore match at most once, ever. Running this
-- file twice in a row updates 0 rows the second time. No bookkeeping table, no "last run"
-- state, no risk of double-counting after a missed window.
--
-- The `UPDATE <n>` command tag psql prints goes to journald, which is the auto-closure audit
-- log (TASK-11 AC #4). Do not add -q to the psql invocation or that record disappears.

UPDATE shifts
   SET end_time    = start_time + INTERVAL '8 hours',
       auto_closed = true
 WHERE end_time IS NULL
   AND start_time < now() - INTERVAL '8 hours';
