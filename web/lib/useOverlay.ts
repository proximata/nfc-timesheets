'use client'

import { type RefObject, useEffect, useRef } from 'react'

/**
 * The accessibility of every write in the redesigned admin, in one place.
 *
 * Callers: components/Drawer.tsx and components/Modal.tsx. Two, and that is the point —
 * these are the rules that get half-implemented nine times otherwise:
 *
 *   - on open  → focus moves to the first focusable descendant
 *   - while open → Tab and Shift+Tab cycle INSIDE the overlay and never reach the page
 *   - Escape → always closes, including mid-save
 *   - on close → focus RETURNS to the control that opened it
 *   - while open → the page behind does not scroll
 *
 * FOCUS RESTORATION IS THE TRAP, and it is why this is a hook and not four lines in Drawer.
 * The prototype does `lastFocus && lastFocus.focus()`. That works right up until the save
 * removes the row that opened the drawer — a resolved shift leaves the list — and then
 * `lastFocus` is detached, `.focus()` silently no-ops, and the keyboard user is dumped on
 * <body> at the top of the document with no announcement. So: if the opener is gone, focus
 * `#main-content`, which already carries `tabIndex={-1}` for the skip link.
 *
 * SYSTEM RULE that falls out of "Escape always closes": a result message lives in the PAGE's
 * aria-live region, NEVER inside the overlay. An overlay that closes on success takes its
 * own success message with it, unread.
 *
 * ponytail: focus trap only, no `inert` on the shell. Ceiling — a screen reader in browse
 * mode can still read the page behind the overlay. Upgrade path: set `inert` on `.app-shell`
 * while the stack is non-empty. One attribute, one line; do it if a real user hits it.
 */

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Open overlays, innermost last. A ConfirmModal opened from inside a Drawer must take
 * Escape for itself; without this, one keypress closes both and the drawer's unsaved work
 * disappears because the user tried to dismiss a confirmation.
 */
const stack: symbol[] = []
let restoreOverflow: string | null = null

function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0
}

export function useOverlay<T extends HTMLElement = HTMLElement>(
  open: boolean,
  onClose: () => void,
): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)

  // Kept in a ref so a caller re-creating its handler every render does not tear the
  // key listener down and rebuild it — which would drop the keypress in between.
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    const token = Symbol('overlay')
    stack.push(token)

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    if (stack.length === 1) {
      restoreOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }

    // The overlay is mounted by the time effects run, so the first control is already there.
    const container = ref.current
    const first = container?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? container)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      // Only the innermost overlay reacts.
      if (stack[stack.length - 1] !== token) return

      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const el = ref.current
      if (!el) return
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible)
      if (items.length === 0) {
        // Nothing to land on — keep focus on the dialog rather than letting Tab escape it.
        event.preventDefault()
        el.focus()
        return
      }

      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (!firstItem || !lastItem) return
      const active = document.activeElement
      const inside = active instanceof Node && el.contains(active)

      if (event.shiftKey && (!inside || active === firstItem)) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && (!inside || active === lastItem)) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    // Capture phase: a field inside the overlay that stops propagation on Escape (a native
    // <select> does exactly that) must not be able to disable the close.
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const index = stack.indexOf(token)
      if (index >= 0) stack.splice(index, 1)
      if (stack.length === 0 && restoreOverflow !== null) {
        document.body.style.overflow = restoreOverflow
        restoreOverflow = null
      }

      // `isConnected` is the whole reason this hook exists — see the header comment.
      if (opener?.isConnected) opener.focus()
      else document.getElementById('main-content')?.focus()
    }
  }, [open])

  return ref
}
