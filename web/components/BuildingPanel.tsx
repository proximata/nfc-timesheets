'use client'

import { useTranslations } from 'next-intl'
import { BuildingFacts, type BuildingFactsProps } from '@/components/BuildingFacts'
import { Drawer } from '@/components/Drawer'
import type { Location } from '@/lib/api'

export type BuildingPanelProps = Omit<BuildingFactsProps, 'building'> & {
  /** null → the drawer is closed. */
  building: Location | null
  onClose: () => void
}

/**
 * OBJEKTPANEL — the building as an object, in a drawer.
 *
 * This is the surface `/locations/<id>` would have been if the admin were not a static
 * export (decision-16, decision-38). It is reached at `/?location=<uuid>`, which means it
 * can be bookmarked, sent to somebody and re-opened — the point of the whole exercise.
 *
 * IT IS THE FALLBACK RENDERING, AND THAT IS DELIBERATE. Since decision-39 the same
 * `?location=` also expands an info box ON the building's map pin, which is the owner's
 * chosen presentation (IA-PLAN §9). Exactly ONE of the two is ever on screen, decided in
 * app/page.tsx: the pin's info box when the map is drawn AND that building has coordinates,
 * this drawer in every other case — no key, no pins, a blocked key, a building nobody has
 * geocoded, or a phone with the map collapsed. Both render the same `<BuildingFacts>`, so
 * they cannot disagree about a number, and the URL is the same either way.
 *
 * Every number and every link lives in components/BuildingFacts.tsx; this file is the
 * drawer around them and nothing else. `<Drawer>` moves focus in, traps it, closes on
 * Escape and returns focus to whatever opened it.
 */
export function BuildingPanel({ building, onClose, ...facts }: BuildingPanelProps) {
  const t = useTranslations('home')

  if (building === null) return null

  return (
    <Drawer open onClose={onClose} title={building.name} step={t('panelStep')}>
      <BuildingFacts building={building} {...facts} />
    </Drawer>
  )
}
