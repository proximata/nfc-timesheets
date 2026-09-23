import { apiFetch } from '@/lib/api'
import { type CalendarRange, type Period, periodRange, rangeQuery } from '@/lib/period'

export type AdminAccount = {
  id: number
  email: string
  role: 'admin' | 'superadmin' | 'flags'
  tenant_id: number
}
export type Workspace = {
  material_orders: {
    id: number
    body: string
    status: 'ordered' | 'arrived'
    cost_cents: number | null
    ordered_at: string
  }[]
  company: { id: number; name: string; locale: 'de' | 'en'; company_confirmed_at: string | null }
  setup: {
    locations: number
    workers: number
    operators: number
    verified_zones: number
    joined_workers: number
    shifts: number
    active_shifts: number
    unresolved_shifts: number
    pending_materials: number
  }
  materials: { ordered_count: number; unpriced_count: number; known_material_cents: number }
  workers: {
    id: number
    name: string
    hourly_rate_cents: number
    minutes: number
    estimated_cents: number
  }[]
  weeks: { week: string; hours: number }[]
  fetched_at: string
}
export type ManagedWorkspace = {
  id: number
  name: string
  locale: string
  active: boolean
  owner_email: string | null
  invitation_expires_at: string | null
  activated_at: string | null
}
export const fetchAccount = (signal?: AbortSignal) =>
  apiFetch<{ admin: AdminAccount }>('/admin/session', { signal })
export const fetchWorkspace = (period: Period, custom?: CalendarRange, signal?: AbortSignal) =>
  apiFetch<Workspace>(`/admin/workspace?${rangeQuery(periodRange(period, new Date(), custom))}`, {
    signal,
  })
export const fetchManagedWorkspaces = () =>
  apiFetch<{ workspaces: ManagedWorkspace[] }>('/platform/workspaces')
export const provisionWorkspace = (body: {
  name: string
  email: string
  locale: string
  request_id: string
}) =>
  apiFetch<{ workspace: ManagedWorkspace; invitation_token: string | null }>(
    '/platform/workspaces',
    { method: 'POST', body },
  )
export const renewInvitation = (id: number) =>
  apiFetch<{ invitation_token: string }>(`/platform/workspaces/${id}/invitation`, {
    method: 'POST',
  })
export const saveCompany = (name: string, locale: string) =>
  apiFetch('/admin/workspace', { method: 'POST', body: { name, locale } })
export const acceptWorkspaceInvitation = (token: string, password: string) =>
  apiFetch('/workspace-invitations/accept', { method: 'POST', body: { token, password } })

// Bearer credentials remain in the fragment, out of access logs and referrer URLs.
export function invitationUrl(token: string): string {
  return `${window.location.origin}/welcome/#${token}`
}
export function readInvitationFragment(): string {
  return window.location.hash.slice(1)
}
export function clearInvitationFragment(): void {
  window.history.replaceState(null, '', window.location.pathname)
}
export function completedSetup(workspace: Workspace): boolean[] {
  const { company, setup } = workspace
  return [
    Boolean(company.company_confirmed_at),
    setup.locations > 0,
    setup.workers > 0,
    setup.operators > 0 && setup.verified_zones > 0 && setup.joined_workers > 0 && setup.shifts > 0,
  ]
}
