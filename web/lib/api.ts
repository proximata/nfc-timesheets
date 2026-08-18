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
  /** Set by the geocoder (migration 005). Null = no pin; see `geocoded_at` for why. */
  lat: number | null
  lng: number | null
  /**
   * When we last asked Google. With `lat` this is the whole map state, and the three
   * cases are genuinely different problems:
   *   null                      — nobody has ever asked
   *   set, `lat` null           — we asked and got no usable pin
   *   set, `lat` present        — pinned
   */
  geocoded_at: string | null
  /**
   * Google's own vocabulary plus a few of ours: 'OK', 'ZERO_RESULTS', 'PARTIAL_MATCH',
   * 'APPROXIMATE_ONLY', 'REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'no_key', 'timeout',
   * 'network:...'. It is the difference between "fix the address you typed" and "try
   * again later" — two problems with different owners.
   */
  geocode_status: string | null
  /**
   * What the Street View METADATA endpoint said. A photo may be rendered ONLY on 'OK':
   * the static image endpoint answers 200 with a grey "no imagery" tile, so anything
   * looser ships a grey rectangle and calls it a photograph of the building.
   */
  street_view_status: string | null
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
   * There is no form input for coordinates — they come from the geocoder — but the
   * route's UPDATE writes every column, so an edit that omitted these would silently null
   * out coordinates set elsewhere. Callers editing an existing row must pass the row's
   * current values back.
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

/* --- Material requests (migration 005) --------------------------------------------------
 *
 * A worker asks for something IN THEIR OWN WORDS and then waits. Nothing here guesses what
 * they meant: there is no fuzzy match onto `inventory_items`, no default quantity and no
 * default cost. An admin maps it, prices it and moves it along, and every one of those is
 * a deliberate human act.
 *
 * THERE IS NO PUSH. Server deps are `pg` + `@sentry/node` and nothing else (decision-23
 * amending decision-16), so the worker's app POLLS `/material-requests/mine`. Screen copy
 * must never promise a notification.
 */

/** Mirrors MATERIAL_TRANSITIONS in server/lib/materials.js. Order = lifecycle order. */
export const MATERIAL_STATUSES = [
  'submitted',
  'approved',
  'ordered',
  'arrived',
  'rejected',
] as const
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number]

export type MaterialRequest = {
  id: number
  worker_id: number
  /**
   * The building the worker NAMED, e.g. "the mop for Neuhaus". CONTEXT ONLY. It is
   * explicitly NOT a cost attribution: decision-6 splits materials pro-rata by labour
   * hours and rejected per-request attribution outright. No screen may total costs by it.
   */
  location_id: string | null
  /** The worker's own words. Never parsed, never matched, never rewritten. */
  body: string
  status: MaterialStatus
  admin_note: string | null
  /** Set by an admin when they decide which catalogue item was meant. Null = unmapped. */
  inventory_item_id: number | null
  quantity: number | null
  /**
   * ACTUAL cost, integer cents. Null = UNPRICED, which is NOT free: the P&L leaves it out
   * of the material pool and reports how many it left out.
   */
  cost_cents: number | null
  decided_by: number | null
  decided_at: string | null
  /**
   * The period pin. A cost belongs to the month the money was committed in, not the month
   * the worker asked or the month the box turned up. Server-stamped; not settable.
   */
  ordered_at: string | null
  arrived_at: string | null
  /** The worker acknowledged the arrival, by polling. Null = they have not seen it yet. */
  seen_at: string | null
  created_at: string
}

/** `/admin/data` joins these three so no screen has to look them up itself. */
export type MaterialRequestRow = MaterialRequest & {
  worker_name: string
  location_name: string | null
  item_name: string | null
}

/**
 * What `PATCH /admin/material-requests/:id` returns: the bare row, WITHOUT the three
 * joined names. Typing it as `MaterialRequestRow` would be a lie that renders as
 * `undefined` in the first cell that trusts it. Callers re-read `/admin/data`.
 */
export type MaterialRequestPatched = MaterialRequest

/**
 * MATERIAL_REQUEST_PAGE in server/routes/admin.js. Open requests come first, so the cap
 * can only ever truncate history \u2014 but the screen still has to say when it did.
 */
export const ADMIN_MATERIAL_REQUEST_LIMIT = 500

/**
 * Operator-set numbers this codebase refuses to invent (migration 005). Values are TEXT
 * on the wire because `app_settings.value` is a TEXT column.
 *
 * An EMPTY object is the normal, supported state on a box nobody has configured. It is
 * NOT an error and NOT a zero: with `pl_margin_baseline_bp` absent the P&L flags nothing
 * and says so.
 */
export type AppSettings = Record<string, string>

/** The margin floor, in BASIS POINTS. Signed: -500 is a legitimate "lose at most 5%". */
export const MARGIN_BASELINE_KEY = 'pl_margin_baseline_bp'

/** One request behind /material-requests/: the queue plus the two lists its selects offer. */
export type MaterialSnapshot = {
  material_requests: MaterialRequestRow[]
  material_request_limit: number
  locations: Location[]
  inventory: InventoryItem[]
}

export function fetchMaterialSnapshot(signal?: AbortSignal): Promise<MaterialSnapshot> {
  return apiFetch<MaterialSnapshot>('/admin/data', { signal })
}

/**
 * Everything `PATCH /admin/material-requests/:id` accepts.
 *
 * `status` is a TRANSITION REQUEST, not an assignment \u2014 the server holds the legal moves
 * and answers 409 for the rest, which is what stops a double-clicked button jumping
 * `submitted` straight to `arrived` and stamping `ordered_at` in a period nothing was
 * ordered in. The three timestamps are stamped server-side and are deliberately absent.
 *
 * Every field is COALESCEd server-side: omitting one leaves it alone, and an explicit
 * `null` therefore cannot clear it. Correcting a wrong cost means typing the right one.
 */
export type MaterialRequestPatch = {
  status?: MaterialStatus
  admin_note?: string
  inventory_item_id?: number | null
  quantity?: number
  cost_cents?: number
  location_id?: string
}

/**
 * 404 = the request is gone. 422 = unknown item or building. 409 = either the row moved
 * under us (illegal transition) or it was already rejected \u2014 `ApiError` carries no server
 * text, so both read as "reload and look again", which is the only correct action for both.
 */
export function patchMaterialRequest(
  id: number,
  patch: MaterialRequestPatch,
  signal?: AbortSignal,
): Promise<MaterialRequestPatched> {
  return apiFetch<{ request: MaterialRequestPatched }>(`/admin/material-requests/${id}`, {
    method: 'PATCH',
    body: patch,
    signal,
  }).then((data) => data.request)
}

/**
 * `POST /admin/settings`. The key is checked against a server-side allowlist, so a typo is
 * a 400 rather than a value that is stored and then quietly does nothing forever.
 */
export function saveSetting(key: string, value: number, signal?: AbortSignal): Promise<void> {
  return apiFetch<{ setting: unknown }>('/admin/settings', {
    method: 'POST',
    body: { key, value },
    signal,
  }).then(() => undefined)
}

/** Back to "nobody has told me". Idempotent: unsetting an unset key is a 200, not a 404. */
export function clearSetting(key: string, signal?: AbortSignal): Promise<void> {
  return apiFetch<{ setting: unknown }>(`/admin/settings/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    signal,
  }).then(() => undefined)
}

/* --- Contract history (migration 005, decision-28) --------------------------------------
 *
 * What a building was priced at, WHEN. `locations.monthly_contract_cents` is a mirror of
 * the CURRENT row here, kept so the already-shipped iOS build and /locations/ keep working.
 */

export type Contract = {
  id: number
  location_id: string
  /** Who was paying AT THE TIME. `locations.client_id` is current-only. */
  client_id: number | null
  monthly_contract_cents: number
  target_minutes_per_month: number | null
  /**
   * VIENNA CALENDAR DATES as `YYYY-MM-DD`, half-open `[valid_from, valid_to)`. Not
   * instants: a contract changes on a day, and a date has no daylight saving to get wrong.
   * `valid_to` null = this is the current period.
   */
  valid_from: string
  valid_to: string | null
  note: string | null
  created_at: string
}

export type ContractInput = {
  monthly_contract_cents: number
  target_minutes_per_month: number | null
  /** `YYYY-MM-DD`. */
  valid_from: string
  note?: string
  client_id?: number | null
}

/** 404 = unknown building. Newest period first. */
export function fetchContracts(locationId: string, signal?: AbortSignal): Promise<Contract[]> {
  return apiFetch<{ contracts: Contract[] }>(
    `/admin/locations/${encodeURIComponent(locationId)}/contracts`,
    { signal },
  ).then((data) => data.contracts)
}

/**
 * The price changed, from this day. Closes the current period at `valid_from` and opens a
 * new one. 409 = the new period would overlap an existing one, which is the server
 * refusing to let "the price on 3 March" have two answers.
 */
export function createContract(
  locationId: string,
  input: ContractInput,
  signal?: AbortSignal,
): Promise<Contract> {
  return apiFetch<{ contract: Contract }>(
    `/admin/locations/${encodeURIComponent(locationId)}/contracts`,
    { method: 'POST', body: input, signal },
  ).then((data) => data.contract)
}

/**
 * Undo a contract period entered wrongly. ONLY the current one: a closed period has
 * already valued a month somebody has seen a report for. Deleting it REOPENS its
 * predecessor, so the price reverts instead of the building falling to "no contract".
 * 409 = it is not the current period.
 */
export function deleteContract(id: number, signal?: AbortSignal): Promise<void> {
  return apiFetch<{ contract: Contract }>(`/admin/contracts/${id}`, {
    method: 'DELETE',
    signal,
  }).then(() => undefined)
}

/**
 * Ask Google again for this building's pin. Answers 200 WITH OR WITHOUT a pin \u2014 a failed
 * geocode is a successful request with a null answer \u2014 so the caller must read the
 * returned row rather than treat 200 as success. 422 = the building has no address to
 * geocode, and the fix is to type one on /locations/.
 */
export function geocodeLocation(id: string, signal?: AbortSignal): Promise<Location> {
  return apiFetch<{ location: Location }>(`/admin/locations/${encodeURIComponent(id)}/geocode`, {
    method: 'POST',
    signal,
  }).then((data) => data.location)
}

/* --- Reports: P&L and building analytics (migration 005) --------------------------------
 *
 * Both are aggregated IN SQL, not in the browser, because `/admin/data` caps shift rows at
 * 2000 and a client-side aggregate would silently report a smaller month than happened.
 *
 * Both REQUIRE both period bounds \u2014 hence `ClosedRange` rather than `PeriodRange`. Revenue
 * is a monthly contract pro-rated over the days of the period, so an unbounded end is
 * either infinitely many days or a default month nobody asked for.
 *
 * EVERY `null` BELOW IS A REFUSAL TO GUESS AND MUST BE RENDERED AS ONE. `revenue_cents`
 * null is "nobody has priced this building", never EUR 0. `below_baseline` null is "not
 * assessable", never a pass.
 */

/** A period with both ends set. `periodRange(p)` for any p except `'all'` produces one. */
export type ClosedRange = { from: string; to: string }

export function isClosedRange(range: PeriodRange): range is ClosedRange {
  return range.from !== null && range.to !== null
}

export type PlBuilding = {
  location_id: string
  slug: string
  name: string
  active: boolean
  client_id: number | null
  client_name: string | null

  labour_seconds: number
  labour_minutes: number
  /** Payable labour only (decision-10), valued at CURRENT rates \u2014 see `PlLabourBasis`. */
  labour_cents: number
  /**
   * The part of `labour_seconds` that `labour_cents` DOES NOT CONTAIN, because nobody has
   * set those people's hourly rate. Real hours, no amount at all \u2014 not even zero, which
   * would make their work look free and leave the margin untouched while the hours rose.
   * Whenever this is above zero the labour cost is too low and the margin too high by an
   * amount nothing in this system can know, and the screen must say so.
   */
  labour_unpriced_seconds: number
  labour_unpriced_minutes: number
  /** People, at this building, with no rate on file. Named and counted, never priced. */
  labour_unpriced_workers: number
  /** This building's share of the period's material pool, pro-rata by labour (decision-6). */
  material_cents: number

  /** Null = no contract covering any day of the period. NOT zero. */
  revenue_cents: number | null
  revenue_unknown_reason: 'no_contract' | null
  /** Days of the period this building actually had a price for. */
  revenue_days: number
  period_days: number

  target_minutes: number | null
  target_unknown_days: number

  profit_cents: number | null
  /** Margin in basis points. Null when revenue is unknown or exactly zero. */
  margin_bp: number | null
  margin_unknown_reason: 'no_contract' | 'zero_revenue' | null
  /**
   * TRUE = below the operator's floor. FALSE = at or above it. NULL = NOT ASSESSABLE,
   * because either the margin or the baseline is unknown. Null is not a pass and must
   * never be rendered as one.
   */
  below_baseline: boolean | null

  /**
   * decision-10, per building. A building looks CHEAP precisely because these hours were
   * withheld from its cost. Not a footnote \u2014 rendering the cost without them is lying.
   */
  excluded_unresolved_shifts: number
  excluded_unresolved_seconds: number
  open_shifts: number
}

/**
 * `rate_basis: 'current'` is the standing limitation: `workers.hourly_rate_cents` is one
 * mutable column with no history, so raising a wage silently rewrites every past month's
 * labour cost (decision-28). `rate_basis_note` is the server's own German sentence; the
 * screens render their OWN translated line off `rate_basis` so it is not German on the
 * English locale, and it must be PERMANENTLY VISIBLE, not a tooltip.
 */
export type PlLabourBasis = {
  rate_basis: 'current'
  rate_basis_note: string
  /** Payable hours across the whole period that carry no rate, so carry no cost. */
  unpriced_seconds: number
  unpriced_minutes: number
  /** DISTINCT people missing a rate. One person at three buildings is one rate to set. */
  unpriced_workers: number
}

export type PlMaterials = {
  basis: 'pro_rata_labour_hours'
  basis_decision: string
  /** Everything ORDERED in the period, priced. Integer cents. */
  pool_cents: number
  allocated_cents: number
  /** Ordered but unsplittable, because nobody worked anywhere in the period. Reported. */
  unallocated_cents: number
  unallocated_reason: 'no_payable_labour_in_period' | null
  /** Ordered but not yet priced. Excluded from the pool, and counted so it can be said. */
  unpriced_requests: number
  priced_requests: number
}

export type PlReport = {
  range: ClosedRange
  period_days: number
  timezone: string
  baseline_margin_bp: number | null
  baseline_set: boolean
  labour: PlLabourBasis
  materials: PlMaterials
  buildings: PlBuilding[]
}

export function fetchPl(range: ClosedRange, signal?: AbortSignal): Promise<PlReport> {
  return apiFetch<PlReport>(`/admin/pl?${rangeQuery(range)}`, { signal })
}

/** One Vienna calendar month of actual payable time at one building. */
export type TrendPoint = { month: string; actual_minutes: number; shifts: number }

export type AnalyticsBuilding = {
  location_id: string
  slug: string
  name: string
  active: boolean
  address: string | null
  client_id: number | null
  client_name: string | null
  contact_id: number | null
  contact_name: string | null

  lat: number | null
  lng: number | null
  geocoded_at: string | null
  /**
   * The map state, decided by the SERVER. Never re-derive it from `lat === null`: that
   * cannot tell "nobody has asked yet" from "we asked and Google had nothing", and those
   * have different fixes.
   */
  geocode_state: 'pinned' | 'never_attempted' | 'failed'
  geocode_status: string | null
  street_view_status: string | null

  actual_minutes: number
  target_minutes: number | null
  target_unknown_days: number
  variance_minutes: number | null

  /** Oldest month first, one entry per requested month, zero-filled. */
  trend: TrendPoint[]
  /** Null = fewer than two months carry any shift at all. Not a flat line. */
  trend_delta_minutes: number | null
  trend_direction: 'up' | 'down' | 'flat' | null
  trend_reason: 'insufficient_data' | null

  excluded_unresolved_shifts: number
  excluded_unresolved_seconds: number
  open_shifts: number
}

export type AnalyticsReport = {
  range: ClosedRange
  period_days: number
  timezone: string
  trend_months: number
  buildings: AnalyticsBuilding[]
}

/** TREND_MONTHS_DEFAULT / TREND_MONTHS_MAX in server/routes/admin.js. Clamped, not rejected. */
export const TREND_MONTHS_DEFAULT = 6
export const TREND_MONTHS_MAX = 24

export function fetchAnalytics(
  range: ClosedRange,
  months: number,
  signal?: AbortSignal,
): Promise<AnalyticsReport> {
  return apiFetch<AnalyticsReport>(`/admin/analytics?${rangeQuery(range)}&months=${months}`, {
    signal,
  })
}

/**
 * Change the signed-in admin's own password. The CURRENT password is required even though
 * the caller already holds a session, because a session is also what a borrowed unlocked
 * laptop has. On success the server revokes every other session and reissues this one.
 */
export function changePassword(
  currentPassword: string,
  newPassword: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<{ ok: true }>('/admin/password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
    signal,
  }).then(() => undefined)
}
