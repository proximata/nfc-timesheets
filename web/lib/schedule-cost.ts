import type { Worker } from './api'
import type { Assignment } from './schedule'

export type CostAssignment = Pick<
  Assignment,
  'worker_id' | 'worker_name' | 'starts_at' | 'ends_at' | 'cancelled_at'
>

export function plannedCost(
  assignments: CostAssignment[],
  workers: Worker[],
  from: string,
  to: string,
) {
  const rows = new Map<number, { id: number; name: string; ms: number; cents: number | null }>()
  for (const plan of assignments) {
    if (plan.cancelled_at) continue
    const ms = Math.max(
      0,
      Math.min(Date.parse(plan.ends_at), Date.parse(to)) -
        Math.max(Date.parse(plan.starts_at), Date.parse(from)),
    )
    if (!Number.isFinite(ms) || ms === 0) continue
    const row = rows.get(plan.worker_id) ?? {
      id: plan.worker_id,
      name: plan.worker_name,
      ms: 0,
      cents: null,
    }
    row.ms += ms
    rows.set(row.id, row)
  }
  for (const row of rows.values()) {
    const rate = workers.find((worker) => worker.id === row.id)?.hourly_rate_cents
    row.cents =
      rate !== undefined && Number.isSafeInteger(rate) && rate > 0
        ? Math.round((row.ms * rate) / 3_600_000)
        : null
  }
  const lines = [...rows.values()]
  return {
    lines,
    ms: lines.reduce((sum, row) => sum + row.ms, 0),
    cents: lines.some((row) => row.cents === null)
      ? null
      : lines.reduce((sum, row) => sum + (row.cents ?? 0), 0),
  }
}
