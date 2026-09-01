package io.github.qwadratic.nfctimesheets

import android.content.Context
import io.github.qwadratic.nfctimesheets.core.Scrub
import io.sentry.Breadcrumb
import io.sentry.SentryBaseEvent
import io.sentry.android.core.SentryAndroid

/**
 * The ONLY file in this app that touches `io.sentry.*` (decision-70, amends decision-23,
 * mirrors iOS's Telemetry.swift). Everything else must never import Sentry directly.
 *
 *   1. Sentry is added in build.gradle.kts as a plain dependency, no `canImport`-style
 *      guard needed the way iOS needs one for its hand-added Xcode package — a Gradle
 *      dependency is always on the classpath once declared, so this file compiles
 *      unconditionally.
 *   2. One file to audit for PII. If a value reaches Sentry it went through here, and
 *      everything that goes through here goes through [Scrub] first.
 *
 * FAIL SOFT IS THE CONTRACT. A blank DSN means [start] never calls `SentryAndroid.init` at
 * all — not "started disabled". No launch cost, no behaviour change. Nothing in this file
 * may throw: a clock-in must never fail because telemetry is unconfigured or unreachable.
 */
object Telemetry {

    fun start(context: Context, dsn: String) {
        if (dsn.isBlank()) return
        try {
            SentryAndroid.init(context) { options ->
                options.dsn = dsn
                options.environment = if (BuildConfig.DEBUG) "development" else "production"
                options.release = "${BuildConfig.APPLICATION_ID}@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"

                // Mirrors server/instrument.mjs and iOS's Telemetry.swift: the SDK's own PII
                // bundling is off, everything leaving this process goes through Scrub
                // first, and logging is verbose for the pilot (decision-70).
                options.isSendDefaultPii = false
                options.logs.isEnabled = true

                // Clock-in-shaped work stays fully sampled; everything else is lighter —
                // same reasoning as the server's tracesSampler: a cleaning crew makes tens
                // of taps a day, not thousands, so sampling one away is the exact failure
                // this feature exists to stop.
                options.tracesSampler = io.sentry.SentryOptions.TracesSamplerCallback { sampling ->
                    val name = sampling.transactionContext.name
                    if (SHIFT_SHAPED.any { name.contains(it, ignoreCase = true) }) 1.0 else 0.2
                }

                options.beforeSend =
                    io.sentry.SentryOptions.BeforeSendCallback { event, _ -> scrub(event); event }
                options.beforeSendTransaction =
                    io.sentry.SentryOptions.BeforeSendTransactionCallback { txn, _ -> scrub(txn); txn }
                options.beforeBreadcrumb =
                    io.sentry.SentryOptions.BeforeBreadcrumbCallback { breadcrumb, _ -> scrubBreadcrumb(breadcrumb); breadcrumb }
            }
        } catch (_: Throwable) {
            // Never let telemetry setup take the app down with it.
        }
    }

    private val SHIFT_SHAPED = listOf("shift", "auth", "verify", "tag", "roster")

    private fun scrub(event: SentryBaseEvent) {
        event.breadcrumbs?.forEach(::scrubBreadcrumb)
        event.request?.let { request ->
            request.url = request.url?.let(Scrub::url)
            request.queryString = null
            request.cookies = null
            request.data = null
            val headers = request.headers
            if (headers != null) {
                for (key in headers.keys.toList()) {
                    if (Scrub.isSensitiveKey(key)) headers[key] = Scrub.REDACTED
                }
            }
        }
        scrubMap(event.extras)
        val tags = event.tags
        if (tags != null) {
            for (key in tags.keys.toList()) {
                val v = tags[key]
                tags[key] = if (Scrub.isSensitiveKey(key)) Scrub.REDACTED else v?.let(Scrub::value)
            }
        }
    }

    private fun scrubBreadcrumb(breadcrumb: Breadcrumb) {
        breadcrumb.message = breadcrumb.message?.let(Scrub::value)
        val category = breadcrumb.category
        val data = breadcrumb.data
        if (category != null && (category.contains("http") || category.contains("url"))) {
            (data["url"] as? String)?.let { data["url"] = Scrub.url(it) }
        }
        scrubMap(data)
    }

    private fun scrubMap(map: MutableMap<String, Any?>?) {
        if (map == null) return
        for (key in map.keys.toList()) {
            if (Scrub.isSensitiveKey(key)) {
                map[key] = Scrub.REDACTED
            } else {
                (map[key] as? String)?.let { map[key] = Scrub.value(it) }
            }
        }
    }
}
