---
id: TASK-287
title: >-
  Backend: manual_start/manual_close columns + POST /shifts/open+close
  manual:true, admin-visible
status: To Do
assignee: []
created_date: '2026-08-27 09:42'
labels:
  - server
  - decision-56
dependencies: []
priority: high
ordinal: 205000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 migration adds shifts.manual_start boolean not null default false, shifts.manual_close boolean not null default false; applied and verified via psql \d shifts locally
- [ ] #2 POST /shifts/open accepts optional manual:true, stamps manual_start=true, validation UNCHANGED (still v.activePlace + v.requireVerifiedPlace, same 422/409 codes a real tap gets)
- [ ] #3 POST /shifts/close accepts optional manual:true, stamps manual_close=true AND corrected_at=now() in the same UPDATE, auto_closed left false; a normal tap-close (manual omitted) is byte-for-byte unchanged
- [ ] #4 GET /roster unchanged (already returns the location list the client needs for a picker) - confirmed by reading the route, no new endpoint added
- [ ] #5 admin-facing shift read paths (admin.js, app.js SHIFT_FIELDS) include manual_start/manual_close in the response so web can render them
- [ ] #6 check-api.js covers: manual open still 422s on an unverified/unbound place exactly like a tap would; manual close sets corrected_at+manual_close in one call with no separate resolve step; a plain close (no manual flag) is unaffected byte-for-byte
- [ ] #7 full check-api.js run shows no new failures beyond the 1 known pre-existing check-telemetry-wire failure (TASK-280)
<!-- AC:END -->
