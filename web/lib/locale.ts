import de from '@/messages/de.json'
import en from '@/messages/en.json'

/**
 * Locale wiring for next-intl (decision-17, decision-8).
 *
 * This bundle is `output: 'export'` (decision-16): no server runtime, no middleware, no
 * request-scoped config, no locale-segmented routes. So next-intl is used in its
 * "without i18n routing" shape — messages are imported at build time and handed to
 * `NextIntlClientProvider` on the client (see components/IntlProvider.tsx).
 */

export const LOCALES = ['en', 'de'] as const
export type Locale = (typeof LOCALES)[number]

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * The one place the active default locale is decided. Baked in at build time
 * (`NEXT_PUBLIC_DEFAULT_LOCALE`), overridable per browser session via `IntlProvider`.
 * MVP ships English (decision-17); flipping the eventual German default is this env var.
 */
const configuredLocale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE
export const DEFAULT_LOCALE: Locale = isLocale(configuredLocale) ? configuredLocale : 'en'

/**
 * Both dictionaries ship in the bundle. Two locales of flat-ish JSON is a few KB; lazy
 * loading them would need a suspense boundary around every screen for no measurable win.
 * `de` is typed as `typeof en`, so a key missing from de.json fails `pnpm typecheck`;
 * `pnpm check` additionally catches *extra* keys, which the type system permits.
 */
export const MESSAGES: Record<Locale, typeof en> = { en, de }

/** `lang` / `hreflang` attribute value for a locale. Keep BCP-47 mapping here only. */
export function htmlLang(locale: Locale): string {
  return locale === 'de' ? 'de-AT' : 'en'
}

/** Message-key unions for data that names a message instead of holding one. */
export type NavKey = keyof typeof en.nav
export type ErrorKey = keyof typeof en.error
