/**
 * Google Maps, loaded with a script tag and NOTHING ELSE.
 *
 * No `@googlemaps/js-api-loader`, no `@react-google-maps/api`, no `@types/google.maps`.
 * The whole integration is one `<script>`, one `new Map`, one `new Marker` per building
 * and the four-line structural interface below — a dependency for that would be a
 * dependency to audit, pin (decision-9) and ship for no capability we do not already have.
 *
 * THE KEY IS PUBLIC AND MUST STAY HARMLESS. `NEXT_PUBLIC_*` is inlined into the bundle at
 * build time, so anyone who opens the panel can read it. That is normal for a Maps browser
 * key and is only safe because the key is restricted BY HTTP REFERRER in the Cloud Console
 * (currently `https://schimmer-glanz.exe.xyz/*`, `http://localhost:3000/*`,
 * `http://127.0.0.1:8080/*`). Never put the server-side geocoding key here: that one is
 * IP-restricted and would be usable by anybody the moment it reached a browser.
 *
 * EVERY FAILURE MODE ENDS ON A USABLE PAGE. No key, a blocked script, a referrer the key
 * does not allow, a key with the Maps JavaScript API disabled, a building with no
 * coordinates — each is a named state the screen renders in words, next to a table that
 * carries the same buildings and the same numbers. There is no path here that produces a
 * blank rectangle.
 */

/** Empty when the build had no key. Checked before anything else is attempted. */
export const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? ''

/** Stephansplatz, near enough. Only used as the fallback centre when a fit is impossible. */
export const VIENNA_CENTRE = { lat: 48.2082, lng: 16.3738 }

/**
 * How the map is doing, in the caller's words rather than Google's.
 *
 * `noKey` and `noPins` are NOT failures: a build without a key and a portfolio nobody has
 * geocoded yet are both ordinary states, and the screen says which one it is. They are
 * separated from `failed` precisely so the message can be actionable — "add the key to
 * the build" and "these three buildings have no coordinates" have different owners.
 */
export type MapStatus = 'noKey' | 'noPins' | 'loading' | 'ready' | 'blocked' | 'failed'

/** Why the script never produced a map. Rendered as a sentence, never swallowed. */
export type MapFailure = 'auth' | 'network' | 'timeout'

/* --- The four things we actually call ---------------------------------------------------
 *
 * A structural subset of the Maps API, hand-written because `@types/google.maps` is a
 * dependency and this is eleven lines. It describes only what is used below; anything
 * else is a compile error rather than a silent `any` (biome forbids `any` outright).
 */

export type LatLngLiteral = { lat: number; lng: number }

export type GBounds = { extend(point: LatLngLiteral): void; isEmpty(): boolean }

export type GMap = {
  fitBounds(bounds: GBounds, padding?: number): void
  setCenter(point: LatLngLiteral): void
  setZoom(zoom: number): void
  /** Theme switch. `setOptions`, NEVER a remount: a remount is a billed map load. */
  setOptions(options: Record<string, unknown>): void
  /** Bring a selected pin into view without changing the zoom the reader chose. */
  panTo(point: LatLngLiteral): void
  /** Nudge in PIXELS. Positive y moves the centre down, so the pin appears higher. */
  panBy(x: number, y: number): void
  /**
   * `event` carries the ORIGINAL DOM event on `domEvent`, and the caller needs it: our own
   * pins and the info box are portalled into Google's float pane, i.e. into the map's own
   * DOM, so a press on a control inside the box also reaches the map's click handler. The
   * handler has to be able to ask where the click came from. React cannot help here — it
   * listens at the root, ABOVE the map, so a synthetic `stopPropagation` runs after Google
   * has already been told.
   */
  addListener(event: string, handler: (event: { domEvent?: Event }) => void): void
}

export type GMarker = {
  addListener(event: string, handler: () => void): void
  setMap(map: GMap | null): void
}

/** Pixel offset from the overlay pane's origin. What `fromLatLngToDivPixel` answers. */
export type GPoint = { x: number; y: number }

export type GProjection = { fromLatLngToDivPixel(position: LatLngLiteral): GPoint | null }

/**
 * The classic overlay path. `OverlayView` is a CLASS we subclass by assignment — Google's
 * own documented pattern — so the three lifecycle hooks are declared writable here.
 */
export type GOverlayView = {
  onAdd: () => void
  draw: () => void
  onRemove: () => void
  getPanes(): { floatPane: HTMLElement; overlayMouseTarget: HTMLElement } | null
  getProjection(): GProjection | null
  setMap(map: GMap | null): void
}

export type GoogleMapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GMap
  Marker: new (options: Record<string, unknown>) => GMarker
  LatLngBounds: new () => GBounds
  OverlayView: new () => GOverlayView
  event: { addListenerOnce(target: unknown, event: string, handler: () => void): void }
}

/* --- The map is a BACKDROP, not the content ---------------------------------------------
 *
 * The owner's decision (IA-PLAN §9): a MUTED map in our palette, subordinate to our own
 * pins and boxes. So Google's tiles are pushed down to the two things they are actually for
 * — the shape of the streets and the name of the district — and everything that competes
 * with our own content is switched off.
 *
 * `labels.icon` is OFF and that is load-bearing, not taste: Google's motorway shields and
 * transit markers are BLUE, and blue is this design system's one accent (DESIGN.md §3.3).
 * Two blues on one screen and the accent stops meaning „ours".
 *
 * ponytail: TWO HAND-WRITTEN STYLE ARRAYS AND NO CLOUD `mapId`, chosen with the trade-off
 * open. `AdvancedMarkerElement` — the non-deprecated marker — REQUIRES a cloud-configured
 * `mapId`, and passing a `mapId` makes the API IGNORE an inline `styles` array outright. So
 * it is one or the other: either our dark map with the deprecated `OverlayView`, or a white
 * Google map with modern markers. A white map inside a dark admin is the single most
 * visible thing on the screen, and a cloud map style is console configuration that lives
 * outside this repo, cannot be reviewed in a diff and cannot be checked by
 * `ops/check-branding.mjs`. Taken: `OverlayView` + inline styles.
 * CEILING: `google.maps.Marker` and `OverlayView` are formally deprecated; Google has said
 * they will keep working, not that they will keep improving.
 * UPGRADE PATH, in order: create a cloud map style in the Cloud console, paste these arrays
 * into it, record the id in `ops/branding.json` (decision-24 — it is operator identity, not
 * a credential), pass `{ mapId }` here and swap the overlay for `AdvancedMarkerElement`.
 * Its `content:` is already an `HTMLElement`, so the pin markup in components/HomeMap.tsx
 * ports across unchanged.
 */
type MapStyle = readonly Record<string, unknown>[]

/** Matches the dark token set in globals.css `:root`. */
export const MAP_STYLE_DARK: MapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#101216' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#868c95' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0c0e' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#131519' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1b1e23' }] },
  // A STREET NAME IS TEXT, so it is scored as text: 4.5:1 on every geometry it can land on
  // (road 5.40, ground 6.06, highway 4.85, water 6.44). #6c7178 was 3.40 on its own road,
  // which is the graphic tier and the wrong tier — the same mistake --state-unres shipped
  // with. Muted is a property of the GEOMETRY, which is unchanged; illegible is not a
  // synonym for muted. Measured by demo/audit-map-contrast.mjs, which parses this array.
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8d939c' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#23272d' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#08090b' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#2a2e34' }],
  },
]

/**
 * Matches `[data-theme="light"]`. NOT Google's default light map: the default is saturated
 * enough that a white pin chip on it fails contrast, and `.map-pin` sits on `--bg-overlay`
 * (which is `#fff` in the light theme) so the tiles underneath have to stay quiet.
 */
export const MAP_STYLE_LIGHT: MapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#f1f2f4' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#686e75' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#fafafa' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#e8eaed' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  // Text tier, same as the dark array above: 6.17 on its own road, 5.50 on the ground, 4.88
  // on a highway, 4.78 over water. #7b8189 was 3.93 on white.
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#5c6269' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e2e5e9' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dfe3e8' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#cdd1d6' }],
  },
]

export function mapStyleFor(theme: 'dark' | 'light'): MapStyle {
  return theme === 'light' ? MAP_STYLE_LIGHT : MAP_STYLE_DARK
}

type MapsWindow = Window & {
  google?: { maps?: GoogleMapsApi }
  /** Google calls this itself when the key is rejected. Set BEFORE the script loads. */
  gm_authFailure?: () => void
  /** Our `callback=` target. `loading=async` warns in the console without one. */
  __nfcMapsReady?: () => void
}

const CALLBACK_NAME = '__nfcMapsReady'

/**
 * Google's own failure signal.
 *
 * It matters because an unauthorised key does NOT fail the script load: the file downloads,
 * `google.maps` appears, `new Map()` succeeds, and what renders is a grey box under a
 * "This page can't load Google Maps correctly" overlay. Without this hook the promise below
 * resolves and the screen reports a healthy map that is not there.
 *
 * It fires asynchronously, possibly long after the load resolved, so it cannot simply
 * reject the load promise — subscribers are notified instead, and late subscribers are
 * told immediately.
 */
let authFailed = false
const authListeners = new Set<() => void>()

export function onMapsAuthFailure(listener: () => void): () => void {
  if (authFailed) {
    listener()
    return () => undefined
  }
  authListeners.add(listener)
  return () => {
    authListeners.delete(listener)
  }
}

/**
 * Ten seconds. A `<script>` that is blocked by an extension, a corporate proxy or an
 * offline browser can hang without ever firing `error`, and a spinner that never resolves
 * is the one outcome this file is written to prevent.
 */
const LOAD_TIMEOUT_MS = 10_000

/** One load per document, shared by every caller. Rejections are not cached — see below. */
let pending: Promise<GoogleMapsApi> | null = null

/**
 * Loads the Maps JavaScript API, or rejects with a `MapFailure` in `Error.message`.
 *
 * A failed attempt clears `pending`, so a Retry button really retries rather than
 * re-serving the cached rejection of a network blip that has since healed.
 */
export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('network'))
  const win = window as MapsWindow

  const already = win.google?.maps
  if (already !== undefined) return Promise.resolve(already)
  if (pending !== null) return pending

  pending = new Promise<GoogleMapsApi>((resolve, reject) => {
    win.gm_authFailure = () => {
      authFailed = true
      for (const listener of authListeners) listener()
    }

    const timer = window.setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS)
    const settle = (run: () => void) => {
      window.clearTimeout(timer)
      run()
    }

    win[CALLBACK_NAME] = () => {
      const api = win.google?.maps
      settle(() => (api === undefined ? reject(new Error('failed')) : resolve(api)))
    }

    const script = document.createElement('script')
    // `loading=async` is Google's own recommendation and keeps the parser unblocked;
    // `v=weekly` pins the channel rather than a version we would then have to maintain.
    // Only the `maps` library is requested — `marker`, `places` and friends are billed
    // and unused, and `OverlayView` lives in `maps` (see the style block above for why the
    // pin is an overlay and not an AdvancedMarkerElement).
    //
    // `language` follows the admin's own locale so Google's street labels are not the one
    // English thing on a German screen; `region=AT` is FIXED, because it biases geocoding
    // and place names towards Austria and the business is Austrian whichever language the
    // director reads. Read from <html lang> rather than passed in: this loads once per
    // document and a parameter would imply it could be changed later, which it cannot.
    const language = document.documentElement.lang === 'en' ? 'en' : 'de'
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(MAPS_API_KEY)}` +
      `&v=weekly&loading=async&libraries=maps&language=${language}&region=AT` +
      `&callback=${CALLBACK_NAME}`
    script.async = true
    // Blocked by an ad blocker, offline, DNS failure, or a CSP that does not allow it.
    script.onerror = () => settle(() => reject(new Error('network')))
    document.head.append(script)
  }).catch((cause: unknown) => {
    pending = null
    throw cause
  })

  return pending
}

/** Maps an `Error.message` from `loadGoogleMaps` onto a state the screen has words for. */
export function failureOf(cause: unknown): MapFailure {
  const message = cause instanceof Error ? cause.message : ''
  return message === 'timeout' ? 'timeout' : message === 'network' ? 'network' : 'auth'
}

/**
 * A Street View photo of a building's entrance, or `null` — and `null` is the answer far
 * more often than it looks.
 *
 * THE RULE, and it is not negotiable: a photo is only ever requested when the Street View
 * METADATA endpoint has already said `OK` for that exact coordinate (server/lib/geocode.js
 * stores the answer in `locations.street_view_status`). The static IMAGE endpoint answers
 * HTTP 200 with a grey "Sorry, we have no imagery here" tile, so a plain `<img>` with an
 * `onError` handler ships that grey tile and presents it as a photograph of the client's
 * building. `return_error_code=true` additionally turns a late refusal into a real 404 so
 * `onError` can catch it as a second line of defence.
 *
 * KNOWN EXTERNAL BLOCKER, do not work around it: the Street View Static API is currently
 * NOT ENABLED on the operator's Google Cloud project, so the metadata probe answers
 * `REQUEST_DENIED` and this function correctly returns `null` for every building. The
 * screen states that reason. It starts working the day the owner ticks the box.
 */
export function streetViewUrl(building: {
  lat: number | null
  lng: number | null
  street_view_status: string | null
}): string | null {
  if (MAPS_API_KEY === '') return null
  if (building.street_view_status !== 'OK') return null
  if (building.lat === null || building.lng === null) return null
  const query = new URLSearchParams({
    size: '400x220',
    location: `${building.lat},${building.lng}`,
    fov: '80',
    pitch: '0',
    return_error_code: 'true',
    key: MAPS_API_KEY,
  })
  return `https://maps.googleapis.com/maps/api/streetview?${query.toString()}`
}

/**
 * Has this building a pin at all? The one place `lat`/`lng` are read as a pair, and a type
 * predicate so callers get the narrowed `{lat: number; lng: number}` instead of reaching
 * for a non-null assertion (which biome forbids, correctly: `lat!` on a NULL column is how
 * a marker ends up at 0,0 in the Gulf of Guinea).
 */
export function isPinned<T extends { lat: number | null; lng: number | null }>(
  building: T,
): building is T & LatLngLiteral {
  return building.lat !== null && building.lng !== null
}
