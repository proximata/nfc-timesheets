'use client'

import { useTranslations } from 'next-intl'

export type FilterChip = {
  /** Stable across renders — the parameter name is exactly that. Used as the React key. */
  key: string
  /** What is being filtered on, in the reader's language: „Objekt", „Mitarbeiter". */
  label: string
  /**
   * The value, as a NAME the reader recognises — never the raw id. When the id names
   * nothing in the loaded data this is the screen's „unbekannt" wording, not the uuid: a
   * chip reading `Objekt: 9f3c…` tells a director nothing at all.
   */
  value: string
  /**
   * True → this id was well formed but matched no row. The chip says so and is styled as
   * something to act on, because the alternative — quietly showing every row — presents
   * one building's numbers as another's.
   */
  unknown?: boolean
  /** Drop this one filter. Always present: a filter you cannot remove is a trap. */
  onRemove: () => void
}

export type FilterChipsProps = {
  chips: readonly FilterChip[]
}

/**
 * „Objekt: Arsenalstraße ✕" — the filter, echoed by the screen it landed on.
 *
 * THIS IS RULE 3 OF decision-38 AND IT IS NOT DECORATION. A filtered screen and an empty
 * database render identically otherwise, and this product has already made a director
 * believe his payroll data was gone by showing him a correctly empty table. The chip is the
 * sentence that says „you are looking at a slice, here is which one, here is how to stop".
 *
 * It renders directly under the page header — above the fold at 390px — so the answer is on
 * screen before any table is. Nothing is announced: the chips are static content that
 * arrives with the page, and every screen already has a live region for the things that
 * change under the reader.
 *
 * The ✕ is a real `<button>` with a visually-hidden sentence naming the filter, because a
 * row of identical „✕" buttons is unusable by voice and by screen reader — the same reason
 * every repeated row action in this admin carries `forLocation` / `forWorker`.
 */
export function FilterChips({ chips }: FilterChipsProps) {
  const t = useTranslations('filters')

  if (chips.length === 0) return null

  return (
    <div className="filter-chips">
      {/* Named, not implied: a bare row of pills is not self-describing when it is the
          first thing on the screen. */}
      <p className="filter-chips-label">{t('activeHeading')}</p>
      <ul className="filter-chip-list">
        {chips.map((chip) => (
          <li key={chip.key}>
            {/* The word „unbekannt" is inside `value`; `is-unknown` is the SECOND signal.
                Greyscale this and it still reads. */}
            <span className={chip.unknown ? 'filter-chip is-unknown' : 'filter-chip'}>
              <span className="filter-chip-text">
                {chip.label}: {chip.value}
              </span>
              <button type="button" className="filter-chip-remove" onClick={chip.onRemove}>
                <span aria-hidden="true">✕</span>
                <span className="visually-hidden">
                  {t('remove', { filter: chip.label, value: chip.value })}
                </span>
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
