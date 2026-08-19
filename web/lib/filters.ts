'use client'

import { useCallback, useEffect, useState } from 'react'
import { isPeriod, type Period } from '@/lib/period'

/**
 * THE URL FILTER CONTRACT — the one place that knows what an admin URL parameter is called
 * and what it may contain (decision-38).
 *
 * Why it exists. Before this file the admin had two cross-links in fourteen screens and
 * NEITHER passed a filter: `/payroll/` said „3 Schichten sind nicht bestätigt" and linked to
 * a shift log that opened on a different period, where those three shifts were not on
 * screen. The director assembled every journey by hand — read a name off one table, find it
 * again in another. Every link now carries the state that produced it, and this file is what
 * makes that a contract rather than eleven private conventions that drift apart.
 *
 * THE VOCABULARY IS THE WHOLE POINT AND IT IS NOT PER-SCREEN. One screen reading `?loc=`
 * while another reads `?location=` is worse than none reading anything: a link that looks
 * like it carries a filter and does not is a link the director stops trusting, and then
 * stops using. So the names live here, once, and every screen parses through `parseFilters`
 * and builds through `filterHref`.
 *
 *   location=<uuid>   the building.  UUID, because that is the only identity a building has
 *                     (decision-21) — the slug is a human label and is deliberately not an id
 *   worker=<id>       the person.    INTEGER: `workers.id` is a serial. decision-38 writes
 *                     `<uuid>` for this one; the database does not, and the database wins.
 *                     Same for `client` and `shift`. Stated rather than silently diverged
 *   client=<id>       the paying company. INTEGER
 *   shift=<id>        one shift row. INTEGER. `/shifts/` opens its correction drawer on it,
 *                     which is what turns „close Marta's open shift" into one click
 *   period=           an id from lib/period.ts, verbatim. Not a date range: a link that
 *                     carried `from=&to=` would freeze a relative period at the moment the
 *                     link was written, and „letzter Monat" means a different month in March
 *   state=            open | unresolved | manual | noEmail | noTag
 *   status=           open | all | decide | order | deliver     (materials only)
 *   open=<uuid>       opens the edit drawer on /locations/ for that building
 *   zones=<uuid>      opens the ZONE list on /locations/ for that building (decision-43).
 *                     Separate from `open=`, because they are two different jobs on one
 *                     screen and one parameter for both would make „Zonen verwalten“ and
 *                     „Objekt bearbeiten“ the same link. Separate from `location=` too:
 *                     `location=` narrows a REPORT to one building, `zones=` opens an
 *                     EDITOR for one, and /locations/ would otherwise have to guess which
 *                     was meant from a link written on another screen
 *
 * `status=all` is an addition to decision-38's list of four, and it is deliberate:
 * `/material-requests/` already ships an „alle" option on its own control, and a filter the
 * URL cannot express is a filter that silently reverts when the page is shared. `all` is
 * already the vocabulary's word for „no restriction" (`period=all`), so it is the same word
 * for the same idea rather than a second one.
 *
 * TWO KINDS OF WRONG INPUT, TWO DIFFERENT ANSWERS, and conflating them is the bug:
 *
 *   a parameter this contract cannot parse   → DROPPED SILENTLY, here, at the boundary.
 *     `?period=letzterMonat`, `?worker=abc`, `?location=<not a uuid>`, `?nonsense=1`.
 *     decision-38 §4: never a 404, never an error, never a blank screen. A hand-typed or
 *     half-copied URL degrades to the screen's own default. This project has already
 *     returned a 500 for a malformed URL once.
 *
 *   a WELL-FORMED id that names nothing      → the screen SAYS SO, in words, in the chip.
 *     That is not this file's job — it needs the loaded data — but it is the reason
 *     `parseFilters` keeps a syntactically valid id it cannot verify instead of dropping
 *     it. Silently showing the WHOLE table when the URL asked for one building is the one
 *     outcome worse than an error: the director reads somebody else's numbers as this
 *     building's.
 *
 * Parameters are read from `window.location`, never from `useSearchParams`: the admin is a
 * static export (decision-16) and `useSearchParams` forces a Suspense boundary on every
 * screen that touches a filter. They are read in an EFFECT so the prerendered HTML and the
 * first client render still agree — `/shifts/` has done exactly this for `?period=` since
 * before this file existed, and this generalises it rather than replacing it.
 */

/** Every parameter name in the admin. Nothing outside this list is read by any screen. */
export const FILTER_KEYS = [
  'location',
  'worker',
  'client',
  'shift',
  'period',
  'state',
  'status',
  'open',
  'zones',
] as const

export type FilterKey = (typeof FILTER_KEYS)[number]

/**
 * The object states a link may ask for. Each screen understands the subset that means
 * something to it and ignores the rest — `/shifts/?state=noEmail` is not an error, it is a
 * shift log with no state filter.
 */
export const FILTER_STATES = ['open', 'unresolved', 'manual', 'noEmail', 'noTag'] as const
export type FilterState = (typeof FILTER_STATES)[number]

export function isFilterState(value: string): value is FilterState {
  return (FILTER_STATES as readonly string[]).includes(value)
}

/** The material queue's own axis. `open` is the queue; `all` is the history. */
export const FILTER_STATUSES = ['open', 'all', 'decide', 'order', 'deliver'] as const
export type FilterStatus = (typeof FILTER_STATUSES)[number]

export function isFilterStatus(value: string): value is FilterStatus {
  return (FILTER_STATUSES as readonly string[]).includes(value)
}

/**
 * Every filter, parsed. `null` means „this URL said nothing about it" — NOT „no filter":
 * the difference matters because each screen keeps its own default period (`/shifts/`
 * browses the last 30 days, `/payroll/` pays for last month) and a link that says nothing
 * must not overwrite it.
 */
export type AdminFilters = {
  location: string | null
  worker: number | null
  client: number | null
  shift: number | null
  period: Period | null
  state: FilterState | null
  status: FilterStatus | null
  open: string | null
  zones: string | null
}

export const EMPTY_FILTERS: AdminFilters = {
  location: null,
  worker: null,
  client: null,
  shift: null,
  period: null,
  state: null,
  status: null,
  open: null,
  zones: null,
}

/**
 * Canonical v4-shaped UUID, case-insensitive. Shape only — whether the row exists is a
 * question for the screen that holds the data, and it answers it out loud (see the file
 * header). Anything else is not a building id and is dropped rather than sent anywhere.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A Postgres serial as it appears in a URL: positive, no sign, no padding, no float. */
const ROW_ID_RE = /^[1-9][0-9]{0,14}$/

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/**
 * A uuid parameter, VALIDATED AND NORMALISED — lower case, because hex digits are
 * case-insensitive on input (RFC 4122 §3) and every id this admin compares against comes
 * back from Postgres in lower case.
 *
 * Without the fold, `?location=5BBDB9CA-…` passed `isUuid` (the pattern is `/i`), survived
 * the boundary unchanged, matched no row, and the screen said „Objekt: unbekannt — dieses
 * Objekt ist hier nicht vorhanden" about a building that is right there. Safe, and wrong.
 * It is not hypothetical: Windows, .NET and several NFC tag writers format a uuid in upper
 * case, and decision-21 puts the location uuid in the tag URI.
 *
 * NORMALISING IS NOT THE SAME AS WIDENING. The shape is still validated and anything that
 * is not a uuid is still dropped silently (see the file header's two kinds of wrong input);
 * a well-formed id that names nothing still reaches the screen and is still said out loud.
 */
export function toUuid(value: string | null): string | null {
  if (value === null || !isUuid(value)) return null
  return value.toLowerCase()
}

/** `"12"` → 12. Anything else — `"0"`, `"-3"`, `"1.5"`, `"01"`, `"1e3"`, `""` → null. */
export function toRowId(value: string | null): number | null {
  if (value === null || !ROW_ID_RE.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

/**
 * Parse a query string into filters. NEVER THROWS, and never returns a value it did not
 * validate. `search` is `window.location.search` or anything `URLSearchParams` accepts,
 * with or without the leading `?`.
 */
export function parseFilters(search: string): AdminFilters {
  const params = new URLSearchParams(search)
  const text = (key: FilterKey): string | null => {
    const raw = params.get(key)
    return raw === null || raw.trim() === '' ? null : raw.trim()
  }

  const location = text('location')
  const open = text('open')
  const period = text('period')
  const state = text('state')
  const status = text('status')

  return {
    location: toUuid(location),
    worker: toRowId(text('worker')),
    client: toRowId(text('client')),
    shift: toRowId(text('shift')),
    period: period !== null && isPeriod(period) ? period : null,
    state: state !== null && isFilterState(state) ? state : null,
    status: status !== null && isFilterStatus(status) ? status : null,
    open: toUuid(open),
    zones: toUuid(text('zones')),
  }
}

/**
 * Filters → `?a=1&b=2`, or `''` when nothing is set.
 *
 * FIXED KEY ORDER, from FILTER_KEYS, so the same filter set always produces the same URL.
 * Two links to „this building's shifts this month" that differ only in parameter order are
 * two strings a human has to compare character by character before believing they agree.
 */
export function filterQuery(filters: Partial<AdminFilters>): string {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = filters[key]
    if (value === null || value === undefined) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/**
 * The ONE way a screen builds a cross-link. `path` keeps its trailing slash — the export is
 * a directory of `index.html` files and `/shifts` (no slash) is a redirect, not a page.
 */
export function filterHref(path: string, filters: Partial<AdminFilters>): string {
  return `${path}${filterQuery(filters)}`
}

/** Is any object-scoped filter set? The period is not one: every screen has a period. */
export function hasObjectFilter(filters: AdminFilters): boolean {
  return (
    filters.location !== null ||
    filters.worker !== null ||
    filters.client !== null ||
    filters.shift !== null ||
    filters.state !== null
  )
}

/**
 * How a filter write is recorded in history. Chosen deliberately, per action, because the
 * back button is the only undo this admin has:
 *
 *   'replace' — a CONTROL on the screen you are already on: a select, a chip's ✕, a jump
 *               out of an empty period. Pushing here is the classic filter-bar bug: change
 *               four dropdowns and the back button walks you through all four before it
 *               takes you off the screen. Nobody presses back four times; they close the
 *               tab.
 *   'push'    — OPENING A PANEL (`?location=`, `?worker=`). A panel covers the screen, so
 *               back must close it — that is what every reader expects from something that
 *               appeared over what they were reading. Closing the panel then writes with
 *               'replace', so leaving it needs one back press and not two.
 *
 * Cross-SCREEN links are neither: they are ordinary `<Link>` navigations and Next pushes
 * them, which is correct — back returns to the screen the link was on.
 */
export type HistoryMode = 'replace' | 'push'

/**
 * Read the URL's filters, and write them back when the screen changes them.
 *
 * Returns `[filters, setFilters]`. The first render is always EMPTY_FILTERS so the
 * prerendered HTML matches; the effect then supplies the real ones. Screens must therefore
 * treat „no filters yet" and „no filters in the URL" the same way — which they do anyway,
 * because both mean „use my default".
 *
 * `popstate` is listened to because the browser's back button is the ONLY thing that can
 * change the URL without going through `setFilters`: a static export re-renders nothing on
 * a query-only history pop, so without this the address bar and the screen disagree, and
 * back appears to do nothing at all.
 */
export function useFilters(): [
  AdminFilters,
  (patch: Partial<AdminFilters>, mode: HistoryMode) => void,
] {
  const [filters, setFiltersState] = useState<AdminFilters>(EMPTY_FILTERS)

  useEffect(() => {
    const read = () => setFiltersState(parseFilters(window.location.search))
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])

  const setFilters = useCallback((patch: Partial<AdminFilters>, mode: HistoryMode) => {
    setFiltersState((current) => {
      const next: AdminFilters = { ...current, ...patch }
      // Raw History API, not `router.push`: the pathname never changes here, only the
      // query, and asking the App Router to re-navigate the route it is already on is a
      // remount waiting to happen. This is also what keeps the static export honest — no
      // `useSearchParams`, so no Suspense boundary on eleven screens.
      const url = `${window.location.pathname}${filterQuery(next)}${window.location.hash}`
      if (mode === 'push') window.history.pushState(null, '', url)
      else window.history.replaceState(null, '', url)
      return next
    })
  }, [])

  return [filters, setFilters]
}
