---
id: TASK-137
title: >-
  Redesign foundation: overlay primitives (useOverlay, Drawer, Modal,
  ConfirmModal)
status: In Progress
assignee: []
created_date: '2026-08-17 11:19'
updated_date: '2026-08-17 13:02'
labels:
  - ux
  - redesign
dependencies:
  - TASK-136
references:
  - docs/brand/prototype.html
documentation:
  - backlog/docs/REDESIGN-PLAN.md
priority: high
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every WRITE in the redesigned admin happens in a right-hand Drawer with ONE job; every irreversible action happens in a small centred ConfirmModal with a plain yes/no. Build the primitives once, correctly, because the accessibility here is what gets half-implemented nine times otherwise.

web/lib/useOverlay.ts - hook, callers are Drawer and Modal. Focus first focusable on open, trap Tab inside the ref, Escape always closes (including mid-save), restore focus on close, lock body scroll.

FOCUS RESTORATION IS THE TRAP. The prototype does lastFocus && lastFocus.focus(). That works until the save removes the row that opened the drawer - a resolved shift leaves the list - and then lastFocus is detached, .focus() silently no-ops, and the keyboard user is dumped on <body>. Fall back to #main-content, which already carries tabIndex={-1} for the skip link.

SYSTEM RULE that falls out of 'Escape always closes': result messages live on the PAGE aria-live region, never inside the overlay. An overlay that closes on success takes its success message with it, unread.

Props in REDESIGN-PLAN.md section 2.2. ConfirmModal wraps Modal, it does not duplicate it; 5 named callers. ponytail: focus trap only, no inert on the shell - ceiling is browse-mode reading behind the drawer, upgrade path is one inert attribute.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 web/lib/useOverlay.ts exports useOverlay(open, onClose) returning a ref; Drawer and Modal are its only callers
- [ ] #2 Escape closes an open Drawer and an open Modal, including while busy
- [ ] #3 Tab and Shift+Tab cycle within the open overlay and never reach the page behind it
- [ ] #4 On close, focus returns to the control that opened the overlay
- [ ] #5 NEGATIVE CASE PROVEN: with the opening row removed from the DOM by the save, focus lands on #main-content and not on <body>; demonstrated by resolving a shift from its drawer using the keyboard only, then pressing Tab
- [ ] #6 Drawer markup matches the prototype: role=dialog, aria-modal, .step line, header/.body/footer, scrim that closes on click
- [ ] #7 ConfirmModal exposes title and body to assistive tech via aria-labelledby and aria-describedby
- [ ] #8 Every control in both overlays has a visible :focus-visible outline and a minimum 44px touch target
- [ ] #9 prefers-reduced-motion: reduce removes the drawer slide and the modal scale
- [ ] #10 No new npm dependency; package.json unchanged
<!-- AC:END -->
