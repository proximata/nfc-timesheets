---
id: TASK-136
title: 'Redesign foundation: token layer in globals.css'
status: In Progress
assignee: []
created_date: '2026-08-17 11:19'
updated_date: '2026-08-17 13:02'
labels:
  - ux
  - redesign
dependencies: []
references:
  - docs/brand/prototype.html
documentation:
  - backlog/docs/REDESIGN-PLAN.md
priority: high
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the light-only :root token block in web/app/globals.css with the approved prototype's dark-default set, plus [data-theme="light"]. Accent is BLUE: oklch(.72 .17 250) dark, oklch(.55 .12 250) light. Exact values in REDESIGN-PLAN.md section 1.1.

Legacy tokens (--bg, --surface, --ink, --ink-muted, --accent-soft, --focus, --space-*) become ALIASES of the new names so ~1000 lines of existing CSS keep working in dark mode without a big-bang rename across files owned by other agents (section 1.2). Superseded rules listed in section 1.3 are deleted in the same change, EXCEPT .worker-form and the button aliases which the cleanup task removes.

Three additions the prototype does not contain but the product needs (section 1.4): color-scheme, a light-pinned .portal subtree, an @media print light set, and the 3px state rule placed on the first CELL because a border on <tr> under border-collapse:collapse silently does not paint.

NO new dependency. 'Inter' is a font-family name only - no @font-face, no next/font, no download. Sole writer of globals.css for the whole workstream.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 web/app/globals.css :root carries the exact token names and values from REDESIGN-PLAN.md section 1.1, including color-scheme: dark
- [ ] #2 [data-theme="light"] block present with the prototype's light values and color-scheme: light
- [ ] #3 Legacy aliases --bg/--surface/--ink/--ink-muted/--accent-soft/--focus/--space-1..8 resolve to the new tokens; no screen file was edited to achieve this
- [ ] #4 Every rule named dead in section 1.3 is deleted, except .worker-form, .button-primary, .button-secondary which are left for the cleanup task; no rule appears in both old and new form
- [ ] #5 .portal renders light and /reinigung/ is visually unchanged from before the change
- [ ] #6 @media print resolves to the light token set
- [ ] #7 MUTATION TEST recorded: the 3px left state rule set to transparent on purpose makes the /shifts/ screenshot visibly change, then is restored
- [ ] #8 package.json dependencies are byte-identical to before
- [ ] #9 cd web && pnpm lint && pnpm typecheck && pnpm build all green, and a screenshot of the UNTOUCHED /workers/ shows the legacy markup rendering correctly in dark mode
<!-- AC:END -->
