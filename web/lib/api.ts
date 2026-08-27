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
  /**
   * The server's own MACHINE code for the refusal — `serial_taken`, `rate_required`,
   * `duplicate_zone_name` — and never its prose. Null when the body carried none, or when
   * what it carried was not a bare identifier.
   *
   * This is deliberately NOT a widening of "no server text in the DOM": the value is gated
   * by `ERROR_CODE_RE` to a short lowercase identifier, is never rendered, and only ever
   * selects one of OUR translated messages. Without it two different 409s on one route are
   * indistinguishable, and the form has to say "something conflicted" to a director who
   * needs to know WHICH tag they have already used.
   */
  readonly code: string | null

  constructor(status: number, messageKey: ErrorKey, code: string | null = null) {
    super(`API request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.messageKey = messageKey
    this.code = code
  }
}

/** A bare identifier and nothing else. A stack trace, a path or SQL cannot match this. */
const ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,39}$/

function messageKeyForStatus(status: number): ErrorKey {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  if (status >= 400 && status < 500) return 'request'
  return 'server'
}

export type ApiRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageKeyForStatus(response.status),
      await errorCode(response),
    )
  }
  if (response.status === 204) return undefined as T

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(response.status, 'badResponse')
  }
}

/**
 * The `error` field of a refusal body, if it is a bare identifier. Anything else — prose, a
 * path, HTML from a proxy, an unparseable body — answers null and is dropped on the floor.
 */
async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string' && ERROR_CODE_RE.test(body.error) ? body.error : null
  } catch {
    return null
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
  /**
   * WHAT THAT WORKER'S PHONE IS STILL HOLDING (migration 009, TASK-225).
   *
   * A shift tapped with no signal exists on the phone and NOT in `shifts` — so every hour
   * and every euro on this admin is computed over a set that may be missing somebody's
   * afternoon. These four columns are how the office finds that out before month end
   * instead of during an argument about a payslip.
   *
   * Null `phone_last_seen_at` means NO PHONE HAS EVER REPORTED, which is not the same fact
   * as "nothing is pending" and must never be rendered as one. The two counts default to 0
   * on the server precisely so that distinction lives in ONE column rather than in three.
   */
  phone_last_seen_at: string | null
  /** Waiting for a signal. Arrives on its own; nobody has to do anything. */
  phone_pending_shifts: number
  /** Given up on — wrong account, refused location. A human has to act. */
  phone_pending_blocked: number
  /** ISO-8601 start of the oldest undelivered shift on that phone. Null = none. */
  phone_pending_oldest_start: string | null
  /**
   * THE LOGIN NUMBER (`phone_identities`, decision-45) — a DIFFERENT fact from `phone`
   * above, which is free text the director typed and is never normalised (decision-48 §2).
   * The two are allowed to disagree. Null = nobody has claimed a login number for this
   * worker yet, which is also why an SMS can never be sent: see `smsNoPhone`.
   */
  phone_e164: string | null
  /**
   * WHAT THE LAST SMS ATTEMPT DID (append-only `sms_deliveries`, decision-48 §2.2). This is
   * what makes a stored "preferred channel" unnecessary: it is a FACT about what happened,
   * not an intention. Null on all three = no attempt has ever been made for this worker.
   */
  sms_last_status: 'sent' | 'failed' | null
  /** A fixed-vocabulary word (`timeout`, `network:<code>`, `rejected`, `http_<n>`, …). `failed` only. */
  sms_last_reason: string | null
  /** ISO-8601 of the last attempt, whatever it did. */
  sms_last_at: string | null
  /** How many attempts, ever — including failed ones. */
  sms_count: number
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
 * What `/workers/` needs now that it hosts the Mitarbeiterpanel (decision-38): the same
 * request it has always made, with the shifts it was throwing away.
 *
 * `/admin/data` has returned the shifts alongside the workers since it existed, so this is
 * strictly a wider TYPE over the same round trip — no second request, no new endpoint. The
 * panel names a person's open shift, their unconfirmed ones and their last ten, and it does
 * it from a payload the screen was already paying for.
 *
 * The server's row cap applies, as everywhere. `shift_limit` comes back so the panel can
 * say when its counts are floors rather than totals.
 */
export type WorkerSnapshot = {
  workers: Worker[]
  shifts: Shift[]
  shift_limit: number
  /** `app_settings` as `/admin/data` returns it — read here for `SMS_OTP_REQUESTS_KEY`. */
  settings: AppSettings
}

export function fetchWorkerSnapshot(signal?: AbortSignal): Promise<WorkerSnapshot> {
  // Same page size as every other screen that counts shift rows: a shorter list here would
  // make the panel disagree with `/shifts/` about how many shifts a person has.
  return apiFetch<WorkerSnapshot>(`/admin/data?limit=${ADMIN_SHIFT_LIMIT}`, { signal })
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

/**
 * A ZONE: a place inside a building that gets cleaned and can carry a tag (decision-43).
 *
 * A ZONE IS NOT A COSTING UNIT. A shift is billed to the BUILDING, and the contract and the
 * revenue stay on the building (decision-42). There is no zone-level contract, target,
 * revenue or margin, and no screen may compute one — a shift is building-level, so no
 * duration is attributable to a zone, and splitting a building's labour by area share would
 * assert that time is proportional to floor area. It is not: a Tiefgarage is fast per m²
 * and an office floor is slow. What a zone answers is AREA and TAG ACTIVITY.
 */
export type Zone = {
  id: string
  /**
   * NULL = UNBOUND (decision-54 §1): a card an operator wrote at a door before anybody
   * decided which building it belongs to. Such a zone cannot be clocked into — `activePlace`
   * INNER JOINs `locations` — and the admin panel only ever SHOWS it. Binding is the
   * operator app's job, never this one's.
   */
  location_id: string | null
  name: string
  /** Where the tag physically is: "links neben der Gegensprechanlage". Null = not said. */
  note: string | null
  /**
   * Floor area. NULL IS THE POINT, and it is not 0: a zone nobody has measured is real,
   * and an invented area poisons the €/m² benchmark that is the only reason the column
   * exists. `NUMERIC(8,2)` in the column; a number on the wire, and it must never be
   * multiplied by anything here — see lib/area.ts, which keeps it in integer hundredths.
   */
  area_sqm: number | null
  /**
   * An ADOPTED tag's hardware serial, uppercase hex, colon-separated (decision-44). Null on
   * almost every zone: a tag WE wrote carries this zone's id in its URL and has no serial
   * on file at all. It is NOT a credential — it is broadcast in the clear and trivially
   * clonable — and it never travels phone → server, only server → phone inside /roster.
   */
  tag_serial: string | null
  /** When a physical tag was actually put on the wall. Null = the walk is unfinished. */
  tag_deployed_at: string | null
  active: boolean
  created_at: string
  /**
   * DERIVED by `/admin/data` from `shifts.start_zone_id`, never stored and never bounded by
   * the screen's period: "the Tiefgarage tag has not been tapped since 14 May" is precisely
   * the answer a period filter would hide. Null = this zone's tag has never opened a shift.
   */
  last_tap_at: string | null
  /**
   * decision-47 / migration 010. NULL = no operator has test-scanned this card yet, so the
   * zone is NOT a clock-in target (`POST /shifts/open` answers 422 `zone_unverified`) even
   * though `active` is true. Set only by `POST /operator/zones/:id/verify`, on an OPERATOR
   * session, in the field — no `/admin/*` route may write it, and `POST /admin/zones`
   * refuses the field from the body. Never cleared: a historical fact, not a toggle.
   */
  verified_at: string | null
  /** Who proved the card, joined by `/admin/data`. Null when nobody has, or that operator
   * was later deactivated and their name is gone with them (`ON DELETE SET NULL`) — the
   * timestamp survives either way. */
  verified_by_operator_name: string | null
}

/**
 * Create (no `id`) or update (`id`). Same route either way.
 *
 * `location_id` is NOT patchable server-side: moving a zone between buildings would strand
 * every shift that names it and silently re-point a physical tag on a wall at a different
 * address. Send the zone's own building back on an edit.
 *
 * `area_sqm` goes as a STRING (`'420.5'`) or null, never as a JS number: the column is exact
 * decimal precisely so the value never passes through binary floating point.
 */
export type ZoneInput = {
  id?: string
  location_id: string
  name: string
  note?: string
  area_sqm?: string | null
  tag_serial?: string | null
  tag_deployed_at?: string | null
  active?: boolean
}

/**
 * Upsert a zone.
 *
 * 409 has TWO meanings here and they are not interchangeable, so the caller must read
 * `ApiError.code` rather than the status alone:
 *   `duplicate_zone_name` another LIVE zone of this building already has that name
 *   `serial_taken`        another zone already claims that adopted serial
 *
 * The zone the taken serial belongs to is NOT read out of the error body: `/admin/data`
 * already returns EVERY zone of every building, so the caller finds it by serial in the
 * snapshot it is holding. One source for that name, and it is the same list the screen is
 * rendering — a second copy arriving through an error body is how a form comes to name a
 * zone the table underneath it does not show.
 */
export const ZONE_CONFLICTS = ['duplicate_zone_name', 'serial_taken'] as const
export type ZoneConflict = (typeof ZONE_CONFLICTS)[number]

export function zoneConflictOf(cause: unknown): ZoneConflict | null {
  if (!(cause instanceof ApiError) || cause.status !== 409) return null
  // A 409 whose code did not survive the gate is still a name clash far more often than
  // anything else, and "that name is taken" sends the director to the field that is wrong.
  return cause.code === 'serial_taken' ? 'serial_taken' : 'duplicate_zone_name'
}

export function saveZone(input: ZoneInput, signal?: AbortSignal): Promise<Zone> {
  return apiFetch<{ zone: Zone }>('/admin/zones', {
    method: 'POST',
    body: input,
    signal,
  }).then((data) => data.zone)
}

/**
 * SOFT deactivate, never a delete. A shift tapped here has to keep naming the door it was
 * tapped at, and the composite FK would refuse a delete anyway. Deactivating also stops the
 * zone's own tag resolving, which is what a director means when a tag comes off a wall.
 * Reactivating is a normal `saveZone` with `active: true`.
 */
export function deactivateZone(id: string, signal?: AbortSignal): Promise<void> {
  return apiFetch<{ zone: Zone }>(`/admin/zones/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
  }).then(() => undefined)
}

/* --- Reported tags: onboarding an UNBOUND tag (migration 008) ------------------------
 *
 * An operator's phone writes a fresh NDEF URI tag in the field and mints the uuid itself
 * (server/db/migrations/008_reported_tags.sql). It lands here, UNBOUND, until an admin
 * turns it into a building, a new zone, or an alias onto an existing zone. THIS SCREEN IS
 * DELIBERATELY PLAIN: it is the whole extent of iteration 3A's onboarding UI, built to
 * unblock the flow end to end, not styled to match the rest of the panel.
 */

export type ReportedTag = {
  id: string
  reported_at: string
  reported_by_operator_id: number | null
  reported_by_operator_name: string | null
}

/**
 * `/admin/data` already returns `reported_tags` alongside everything else (adminData's own
 * SELECT); `locations` and `zones` ride along in the SAME response so the resolve forms
 * have something to pick from without a second request.
 */
export type TagsSnapshot = {
  reported_tags: ReportedTag[]
  locations: Location[]
  zones: Zone[]
}

export function fetchTagsSnapshot(signal?: AbortSignal): Promise<TagsSnapshot> {
  return apiFetch<TagsSnapshot>('/admin/data', { signal })
}

// `resolveTagToBuilding` is DELETED (decision-47). The route it called
// (POST /admin/tags/:id/resolve-building) no longer exists on the server: a card can no
// longer become a BUILDING's own tap surface. A newly discovered building is created
// TAG-FREE with `saveLocation` (POST /admin/locations, whose id is generated by the
// database). Kept as a comment and not as a dead function on purpose: a client helper that
// still compiles is one a later screen calls, and the 404 would only surface at runtime, on
// an admin's screen, mid-field-visit.
//
// `resolveTagToZone` is DELETED for the same reason and by the same rule (decision-54 §2).
// POST /admin/tags/:id/resolve-zone is gone from the server: a reported card becomes a ZONE
// in the OPERATOR app (POST /operator/tags/:id/resolve-zone), never from this panel. What
// survives below is `resolveTagToExistingZone`, which creates nothing — it points a second
// physical card at a zone that already exists.

export type TagAlias = { id: string; zone_id: string }

/** `POST /admin/tags/:id/resolve-existing-zone` — this physical tag ALSO names that zone. */
export function resolveTagToExistingZone(
  tagId: string,
  zoneId: string,
  signal?: AbortSignal,
): Promise<TagAlias> {
  return apiFetch<{ alias: TagAlias }>(
    `/admin/tags/${encodeURIComponent(tagId)}/resolve-existing-zone`,
    { method: 'POST', body: { zone_id: zoneId }, signal },
  ).then((data) => data.alias)
}

/**
 * Feature flags (decision-57 §1). A name and a boolean is the whole feature — no
 * percentage rollout, no targeting. Rows are created by a migration alongside the client
 * code that reads them, so the panel can flip a flag and never create one.
 *
 * These two calls are the ONLY ones a 'flags'-role session can make: every other admin
 * route answers 401 for it, exactly as it does for a logged-out browser.
 */
export type FeatureFlag = {
  name: string
  enabled: boolean
  updated_at: string | null
  updated_by: string | null
}

export function fetchFlags(signal?: AbortSignal): Promise<FeatureFlag[]> {
  return apiFetch<{ flags: FeatureFlag[] }>('/admin/flags', { signal }).then((data) => data.flags)
}

/** `PATCH /admin/flags/:name`. 404 `unknown_flag` when the name has no row. */
export function setFlag(
  name: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<FeatureFlag> {
  return apiFetch<{ flag: FeatureFlag }>(`/admin/flags/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: { enabled },
    signal,
  }).then((data) => data.flag)
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
 * `PUT /admin/workers/:id/phone` — claims a LOGIN number for this worker (`phone_identities`,
 * decision-45), the one an SMS sign-in code actually goes to. NEVER `workers.phone` (the
 * free-text contact number above): the two are allowed to disagree and this route never
 * touches the other. `409 phone_claimed` names nobody — the same anti-enumeration posture
 * as `createOperator` — so the caller can only say "already assigned to someone else".
 */
export function setWorkerLoginPhone(
  workerId: number,
  phone: string,
  signal?: AbortSignal,
): Promise<string> {
  return apiFetch<{ worker: { id: number }; phone_e164: string }>(
    `/admin/workers/${workerId}/phone`,
    { method: 'PUT', body: { phone }, signal },
  ).then((data) => data.phone_e164)
}

/** `DELETE /admin/workers/:id/phone`. Idempotent: releasing an unclaimed number is a 200. */
export function clearWorkerLoginPhone(workerId: number, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/admin/workers/${workerId}/phone`, { method: 'DELETE', signal }).then(
    () => undefined,
  )
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

/* --- SMS: a SECOND delivery channel for the SAME enrolment code (decision-48) -----------
 *
 * THE OWNER, VERBATIM: "in admin there must be an option to choose how to onboard a
 * worker, so if sms didnt work, there is always a fallback."
 *
 * Onboarding is an ACTION, not a stored preference: this is a SEPARATE route from
 * `issueEnrolmentCode` above, never a `{deliver:"sms"}` option on it, so the fallback can
 * never end up hidden behind a parameter — and `issueEnrolmentCode` above is byte-for-byte
 * unchanged by any of this.
 */

/**
 * `GET /admin/sms-status` — names only, never a credential (server/lib/sms.js `smsStatus`).
 * The panel fetches this once alongside the worker list so the "SMS senden" button's
 * disabled state is a FACT FROM THE SERVER, not a guess baked into the static bundle
 * (decision-16: this is a static export).
 */
export type SmsStatus = {
  configured: boolean
  /** Exactly: 'account_sid' | 'auth' | 'sender'. Never surfaced verbatim — see `smsNotConfigured`. */
  missing: string[]
  sender_kind: 'number' | 'messaging_service' | null
}

export function fetchSmsStatus(signal?: AbortSignal): Promise<SmsStatus> {
  return apiFetch<SmsStatus>('/admin/sms-status', { signal })
}

/**
 * ONE delivery attempt, exactly as `POST .../enrolment-code/sms` returns it
 * (server/routes/admin.js `sendEnrolmentCodeBySms`). There is no third value: the flag is
 * checked before anything is minted, so a misconfigured box never reaches this type at all
 * — it throws `ApiError` with status 503 instead, same as every other refusal here.
 */
export type SmsDeliveryResult =
  | { status: 'sent'; phone_e164: string; provider_sid: string }
  | { status: 'failed'; phone_e164: string; reason: string; provider_code: number | null }

/**
 * `POST /admin/workers/:id/enrolment-code/sms` response. Same three fields as
 * `FreshEnrolmentCode` plus `delivery` — because a FAILED send is STILL a 200 carrying a
 * working code (decision-48 §5.1): the code half of this response is built before Twilio is
 * ever contacted, so there is no error case here for "SMS did not go out". `409
 * no_phone_identity`, `503 sms_not_configured` and `429 too_many_attempts` all throw
 * `ApiError` before anything is minted, exactly like every other route in this file.
 */
export type SmsEnrolmentCode = FreshEnrolmentCode & { delivery: SmsDeliveryResult }

export function sendEnrolmentCodeBySms(
  workerId: number,
  signal?: AbortSignal,
): Promise<SmsEnrolmentCode> {
  return apiFetch<SmsEnrolmentCode>(`/admin/workers/${workerId}/enrolment-code/sms`, {
    method: 'POST',
    signal,
  })
}

/**
 * A row of `operators` joined to its `phone_identities` claim (decision-45), exactly as the
 * `adminData` operator SELECT in server/routes/admin.js returns it. `enrolment_code_hash` is
 * never selected server-side, same omission as `Worker` above.
 *
 * `phone_e164` is nullable in the TYPE only because a LEFT JOIN can theoretically miss — in
 * practice every operator row is created inside the same transaction that claims a phone
 * (createOperator's one writable CTE), so an operator with no phone is not a state this
 * screen's own create path can produce. It is typed nullable anyway rather than asserted
 * non-null, because asserting it would be trusting the server's invariant instead of the
 * response actually in hand.
 */
export type Operator = {
  id: number
  name: string
  active: boolean
  created_at: string
  phone_e164: string | null
  /** Set only when this same phone also claims a `workers` row (decision-45 §3). */
  linked_worker_id: number | null
  linked_worker_name: string | null
  enrolment_code_expires_at: string | null
  enrolment_code_redeemed_at: string | null
}

/**
 * Create only — `POST /admin/operators` has no update branch (decision-45 §7, the route's
 * own comment: a phone that needs to change is a new identity claim, not an edit of an old
 * one). No `id` field exists on this type for that reason, not by omission.
 */
export type OperatorInput = { name: string; phone: string }

/**
 * ponytail: `/admin/data` returns far more than operators; typing the rest here would be
 * fiction no screen reads — same convention as `fetchInventory`/`fetchClientsSnapshot`
 * above, each of which reads its own slice of the same response.
 */
export function fetchOperators(signal?: AbortSignal): Promise<Operator[]> {
  return apiFetch<{ operators: Operator[] }>('/admin/data', { signal }).then(
    (data) => data.operators,
  )
}

/**
 * 409 `phone_claimed` is the only conflict this route can raise (createOperator's own
 * comment: `phone_identities_pkey` is the sole 23505 source reachable here) — and it names
 * nothing about who holds the number, on purpose (anti-enumeration, decision-45 §7).
 */
export function saveOperator(input: OperatorInput, signal?: AbortSignal): Promise<Operator> {
  return apiFetch<{ operator: Operator }>('/admin/operators', {
    method: 'POST',
    body: input,
    signal,
  }).then((data) => data.operator)
}

/** Soft delete (`active = false`) — mirrors `DELETE /admin/operators/:id` exactly. */
export function deactivateOperator(id: number, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/admin/operators/${id}`, { method: 'DELETE', signal })
}

/** The inverse of deactivateOperator (TASK-219). Sends no body — the route takes none;
 *  reactivating never touches a phone claim. */
export function reactivateOperator(id: number, signal?: AbortSignal): Promise<void> {
  return apiFetch<void>(`/admin/operators/${id}/reactivate`, { method: 'POST', signal })
}

/** Byte-identical shape to `FreshEnrolmentCode` above, over an operator instead of a worker. */
export type FreshOperatorCode = {
  operator: { id: number; name: string }
  code: string
  expires_at: string
}

export function issueOperatorEnrolmentCode(
  operatorId: number,
  signal?: AbortSignal,
): Promise<FreshOperatorCode> {
  return apiFetch<FreshOperatorCode>(`/admin/operators/${operatorId}/enrolment-code`, {
    method: 'POST',
    signal,
  })
}

export function revokeOperatorEnrolmentCode(
  operatorId: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<void>(`/admin/operators/${operatorId}/enrolment-code`, {
    method: 'DELETE',
    signal,
  })
}

/**
 * `POST /admin/operators/:id/enrolment-code/sms` — byte-identical contract to
 * `sendEnrolmentCodeBySms` above, over an operator instead of a worker (decision-45 §6 /
 * decision-48 applied to the operator role). A failed send is still a 200 carrying a
 * working code, for the same reason as the worker route.
 */
export type SmsOperatorCode = FreshOperatorCode & { delivery: SmsDeliveryResult }

export function sendOperatorEnrolmentCodeBySms(
  operatorId: number,
  signal?: AbortSignal,
): Promise<SmsOperatorCode> {
  return apiFetch<SmsOperatorCode>(`/admin/operators/${operatorId}/enrolment-code/sms`, {
    method: 'POST',
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
  /**
   * decision-56: the worker pressed "start without a tag" / "stop" in the app instead of
   * tapping. Independent of `client_uuid` — a manual END is still a phone-originated row.
   */
  manual_start: boolean
  manual_close: boolean
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
  /**
   * Every zone of every building, active and inactive — the same array `BuildingsSnapshot`
   * declares, because it is the same `/admin/data` response. Typed here too so the
   * dashboard can state a building's zone state from the request it ALREADY makes: a
   * second round trip for one integer per building would be a second thing that can be
   * stale, and the pin and the buildings table would then disagree about the same building.
   */
  zones: Zone[]
  shifts: Shift[]
  shift_limit: number
  shift_range: { from: string | null; to: string | null }
  shift_bounds: ShiftBounds
  /**
   * Rows the CURRENT `worker`/`location`/`state` request would also match in every OTHER
   * period — the server's own count, not the browser's, because the browser no longer holds
   * those rows (see `fetchShiftSnapshot`). `/shifts/` reports this so "no rows" and "no rows
   * anywhere" never look the same (TASK-235).
   */
  shift_outside_count: number
  /** The OFFSET the server applied (0 for page one). Echoed, not assumed. */
  shift_offset: number
  /** The ORDER BY the server applied. Echoed so a header can show it, not guess it. */
  shift_sort: { column: string; direction: 'asc' | 'desc' }
  /**
   * How many rows the period AND the filter keep, IGNORING limit/offset — the denominator of
   * „Seite 2 von 9“ and of „50 von 431 angezeigt“. Counting the page would answer a different
   * question with the same number.
   */
  shift_matching_count: number
  /**
   * Of those, how many block payroll — over the WHOLE period, not this page. The answer band
   * reads this and never `shifts.filter(blocksPayroll).length`: once the log pages, the
   * browser holds 50 rows and a headline computed from them silently means „this page“.
   */
  shift_blocked_count: number
}

/** Rows per page on `/shifts/` (TASK-18 AC3). The other callers of `/admin/data` do not page. */
export const SHIFT_PAGE_SIZE = 50

/**
 * What `/shifts/` currently has selected. Every field is optional/nullable because "any" is
 * a real, common choice — the browsing default has no worker, no building and no state.
 */
export type ShiftQuery = {
  range: PeriodRange
  /** `workers.id`, or `null` for every worker. */
  worker?: number | null
  /** Building uuid, or `null` for every building. */
  location?: string | null
  /**
   * Only the three values `server/routes/admin.js` understands narrow the request.
   * `noEmail` / `noTag` belong to other screens (decision-38 §4) and must never reach here —
   * callers translate them to `null` before calling this, exactly as the old client-side
   * `switch` did.
   */
  state?: 'open' | 'unresolved' | 'manual' | null
  /**
   * 1-based page. Set it and the request becomes `limit=SHIFT_PAGE_SIZE&offset=(page-1)*size`;
   * leave it off and the request is the unpaged one every other caller makes.
   */
  page?: number | null
  /** A key of `SHIFT_SORT` in server/routes/admin.js. Anything else is a 400, by design. */
  sort?: string | null
  dir?: 'asc' | 'desc' | null
  /**
   * One shift row, by id. A cross-link arriving as `?shift=123` narrows the SERVER query to
   * it: at 50 rows a page the row it names is usually not on page one, and a drawer that
   * cannot open is decision-38 rule 3 broken for every /payroll/ and / cross-link.
   */
  shift?: number | null
}

/**
 * THE SHIFT LOG IS WINDOWED BY THE SAME `?from=&to=` PAYROLL USES, PLUS `?worker=&location=
 * &state=` (TASK-235). It used to fetch UNBOUNDED and filter in the browser, on the theory
 * that only the browser could say "no shifts in August — 5 exist in earlier periods". That
 * theory stopped being true the day `/admin/data` learned to count what it did NOT return:
 * `shift_outside_count` is the server's own answer to exactly that question, over the SAME
 * filter this request already carries, so the distinction survives without the browser
 * having to hold every row ever recorded. At 20 workers / 8 buildings the old design was
 * the whole product's ceiling — a `thisYear` view neared 10 000 rows against a hard 2000-row
 * cap, and the query was not even bounded by date, so the newest 2000 rows SITE-WIDE could
 * exclude January entirely while claiming to answer "this year". A date-bounded query does
 * not have that failure mode: it is wrong only about ITS OWN period, and says so
 * (`shift_limit`, checked by the caller exactly as before).
 */
export function fetchShiftSnapshot(
  query: ShiftQuery,
  signal?: AbortSignal,
): Promise<ShiftSnapshot> {
  // Same page size as `fetchAdminSnapshot`. If the shift log asked for the server's 500
  // default while payroll asked for 2000, payroll would count shifts the log cannot show —
  // so "3 shifts need confirming" would link to a screen where they are not there.
  const parts =
    query.page == null
      ? [`limit=${ADMIN_SHIFT_LIMIT}`]
      : [`limit=${SHIFT_PAGE_SIZE}`, `offset=${(query.page - 1) * SHIFT_PAGE_SIZE}`]
  const range = rangeQuery(query.range)
  if (range !== '') parts.push(range)
  if (query.worker != null) parts.push(`worker=${query.worker}`)
  if (query.location != null) parts.push(`location=${encodeURIComponent(query.location)}`)
  if (query.state != null) parts.push(`state=${query.state}`)
  if (query.shift != null) parts.push(`shift=${query.shift}`)
  if (query.sort != null) parts.push(`sort=${encodeURIComponent(query.sort)}`)
  if (query.dir != null) parts.push(`dir=${query.dir}`)
  return apiFetch<ShiftSnapshot>(`/admin/data?${parts.join('&')}`, { signal })
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
  /**
   * Every zone of every building, ACTIVE AND INACTIVE, unbounded by the period. History has
   * to keep naming a zone a shift was tapped at, so an inactive one is rendered as inactive
   * rather than hidden.
   */
  zones: Zone[]
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

/**
 * decision-51. How many times one source address may call `POST /auth/sms/request` in a
 * rolling 5 minutes. The window itself is fixed in server code and not settable here.
 *
 * MIN/MAX/DEFAULT mirror `server/lib/auth.js` (`SMS_OTP_REQUESTS_MIN/MAX/DEFAULT`) — the
 * server is the trust boundary and re-checks the same bound on write, so a mismatch here
 * is a worse UX, never a hole: a client-side value outside the bound is caught by the
 * server's own `400 invalid_field` before it can be stored.
 */
export const SMS_OTP_REQUESTS_KEY = 'sms_otp_requests_per_5min'
export const SMS_OTP_REQUESTS_DEFAULT = 3
export const SMS_OTP_REQUESTS_MIN = 1
export const SMS_OTP_REQUESTS_MAX = 20

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

  /**
   * PRESENTATION ONLY, and never the same word as `active` above (decision-43 §3).
   * `active` decides whether this building's tag resolves; this decides whether its pin is
   * grey and which sentence the screen prints. An unzoned building clocks workers in
   * perfectly well: the card on the HOIV wall carries a BUILDING uuid and has no zone.
   */
  zone_state: 'zoned' | 'unzoned'

  labour_seconds: number
  labour_minutes: number
  /**
   * Payable labour only (decision-10), valued at CURRENT rates. See `PlLabourBasis`.
   *
   * THERE IS NO `labour_unpriced_*` ANY MORE AND THAT IS A DELETION, NOT AN OMISSION:
   * decision-41 made a rate of 0 unrepresentable, so `labour_seconds` and `labour_cents`
   * describe the SAME set of seconds and any divergence is a bug rather than a state.
   * `rate_basis: 'current'` below is a DIFFERENT, still-true limitation and it stays.
   */
  labour_cents: number
  /** This building's share of the period's material pool, pro-rata by labour (decision-6). */
  material_cents: number

  /**
   * WHAT THE CLIENT ACTUALLY PAID for the whole Vienna months this period contains, typed
   * by a human (decision-42). Not the contract, and not an accrual of one.
   *
   * Null = nobody has typed a figure for any of those months. It is NOT 0 and it is NOT the
   * contract value: 0 is a real, different answer meaning "they paid nothing this month" -
   * a credit month, a dispute, a free trial - and it comes back as 0.
   */
  revenue_cents: number | null
  revenue_unknown_reason: 'not_entered' | null
  /**
   * Whole months of the period that still have nobody's figure in them. The period figure
   * is only a TOTAL once this is 0; until then it is a partial sum, and a partial sum
   * printed as a total reads as a bad quarter.
   */
  months_missing_revenue: number
  revenue_months_entered: number
  /** What was AGREED for the same months: "vereinbart" beside "erhalten". Null = none. */
  contract_cents: number | null
  /** Provenance of the most recent figure in the period. Null = nothing entered. */
  revenue_entered_at: string | null
  revenue_entered_by: string | null
  /**
   * Set when the figure REPLACED an earlier one, which is kept: "geaendert" without "from
   * what" sends the director to the database, so the previous amount travels with it.
   */
  revenue_changed_at: string | null
  revenue_previous_cents: number | null
  period_days: number

  target_minutes: number | null
  target_unknown_days: number

  /**
   * Area DERIVED from the building's live zones and never stored (decision-43 section 6).
   * Null whenever the sum would be a FLOOR rather than a total, because a denominator that
   * is silently too small inflates every per-m2 figure computed from it.
   */
  building_m2: number | null
  zones_total: number
  zones_unmeasured: number
  area_unknown_reason: 'no_zones' | 'area_incomplete' | null
  /** All three null whenever the area is unknown. Never 0, never "about". */
  revenue_cents_per_m2: number | null
  labour_minutes_per_m2: number | null
  cost_cents_per_m2: number | null
  /** EUR/m2 has TWO ways of being unknowable and the screen has to say which. */
  per_m2_unknown_reason: 'no_zones' | 'area_incomplete' | 'not_entered' | null

  profit_cents: number | null
  /**
   * Margin in basis points. Null when the period is not whole Vienna months, when revenue
   * is unknown, or when revenue is exactly zero.
   */
  margin_bp: number | null
  margin_unknown_reason: 'period_not_month_aligned' | 'revenue_not_entered' | 'zero_revenue' | null
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
}

/**
 * THE PERIOD'S SHAPE, which is what decides whether a margin is answerable at all
 * (decision-42).
 *
 * A typed monthly payment CANNOT BE SLICED: 17/30ths of "the client paid 1.250,00 in
 * September" invents a payment schedule nobody agreed to, which is the same accrual
 * decision-42 removed, applied to its replacement. So a ragged period reports revenue for
 * the months it fully contains, NAMES the partial ones as excluded, and refuses every
 * margin. Cost keeps exact day boundaries, which is why approximating would compare a full
 * month of revenue against a partial month of labour.
 */
export type PlRevenueBasis = {
  basis: 'entered'
  basis_decision: string
  /** `YYYY-MM`, the whole Vienna months the period FULLY CONTAINS. */
  months: string[]
  months_contained: number
  months_touched: number
  /** False = days hang off a month boundary, and then every `margin_bp` is null. */
  month_aligned: boolean
  partial_months_excluded: number
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
  revenue: PlRevenueBasis
  labour: PlLabourBasis
  materials: PlMaterials
  buildings: PlBuilding[]
}

export function fetchPl(range: ClosedRange, signal?: AbortSignal): Promise<PlReport> {
  return apiFetch<PlReport>(`/admin/pl?${rangeQuery(range)}`, { signal })
}

/* --- Revenue: what a client actually PAID, per building per month (decision-42) ---------
 *
 * TWO FACTS THAT USED TO BE ONE:
 *   CONTRACT   what was AGREED.   A rate, valid from a date until a date.  /contracts/
 *   REVENUE    what was RECEIVED. A scalar, for one named Vienna month.    here
 *
 * THE ABSENCE OF A ROW IS THE UNKNOWN. Nothing on this screen may write a row on its own:
 * pre-filling from the contract is the rejected accrual wearing a different hat, and it
 * fabricates a payment a human then reads as confirmed. The contract value travels as a
 * `suggestion`, is LABELLED as one, and is stored only when somebody presses save.
 *
 * 0 is NOT the unknown. It is a real, different answer: "they paid nothing this month".
 * That is why RETRACTING exists and is not the same as typing 0 - see `retractRevenue`.
 */

/** The figure IN FORCE for one building-month, plus the one it replaced. */
export type RevenueEntry = {
  location_id: string
  /** `YYYY-MM`. A Vienna calendar month, never a slice of one. */
  month: string
  amount_cents: number
  note: string | null
  entered_at: string
  /** The admin who typed it, from their SESSION. A caller can never name themselves. */
  entered_by_email: string | null
  /** The amount this one replaced, or null when nothing was replaced. */
  previous_cents: number | null
  changed_at: string | null
  changed_by_email: string | null
}

/**
 * The CONTRACT value in force on the first of that month. A pre-fill for the form and
 * NOTHING ELSE: nothing applies it, and it is never summed into a report.
 */
export type RevenueSuggestion = {
  location_id: string
  month: string
  contract_cents: number
}

export type RevenueGrid = {
  range: ClosedRange
  timezone: string
  /** Every Vienna month the period TOUCHES, oldest first. `YYYY-MM`. */
  months: string[]
  entries: RevenueEntry[]
  /** Named `suggestions` and not `defaults` on purpose. */
  suggestions: RevenueSuggestion[]
}

export function fetchRevenue(range: ClosedRange, signal?: AbortSignal): Promise<RevenueGrid> {
  return apiFetch<RevenueGrid>(`/admin/revenue?${rangeQuery(range)}`, { signal })
}

/**
 * File, or CORRECT, one month's payment. A correction is an INSERT, never an update in
 * place: the previous row keeps its amount and gains a superseded stamp, so the screen can
 * print what the figure used to be and who changed it.
 *
 * 422 `amount_required` = the field was left empty. An entry with no amount is not an entry.
 * 422 `month_too_far_ahead` = further ahead than next month, which is a mistyped YEAR.
 * 400 `invalid_month` = not `YYYY-MM`.
 */
export function saveRevenue(
  locationId: string,
  month: string,
  amountCents: number,
  note: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<{ entry: unknown }>(
    `/admin/locations/${encodeURIComponent(locationId)}/revenue`,
    { method: 'POST', body: { month, amount_cents: amountCents, note }, signal },
  ).then(() => undefined)
}

/** One cell of the bulk grid: exactly what `POST /admin/revenue` files or corrects. */
export type RevenueBulkEntry = {
  location_id: string
  /** `YYYY-MM`. */
  month: string
  amount_cents: number
  note?: string
}

/**
 * File, or CORRECT, MANY building-months in one request (TASK-236) — the grid on `/pl/`
 * saves every cell a director actually typed into with ONE click, instead of `saveRevenue`
 * above 96 times. Same rule per cell: an entry with no amount is not an entry, 0 IS a real
 * answer, and nothing is pre-filled — only cells the caller put in `entries` are touched.
 *
 * 422 `duplicate_entry` = two entries named the same building-month in one request.
 * 404 `unknown_location` = a location id in the batch does not exist; nothing is written.
 * 422 `too_many_entries` = over the server's per-request cap (`REVENUE_BULK_MAX`).
 */
export function saveRevenueBulk(entries: RevenueBulkEntry[], signal?: AbortSignal): Promise<void> {
  return apiFetch<{ entries: unknown[] }>('/admin/revenue', {
    method: 'POST',
    body: { entries },
    signal,
  }).then(() => undefined)
}

/**
 * RETRACT: the month reverts to UNKNOWN. NOT the same as entering 0, and not optional.
 *
 * If a figure lands on the wrong building the only other way back would be "set it to 0",
 * which asserts that a paying client paid nothing - inside a report that drives
 * conversations with that client. The retracted row is kept and stamped.
 *
 * 404 = there is no live entry for that month, which is already the state asked for.
 */
export function retractRevenue(
  locationId: string,
  month: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiFetch<{ retracted: unknown }>(
    `/admin/locations/${encodeURIComponent(locationId)}/revenue/${encodeURIComponent(month)}`,
    { method: 'DELETE', signal },
  ).then(() => undefined)
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

  /**
   * PRESENTATION ONLY (decision-43). A grey pin and a named next action, never an
   * operational state: `active` is what decides whether the building's tag resolves, and an
   * unzoned building clocks workers in exactly as it did before zones existed.
   */
  zone_state: 'zoned' | 'unzoned'
  zones_total: number
  zones_unmeasured: number
  /** Null whenever the sum would be a floor rather than a total. Never 0. */
  building_m2: number | null
  area_unknown_reason: 'no_zones' | 'area_incomplete' | null

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
