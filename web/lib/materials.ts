import type { MaterialRequest, MaterialStatus } from '@/lib/api'

/**
 * The material-request lifecycle, in the browser.
 *
 * A COPY of MATERIAL_TRANSITIONS in server/lib/materials.js, and it stays a copy on
 * purpose: the server is the authority and answers 409 for an illegal move, but a screen
 * whose job is "the next action is one click" has to know which buttons to draw before it
 * clicks anything. The table is small, and the alternative — rendering every button and
 * finding out from a 409 — makes the admin discover a refusal after committing to it.
 *
 * `arrived` and `rejected` are TERMINAL. There is no un-reject: the worker asks again, and
 * the refusal stays in the history where a dispute can find it.
 */
export const MATERIAL_TRANSITIONS: Record<MaterialStatus, readonly MaterialStatus[]> = {
  submitted: ['approved', 'rejected'],
  approved: ['ordered', 'rejected'],
  ordered: ['arrived'],
  arrived: [],
  rejected: [],
}

/** The moves an admin may make from here. Empty = terminal, so no action button is drawn. */
export function nextStatuses(status: MaterialStatus): readonly MaterialStatus[] {
  return MATERIAL_TRANSITIONS[status]
}

/**
 * Is somebody still waiting on this? Derived from the table, never a second list — the
 * same derivation the server uses for MATERIAL_OPEN_STATUSES and for its partial index.
 */
export function isOpen(status: MaterialStatus): boolean {
  return MATERIAL_TRANSITIONS[status].length > 0
}

/**
 * WHO is being waited on, which is the only question the queue screen is really asking.
 *
 * - `decide`  — the admin has not said yes or no. The worker is waiting on a person.
 * - `order`   — approved, but nobody has bought it. The worker is waiting on a purchase.
 * - `deliver` — bought, not yet here. The worker is waiting on a van.
 * - `done`    — it arrived.
 * - `refused` — it will not come, and that answer is final.
 */
export type MaterialStage = 'decide' | 'order' | 'deliver' | 'done' | 'refused'

export function stageOf(status: MaterialStatus): MaterialStage {
  switch (status) {
    case 'submitted':
      return 'decide'
    case 'approved':
      return 'order'
    case 'ordered':
      return 'deliver'
    case 'arrived':
      return 'done'
    case 'rejected':
      return 'refused'
  }
}

/**
 * Money was committed and nobody has typed what it cost.
 *
 * This is not a cosmetic gap. The P&L's material pool is `SUM(cost_cents)` over requests
 * with `status IN ('ordered','arrived')`, so an unpriced one is silently worth zero there:
 * every building's material share comes out too low and the margin too high. The screen
 * counts these and says so, and the P&L reports the same number from its own side.
 *
 * A request that was never ordered is NOT unpriced — there is nothing to price yet.
 */
export function isUnpriced(request: Pick<MaterialRequest, 'status' | 'cost_cents'>): boolean {
  return (
    (request.status === 'ordered' || request.status === 'arrived') && request.cost_cents === null
  )
}

/**
 * The worker acknowledged the arrival — by POLLING, because there is no push in this
 * system (decision-23 keeps the server on `pg` + `@sentry/node`). So `false` means "their
 * app has not asked since it arrived", NOT "the message failed to deliver", and no copy on
 * this screen may promise a notification.
 */
export function isAcknowledged(request: Pick<MaterialRequest, 'status' | 'seen_at'>): boolean {
  return request.status === 'arrived' && request.seen_at !== null
}
