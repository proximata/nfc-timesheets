import type { Locale } from '@/lib/locale'
import type en from '@/messages/en.json'

/**
 * next-intl type augmentation: makes `t('nav.shifts')` typecheck and `t('nav.shfits')` fail,
 * and narrows every `locale` prop to our two supported locales.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale
    Messages: typeof en
  }
}
