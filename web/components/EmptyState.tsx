import type { ReactNode } from 'react'

export type EmptyStateProps = {
  /**
   * What the emptiness MEANS, in a sentence. „Nichts zu tun" — not „Keine Daten".
   *
   * Where a filter could be hiding rows, say so and offer the way out: an empty period that
   * reads as an empty database is how a director concludes the payroll data is gone.
   */
  children: ReactNode
}

/** „Leer heißt: nichts zu tun", not a screen that failed to load. ~10 callers. */
export function EmptyState({ children }: EmptyStateProps) {
  return <p className="empty-state">{children}</p>
}
