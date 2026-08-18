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

/**
 * WHERE FOCUS GOES WHEN A SURFACE CLOSES. Called at OPEN time; the function it returns is
 * called at CLOSE time.
 *
 * `opener.isConnected` alone is not enough and this is the defect it missed. For a panel
 * driven by the URL (`?worker=`, `?location=` — decision-38) the close itself re-renders the
 * list that holds the opener anchor. At cleanup time the anchor is STILL connected, so
 * `.focus()` succeeds — and React then replaces that node in the same commit, at which point
 * the browser drops focus on `<body>`, at the top of a 351-row table. The guard was written
 * for a different shape of close ('the save removed the row'), where the removal lands in an
 * EARLIER commit and `isConnected` is already false.
 *
 * So: focus immediately, then look again after the commit has painted, and if focus fell to
 * the document, re-find the opener BY IDENTITY IN THE MARKUP rather than by node reference —
 * the id, the href or the label it was activated by. A replaced node carries the same three.
 * Only if that finds nothing does focus go to `#main-content`, which is where the skip link
 * already points. NEVER `<body>`.
 *
 * ponytail: the re-find is a first-match query, so two controls with the same href and label
 * on one screen would return the earlier one. CEILING, and a harmless one — it is the same
 * link to the same place. Upgrade path: a data attribute written by the opener, if a screen
 * ever gets two of them and somebody minds.
 */
export function captureOpener(): () => void {
  const active = document.activeElement
  // `<body>` is not an opener, it is the absence of one — and remembering it would make the
  // fallback below restore focus to exactly the place this function exists to avoid.
  const opener =
    active instanceof HTMLElement && active !== document.body && active !== document.documentElement
      ? active
      : null
  const tag = opener?.tagName ?? ''
  const id = opener?.id ?? ''
  const href = opener?.getAttribute('href') ?? ''
  const label = (opener?.getAttribute('aria-label') ?? opener?.textContent ?? '').trim()

  const again = (): HTMLElement | null => {
    if (id !== '') return document.getElementById(id)
    if (tag === '') return null
    const same = [...document.querySelectorAll<HTMLElement>(tag)].find((node) =>
      href !== ''
        ? node.getAttribute('href') === href
        : label !== '' &&
          (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === label,
    )
    return same ?? null
  }

  const land = () => {
    const target = opener?.isConnected === true ? opener : again()
    if (target?.isConnected === true) target.focus()
    else document.getElementById('main-content')?.focus()
  }

  return () => {
    land()
    // After the commit that closed the surface. `requestAnimationFrame` and not a timeout:
    // the replacement happens in React's commit, which is before the next paint.
    requestAnimationFrame(() => {
      // Only if focus is nowhere. Anything else — another overlay opened, the reader clicked
      // something — is somebody with a better claim to it than a closed panel.
      const active = document.activeElement
      if (stack.length > 0) return
      if (active !== null && active !== document.body && active !== document.documentElement) return
      land()
    })
  }
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

    const restore = captureOpener()

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

      // Focus restoration is the whole reason this hook exists — see `captureOpener`.
      restore()
    }
  }, [open])

  return ref
}
