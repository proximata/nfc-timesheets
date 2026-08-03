import type { ErrorKey } from '@/lib/locale'
import { type PeriodRange, rangeQuery } from '@/lib/period'

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
  /**
   * Null = no number on file. A contact detail and NOTHING else: it grants no access, is
   * never matched at sign-in and is not unique. Do not conflate it with `email`.
   */
  phone: string | null
  hourly_rate_cents: number
  active: boolean
  created_at: string
  /**
   * When the worker's current enrolment code stops working, ISO-8601. Null = there is no
   * outstanding code, either because none was issued, because it was used, or because it
   * was revoked. A value in the PAST means the code ran out unused (decision-26).
   *
   * The code itself is NOT here and can never be: the server keeps only a digest of it and
   * hands the plaintext back exactly once, from `issueEnrolmentCode`.
   */
  enrolment_code_expires_at: string | null
  /** When a code was last exchanged for an app sign-in, ISO-8601. Null = never. */
  enrolment_code_redeemed_at: string | null
}

/** Create (no `id`) or update (`id`). Same route either way. */
export type WorkerInput = {
  id?: number
  name: string
  email: string
  /** Empty string = clear it. The route rewrites every column, so an edit must send it. */
  phone: string
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
  /** The company under contract. Null = nobody has filled it in yet. */
  client_id: number | null
  /** The person at the client we report to. Null = none named. */
  contact_id: number | null
  /**
   * Contract volume per month, integer cents. Null and 0 are DIFFERENT answers:
   * null = "nobody has told us", 0 = "we clean this for free".
   */
  monthly_contract_cents: number | null
  /** Agreed time per month, integer minutes. Null = no target agreed. */
  target_minutes_per_month: number | null
  /** Joined by `/admin/data` so no screen has to look the names up itself. */
  client_name: string | null
  contact_name: string | null
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
   *
   * The same hazard applies to the four contract fields below: omitting one on an edit
   * CLEARS it. Send the row's current value when the form did not change it.
   */
  lat?: number | null
  lng?: number | null
  active: boolean
  client_id?: number | null
  contact_id?: number | null
  monthly_contract_cents?: number | null
  target_minutes_per_month?: number | null
}

/**
 * Soft deactivate. NOT `saveLocation({ active: false })`, for the same reason
 * `deactivateContact` is not `saveContact({ active: false })`: this route ALSO revokes
 * every live client link on the building, and a contact must stop being able to read the
 * cleaning history of a building we no longer clean at the moment it is stood down, not
 * whenever somebody remembers the links exist.
 *
 * It touches only `active`, so no contract field can be cleared by a mis-sent payload.
 * Reactivating is a normal `saveLocation` with `active: true`; the links are not restored,
 * which is correct — a revoked token is gone and a fresh link has to be issued.
 */
export function deactivateLocation(id: string, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/admin/locations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
  })
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
 * Reactivation goes through here with `active: true`. DEACTIVATION does not — see
 * `deactivateLocation`, which additionally revokes the building's live client links.
 * Both are soft; nothing here ever destroys a row that shifts point at.
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

/**
 * The one and only sighting of an enrolment code (decision-26).
 *
 * `code` is in THIS RESPONSE AND NOWHERE ELSE, EVER — `/admin/data` returns the two state
 * timestamps above and never the secret, so the screen must show it immediately. Losing it
 * is survivable: issuing again replaces it, so a worker always has at most one live code.
 *
 * `expires_at` is the server's own deadline, not a client-side guess. Show it.
 */
export type FreshEnrolmentCode = {
  worker: { id: number; name: string }
  /** Grouped for reading out over the phone, e.g. `K7QF-3MZ2`. */
  code: string
  expires_at: string
}

/**
 * Issues a code for ONE worker and replaces whatever they had. 404 = unknown worker, or a
 * deactivated one: the server refuses to issue for somebody who may not sign in anyway.
 */
export function issueEnrolmentCode(
  workerId: number,
  signal?: AbortSignal,
): Promise<FreshEnrolmentCode> {
  return apiFetch<FreshEnrolmentCode>(`/admin/workers/${workerId}/enrolment-code`, {
    method: 'POST',
    signal,
  })
}

/**
 * Revoke, immediately and idempotently — the control for a code read aloud to the wrong
 * person. It does NOT sign anybody out; a worker already enrolled keeps their session, and
 * the button for ending that is `Deactivate` (DELETE /admin/workers/:id).
 */
export function revokeEnrolmentCode(workerId: number, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/admin/workers/${workerId}/enrolment-code`, {
    method: 'DELETE',
    signal,
  })
}

/**
 * A row of `inventory_items`. Products and equipment are ONE table and one screen: they
 * differ by this `kind` label and by nothing else (server/db/migrations/003).
 */
export const INVENTORY_KINDS = ['product', 'equipment'] as const
export type InventoryKind = (typeof INVENTORY_KINDS)[number]

export function isInventoryKind(value: string): value is InventoryKind {
  return (INVENTORY_KINDS as readonly string[]).includes(value)
}

export type InventoryItem = {
  id: number
  name: string
  kind: InventoryKind
  /** Integer cents. 0 is a real answer: "we have it, nobody has priced it yet". */
  unit_cost_cents: number
  active: boolean
  created_at: string
}

/** Create (no `id`) or update (`id`). Same route either way. */
export type InventoryInput = {
  id?: number
  name: string
  kind: InventoryKind
  unit_cost_cents: number
  active: boolean
}

export function fetchInventory(signal?: AbortSignal): Promise<InventoryItem[]> {
  return apiFetch<{ inventory: InventoryItem[] }>('/admin/data', { signal }).then(
    (data) => data.inventory,
  )
}

/**
 * Upsert. 404 = the item is gone, 400 = a field the server refused. There is no 409 on
 * this route: two buckets of the same cloth at different prices are two legitimate rows.
 *
 * Deactivation goes through here with `active: false` rather than `DELETE
 * /admin/inventory/:id`, so the same button can put an item back.
 */
export function saveInventoryItem(
  input: InventoryInput,
  signal?: AbortSignal,
): Promise<InventoryItem> {
  return apiFetch<{ item: InventoryItem }>('/admin/inventory', {
    method: 'POST',
    body: input,
    signal,
  }).then((data) => data.item)
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
  /**
   * The phone's idempotency key. NULL means the shift was typed into this admin panel
   * rather than tapped — there is no separate flag, see `isManualEntry` in lib/shifts.ts.
   */
  client_uuid: string | null
  created_at: string
}

/**
 * The full extent of the ledger, regardless of period and regardless of `limit`: the
 * earliest and latest `start_time` in the whole `shifts` table.
 *
 * This is what lets a screen tell "nobody worked in the period you asked for" apart from
 * "the data is gone". Without it an empty table means both at once, and the second reading
 * is the one that makes a director phone at midnight. Null on both when nothing has ever
 * been recorded, which is the genuine first-run state.
 */
export type ShiftBounds = { earliest: string | null; latest: string | null }

/**
 * `/admin/data` in the shape the shift log needs: the shifts plus the two lists the
 * filters and the correction form pick from.
 *
 * `shift_limit` is the LIMIT the server actually applied (500 by default, 2000 max). When
 * the row count reaches it the list is TRUNCATED, and the screen has to say so — an
 * incomplete shift table read as a complete one is how somebody gets underpaid.
 *
 * `shift_range` echoes the `[from, to)` the server actually applied, so a screen can state
 * what it is showing instead of assuming its own request arrived intact.
 */
export type ShiftSnapshot = {
  workers: Worker[]
  locations: Location[]
  shifts: Shift[]
  shift_limit: number
  shift_range: { from: string | null; to: string | null }
  shift_bounds: ShiftBounds
}

/**
 * The shift log deliberately fetches UNBOUNDED and filters in the browser.
 *
 * That is not an oversight now that `?from=&to=` exists: this screen has to be able to say
 * "no shifts in August — 5 exist in earlier periods", and it can only count what it holds.
 * A server-bounded fetch would answer the period question and lose the only fact that
 * distinguishes an empty filter from an empty database. Payroll, whose totals must match
 * its rows, does the opposite — see `fetchPayrollSnapshot`.
 */
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

/**
 * A shift that was never tapped: the worker's phone died, or the tag was gone, and the day
 * still has to be paid. `end_time` is REQUIRED — the route refuses to open a shift by hand,
 * because an open one would compete with the phone for the one-open-shift-per-worker slot.
 */
export type NewShiftInput = {
  worker_id: number
  location_id: string
  /** ISO-8601 instants. Both must be in the past and the worker must be free in between. */
  start_time: string
  end_time: string
}

/**
 * `POST /admin/shifts`. The created row has `client_uuid: null`, which is exactly what
 * marks it as hand-entered (`isManualEntry` in lib/shifts.ts).
 *
 * 409 = the worker already has a shift covering part of that window, including an open one.
 * The response body names the clashing shift, but `ApiError` deliberately carries no server
 * text, so callers identify it from the shift list they already hold (`overlappingShift`).
 * 422 = unknown/inactive worker or building, end before start, or a time in the future.
 */
export function createShift(input: NewShiftInput, signal?: AbortSignal): Promise<ShiftRow> {
  return apiFetch<{ shift: ShiftRow }>('/admin/shifts', {
    method: 'POST',
    body: input,
    signal,
  }).then((data) => data.shift)
}

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
 * The server's own payroll aggregate, over EXACTLY the `[from, to)` the request asked for
 * and with exactly the decision-10 exclusions (open shifts and unconfirmed auto-closed ones
 * are out). It is the same period as the `shifts` rows in the same response — that is the
 * whole point of the parameter, and it is why a payroll total can no longer describe
 * different days from the table underneath it.
 *
 * It is still NOT capped by `limit`, unlike `shifts`. So it can legitimately exceed what
 * the returned rows add up to, and the difference is then exactly the truncated tail. That
 * is what /payroll/ reconciles and reports.
 */
export type HoursRow = {
  worker_id: number
  /** Payable hours in the requested period. Postgres `numeric`, parsed to a JS number. */
  hours: number
  /** Payable cents in the requested period, at the worker's CURRENT rate. */
  pay_cents: number
}

/** `ShiftSnapshot` plus the aggregate. Same route, same round trip. */
export type AdminSnapshot = ShiftSnapshot & { hours: HoursRow[] }

/**
 * Everything the dashboard renders, in one request, asking for the server's maximum page
 * rather than its 500 default: the screen counts shift rows, so a silently short list would
 * be a wrong answer rather than a slow one. No period — the dashboard is about now.
 */
export function fetchAdminSnapshot(signal?: AbortSignal): Promise<AdminSnapshot> {
  return apiFetch<AdminSnapshot>(`/admin/data?limit=${ADMIN_SHIFT_LIMIT}`, { signal })
}

/**
 * The same payload bounded to one pay period, server-side.
 *
 * The range goes on the wire so that `hours` and `shifts` are cut by the same WHERE clause.
 * It also removes the history horizon: the old all-time query returned the most recent
 * `limit` rows, so a period further back than roughly ten weeks of a busy crew simply had
 * no rows to sum and paid too little.
 */
export function fetchPayrollSnapshot(
  range: PeriodRange,
  signal?: AbortSignal,
): Promise<AdminSnapshot> {
  const query = rangeQuery(range)
  return apiFetch<AdminSnapshot>(
    `/admin/data?limit=${ADMIN_SHIFT_LIMIT}${query === '' ? '' : `&${query}`}`,
    { signal },
  )
}

/* --- Clients, contacts and the client link ---------------------------------------------
 *
 * Business words on purpose: a `client` is the company that pays for a building, a
 * `contact` is the person there we report to. Neither is a login — a contact has no
 * password and no session, and the only access they ever get is a link (below).
 */

export type Client = {
  id: number
  name: string
  active: boolean
  created_at: string
}

export type Contact = {
  id: number
  /** A contact belongs to exactly ONE client, which is why picking a contact implies it. */
  client_id: number
  name: string
  /** Recognition for the director, NOT a credential. See POST /admin/contacts. */
  email: string | null
  phone: string | null
  active: boolean
  created_at: string
}

/**
 * A live client link. `/admin/data` lists live grants only — revoked ones are history the
 * director cannot act on.
 *
 * `token_hash` is a SHA-256 and grants nothing; it is the handle the revoke call posts
 * back. The raw token exists in exactly one HTTP response, ever (see `createClientLink`).
 */
export type PortalGrant = {
  token_hash: string
  contact_id: number
  location_id: string
  created_at: string
  contact_name: string
  location_name: string
}

/**
 * One request behind the buildings screen. Buildings, the two lists its selects offer, the
 * live links, and the shifts the "time this month" column is summed from.
 *
 * `shift_limit` is the cap the server applied. When `shifts.length` reaches it the list is
 * TRUNCATED and the monthly totals can be too low, so the screen has to say so.
 */
export type BuildingsSnapshot = {
  locations: Location[]
  clients: Client[]
  contacts: Contact[]
  portal_grants: PortalGrant[]
  shifts: Shift[]
  shift_limit: number
  shift_bounds: ShiftBounds
}

export function fetchBuildingsSnapshot(signal?: AbortSignal): Promise<BuildingsSnapshot> {
  return apiFetch<BuildingsSnapshot>(`/admin/data?limit=${ADMIN_SHIFT_LIMIT}`, { signal })
}

/** Buildings, clients and contacts for the clients screen. Same route, same round trip. */
export type ClientsSnapshot = Pick<BuildingsSnapshot, 'clients' | 'contacts' | 'locations'>

export function fetchClientsSnapshot(signal?: AbortSignal): Promise<ClientsSnapshot> {
  return apiFetch<ClientsSnapshot>('/admin/data', { signal })
}

/** Create (no `id`) or update (`id`). Same route either way, as everywhere else here. */
export type ClientInput = { id?: number; name: string; active?: boolean }

export function saveClient(input: ClientInput, signal?: AbortSignal): Promise<Client> {
  return apiFetch<{ client: Client }>('/admin/clients', {
    method: 'POST',
    body: input,
    signal,
  }).then((data) => data.client)
}

export type ContactInput = {
  id?: number
  client_id: number
  name: string
  email?: string
  phone?: string
  active?: boolean
}

/** 422 = the client is gone. 400 = the email or phone is not a plausible one. */
export function saveContact(input: ContactInput, signal?: AbortSignal): Promise<Contact> {
  return apiFetch<{ contact: Contact }>('/admin/contacts', {
    method: 'POST',
    body: input,
    signal,
  }).then((data) => data.contact)
}

/**
 * Soft deactivate. DELETE and not `saveClient({active: false})` on purpose: for a contact
 * the DELETE route ALSO revokes their live links, and someone who has left the client
 * company must lose access at that moment rather than whenever an admin remembers.
 * Buildings keep pointing at the row, so history stays readable; reactivating is a normal
 * save with `active: true`.
 */
export function deactivateClient(id: number, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/admin/clients/${id}`, { method: 'DELETE', signal })
}

export function deactivateContact(id: number, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/admin/contacts/${id}`, { method: 'DELETE', signal })
}

/**
 * Mints the read-only link a contact uses to see their own building's cleaning history,
 * and returns the path to it — `/portal/<token>`.
 *
 * THE TOKEN IS IN THIS RESPONSE AND NOWHERE ELSE, EVER: the server stores only its hash.
 * The caller must show the full URL immediately, because it cannot be re-read afterwards.
 * That is survivable — calling this again for the same pair issues a fresh link and
 * revokes the previous one, so the contact always holds exactly one working link.
 *
 * Requires an ACTIVE contact and an ACTIVE building; either being inactive is a 422.
 */
export function createClientLink(
  contactId: number,
  locationId: string,
  signal?: AbortSignal,
): Promise<string> {
  return apiFetch<{ path: string }>('/admin/portal-grants', {
    method: 'POST',
    body: { contact_id: contactId, location_id: locationId },
    signal,
  }).then((data) => data.path)
}

/** Revoke, by the hash `/admin/data` lists. Idempotent, and takes effect immediately. */
export function revokeClientLink(tokenHash: string, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/admin/portal-grants/${tokenHash}`, { method: 'DELETE', signal })
}

/* --- The client's own view ---------------------------------------------------------------
 *
 * `GET /portal/:token`, the only unauthenticated data route. The reader is an OUTSIDER, and
 * the payload is minimised on the server accordingly: a first name, a date and a duration.
 *
 * These types list what the portal screen renders and nothing more. If the route ever starts
 * returning extra fields, they must not appear here and must not be rendered — widening this
 * type is a GDPR decision about a third party's access, not a convenience.
 */

export type PortalCleaning = {
  /** `YYYY-MM-DD`, already the Vienna calendar day the cleaning ENDED on. */
  date: string
  /** FIRST NAME ONLY. Never a surname, and never an id. */
  first_name: string
  /** Whole minutes worked. */
  minutes: number
}

/** Exactly one building — the one the link was issued for. Its name, not its id. */
export type PortalView = {
  building: { name: string }
  /** Completed cleanings, newest first, capped server-side. Empty is a normal answer. */
  cleanings: PortalCleaning[]
}

/**
 * No session, no cookie, no header: the token in the URL is the whole credential.
 *
 * 404 = unknown OR revoked, indistinguishably and on purpose. 429 = the route's own rate
 * limit. Callers must not tell those two apart for the reader.
 */
export function fetchPortalView(token: string, signal?: AbortSignal): Promise<PortalView> {
  return apiFetch<PortalView>(`/portal/${encodeURIComponent(token)}`, { signal })
}
