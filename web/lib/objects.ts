import type { Location, Shift } from '@/lib/api'
import { isPinned } from '@/lib/map'
import { blocksPayroll, shiftState } from '@/lib/shifts'

/**
 * ONE DERIVATION FOR THE MAP AND THE LIST (decision-39 §2).
 *
 * The pin and the `Objektliste` row below it show the same building, and the whole
 * argument for keeping the list is that it carries every fact the map carries. Two
 * derivations would be two things that can disagree — the pin saying „2 vor Ort" while the
 * row says 1 is exactly the quiet lie a dashboard tells, and neither number would look
 * wrong on its own. So this file computes it once and both surfaces render the result.
 *
 * IT IS PURE AND IT IS RUN BY `pnpm check`. No React, no formatting, no i18n: it answers
 * with counts and state names, and the two components turn those into German. That is what
 * lets the check assert the „kein Tag" proxy and the sort order without a browser.
 *
 * EVERYTHING HERE IS SLICED FROM THE SHIFT PAYLOAD `/` ALREADY FETCHED. That payload is
 * CAPPED at the server's row limit, so every count is a FLOOR when it is truncated and the
 * screen says so in the words it already uses (`home.truncatedNote`, `home.panelTruncated`).
 * `GET /admin/overview` — SQL aggregates, uncapped — is the upgrade path and is TASK-161;
 * it is not built here, and the capped-ness is stated rather than hidden.
 */

/** What the pin's glyph and the row's first cell say, before any colour is applied. */
export type OccupancyState = 'occupied' | 'empty'

export type BuildingSummary = {
  id: string
  name: string
  /** The pin's label. `name` cut at the first comma, so „Wohnhausanlage Donaufeld, Stiege 2"
   * does not become a 40-character chip floating over Floridsdorf. */
  short: string
  lat: number | null
  lng: number | null
  /** Distinct WORKERS with an open shift here — the director's question is „wie viele Leute
   * sind im Haus", and one worker cannot hold two open shifts (`shifts_one_open_per_worker_idx`). */
  onSite: number
  /**
   * Their names, oldest shift first, ONE ENTRY PER PERSON. The row states them; a bare
   * count is not actionable. `onSiteNames.length === onSite` is an invariant, not a
   * coincidence: a count and a list of names that disagree on the same row is the quiet
   * kind of wrong, because neither of them looks wrong on its own.
   */
  onSiteNames: readonly string[]
  occupancy: OccupancyState
  /** Auto-closed and never confirmed. NO PERIOD FILTER: an unresolved shift from March is
   * an open point today, and being old is what made it unresolved. */
  unresolved: number
  /** The newest completed, payable shift here. `null` is „noch nie", which is a real answer. */
  lastCleaned: Shift | null
  /**
   * TODAY'S PROXY for „no tag on the wall", and it is the same one `/` already uses in its
   * triage list (`home.rowDeadTag`): an active building that appears in NO loaded shift has
   * probably never had a working tag. It becomes a real fact when zones land (decision-37:
   * a zone row IS the tag record) — until then it is a proxy and the wording says so.
   */
  noTag: boolean
  /** `pinned` | `never_attempted` | `failed`, computed exactly as server/lib/reporting.js does. */
  geocodeState: 'pinned' | 'never_attempted' | 'failed'
  geocodeStatus: string | null
  /** Anything at all to look at here. Occupancy is NOT attention: a building can be fully
   * staffed and still need looking at, and modelling them as one traffic light makes the pin
   * and the answer band disagree. */
  attention: boolean
}

/** A pin label is a chip on a map, not a table cell. Cut at the first comma or dash. */
function shortName(name: string): string {
  const cut = name.split(/[,–—]/)[0]?.trim() ?? name
  return cut === '' ? name : cut
}

/**
 * Every ACTIVE building, with what the map and the list both need.
 *
 * Inactive buildings are deliberately absent: nothing is destroyed by a deactivation, but a
 * pin for a building nobody cleans any more is a pin that competes for space with one
 * somebody is standing in. `/locations/` is where a deactivated building still lives.
 *
 * SORTED attention → on-site → name, which is also the map's pin priority. A director who
 * reads the first row has read the most important one, on every path.
 */
export function summariseBuildings(
  locations: readonly Location[],
  shifts: readonly Shift[],
): BuildingSummary[] {
  const byLocation = new Map<string, Shift[]>()
  for (const shift of shifts) {
    const bucket = byLocation.get(shift.location_id)
    if (bucket === undefined) byLocation.set(shift.location_id, [shift])
    else bucket.push(shift)
  }

  const summaries = locations
    .filter((location) => location.active)
    .map((location): BuildingSummary => {
      const here = byLocation.get(location.id) ?? []
      const open = here
        .filter((shift) => shift.end_time === null)
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
      // DISTINCT WORKERS, NOT OPEN ROWS, and the names come from the same pass so the count
      // and the list can never disagree. They cannot differ today — one open shift per worker
      // is a database constraint (`shifts_one_open_per_worker_idx`) — but the pin's sentence
      // says „vor Ort", which is a number of PEOPLE, and counting rows instead would read 4
      // when four rows belong to one cleaner who tapped four times.
      const workers = new Map<number, string>()
      for (const shift of open) {
        if (!workers.has(shift.worker_id)) workers.set(shift.worker_id, shift.worker_name)
      }
      const unresolved = here.filter((shift) => shiftState(shift) === 'unresolved').length
      const lastCleaned =
        here.find((shift) => shift.end_time !== null && !blocksPayroll(shiftState(shift))) ?? null

      return {
        id: location.id,
        name: location.name,
        short: shortName(location.name),
        lat: location.lat,
        lng: location.lng,
        onSite: workers.size,
        onSiteNames: [...workers.values()],
        occupancy: workers.size > 0 ? 'occupied' : 'empty',
        unresolved,
        lastCleaned,
        noTag: here.length === 0,
        geocodeState: isPinned(location)
          ? 'pinned'
          : location.geocoded_at === null
            ? 'never_attempted'
            : 'failed',
        geocodeStatus: location.geocode_status,
        attention: unresolved > 0 || here.length === 0,
      }
    })

  return summaries.sort((a, b) => {
    if (a.attention !== b.attention) return a.attention ? -1 : 1
    if (a.onSite !== b.onSite) return b.onSite - a.onSite
    return a.name.localeCompare(b.name, 'de-AT')
  })
}

/** The ones that can be drawn. Narrowed, so no caller reaches for a non-null assertion. */
export function pinnedOnly(
  summaries: readonly BuildingSummary[],
): (BuildingSummary & { lat: number; lng: number })[] {
  return summaries.filter((summary): summary is BuildingSummary & { lat: number; lng: number } =>
    isPinned(summary),
  )
}
