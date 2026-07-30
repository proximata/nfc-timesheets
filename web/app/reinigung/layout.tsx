import type { Metadata } from 'next'
import { createTranslator } from 'next-intl'
import type { ReactNode } from 'react'
import { MESSAGES } from '@/lib/locale'
import { CLIENT_PORTAL_LOCALE } from '@/lib/portal'

/**
 * Metadata override for the ONE page a non-employee ever opens.
 *
 * The root layout's static title is "NFC TimeSheets Admin", and that string is baked into
 * every prerendered file. An outsider opening a shared link would therefore see somebody
 * else's ADMIN PANEL named in their browser tab, in their history and in the preview card a
 * messaging app builds from a pasted URL — before any JavaScript has run. The page corrects
 * the title once the building is known (`document.title` in page.tsx), but that is too late
 * for the tab, the history entry and the crawler.
 *
 * Pinned to German like the rest of this path (lib/portal.ts), not to the build-time default
 * locale: the reader never chose a language and has no switcher.
 *
 * `robots: noindex, nofollow` is inherited from the root layout and MUST stay that way — this
 * URL carries a credential in its fragment.
 */
const t = createTranslator({
  locale: CLIENT_PORTAL_LOCALE,
  messages: MESSAGES[CLIENT_PORTAL_LOCALE],
})

export const metadata: Metadata = {
  title: t('portal.heading'),
  // Deliberately says nothing about who cleans what: a description is quoted verbatim by
  // link-preview crawlers, so it must hold no building name and no client name.
  description: t('portal.note'),
}

export default function ClientPortalLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
