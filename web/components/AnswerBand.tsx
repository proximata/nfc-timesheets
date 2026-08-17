import type { ReactNode } from 'react'

export type AnswerCell = {
  /** The label above the number. Doubles as the React key, so keep them distinct. */
  k: string
  /** The number. Already formatted — this component does no arithmetic and no rounding. */
  v: ReactNode
  /** One line of context under it: who, since when, out of how many. */
  sub?: ReactNode
  /** True for a number that is merely true, false for a number that wants something done. */
  calm?: boolean
}

export type AnswerBandProps = {
  cells: readonly AnswerCell[]
}

/**
 * The thing you read first. Callers: `/`, `/payroll/`, `/pl/`, `/analytics/`, `/shifts/`.
 *
 * `role="status"` because this replaces the `.page-summary role=status` those screens ship
 * today: changing the period refetches and rewrites these numbers, and that change is
 * announced as a text change inside a region that was already there.
 *
 * IT NEVER ANIMATES A NUMBER. A figure that moves while a director reads it is a figure he
 * reads twice. Tabular numerals come from the stylesheet, so the same figure keeps its width
 * between states instead of looking like it changed when it did not.
 */
export function AnswerBand({ cells }: AnswerBandProps) {
  return (
    <div className="answer" role="status">
      {cells.map((cell) => (
        <div className="cell" key={cell.k}>
          <div className="k">{cell.k}</div>
          <div className={cell.calm ? 'v calm' : 'v'}>{cell.v}</div>
          {cell.sub ? <div className="sub">{cell.sub}</div> : null}
        </div>
      ))}
    </div>
  )
}
