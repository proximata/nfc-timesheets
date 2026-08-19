'use client'

import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/EmptyState'
import type { BuildingSummary } from '@/lib/objects'
import { BUSINESS_TIME_ZONE, durationMinutes, formatDuration } from '@/lib/shifts'

export type ObjektlisteProps = {
  /** Active buildings, already summarised and sorted attention → on-site → name. */
  buildings: readonly BuildingSummary[]
  selectedId: string | null
  onOpen: (id: string) => void
  /** Ask Google again for one building's coordinates. The one WRITE on this screen. */
  onGeocode: (id: string) => void
  /** True while a geocode request is in flight, so the row cannot be double-submitted. */
  busy: boolean
}

/**
 * OBJEKTLISTE — every building, on every path, whatever the map is doing (decision-39 §2).
 *
 * THIS IS NOT THE MAP'S FALLBACK. It is the primary presentation and the map is the
 * optional region above it. The reason is not a principle, it is production: one building,
 * `lat NULL`, `lng NULL`. On day one the map draws nothing and this table IS the screen.
 * It is also what makes the whole surface usable with a keyboard and a screen reader
 * without a second implementation — the pins are `aria-hidden` and these rows are the only
 * tab stops (components/HomeMap.tsx says so and says why).
 *
 * FIVE COLUMNS, HARD CAP. `.data-table` turns every row into a card below 768px for free
 * (components/ResponsiveTableLabels.tsx), and a sixth column is what reintroduced the
 * 768–1439px horizontal scroll the redesign review logged as R1.
 *
 * COLOUR IS THE SECOND SIGNAL, NEVER THE FIRST. Every state here is a glyph and a WORD:
 * `● 1 vor Ort`, `○ niemand vor Ort`, `▲ 2 nicht bestätigt`, `▢ kein Tag`. Greyscale the
 * screenshot and nothing becomes unreadable.
 *
 * THE ZONE STATE IS A SETUP FACT, NOT A CHECK. It rides under the building's NAME rather
 * than in the „Zu prüfen" column, because nothing about it is broken: an unzoned building
 * clocks workers in exactly as it did before zones existed, and the card already on the
 * HOIV wall carries its BUILDING uuid (decision-43 §3). The map pin beside it is drawn
 * grey; this sentence is what makes the grey readable without colour.
 *
 * A BUILDING WITHOUT COORDINATES IS NOT AN ERROR ROW. It says which of the three genuinely
 * different things happened — nobody has asked yet, we asked and Google said no, or the
 * address is the problem — and offers the retry, because that is the state the whole
 * portfolio is in today and it has to be actionable rather than apologetic.
 */
export function Objektliste({ buildings, selectedId, onOpen, onGeocode, busy }: ObjektlisteProps) {
  const t = useTranslations('home')
  const format = useFormatter()

  if (buildings.length === 0) {
    // „Kein aktives Objekt" is a real answer for a company that has not been set up yet, and
    // it must never read as a table that failed to load.
    //
    // AND IT CARRIES THE ACTION IT NAMES. The sentence says „sobald ein Objekt angelegt ist“
    // and offered no way to create one: this is the FIRST SCREEN of a new account,
    // it is the state the Vienna client is onboarded into next week (JOURNEYS D1), and a
    // precondition with no route to satisfying it is a dead end dressed as an explanation.
    // An empty state is not an error — it is the first instruction.
    return (
      <EmptyState>
        {t('objectsEmpty')} <Link href="/locations/">{t('objectsEmptyLink')}</Link>
      </EmptyState>
    )
  }

  const day = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })

  /** Which of the three coordinate states this building is in, in words the owner can act on. */
  const coordinateNote = (building: BuildingSummary): string | null => {
    if (building.geocodeState === 'pinned') return null
    if (building.geocodeState === 'never_attempted') return t('objectsGeoNever')
    return t('objectsGeoFailed', { status: building.geocodeStatus ?? t('objectsGeoUnknown') })
  }

  return (
    /* `objects-table` carries no styling. It is a HOOK, so a check can count THESE rows and
       not the ledger's two tables further down the same screen — which is exactly the
       mistake that let a sabotaged Objektliste pass a row count once. */
    <table className="data-table objects-table" aria-busy={busy}>
      <caption className="visually-hidden">{t('objectsCaption')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('colLocation')}</th>
          <th scope="col">{t('colOnSite')}</th>
          <th scope="col">{t('colLastCleaned')}</th>
          <th scope="col">{t('colToCheck')}</th>
          <th scope="col">{t('colActions')}</th>
        </tr>
      </thead>
      <tbody>
        {buildings.map((building) => {
          const note = coordinateNote(building)
          const last = building.lastCleaned
          return (
            <tr key={building.id} className={building.attention ? 'row-attention' : undefined}>
              <th scope="row">
                {building.name}
                {note === null ? null : <span className="shift-state-note">{note}</span>}
                {building.zoneState === 'unzoned' ? (
                  <span className="shift-state-note">{t('objectsNoZone')}</span>
                ) : null}
              </th>
              <td>
                {/* The glyph is decoration ON TOP OF the sentence beside it, so it is
                    aria-hidden: a screen reader announcing „schwarzer Kreis" before „1 vor
                    Ort" is noise, and the sentence already carries the state. */}
                <span className="state-glyph" aria-hidden="true">
                  {building.occupancy === 'occupied' ? '●' : '○'}
                </span>{' '}
                {building.onSite === 0
                  ? t('objectsNobody')
                  : t('objectsOnSite', { count: building.onSite })}
                {building.onSiteNames.length === 0 ? null : (
                  <span className="shift-state-note">{building.onSiteNames.join(' · ')}</span>
                )}
              </td>
              <td>
                {last === null || last.end_time === null ? (
                  /* „Noch nie" is a real answer and not an error. */
                  <span className="cell-muted">{t('objectsNeverCleaned')}</span>
                ) : (
                  <>
                    {day(last.start_time)}
                    <span className="shift-state-note">
                      {t('objectsLastBy', {
                        name: last.worker_name,
                        duration: formatDuration(durationMinutes(last.start_time, last.end_time)),
                      })}
                    </span>
                  </>
                )}
              </td>
              <td>
                {building.unresolved > 0 ? (
                  <span className="state-word is-unres">
                    <span aria-hidden="true">▲</span>{' '}
                    {/* The panel's own wording, reused rather than restated: two spellings
                        of „2 Schichten nicht bestätigt" is two strings to keep in step. */}
                    {t('panelPointsUnresolved', { count: building.unresolved })}
                  </span>
                ) : null}
                {building.noTag ? (
                  <span className="state-word is-muted">
                    <span aria-hidden="true">▢</span> {t('objectsNoTag')}
                  </span>
                ) : null}
                {building.unresolved === 0 && !building.noTag ? (
                  <span className="cell-muted">{t('objectsNothingToCheck')}</span>
                ) : null}
              </td>
              <td className="cell-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-pressed={selectedId === building.id}
                  onClick={() => onOpen(building.id)}
                >
                  {t('objectsOpen')}
                  <span className="visually-hidden"> {building.name}</span>
                </button>
                {building.geocodeState === 'pinned' ? null : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => onGeocode(building.id)}
                  >
                    {t('objectsGeocode')}
                    <span className="visually-hidden"> {building.name}</span>
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
