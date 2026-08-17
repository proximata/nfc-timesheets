'use client'

import type { ReactNode } from 'react'
import type { BadgeState } from '@/components/StateBadge'

export type AttentionItem = {
  id: string
  /** Who. The line you scan for. */
  who: string
  /** Where and when, one quiet line under it. */
  where: string
  /** Drives the 3px left rule. The WORD still has to appear, normally in `trailing`. */
  state?: BadgeState
  /**
   * A StateBadge, a duration, an arrow. DISPLAY ONLY — the whole row is one button, so
   * anything focusable in here would be a button inside a button and is invalid markup.
   */
  trailing?: ReactNode
  onOpen: () => void
  /**
   * Optional visually-hidden prefix to the row's accessible name, for when `who` alone is
   * ambiguous out of context ("Schicht korrigieren: Selim Kaya").
   */
  openLabel?: string
}

export type AttentionListProps = {
  items: readonly AttentionItem[]
}

/**
 * The prototype's `.row` grid, for NON-TABULAR attention rows: one thing that needs a
 * decision, its context, its state, and a click that opens the drawer.
 *
 * NOT FOR TABULAR DATA. Anything with columns that line up stays a
 * `<table class="data-table">`, because the ≤767px row-to-card transform and
 * components/ResponsiveTableLabels.tsx both depend on it being a real table, and because
 * payroll, P&L and analytics need genuine column/row association. Porting this onto a table
 * breaks the phone layout and no green test will say so.
 *
 * Callers: `/` (Zu erledigen) and `/shifts/` (top-of-page triage). Two, which is the floor.
 * If `/shifts/` ends up not using it, delete this file and inline the JSX into `/`.
 */
export function AttentionList({ items }: AttentionListProps) {
  return (
    <ul className="list-rows">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className={item.state ? `row is-${item.state}` : 'row'}
            onClick={item.onOpen}
          >
            <span className="rule" aria-hidden="true" />
            <span className="row-text">
              {item.openLabel ? <span className="visually-hidden">{item.openLabel}</span> : null}
              <span className="who">{item.who}</span>
              <span className="where">{item.where}</span>
            </span>
            {item.trailing ? <span className="row-trailing">{item.trailing}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
