package io.github.qwadratic.nfctimesheets.core

/**
 * The PII boundary for telemetry (decision-70, amends decision-23). Pure Kotlin, no
 * `io.sentry` import — so this compiles and runs under android/checks on a plain JVM
 * whether or not the SDK is ever added to the classpath.
 *
 * MIRROR: server/lib/scrub.js and NFCTimeSheets/Scrub.swift carry the same two lists.
 * Keep them visually identical — when one grows, grow the others in the same commit.
 *
 * This exists because "remember not to log the token" is not a control. Errors,
 * breadcrumbs and log attributes go through these functions at the SDK boundary
 * (beforeSend / beforeBreadcrumb / beforeSendLog in Telemetry.kt), so a call site that
 * passes something careless is scrubbed by construction rather than by review. This is
 * EU/Austrian payroll data about named people; a leak here is a GDPR problem, not a bug.
 *
 * NOT MUTATION-TESTED to the same rigor as scrub-check.swift / the server's scrub tests
 * yet (decision-70 names this gap explicitly rather than hiding it) — upgrade path is a
 * checks/scrub-check.kt in the same shape the day Android telemetry carries a field the
 * other two platforms don't already cover.
 */
object Scrub {

    /**
     * Keys whose VALUE never leaves the phone, whatever it happens to hold today.
     * Case-insensitive, so `sessionToken`, `X-App-Key` and `Set-Cookie` all hit.
     */
    private val sensitiveKey = Regex(
        "token|cookie|passwd|password|hash|secret|identity|app[-_]?key|apple[-_]?sub|" +
            "nonce|e-?mail|hourly|rate_cents|authorization|credential|session",
        RegexOption.IGNORE_CASE,
    )

    /**
     * Value SHAPES that must not survive even under an innocent key — defence in depth.
     *   - 64 lowercase hex -> our session cookie value (server/lib/auth.js hashToken)
     *   - tsk_... -> BuildConfig.APP_KEY
     */
    private val sensitiveValue = Regex("\\b[0-9a-f]{64}\\b|\\btsk_[A-Za-z0-9]+\\b")

    const val REDACTED = "[redacted]"

    fun isSensitiveKey(key: String): Boolean = sensitiveKey.containsMatchIn(key)

    /** Redact anything token-shaped inside free text. Unchanged when there is nothing to redact. */
    fun value(text: String): String = sensitiveValue.replace(text, REDACTED)

    /** Path only, query dropped — this app's one non-empty query string carries no secret
     *  today, but a URL is exactly where a future one would first appear unnoticed. */
    fun url(raw: String): String {
        val q = raw.indexOf('?')
        return if (q >= 0) raw.substring(0, q) else raw
    }
}
