'use client'

import { useEffect } from 'react'

/**
 * Copies each table's column headings onto its own cells as `data-label`, so the CSS
 * row-to-card transform (`globals.css`, `@media (max-width: 1279px)` since R1 — an iPad and a
 * half-width monitor window, not only a phone) can print the heading beside each value. A card
 * reading `08:15` twice is not a card, it is a riddle.
 *
 * The positional walk below is guarded by `demo/audit-band-shape.mjs`, which compares each
 * caption's TEXT with its column's heading TEXT at all six card widths. Map the labels off the
 * `td`s alone and it goes red with the pairs; every count-based probe stayed green.
 *
 * ponytail: fifteen lines here instead of hand-adding `data-label` to several hundred `<td>`
 * elements across eleven screens — and it covers screens nobody has written yet, which is the
 * part a hand-edit gets wrong six months from now. Ceiling: this needs JavaScript, so with JS
 * off a card shows values without headings. The panel already fetches all its data client
 * side, so it does not work with JS off anyway; if that ever changes, move the labels into
 * the JSX and delete this. It also only sees tables present when it runs, hence the observer.
 */
export function ResponsiveTableLabels() {
  useEffect(() => {
    const label = (root: ParentNode) => {
      for (const table of root.querySelectorAll?.('table.data-table') ?? []) {
        const headings = [...table.querySelectorAll('thead th')].map((th) =>
          (th.textContent ?? '').trim(),
        )
        if (headings.length === 0) continue
        for (const row of table.querySelectorAll('tbody tr')) {
          // ALL cells, in document order — not just the `td`s. Rows here lead with a `<th>`
          // row header (the worker, the building), so counting only `td`s shifts every label
          // one column left and a card confidently captions a timestamp as "Objekt". A card
          // with the wrong headings is worse than a card with none: it is not unreadable, it
          // is readable and false, and this shipped for exactly as long as it took to look at
          // a screenshot rather than a passing assertion.
          const cells = [...row.children] as HTMLElement[]
          cells.forEach((cell, i) => {
            const heading = headings[i]
            // Only label real data cells, and only when there is something to say. The row
            // header already reads as the card's title, and an empty heading (an actions
            // column) would otherwise print a stray label on every card.
            if (cell.tagName === 'TD' && heading) cell.setAttribute('data-label', heading)
            else cell.removeAttribute('data-label')
          })
        }
      }
    }

    label(document)

    // Rows arrive after a fetch, and filters replace them. Re-label on any DOM change rather
    // than trying to guess which screens re-render when.
    const observer = new MutationObserver(() => label(document))
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return null
}
