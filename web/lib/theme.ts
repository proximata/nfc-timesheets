/**
 * Dark by brand decision, but the OS preference wins unless the director chose explicitly —
 * so the control has THREE states, never two. A two-state toggle silently lies to the person
 * who has never touched it: it shows "light" while the screen is dark because the OS is.
 *
 * Mechanics: `:root` in globals.css IS the dark set; `[data-theme="light"]` is the light one.
 * This module decides which attribute value goes on <html>.
 */

export const THEME_STORAGE_KEY = 'nfcts.theme'

export const THEME_SETTINGS = ['system', 'dark', 'light'] as const
export type ThemeSetting = (typeof THEME_SETTINGS)[number]

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === 'string' && (THEME_SETTINGS as readonly string[]).includes(value)
}

/**
 * If `prefers-color-scheme` cannot be asked, the answer is DARK — the brand default, and the
 * theme the whole token set is designed against.
 */
export function resolveTheme(setting: ThemeSetting): 'dark' | 'light' {
  if (setting !== 'system') return setting
  const media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null
  return media?.matches ? 'light' : 'dark'
}

export function readStoredTheme(): ThemeSetting {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeSetting(stored) ? stored : 'system'
  } catch {
    // Storage can be denied outright (private mode, a locked-down profile). A refused
    // preference is not an error worth showing anyone; it just means "System".
    return 'system'
  }
}

export function applyTheme(setting: ThemeSetting): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(setting))
}

export function storeTheme(setting: ThemeSetting): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, setting)
  } catch {
    // Same as above: the choice still applies to this tab, it just will not be remembered.
  }
}

/**
 * Runs BEFORE first paint, inlined in <head> by app/layout.tsx. Without it the static HTML
 * paints with the stylesheet's default and a light-theme user gets a full white flash on
 * every navigation — which on a dark UI reads as a fault, not as a preference.
 *
 * It is a hand-written string, not a bundled module, because a <script src> is another round
 * trip and would paint first. It duplicates `resolveTheme` in four lines; the two must agree,
 * and `node demo/check-foundation.mjs` asserts that they do by loading the page with a
 * stored preference and reading the attribute back.
 */
export const THEME_INIT_SCRIPT = `try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var l=s==="light"||(s!=="dark"&&typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.setAttribute("data-theme",l?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}`
