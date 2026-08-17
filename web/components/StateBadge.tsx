export type BadgeState = 'open' | 'unres' | 'corr' | 'muted'

export type StateBadgeProps = {
  state: BadgeState
  /** The WORD. Never empty, never an icon, never a bare colour. Already translated. */
  label: string
}

/**
 * The state, as a word, tinted second.
 *
 * COLOUR IS ALWAYS THE SECOND SIGNAL. The badge carries the word; the row carries a 3px left
 * rule; the sort order carries the rest. Desaturate a screenshot of this table and it is
 * still readable — that is the test, and if it fails the design is wrong, not the reviewer.
 *
 * Callers: `/`, `/shifts/`, `/material-requests/`, `/contracts/`.
 */
export function StateBadge({ state, label }: StateBadgeProps) {
  return <span className={`badge ${state}`}>{label}</span>
}
