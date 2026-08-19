'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  failureOf,
  type GMap,
  type GOverlayView,
  loadGoogleMaps,
  MAPS_API_KEY,
  type MapFailure,
  mapStyleFor,
  onMapsAuthFailure,
  VIENNA_CENTRE,
} from '@/lib/map'
import { type BuildingSummary, pinnedOnly } from '@/lib/objects'
import { captureOpener } from '@/lib/useOverlay'

/**
 * THE MAP REGION ON `/` — a backdrop under our own pins, and never the only way to read
 * anything (decision-39).
 *
 * IT IS OPTIONAL BY CONSTRUCTION. The `Objektliste` below it is rendered on every path,
 * with the same buildings, the same numbers, the same states in words and the same action.
 * That is not a fallback bolted on afterwards: production holds exactly one building and
 * its `lat`/`lng` are NULL, so ZERO PINS is the state on the day this ships. A design in
 * which the list is the degraded case would ship an empty screen to the only building this
 * company currently cleans.
 *
 * SEVEN STATES, EACH ONE A DESIGNED RENDERING IN WORDS, none of them a blank rectangle and
 * none of them a bare „Fehler" — they have different owners and different fixes:
 *
 *   noKey    the build carried no NEXT_PUBLIC_GOOGLE_MAPS_KEY. A deployment fact, not a
 *            fault, and NOT retryable: a retry cannot fix a build.
 *   noPins   no active building has coordinates. The region is not rendered at all — no
 *            empty grey frame — and the list says how many and offers „Koordinaten holen".
 *   loading  a reserved box, never a spinner over a list that is already usable.
 *   failed   the script never arrived: offline, an ad blocker, a proxy, a CSP. Retryable,
 *            and the retry really retries (`loadGoogleMaps` does not cache a rejection).
 *   timeout  ten seconds and no `error` event — a blocked script that never settles.
 *   blocked  `gm_authFailure`: the referrer was rejected, the Maps JavaScript API is not
 *            enabled, OR the quota/billing ran out. THE REGION IS TORN DOWN, not covered:
 *            this signal fires LATE, after `new Map()` has already succeeded, and what is
 *            on screen at that moment is Google's own grey box under its own alert. Quota
 *            exhaustion is INDISTINGUISHABLE from a rejected key in the browser, so the
 *            sentence names both possibilities instead of inventing a distinction.
 *   collapsed on a phone, by choice (see below).
 *
 * COST. Billing is per MAP LOAD — one `new google.maps.Map(...)` — not per script fetch and
 * not per pin. So the map is constructed ONCE per mount and held in a ref; a data refresh
 * repositions pins and never rebuilds; a theme switch calls `setOptions({ styles })` and
 * never remounts. There is no auto-refresh polling on `/` at all — the refresh button and
 * `home.asOf` are how a newer answer is asked for.
 *
 * ESCAPE AND FOCUS ON THE INFO BOX, and what it deliberately is NOT. The box is not a
 * dialog, does not claim `role="dialog"` and does not trap Tab: the Objektliste below is a
 * proven-complete keyboard path to everything the pins open, so nothing here is the only way
 * to reach a function. What it DOES keep is the half of the overlay contract whose absence
 * is simply surprising — Escape dismisses it, opening it moves focus into it, and closing it
 * puts focus back on the control that opened it. Without the first, the box was the one
 * surface in the admin that ate Escape; without the second, a keyboard reader pressed Enter
 * on a row and nothing happened WHERE THEY WERE, because the box mounts UPSTREAM of the list
 * in DOM order and forward Tab therefore never reaches it (measured: 30 presses, not found;
 * Shift+Tab found it in 7, six of them Google's own controls).
 *
 * KEYBOARD AND SCREEN READER — a deliberate, stated ceiling. Each COLLAPSED pin label is
 * `aria-hidden` and `tabindex="-1"`: pins are ordered by geography, so a tab order over
 * them is arbitrary, and a reader that hears „Donaufeld, 1 vor Ort" from a pin and again
 * from the list row below is being read the portfolio twice. The `Objektliste` is the only
 * set of tab stops and it opens the same thing. The EXPANDED info box is NOT hidden — it
 * holds the real cross-links, and a link nobody can reach with a keyboard is not a link.
 * UPGRADE PATH: a roving tabindex over pins sorted north→south, list unchanged. Not built
 * until somebody asks for it.
 */

/**
 * Above this many pins a label is a smear, so it degrades to glyph + count and the name
 * comes back on selection. CEILING, stated: past roughly 60 buildings the map is a heat
 * blur and the list is the product. UPGRADE PATH: a grid collision pass, or the
 * `markerclusterer` script tag argued for in its own decision record — not a dependency
 * added quietly (the budget is zero).
 */
const PIN_LABEL_MAX = 30

/** Padding around the fitted bounds, in pixels. Keeps a pin off the region's own border. */
const FIT_PADDING = 48

/** A single pin fits to maximum zoom and lands the director on a rooftop. Pull back. */
const SINGLE_PIN_ZOOM = 16

/** Below this the home screen is a list and the map is one tap away. decision-28 / §7. */
const PHONE_MAX_WIDTH = 767

/** Breathing room between the info box and the map's own edge, in pixels. */
const INFO_MARGIN = 12

/**
 * How long after a click on our own pin layer the map's own click handler stays quiet, in
 * milliseconds. See `layerClickAt`. Google forwards the click in the same task, so this only
 * has to be non-zero; it is kept well under the time it takes a reader to click twice.
 */
const LAYER_CLICK_WINDOW = 150

/** How far under the pin's own coordinate the box hangs before it is clamped. Mirrors the
 *  `top: calc(100% + 14px)` in globals.css, and the two must agree or the clamp is off by
 *  the difference. */
const INFO_GAP = 14

/** The info box never gets smaller than this; below it, it is a scrollbar with a title. */
const INFO_MIN_HEIGHT = 160

/**
 * How far above the centre a selected pin is lifted, as a fraction of the map's height.
 *
 * MEASURED, not chosen, and re-measured when the map region was cut to keep the Objektliste
 * on the fold: the box hangs below the pin, so a CENTRED pin leaves it exactly half a map.
 * 0.3 left ~336px of room in a 520px map; the region is smaller now, so the pin is lifted
 * further — 0.38 puts it ~11 % from the top, which is as high as it can go before the label
 * ABOVE the coordinate (the pin is `translate(-50%, -100%)`) is clipped by the map's edge.
 * Everything under it is what the info box has to live in, and the expanded link list is
 * sized against that number rather than hoping.
 */
const INFO_LIFT = 0.38

/**
 * The theme the page is in RIGHT NOW. `<html data-theme>` is the single truth — it is
 * written by the pre-paint script in app/layout.tsx, by ThemeSwitcher, and by the OS media
 * query when the setting is „System" — so reading the attribute agrees with all three,
 * where asking `matchMedia` directly would disagree with two of them.
 */
function currentTheme(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export type HomeMapProps = {
  /** Active buildings, already summarised and sorted (lib/objects.ts). */
  buildings: readonly BuildingSummary[]
  /** `?location=` — the same parameter that opens the drawer. One selection, two renderings. */
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** The expanded info box's body. Called only for a selected building that HAS a pin. */
  renderFacts: (id: string) => ReactNode
  /**
   * True exactly while a map is on screen and able to hold an info box. `/` uses it to
   * decide which of the TWO renderings of `?location=` to show, and it is reported from
   * here rather than guessed there because only this component knows whether Google
   * actually answered. Must be a stable identity — it sits in an effect's dependencies.
   */
  onDrawnChange: (drawn: boolean) => void
}

type MapState = 'noKey' | 'noPins' | 'loading' | 'ready' | 'blocked' | 'failed'

export function HomeMap({
  buildings,
  selectedId,
  onSelect,
  renderFacts,
  onDrawnChange,
}: HomeMapProps) {
  const t = useTranslations('home')

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GMap | null>(null)
  const overlayRef = useRef<GOverlayView | null>(null)
  /** The DOM node inside Google's own float pane that our pins are portalled into. */
  const [pane, setPane] = useState<HTMLElement | null>(null)
  /**
   * WHEN OUR OWN PIN LAYER LAST TOOK A CLICK, as a timestamp.
   *
   * The pins and the open info box are portalled into Google's float pane, so every press
   * inside the box is also a click on the map, and the map's handler clears the selection —
   * i.e. pressing the disclosure inside the box closed the box that held it. Neither obvious
   * fix works, and both were tried before this one:
   *
   *   `stopPropagation` on the box   Google's own click listener sits ON THE PIN LAYER, and
   *                                  React's sits on the document ABOVE it. A fence between
   *                                  the two blocks React as well, and then nothing inside
   *                                  the box works at all.
   *   ask `event.domEvent.target`    Google forwards the DOM event AFTER dispatch has
   *                                  finished: `domEvent` is a real MouseEvent whose
   *                                  `target` is already null and whose `composedPath()` is
   *                                  empty. Measured, printed, not assumed.
   *
   * So the layer records the click while it is still being dispatched, and the map's handler
   * reads that record. The window is short on purpose: it must outlast Google's forwarding
   * (same task) and expire long before a reader can click the pin and then the map.
   */
  const layerClickAt = useRef(0)
  const pinRefs = useRef(new Map<string, HTMLDivElement>())

  const [state, setState] = useState<MapState>('loading')
  const [failure, setFailure] = useState<MapFailure | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [phone, setPhone] = useState(false)
  /**
   * ponytail: the phone's „Karte anzeigen" choice lives in React state, so it lasts as long
   * as the screen does. CEILING: a reload re-collapses the map. Per-session browser storage
   * is the obvious upgrade and is deliberately NOT taken — `pnpm check` bans that whole API
   * from this bundle (decision-20: nothing the page can read may hold state), and a map
   * preference is not worth a hole in that rule. UPGRADE PATH: a server-side admin
   * preference, once there is a second one worth storing.
   */
  const [phoneOpen, setPhoneOpen] = useState(false)

  const pinned = useMemo(() => pinnedOnly(buildings), [buildings])
  /** Refs, not dependencies: `draw()` runs on every frame of a pan and must see the latest. */
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  /** Changes only when the SET of drawable buildings changes, so a refresh does not refit. */
  const fitKey = useMemo(
    () =>
      pinned
        .map((b) => `${b.id}:${b.lat.toFixed(5)},${b.lng.toFixed(5)}`)
        .sort()
        .join('|'),
    [pinned],
  )

  /**
   * Put every pin where its coordinate currently projects to. Imperative on purpose: this
   * runs on every frame of a pan, and a `setState` per frame is jank with a stack trace.
   *
   * It also decides WHERE THE OPEN INFO BOX SITS, and the answer is: inside the map,
   * wherever that has to be. The box hangs under the pin by default and is then CLAMPED to
   * the map's own rectangle — it is not flipped to whichever side has more room, which is
   * what it used to do. The difference is not cosmetic: flipping capped the box at the room
   * on ONE side of the pin (measured at 266px in a 380px map), and the box has to hold ten
   * cross-links. Clamping caps it at the whole region instead, so the height available is a
   * property of the map and not of where the reader happens to have dragged it.
   *
   * Measured against the container's own rectangle rather than guessed from the projected
   * pixel, because the projection's origin is the overlay pane's and not the map's viewport.
   * Only the ONE open box is measured, so this stays two `getBoundingClientRect` calls per
   * frame rather than two per pin.
   */
  const reposition = useCallback(() => {
    const projection = overlayRef.current?.getProjection()
    if (!projection) return
    for (const building of pinnedRef.current) {
      const element = pinRefs.current.get(building.id)
      if (element === undefined) continue
      const point = projection.fromLatLngToDivPixel({ lat: building.lat, lng: building.lng })
      if (point === null) continue
      element.style.left = `${point.x}px`
      element.style.top = `${point.y}px`

      if (building.id !== selectedRef.current) continue
      const container = containerRef.current
      if (container === null) continue
      const pin = element.getBoundingClientRect()
      const map = container.getBoundingClientRect()
      element.dataset.side = pin.left > map.left + map.width / 2 ? 'left' : 'right'
      // The whole region, less a margin at each edge. `INFO_MIN_HEIGHT` is the floor: below
      // that the box would be a scrollbar with a title on it.
      const room = Math.max(INFO_MIN_HEIGHT, Math.round(map.height - INFO_MARGIN * 2))
      element.style.setProperty('--map-info-max', `${room}px`)

      // …then slide it back inside. The box is measured AFTER its max-height is set, so the
      // number read here is the height it actually has, not the height it would like.
      const box = element.querySelector('.map-info')
      if (box === null) continue
      const height = box.getBoundingClientRect().height
      const want = pin.bottom + INFO_GAP
      const top = Math.max(map.top + INFO_MARGIN, Math.min(want, map.bottom - INFO_MARGIN - height))
      element.style.setProperty('--map-info-shift', `${Math.round(top - want)}px`)
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`)
    const read = () => setPhone(media.matches)
    read()
    media.addEventListener('change', read)
    return () => media.removeEventListener('change', read)
  }, [])

  /**
   * Google's own rejection signal. It fires LATE — the script loads, `google.maps` appears,
   * `new Map()` succeeds — so without this the screen reports a healthy map that is not there.
   */
  useEffect(
    () =>
      onMapsAuthFailure(() => {
        setFailure('auth')
        setState('blocked')
      }),
    [],
  )

  const hidden = phone && !phoneOpen

  /**
   * WHETHER THE INFO BOX MAY LIVE ON THE PIN AT ALL — desktop only.
   *
   * On a phone the map is 320px tall, so a box anchored to a pin inside it would be a
   * 160px scrolling window holding five numbers and eleven links: technically the owner's
   * chosen presentation, actually unusable. There the building opens as the bottom sheet
   * instead (MAP-HOME-SPEC §7), which is the SAME <BuildingFacts> in a frame that has room
   * for it. `/` is told through `onDrawnChange`, so exactly one of the two renderings is
   * ever on screen — two boxes about one building is the disagreement this must not ship.
   */
  const infoOnPin = !phone

  /**
   * CONSTRUCT THE MAP. Once. The dependency list is deliberately tiny — a key, whether
   * there is anything to draw, whether the region is on screen, and the retry counter —
   * because every entry in it that can change on a refetch is a billed map load.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is read by nothing inside; it is the RETRY TRIGGER. "Karte erneut laden" bumps it and re-running this effect is the entire mechanism, so removing it would leave a button that does nothing.
  useEffect(() => {
    if (hidden) return
    if (MAPS_API_KEY === '') {
      setState('noKey')
      return
    }
    if (pinned.length === 0) {
      setState('noPins')
      return
    }
    if (mapRef.current !== null) return

    let cancelled = false
    setState('loading')
    setFailure(null)

    loadGoogleMaps()
      .then((api) => {
        const container = containerRef.current
        if (cancelled || container === null || mapRef.current !== null) return

        const map = new api.Map(container, {
          center: VIENNA_CENTRE,
          zoom: 12,
          // The theme the page is ALREADY in, not the OS preference: `<html data-theme>`
          // was set before first paint and may hold an explicit choice. Reading the OS here
          // would build a light map under a dark admin for anybody who picked „Dunkel" on a
          // light Mac — and the observer below would then correct it one frame later.
          styles: mapStyleFor(currentTheme()),
          // MANDATORY, and not only on a phone: one finger scrolls the PAGE and two fingers
          // pan the map. `greedy` traps the page scroll inside the map, which is the classic
          // way a map makes a phone page impossible to leave.
          gestureHandling: 'cooperative',
          disableDefaultUI: true,
          zoomControl: true,
          // Google's own POI pins are not ours and are not clickable content here.
          clickableIcons: false,
        })
        mapRef.current = map
        // A click on the MAP clears the selection — but our pins and the open info box are
        // portalled into Google's own float pane, so a press on the disclosure inside the
        // box arrives here too, and it used to close the box that held it. Asked of the
        // original DOM event rather than fenced off with `stopPropagation`, because the box
        // is React's and React listens at the root, above the map: a fence that keeps this
        // handler out also keeps React's own onClick out, and then nothing inside the box
        // works at all. (That is not a hypothesis. Both were tried, in this order.)
        map.addListener('click', () => {
          if (Date.now() - layerClickAt.current < LAYER_CLICK_WINDOW) return
          onSelect(null)
        })

        // ONE overlay for ALL pins: a projection lookup per frame instead of per pin, and
        // one React portal target instead of N.
        const overlay = new api.OverlayView()
        overlay.onAdd = () => {
          const panes = overlay.getPanes()
          if (panes === null) return
          const layer = document.createElement('div')
          layer.className = 'map-pin-layer'
          // Capture phase, and it changes nothing about the event: it only records that this
          // click belongs to our own controls, for the map handler above.
          layer.addEventListener(
            'click',
            () => {
              layerClickAt.current = Date.now()
            },
            true,
          )
          panes.floatPane.append(layer)
          setPane(layer)
        }
        overlay.draw = () => reposition()
        overlay.onRemove = () => setPane(null)
        overlay.setMap(map)
        overlayRef.current = overlay

        api.event.addListenerOnce(map, 'idle', () => {
          if (!cancelled) setState('ready')
        })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setFailure(failureOf(cause))
        setState('failed')
      })

    return () => {
      cancelled = true
    }
  }, [pinned.length, hidden, attempt, onSelect, reposition])

  /**
   * Fit to what is drawable — and ONLY when that set actually changes. `fitKey` is a string
   * of ids and coordinates, deliberately, so that a refresh returning the same buildings is
   * the same key. The list is read from the ref for the same reason: with `pinned` itself in
   * the dependencies this refit on every render, and it silently undid the pan that opens
   * an info box.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pinned` is read through `pinnedRef` on purpose — see above. `fitKey` is its value-identity and is the trigger that belongs here.
  useEffect(() => {
    const map = mapRef.current
    const list = pinnedRef.current
    if (map === null || state !== 'ready' || list.length === 0) return
    const only = list.length === 1 ? list[0] : undefined
    if (only !== undefined) {
      // `fitBounds` on one point zooms to the maximum and lands the director on a rooftop
      // with no street around it. Pull back to a block. Same guard `/analytics/` carried.
      map.setCenter({ lat: only.lat, lng: only.lng })
      map.setZoom(SINGLE_PIN_ZOOM)
      return
    }
    loadGoogleMaps().then((api) => {
      const bounds = new api.LatLngBounds()
      for (const building of list) bounds.extend({ lat: building.lat, lng: building.lng })
      map.fitBounds(bounds, FIT_PADDING)
    })
  }, [fitKey, state])

  /**
   * THEME. `setOptions`, never a remount — a remount is a billed map load per toggle, and
   * the ThemeSwitcher has three states somebody will click through.
   *
   * Watched on <html data-theme> rather than subscribed to the switcher, because the
   * attribute is also written by the inline pre-paint script and by the OS following
   * `prefers-color-scheme`. The attribute is the single truth; everything else sets it.
   */
  useEffect(() => {
    const apply = () => mapRef.current?.setOptions({ styles: mapStyleFor(currentTheme()) })
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  /**
   * Bring the selected pin into view. Without this, opening a building from the
   * `Objektliste` can expand an info box on a pin that is off the current extent, and the
   * screen appears to do nothing at all. `panTo`, not `setCenter` + `setZoom`: the reader
   * chose that zoom and a jump out of it loses the context they were reading.
   */
  useEffect(() => {
    if (selectedId === null || state !== 'ready') return
    // Through the ref, not the prop: `pinned` in the dependencies would pan the map on
    // every render, which fights the reader's own dragging.
    const target = pinnedRef.current.find((building) => building.id === selectedId)
    if (target === undefined) return
    mapRef.current?.panTo({ lat: target.lat, lng: target.lng })
    // ...then lift it above the centre, because the box hangs BELOW the pin and a centred
    // pin leaves it exactly half a map. Positive y moves the centre down, so the pin rises.
    const height = containerRef.current?.clientHeight ?? 0
    if (height > 0) mapRef.current?.panBy(0, Math.round(height * INFO_LIFT))
  }, [selectedId, state])

  /**
   * The open box changes height when the reader expands its links, and nothing else in this
   * component notices: the disclosure's state lives inside <BuildingFacts>, which is where
   * it belongs. Without this the clamp above would still be the one computed for the
   * COLLAPSED box, and the expanded one would hang off the bottom of the map — which is the
   * exact failure this round is fixing, one level down.
   *
   * No feedback loop: `reposition` writes a position and a max-height, and neither changes
   * the box's own content height.
   */
  useEffect(() => {
    if (selectedId === null || state !== 'ready') return
    const box = pinRefs.current.get(selectedId)?.querySelector('.map-info')
    if (box === undefined || box === null) return
    const observer = new ResizeObserver(() => reposition())
    observer.observe(box)
    return () => observer.disconnect()
  }, [selectedId, state, reposition])

  /** A pin added by a refetch has never been through `draw()`. Place it now. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reposition` reads `pinnedRef`, so biome cannot see that `pinned` and `selectedId` are what make it need re-running. They are triggers: a refetch that adds a building, or a selection that changes a pin's size, must move the labels or they sit at their old pixels until the next pan.
  useEffect(reposition, [reposition, pinned, selectedId])

  /** Tell `/` which rendering of `?location=` is the live one. */
  useEffect(() => {
    onDrawnChange(state === 'ready' && !hidden && infoOnPin)
    return () => onDrawnChange(false)
  }, [state, hidden, infoOnPin, onDrawnChange])

  /**
   * TEARDOWN on `blocked`. Not an overlay over Google's grey box — the box goes.
   * `setMap(null)` on the overlay first so the portal target disappears before its React
   * children are unmounted; then the container is removed from the tree by the render below.
   */
  useEffect(() => {
    if (state !== 'blocked') return
    overlayRef.current?.setMap(null)
    overlayRef.current = null
    mapRef.current = null
    setPane(null)
  }, [state])

  const retry = () => {
    mapRef.current = null
    overlayRef.current = null
    setPane(null)
    setAttempt((n) => n + 1)
  }

  const unpinned = buildings.length - pinned.length
  const labelled = pinned.length <= PIN_LABEL_MAX

  /** The state of the map, in words, ALWAYS — including when it worked. */
  const statusText =
    state === 'noKey'
      ? t('mapNoKey')
      : state === 'noPins'
        ? // ZERO BUILDINGS IS NOT „ZERO BUILDINGS WITHOUT COORDINATES". Reusing `mapNoPins`
          // for the empty database printed „0 Objekte haben keine Koordinaten, daher gibt es
          // nichts zu zeichnen" — a sentence that contradicts itself, and the one production
          // will print the day after the backfill runs on a portfolio of nothing. It is also
          // the first screen the new client sees next week.
          buildings.length === 0
          ? t('mapNoBuildings')
          : t('mapNoPins', { count: unpinned })
        : state === 'loading'
          ? t('mapLoading')
          : state === 'ready'
            ? t('mapReady', { pinned: pinned.length, unpinned })
            : state === 'blocked'
              ? t('mapBlocked')
              : failure === 'timeout'
                ? t('mapTimeout')
                : t('mapNetwork')

  // `noPins` renders NO region at all. An empty grey frame above a complete list is a
  // screen apologising for something that is not missing.
  const drawable = state === 'loading' || state === 'ready'

  return (
    <section className="map-region" aria-labelledby="map-region-heading">
      <div className="map-region-head">
        <h2 id="map-region-heading">{t('mapHeading')}</h2>
        {phone ? (
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={phoneOpen}
            aria-controls="map-region-body"
            onClick={() => setPhoneOpen((open) => !open)}
          >
            {phoneOpen ? t('mapHide') : t('mapShow')}
          </button>
        ) : null}
      </div>

      {/* The sentence that makes the list not-optional, permanently visible and never a
          tooltip. Inherited verbatim in intent from `/analytics/`'s noteMapEquivalent.

          ONE EXCEPTION, and it is the only place on a phone where this sentence is not
          drawn: the map COLLAPSED on a phone. It is still rendered, still a live region and
          still read out — `visually-hidden`, never removed — because both halves of it are
          already on the screen in words. „Karte ist eingeklappt" is the button 20px above it
          („Karte anzeigen", aria-expanded="false"); „die Liste unten führt jedes Objekt" is
          the Objektliste's own note 60px below it. Printing it here as well cost 87px of an
          844px phone before the first building name (TASK-179), and saying one true thing
          three times is the defect TASK-178 is fixing two panels away. Every OTHER state —
          noKey, noBuildings, noPins, blocked, failed, timeout, ready — stays visible at
          every width: they are things the reader cannot find out any other way. */}
      <p className={hidden ? 'note visually-hidden' : 'note'} role="status">
        {hidden ? t('mapCollapsed') : statusText}
      </p>

      <div id="map-region-body">
        {hidden ? null : (
          <>
            {state === 'failed' ? (
              <p className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={retry}>
                  {t('mapRetry')}
                </button>
              </p>
            ) : null}

            {/* Mounted whenever a map is possible, so the ref exists when the API resolves;
                `hidden` rather than unmounted while loading so `new Map()` never gets a
                zero-height box (which renders a grey strip that looks exactly like a broken
                map). On `blocked` it is UNMOUNTED — Google's grey box goes with it. */}
            {state === 'blocked' || state === 'noKey' || state === 'noPins' ? null : (
              <div
                ref={containerRef}
                className={phone ? 'map-canvas map-canvas-phone' : 'map-canvas'}
                hidden={!drawable}
              />
            )}

            {pane !== null &&
              createPortal(
                [...pinned]
                  // Ascending latitude, so the southern label is drawn FIRST and the
                  // northern anchor sits on top of it rather than under it.
                  .sort((a, b) => a.lat - b.lat)
                  .map((building) => (
                    <Pin
                      key={building.id}
                      building={building}
                      labelled={labelled}
                      expandable={infoOnPin}
                      selected={building.id === selectedId}
                      onSelect={onSelect}
                      renderFacts={renderFacts}
                      register={(element) => {
                        if (element === null) pinRefs.current.delete(building.id)
                        else pinRefs.current.set(building.id, element)
                      }}
                    />
                  )),
                pane,
              )}
          </>
        )}
      </div>
    </section>
  )
}

type PinProps = {
  building: BuildingSummary & { lat: number; lng: number }
  labelled: boolean
  /** False on a phone: the box opens as the bottom sheet instead. See `infoOnPin`. */
  expandable: boolean
  selected: boolean
  onSelect: (id: string | null) => void
  renderFacts: (id: string) => ReactNode
  register: (element: HTMLDivElement | null) => void
}

/**
 * ONE PIN, and its info box.
 *
 * STATE IS READABLE WITHOUT COLOUR, which is the owner's binding requirement and the test
 * is the shipped one: desaturate the screenshot and every state must still be legible.
 *
 *   ● {n} vor Ort   filled glyph + the count in 700   — somebody is in the building
 *   ○ 0 vor Ort     hollow glyph, everything in 400   — nobody is
 *   ▲ prüfen        a separate boxed chip with a WORD in it, own divider rule
 *   ▢ kein Tag      hatched left rule + a word
 *   ▢ ohne Zone     the same hatched treatment + a word
 *
 * The coloured 3px left rule is the SECOND signal, always. Occupancy and attention are
 * INDEPENDENT: a building can be fully staffed and still need looking at, and modelling
 * them as one traffic light makes the pin and the answer band disagree.
 *
 * GREY IS NEVER THE ONLY SIGNAL, and „ohne Zone" is where that rule earns its keep. The pin
 * of an unzoned building is drawn muted, and it also SAYS the word — desaturate the
 * screenshot and the state survives. It is a PRESENTATION state and it is drawn like one
 * (decision-43 §3): the building is active, its own card still clocks people in, and
 * nothing on this pin may read as an outage.
 *
 * At most TWO chips. Three states at once overflows the label, so the rest are dropped from
 * the pin and stated in the list row instead; priority is `prüfen` → `kein Tag` → `ohne
 * Zone`, i.e. a defect before an absence before a piece of unfinished setup.
 *
 * NO ANIMATION. Five pulsing labels over a moving map is noise, and `prefers-reduced-motion`
 * would have to remove the only signal.
 */
function Pin({
  building,
  labelled,
  expandable,
  selected,
  onSelect,
  renderFacts,
  register,
}: PinProps) {
  const t = useTranslations('home')
  const boxRef = useRef<HTMLElement>(null)
  const open = selected && expandable

  /**
   * The box's half of the overlay contract (see the file header): focus in, Escape out,
   * focus back on the opener. NOT a trap — Tab leaves, on purpose.
   *
   * The listener is on the document in the CAPTURE phase for the same reason
   * `lib/useOverlay.ts` puts it there: focus is usually still on the Objektliste button that
   * opened the box, which is nowhere near this subtree, and a control that swallows Escape
   * (a native `<select>` does) must not be able to disable the dismissal.
   */
  useEffect(() => {
    if (!open) return
    // ONLY when the box was opened from a control OUTSIDE the map — which is to say from the
    // Objektliste, which is the keyboard path. A mouse click on a pin leaves focus on the
    // pin's own label; moving it into the box and then to `#main-content` on close would
    // scroll a mouse user back to the top of the page for having closed a box.
    const opener = document.activeElement
    const fromPin = opener instanceof HTMLElement && opener.closest('.map-pin') !== null
    const restore = fromPin ? null : captureOpener()
    // The box itself, not its first link: landing on a link would read as though the reader
    // had already chosen one of the ten.
    if (!fromPin) boxRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onSelect(null)
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      restore?.()
    }
  }, [open, onSelect])

  const flags: ReactNode[] = []
  if (building.unresolved > 0) {
    flags.push(
      // The WORD, not the number: a pin has room for a state, and the count that goes with
      // it („2 Schichten nicht bestätigt") is in the list row and in the info box, where
      // there is room to say what it counts.
      <span key="check" className="map-pin-flag">
        {t('pinCheck')}
      </span>,
    )
  }
  if (flags.length < 2 && building.noTag) {
    flags.push(
      <span key="notag" className="map-pin-flag is-notag">
        {t('pinNoTag')}
      </span>,
    )
  }
  if (flags.length < 2 && building.zoneState === 'unzoned') {
    flags.push(
      <span key="nozone" className="map-pin-flag is-notag">
        {t('pinNoZone')}
      </span>,
    )
  }

  return (
    <div
      ref={register}
      className={selected ? 'map-pin is-selected' : 'map-pin'}
      data-state={building.occupancy}
      data-attention={building.attention ? 'yes' : 'no'}
      /* The GREY. A styling hook and nothing else — no route, no filter and no number reads
         it, so there is no path from this attribute back to whether a tap resolves. */
      data-zone={building.zoneState}
    >
      {/*
        aria-hidden + tabindex="-1": the Objektliste below carries this building, these
        numbers, these states in words and this same action, and it is the only set of tab
        stops (see the file header). Not an oversight — a stated ceiling.
      */}
      <button
        type="button"
        className="map-pin-label"
        aria-hidden="true"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(selected ? null : building.id)
        }}
      >
        <span className="map-pin-glyph" aria-hidden="true">
          {building.occupancy === 'occupied' ? '●' : '○'}
        </span>
        {labelled || selected ? <span className="map-pin-name">{building.short}</span> : null}
        <span className="map-pin-count">
          <b>{building.onSite}</b> {t('pinOnSite')}
        </span>
        {flags}
      </button>

      {/*
        THE INFO BOX ON THE PIN — the owner's chosen presentation (IA-PLAN §9): the numbers
        AND the cross-links, attached to the place rather than parked in a drawer somewhere
        else on the screen. Expandable and collapsible; exactly one is open at a time because
        the URL holds one `?location=`.

        NOT aria-hidden, unlike the label above it: it holds the real links out of this
        building, and a link no keyboard can reach is not a link.
      */}
      {open ? (
        // `tabIndex={-1}`: programmatically focusable so the box can be focused on open,
        // never a tab stop of its own.
        <section className="map-info" aria-label={building.name} ref={boxRef} tabIndex={-1}>
          {/* The heading and the close control sit OUTSIDE the scrolling area: a box whose
              own title scrolls away is a box that stops saying which building it is about,
              and that is the misreading this whole surface exists to prevent. */}
          <header className="map-info-head">
            <h3>{building.name}</h3>
            <button type="button" className="btn btn-quiet" onClick={() => onSelect(null)}>
              <span aria-hidden="true">✕</span>
              <span className="visually-hidden">{t('pinCollapse', { name: building.name })}</span>
            </button>
          </header>
          <div className="map-info-body">{renderFacts(building.id)}</div>
        </section>
      ) : null}
    </div>
  )
}
