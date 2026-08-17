---
id: TASK-137
title: >-
  Redesign foundation: overlay primitives (useOverlay, Drawer, Modal,
  ConfirmModal)
status: Done
assignee: []
created_date: '2026-08-17 11:19'
updated_date: '2026-08-17 13:31'
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
- [x] #1 web/lib/useOverlay.ts exports useOverlay(open, onClose) returning a ref; Drawer and Modal are its only callers
- [x] #2 Escape closes an open Drawer and an open Modal, including while busy
- [x] #3 Tab and Shift+Tab cycle within the open overlay and never reach the page behind it
- [x] #4 On close, focus returns to the control that opened the overlay
- [x] #5 NEGATIVE CASE PROVEN: with the opening row removed from the DOM by the save, focus lands on #main-content and not on <body>; demonstrated by resolving a shift from its drawer using the keyboard only, then pressing Tab
- [x] #6 Drawer markup matches the prototype: role=dialog, aria-modal, .step line, header/.body/footer, scrim that closes on click
- [x] #7 ConfirmModal exposes title and body to assistive tech via aria-labelledby and aria-describedby
- [x] #8 Every control in both overlays has a visible :focus-visible outline and a minimum 44px touch target
- [x] #9 prefers-reduced-motion: reduce removes the drawer slide and the modal scale
- [x] #10 No new npm dependency; package.json unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
web/lib/useOverlay.ts + components/Drawer.tsx, Modal.tsx, ConfirmModal.tsx. Drawer and Modal are the hook's only callers; ConfirmModal wraps Modal.

Overlays are UNMOUNTED when closed, so nothing inside one is ever in the tab order behind it. Entry animation is a CSS keyframe rather than a toggled class, which is what makes unmounting possible; prefers-reduced-motion flattens it.

An overlay STACK (module-level) means a ConfirmModal opened from inside a Drawer takes Escape for itself -- otherwise one keypress closes both and unsaved work vanishes because the user dismissed a confirmation. Body scroll is locked on the first open and released on the last close.

Escape is bound in the CAPTURE phase: a native <select> inside the drawer swallows Escape, and a control must not be able to disable the close.

NEGATIVE CASE PROVEN (AC#5). demo/check-foundation.mjs drives a temporary harness route whose Save removes the button that opened the drawer, then reads document.activeElement:
  green: 'focus lands on #main-content, never <body>  focus landed on MAIN#main-content.content'
  MUTATION -- replacing the isConnected branch with the prototype's naive lastFocus.focus():
  'FAIL overlay: opener removed by the save -> focus lands on #main-content, never <body> -- focus landed on BODY'
The other six overlay assertions stayed GREEN through that mutation, which is the whole reason this case is asserted separately.

Also asserted: focus moves in on open, 14 real Tab and 4 Shift+Tab keypresses never leave the drawer, Escape closes, focus returns to the opener, body overflow released.

ponytail: focus trap only, no inert on the shell. Ceiling recorded in the file header.
<!-- SECTION:NOTES:END -->
