//
//  Scrub.swift
//  NFCTimeSheets
//
//  The PII boundary for telemetry. Pure Foundation, no Sentry import, no #if - so it
//  compiles and runs under checks/scrub-check.swift whether or not the SDK is linked.
//
//  This exists because "remember not to log the token" is not a control. Errors,
//  breadcrumbs and logs go through these functions at the SDK boundary (beforeSend /
//  beforeBreadcrumb / beforeSendLog in Telemetry.swift), so a future call site that
//  passes something careless is scrubbed by construction rather than by review.
//
//  ONE THING IS NOT COVERED, AND IT IS NOT COVERED ON PURPOSE. `beforeSend` in
//  sentry-cocoa is for ERROR AND MESSAGE EVENTS ONLY - the installed skill says so
//  outright (sentry-cocoa-sdk/references/error-monitoring.md: "Events missing from
//  beforeSend for transactions | beforeSend is for error/message events only; use
//  beforeSendSpan for spans"). So SPAN data - including whatever the URLSession
//  instrumentation attaches to an http.client span - does not pass through here.
//
//  Why that is currently safe, and exactly how far the safety goes: every URL this app
//  builds is `apiURL(path, query:)` in API.swift, and there is exactly ONE call site that
//  passes a non-empty query - `ShiftAPI.mine(since:)`, whose only parameter is an ISO-8601
//  timestamp. No credential, address or rate is ever in a query string we emit, so there
//  is nothing in a span for the missing hook to leak. The server's `/portal/<token>` URLs
//  are never fetched by this app at all.
//  CEILING: the day someone adds a second query parameter, that guarantee is gone.
//  UPGRADE PATH: `options.beforeSendSpan` in Telemetry.start(), routing span data through
//  Scrub.attributes exactly as beforeSendLog already does. It is deliberately NOT written
//  today: the skill does not document its signature, sentry-cocoa is not linked yet, and
//  an API call that no compiler has ever seen is a build break waiting for the owner.
//  server/lib/scrub.js covers the equivalent server-side field (`http.query`) already -
//  that one WAS leaking, and there is a runnable check on it.
//
//  This is EU/Austrian payroll data about named people. A leak here is a GDPR problem,
//  not a bug. The denylist below is deliberately wider than the fields we send today.
//
//  MIRROR: server/lib/scrub.js carries the same two lists. Keep them visually identical -
//  when one grows, grow the other in the same commit.
//

import Foundation

enum Scrub {
    /// Keys whose VALUE never leaves the phone, whatever it happens to hold today.
    ///
    /// Covers, by name: Apple identity tokens and the raw nonce, the session cookie,
    /// X-App-Key, worker emails, scrypt hashes, portal grant tokens, hourly rates.
    /// `apple_sub` is in here because Apple's `sub` is a stable per-person identifier -
    /// it is PII even though it looks like an opaque string.
    private static let sensitiveKey = try! NSRegularExpression(
        pattern: "token|cookie|passwd|password|hash|secret|identity|app[-_]?key|apple[-_]?sub|nonce|e-?mail|hourly|rate_cents|authorization|credential|session",
        options: [.caseInsensitive])

    /// Value shapes that must not survive even under an innocent key. Defence in depth:
    /// a JWT under `"note"` is still an identity token.
    ///   - JWT (three base64url segments) -> Apple identity token
    ///   - 64 lowercase hex -> our session cookie value, and the raw sign-in nonce
    ///   - tsk_... -> API.appKey
    private static let sensitiveValue = try! NSRegularExpression(
        pattern: "(\\beyJ[A-Za-z0-9_-]{4,}\\.[A-Za-z0-9_-]{4,}\\.[A-Za-z0-9_-]{4,})|(\\b[0-9a-fA-F]{64}\\b)|(\\btsk_[A-Za-z0-9]+)",
        options: [])

    static let redacted = "[redacted]"

    static func isSensitiveKey(_ key: String) -> Bool { matches(sensitiveKey, key) }

    /// Redact anything token-shaped inside a free-text value. Returns the value
    /// unchanged when there is nothing to redact - most values are boring.
    static func value(_ text: String) -> String {
        guard matches(sensitiveValue, text) else { return text }
        return sensitiveValue.stringByReplacingMatches(
            in: text, options: [], range: NSRange(text.startIndex..., in: text), withTemplate: redacted)
    }

    /// Path-only, query dropped, portal grant tokens replaced.
    ///
    /// A query string is never worth keeping here: `/t?l=<uuid>` is the only one this app
    /// produces and the uuid is already a span attribute. Dropping the whole query means
    /// the day someone adds `?token=` to a URL there is nothing to get wrong.
    static func url(_ raw: String) -> String {
        guard let parts = URLComponents(string: raw) else { return redacted }
        var path = parts.path
        // /portal/<grant token>/... - the token IS the credential for that page.
        if let range = path.range(of: "/portal/") {
            let tail = path[range.upperBound...]
            let rest = tail.firstIndex(of: "/").map { String(tail[$0...]) } ?? ""
            path = "/portal/\(redacted)\(rest)"
        }
        let host = parts.host.map { "\($0)" } ?? ""
        return host.isEmpty ? path : "\(parts.scheme ?? "https")://\(host)\(path)"
    }

    /// The one entry point call sites use: drop sensitive keys entirely, redact
    /// token-shaped values, and route anything URL-ish through `url(_:)`.
    static func attributes(_ input: [String: Any]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (key, raw) in input {
            if isSensitiveKey(key) { continue }
            if let text = raw as? String {
                out[key] = key.lowercased().contains("url") ? url(text) : value(text)
            } else {
                out[key] = raw
            }
        }
        return out
    }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, options: [], range: NSRange(text.startIndex..., in: text)) != nil
    }
}
