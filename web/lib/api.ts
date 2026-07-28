import type { ErrorKey } from '@/lib/locale'

/**
 * Typed fetch wrapper for the NFC TimeSheets REST API.
 *
 * The admin bundle is served by the same Node process that serves the API (decision-16), so
 * the base URL defaults to same-origin and `NEXT_PUBLIC_API_BASE_URL` is normally empty.
 *
 * Setting it to a different origin does NOT currently work for anything behind a session:
 * the API sends no CORS headers and the session cookie is `Secure; SameSite=Strict`. To
 * exercise a real login locally, build the export and let the API serve it same-origin:
 *   cd web && pnpm build && cd ../server && PUBLIC_DIR=../web/out node server.js
 * `pnpm dev` is for layout work on pages that make no authenticated call.
 *
 * Auth is a server-set httpOnly session cookie (decision-20). There is no admin PIN, no token
 * in web storage and nothing here that reads the cookie back — the browser attaches the
 * session itself because every request is sent with `credentials: 'include'`.
 * `scripts/check.mjs` fails the build if that ever regresses.
 */
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '')

/**
 * Carries an i18n key, not server text. The API's own error body is deliberately discarded so
 * that stack traces, SQL errors or internal paths can never reach the DOM.
 */
export class ApiError extends Error {
  /** 0 means the request never got a response (offline, DNS, CORS, TLS). */
  readonly status: number
  readonly messageKey: ErrorKey

  constructor(status: number, messageKey: ErrorKey) {
    super(`API request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.messageKey = messageKey
  }
}

function messageKeyForStatus(status: number): ErrorKey {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  if (status >= 400 && status < 500) return 'request'
  return 'server'
}

export type ApiRequest = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

/**
 * `path` must start with `/`, e.g. `/admin/data`.
 * Throws `ApiError` for every failure mode; never returns a partial result.
 */
export async function apiFetch<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const { method = 'GET', body, signal } = request

  const headers = new Headers({ Accept: 'application/json' })
  if (body !== undefined) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // Sends and stores the httpOnly session cookie. Required cross-origin in `pnpm dev`.
      credentials: 'include',
      cache: 'no-store',
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, 'network')
  }

  if (!response.ok) throw new ApiError(response.status, messageKeyForStatus(response.status))
  if (response.status === 204) return undefined as T

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(response.status, 'badResponse')
  }
}

/**
 * Exchanges credentials for a session cookie. The cookie is httpOnly, so success here is
 * "no exception thrown" — there is deliberately nothing for the client to read back.
 *
 * Callers must render ONE uniform failure message: the server answers 401 for both an unknown
 * email and a wrong password, and the UI must not widen that into an account oracle.
 */
export function login(email: string, password: string, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>('/admin/login', { method: 'POST', body: { email, password }, signal })
}

/** Clears the session server-side. Failure is still treated as signed out by the caller. */
export function logout(): Promise<void> {
  return apiFetch<void>('/admin/logout', { method: 'POST' })
}

/**
 * A row of `workers` as the API returns it (see WORKER_COLS in server/routes/admin.js).
 * `apple_sub` is deliberately not part of the payload, so it is not part of this type.
 */
export type Worker = {
  id: number
  name: string
  /** Null = no login on file. This address is the Sign in with Apple gate (decision-22). */
  email: string | null
  hourly_rate_cents: number
  active: boolean
  created_at: string
}

/** Create (no `id`) or update (`id`). Same route either way. */
export type WorkerInput = {
  id?: number
  name: string
  email: string
  hourly_rate_cents: number
  active: boolean
}

/**
 * ponytail: `/admin/data` returns shifts and hours too, but typing what no screen reads
 * would be fiction. Widen the response type when a screen needs it.
 */
export function fetchWorkers(signal?: AbortSignal): Promise<Worker[]> {
  return apiFetch<{ workers: Worker[] }>('/admin/data', { signal }).then((data) => data.workers)
}

/**
 * A row of `locations` as `/admin/data` returns it.
 *
 * `id` is a server-generated UUID and is the ONLY identity that exists: it is what the NFC
 * tag carries in `?l=` (decision-21). `slug` is a human label for the admin UI and log
 * lines — it is deliberately NOT on the tag, because a guessable handle on an unlocked tag
 * would let anyone enumerate every building.
 */
export type Location = {
  id: string
  slug: string
  name: string
  address: string | null
  /** Recorded if known; 3A shows the address instead and draws no map. */
  lat: number | null
  lng: number | null
  active: boolean
  created_at: string
}

/** Create (no `id`) or update (`id`, the UUID). Same route either way. */
export type LocationInput = {
  id?: string
  slug: string
  name: string
  address: string
  /**
   * 3A has no input for coordinates, but the route's UPDATE writes every column, so an
   * edit that omitted these would silently null out coordinates set elsewhere. Callers
   * editing an existing row must pass the row's current values back.
   */
  lat?: number | null
  lng?: number | null
  active: boolean
}

export function fetchLocations(signal?: AbortSignal): Promise<Location[]> {
  return apiFetch<{ locations: Location[] }>('/admin/data', { signal }).then(
    (data) => data.locations,
  )
}

/**
 * Upsert. A 409 here can only be `slug_taken` — the route raises no other conflict — so
 * callers may read `ApiError.status === 409` as "that slug belongs to another building".
 *
 * ponytail: deactivation goes through this route with `active: false` rather than
 * `DELETE /admin/locations/:id`, because DELETE is one-way and the admin has to be able to
 * put a building back. Both are soft; nothing here ever destroys a row that shifts point at.
 */
export function saveLocation(input: LocationInput, signal?: AbortSignal): Promise<Location> {
  return apiFetch<{ location: Location }>('/admin/locations', {
    method: 'POST',
    body: input,
    signal,
  }).then((data) => data.location)
}

/**
 * Upsert. A 409 here can only be the UNIQUE index on `workers.email` — the route has no
 * other conflict — so callers may read `ApiError.status === 409` as "email already taken".
 */
export function saveWorker(input: WorkerInput, signal?: AbortSignal): Promise<Worker> {
  return apiFetch<{ worker: Worker }>('/admin/workers', {
    method: 'POST',
    body: input,
    signal,
  }).then((data) => data.worker)
}

/** SHIFT_PAGE_MAX in server/routes/admin.js. A larger value is clamped, not rejected. */
export const ADMIN_SHIFT_LIMIT = 2000

/** A shift joined to its worker and location, exactly as the `adminData` query selects it. */
export type Shift = {
  id: number
  worker_id: number
  worker_name: string
  location_id: string
  location_slug: string
  location_name: string
  start_time: string
  /** Null = still running. */
  end_time: string | null
  /** True = the 8h timer ended it, not a tap. A machine fact, and not patchable. */
  auto_closed: boolean
  /** Set only when a human supplied the real end time of an auto-closed shift. */
  corrected_at: string | null
  client_uuid: string | null
  created_at: string
}

/**
 * `/admin/data` in the shape the shift log needs: the shifts plus the two lists the
 * filters and the correction form pick from.
 *
 * `shift_limit` is the LIMIT the server actually applied (500 by default, 2000 max). When
 * the row count reaches it the list is TRUNCATED, and the screen has to say so — an
 * incomplete shift table read as a complete one is how somebody gets underpaid.
 */
export type ShiftSnapshot = {
  workers: Worker[]
  locations: Location[]
  shifts: Shift[]
  shift_limit: number
}

export function fetchShiftSnapshot(signal?: AbortSignal): Promise<ShiftSnapshot> {
  // Same page size as `fetchAdminSnapshot`. If the shift log asked for the server's 500
  // default while payroll asked for 2000, payroll would count shifts the log cannot show —
  // so "3 shifts need confirming" would link to a screen where they are not there.
  return apiFetch<ShiftSnapshot>(`/admin/data?limit=${ADMIN_SHIFT_LIMIT}`, { signal })
}

/**
 * The fields `PATCH /admin/shifts/:id` accepts. Anything omitted keeps its current value.
 *
 * `auto_closed` is deliberately absent: the route refuses to let an admin rewrite what the
 * timer did. `corrected_at` is not settable either — the route stamps it itself, and only
 * when the edit actually gives an auto-closed shift a real end time.
 *
 * `worker_id` / `location_id` must reference an ACTIVE row or the server answers 422, so
 * send them only when they really changed.
 */
export type ShiftPatch = {
  worker_id?: number
  location_id?: string
  /** ISO-8601. */
  start_time?: string
  /** ISO-8601, or null to reopen the shift. */
  end_time?: string | null
}

/**
 * What `PATCH /admin/shifts/:id` actually returns: the `shifts` row on its own. Its
 * RETURNING clause does not join `workers` or `locations`, so `worker_name`,
 * `location_slug` and `location_name` are NOT in the response — typing it as a full
 * `Shift` would be a lie that renders as `undefined` in the first table cell that trusts it.
 * Callers that need the joined names re-read `/admin/data`.
 */
export type ShiftRow = Omit<Shift, 'worker_name' | 'location_slug' | 'location_name'>

/** 404 = the shift is gone. 422 = the merged row is not a sane shift (order, range, refs). */
export function updateShift(
  id: number,
  patch: ShiftPatch,
  signal?: AbortSignal,
): Promise<ShiftRow> {
  return apiFetch<{ shift: ShiftRow }>(`/admin/shifts/${id}`, {
    method: 'PATCH',
    body: patch,
    signal,
  }).then((data) => data.shift)
}

/**
 * The server's own payroll aggregate. READ `adminData` in server/routes/admin.js before
 * trusting it, because it does not mean what a payroll screen wants it to mean:
 *
 *   - it is ALL-TIME. There is no `from`/`to` parameter on `/admin/data`, so this number
 *     cannot answer "October" and paying from it pays every hour ever worked.
 *   - it is NOT capped by `limit`, unlike `shifts`. So it can legitimately be larger than
 *     the returned rows add up to, and the difference is exactly the truncated tail.
 *   - it already excludes open shifts and unresolved auto-closed ones (decision-10).
 *
 * Screens that need a period must aggregate the shift rows themselves. This row is useful
 * only as a cross-check against that sum — which is what /payroll/ uses it for.
 */
export type HoursRow = {
  worker_id: number
  /** Payable hours, all time. Postgres `numeric`, parsed server-side to a JS number. */
  hours: number
  /** Payable cents, all time, at the worker's CURRENT rate. */
  pay_cents: number
}

/** `ShiftSnapshot` plus the aggregate. Same route, same round trip. */
export type AdminSnapshot = ShiftSnapshot & { hours: HoursRow[] }

/**
 * Everything the dashboard and payroll render, in one request, asking for the server's
 * maximum page rather than its 500 default: both screens count and total shift rows, so a
 * silently short list would be a wrong answer rather than a slow one.
 */
export function fetchAdminSnapshot(signal?: AbortSignal): Promise<AdminSnapshot> {
  return apiFetch<AdminSnapshot>(`/admin/data?limit=${ADMIN_SHIFT_LIMIT}`, { signal })
}
