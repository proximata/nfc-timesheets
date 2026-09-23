import { apiFetch } from '@/lib/api'
import { businessMidnight, rangeQuery } from '@/lib/period'
import { toBusinessInput } from '@/lib/shifts'

export type Assignment = {
  id: string
  worker_id: number
  worker_name: string
  location_id: string
  location_name: string
  starts_at: string
  ends_at: string
  note: string
  cancelled_at: string | null
  version: number
  updated_at: string
}

export function calendarDay(date: string, offset = 0): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

export function weekStart(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  return calendarDay(date, -((weekday + 6) % 7))
}

export function dayStart(date: string): string {
  return businessMidnight(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
  )
}

export function today(): string {
  return toBusinessInput(new Date().toISOString()).slice(0, 10)
}

export function fetchSchedule(week: string, signal?: AbortSignal) {
  return apiFetch<{ assignments: Assignment[]; truncated: boolean }>(
    `/admin/schedule?${rangeQuery({ from: dayStart(week), to: dayStart(calendarDay(week, 7)) })}`,
    { signal },
  )
}
