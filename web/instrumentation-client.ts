// The admin panel's entire Sentry integration (decision-70). Runs in the BROWSER, before
// the app hydrates — Next 16's root `instrumentation-client.ts` hook.
//
// WHY THIS IS THE ONLY FILE, and why there is no `sentry.client.config.ts`, no
// `instrumentation.ts`, no `withSentryConfig()` wrapper and no provider component:
// decision-16 makes this panel a STATIC EXPORT (`output: 'export'`) served by the Node API
// process. There is no server runtime here to instrument — no route handlers, no
// middleware, no `onRequestError`. Server-side errors are the API's own Sentry project
// (server/instrument.mjs). And `withSentryConfig` is a webpack plugin whose job is
// sourcemap UPLOAD, which this project deliberately does not do (see pnpm-workspace.yaml:
// `@sentry/cli` builds are off, no auth token, no new required CI secret for a
// diagnostic-only feature — the same call made for Android's gradle plugin). The build
// runs on Turbopack anyway, where that plugin does not apply.
//
// THE CONTRACT, same as the other three platforms: telemetry can never break the product.
// A blank DSN inits nothing at all, and the init itself cannot throw out of this module.
// The panel must render for someone doing payroll whether or not Sentry is reachable.

import * as Sentry from '@sentry/nextjs'
import { scrubBreadcrumb, scrubEvent, scrubLogAttributes } from '@/lib/scrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''

// Transactions worth a full trace: signing in, and anything shift- or worker-shaped. The
// rest of the panel is reporting screens that are merely slow, not load-bearing, so they
// ride at a fraction. Mirrors the server's tracesSampler split (server/instrument.mjs).
const FULLY_TRACED = /(login|auth|shift|worker|operator|payroll)/i

if (dsn) {
  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      // The commit this bundle was built from, so an event can be pinned to a tree.
      // next.config.mjs already derives it for the build id; this just exposes it.
      release: process.env.NEXT_PUBLIC_BUILD_ID || undefined,

      // Verbose on purpose for the pilot (decision-70).
      enableLogs: true,

      // Never let the SDK attach cookies, headers or the signed-in admin's identity.
      // lib/scrub.ts is the belt; this is the braces.
      sendDefaultPii: false,

      tracesSampler: ({ name, inheritOrSampleWith }) =>
        FULLY_TRACED.test(name ?? '') ? 1.0 : inheritOrSampleWith(0.2),

      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),
      beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
      beforeSendLog: (log) => {
        log.attributes = scrubLogAttributes(log.attributes)
        return log
      },
    })
  } catch {
    // A telemetry SDK that cannot start is not a reason the admin cannot approve payroll.
  }
}

// Next 16 calls this on every client-side route change; without it an App Router
// navigation is invisible and every error looks like it happened on the landing page.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
