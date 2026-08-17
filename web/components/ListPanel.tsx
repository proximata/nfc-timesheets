'use client'

import { type ReactNode, useId } from 'react'

export type ListPanelProps = {
  /** The panel's heading. Rendered as an <h2>, styled small — it is a label, not a title. */
  title: string
  /** One quiet action for the whole panel: "Alle Schichten →", "Neu anlegen". */
  action?: ReactNode
  /**
   * One line of scope about THIS panel's data — "as of 17:44", "the last 10 shifts".
   * It belongs in the heading and not as a loose grey paragraph under the table: a
   * footnote floating between two panels reads as page-level prose, which is the weight
   * this redesign exists to remove, and it is ambiguous about which panel it qualifies.
   */
  note?: ReactNode
  /**
   * True → wrap the children in a padded body. Leave it off when the child IS a
   * `<table class="data-table">`, which supplies its own cell padding and would otherwise
   * sit inside a second, doubled inset.
   */
  padded?: boolean
  children: ReactNode
}

/**
 * ONE surface with a heading. ~12 callers.
 *
 * This is the component that kills the card-in-a-card: a card inside a card is almost always
 * a missing heading, and this is the heading. Do not nest a ListPanel inside a ListPanel —
 * two adjacent hairlines is the doubled 2px line that makes an interface look homemade.
 */
export function ListPanel({ title, action, note, padded, children }: ListPanelProps) {
  const headingId = useId()

  return (
    <section className="list" aria-labelledby={headingId}>
      <div className="lh">
        <div>
          <h2 id={headingId}>{title}</h2>
          {note ? <p className="panel-note">{note}</p> : null}
        </div>
        {action}
      </div>
      {padded ? <div className="list-body">{children}</div> : children}
    </section>
  )
}
