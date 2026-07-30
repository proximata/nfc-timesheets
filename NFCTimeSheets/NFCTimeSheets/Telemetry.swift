//
//  Telemetry.swift
//  NFCTimeSheets
//
//  The ONLY file in this app that touches SentrySDK. Everything else calls `Telemetry`.
//
//  WHY THE INDIRECTION. Two reasons, both practical:
//    1. The Sentry package is added in Xcode by hand (see the click path at the bottom of
//       this file). Until that happens `canImport(Sentry)` is false, every function here
//       is a no-op, and the app compiles and behaves exactly as it does today. That is
//       what lets this ship before any Sentry account exists.
//    2. One file to audit for PII. If a value reaches Sentry it went through here, and
//       everything that goes through here goes through Scrub.swift first.
//
//  FAIL SOFT IS THE CONTRACT. With no DSN, `start()` never calls SentrySDK.start at all -
//  not "started disabled". No swizzling, no launch cost, no behaviour change. Nothing in
//  this file may throw, block, or change what the app does. A clock-in must never fail
//  because telemetry is unconfigured or unreachable.
//
//  WHY THE iOS HALF IS THE LOAD-BEARING HALF. The defect that shipped - a valid tag
//  refused on cold launch - produced ZERO server-side evidence, because zero requests
//  were made. A tap that never leaves the phone can only be seen from the phone. That is
//  what `beginTap` is for: an `nfc.tap` transaction with no http.client child is the
//  signature of "the app decided not to POST", and `ts.roster.cached_locations: 0` on the
//  accepted log is the single field that would have diagnosed it in five seconds.
//
//  NOT the record of truth. sentry-cocoa can lose buffered logs if the app is killed
//  before a flush. The SwiftData row and the Postgres row are the timesheet; this is
//  diagnosis.
//

import Foundation

#if canImport(Sentry)
import Sentry
#endif

enum TelemetryLevel { case info, warning, error }

enum Telemetry {
    /// Ties this process's app-start transaction to its `nfc.tap` transactions.
    ///
    /// They CANNOT be one trace. The physical tap, the NFC read and the universal-link
    /// resolution all happen with no SDK in the process, and an NDEF URI record carries a
    /// URL and nothing else - there is no header to propagate and no API to ask iOS how
    /// long the handoff took. So tap->launch latency is unmeasurable from in here and is
    /// deliberately NOT synthesised. Standalone app-start tracing gets its own trace_id;
    /// search this tag to see both halves side by side.
    static let launchId = UUID().uuidString

    private static let processStart = Date.now

    /// True when a tap arrived close enough to launch that the launch was almost
    /// certainly caused by it. Heuristic, and labelled as one.
    static func isColdLaunch(now: Date = .now) -> Bool {
        now.timeIntervalSince(processStart) < 3
    }

    // MARK: - Lifecycle

    /// Call FIRST in NFCTimeSheetsApp.init(), before the ModelContainer, so a crash in
    /// schema or data migration is reported rather than being a silent launch failure.
    @MainActor
    static func start() {
        #if canImport(Sentry)
        // The DSN is NOT a secret and is deliberately committed in Info.plist, reasoned
        // exactly like API.appKey: it is compiled into the binary, so `strings` on any
        // installed IPA recovers it, and hiding it from git would protect nothing while
        // it sits readable on every worker's phone. It is strictly WEAKER than the app
        // key - it grants no read and no write of company data. Worst case if extracted:
        // junk events burn Sentry quota, answered with inbound filters and rate limits.
        // Intentionally NOT in the psst vault, same reasoning as API.appKey: keeping it
        // there blocked every commit touching the file for no security gain.
        // CEILING: if quota abuse ever happens the fix is a new DSN and a new build, not
        // better hiding.
        let configured = Bundle.main.object(forInfoDictionaryKey: "SentryDSN") as? String ?? ""
        guard configured.hasPrefix("https://") else { return }  // unconfigured => never start

        SentrySDK.start { options in
            options.dsn = configured
            options.environment = "production"

            // PII. All three of these are `true` in the SDK's own quickstart and all
            // three are wrong here: these screens show named people's payroll.
            options.sendDefaultPii = false
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            options.debug = false

            // Tracing. A cleaning crew produces tens of taps a day; sampling a clock-in
            // away is the exact failure this whole exercise exists to stop.
            options.tracesSampleRate = 1.0

            // BOTH of these default to EVERY request, not "our host". Left at the
            // default, trace headers would ride along to any host URLSession touches and
            // any third-party 5xx would become our issue.
            options.tracePropagationTargets = [TagLink.host]
            options.failedRequestTargets = [TagLink.host]
            options.enableCaptureFailedRequests = true
            // strictTraceContinuation is deliberately NOT set. It governs continuing an
            // INCOMING trace, and this app receives none - it is where every trace
            // starts. Setting it here would only imply a symmetry with the server that
            // does not exist. The server's copy is off too, and server/instrument.mjs
            // explains why that one is load-bearing.

            options.enableLogs = true
            options.experimental.enableStandaloneAppStartTracing = true

            options.beforeSend = { event in scrub(event) }
            options.beforeBreadcrumb = { crumb in scrub(crumb) }
            options.beforeSendLog = { log in
                for key in log.attributes.keys where Scrub.isSensitiveKey(key) {
                    log.attributes.removeValue(forKey: key)
                }
                return log
            }
        }

        SentrySDK.configureScope { $0.setTag(value: launchId, key: "ts.launch_id") }
        #endif
    }

    /// Worker id and NOTHING else. No name, no email, no Apple `sub`.
    static func setWorker(id: Int) {
        #if canImport(Sentry)
        let user = User()
        user.userId = String(id)
        SentrySDK.setUser(user)
        #endif
    }

    static func clearWorker() {
        #if canImport(Sentry)
        SentrySDK.setUser(nil)
        #endif
    }

    // MARK: - Logs

    static func log(_ message: String, _ level: TelemetryLevel, _ attributes: [String: Any] = [:]) {
        #if canImport(Sentry)
        let safe = Scrub.attributes(attributes)
        switch level {
        case .info: SentrySDK.logger.info(message, attributes: safe)
        case .warning: SentrySDK.logger.warn(message, attributes: safe)
        case .error: SentrySDK.logger.error(message, attributes: safe)
        }
        #endif
    }

    static func capture(_ error: Error) {
        #if canImport(Sentry)
        SentrySDK.capture(error: error)
        #endif
    }

    // MARK: - The tap journey

    /// Start the `nfc.tap` transaction for ONE physical tap.
    ///
    /// Started here, in the handler, and NOT in `onOpenURL`: TapInbox collapses the two
    /// deliveries of a single physical tap into one, and starting the transaction before
    /// that dedupe would make every tap look like two.
    ///
    /// `bindToScope: true` is load-bearing, not decoration: URLSession spans only attach
    /// to a scope-bound transaction, and the whole point is seeing whether the POST
    /// happened at all.
    @MainActor
    static func beginTap(locationId: String, cachedLocations: Int) -> TapTrace {
        #if canImport(Sentry)
        let span = SentrySDK.startTransaction(name: "nfc.tap", operation: "nfc.tap", bindToScope: true)
        span.setTag(value: launchId, key: "ts.launch_id")
        span.setData(value: isColdLaunch(), key: "ts.cold_launch")
        span.setData(value: locationId, key: "ts.location.id")
        span.setData(value: cachedLocations, key: "ts.roster.cached_locations")
        return TapTrace(span: span)
        #else
        return TapTrace(span: nil)
        #endif
    }
}

/// One tap's transaction. A no-op shell when the SDK is not linked.
///
/// Deliberately holds the span as `AnyObject?` so the type surface is declared exactly
/// once instead of twice behind `#if`.
final class TapTrace {
    private let span: AnyObject?

    init(span: AnyObject?) { self.span = span }

    /// A named step inside the tap. Returns a token whose only job is `finish()`.
    func child(_ operation: String, _ description: String) -> TapTrace {
        #if canImport(Sentry)
        if let parent = span as? any Span {
            return TapTrace(span: parent.startChild(operation: operation, description: description))
        }
        #endif
        return TapTrace(span: nil)
    }

    func data(_ key: String, _ value: Any) {
        #if canImport(Sentry)
        (span as? any Span)?.setData(value: value, key: key)
        #endif
    }

    func finish(ok: Bool = true) {
        #if canImport(Sentry)
        (span as? any Span)?.finish(status: ok ? .ok : .internalError)
        #endif
    }
}

#if canImport(Sentry)
// MARK: - Scrubbing at the SDK boundary

/// Everything the SDK collects on its own - request context, breadcrumbs, user - passes
/// through here. Field-by-field, not best-effort: `sendDefaultPii = false` already blocks
/// most of this, and this is the belt to that pair of braces.
private func scrub(_ event: Event) -> Event {
    event.request?.cookies = nil
    event.request?.headers = nil
    event.request?.data = nil
    if let url = event.request?.url { event.request?.url = Scrub.url(url) }
    event.user?.email = nil
    event.user?.username = nil
    event.user?.ipAddress = nil
    event.user?.data = nil
    if let extra = event.extra { event.extra = Scrub.attributes(extra) }
    event.breadcrumbs = event.breadcrumbs?.compactMap(scrub)
    return event
}

private func scrub(_ crumb: Breadcrumb) -> Breadcrumb? {
    guard var data = crumb.data else { return crumb }
    if let url = data["url"] as? String { data["url"] = Scrub.url(url) }
    crumb.data = Scrub.attributes(data)
    return crumb
}
#endif

// MARK: - Adding the package (OWNER ACTION, in Xcode)
//
// project.pbxproj is hand-edited by the owner, so no agent adds this. Until it is done
// the whole file above compiles to nothing and the app is unchanged. Exact clicks:
//
//   1. Open NFCTimeSheets/NFCTimeSheets.xcodeproj
//   2. File -> Add Package Dependencies...
//   3. Paste into the search field top-right:  https://github.com/getsentry/sentry-cocoa.git
//      then press Return.
//   4. Dependency Rule: "Up to Next Major Version", lower bound 9.15.0.
//      (9.15.0 is the floor for `experimental.enableStandaloneAppStartTracing`.)
//   5. Add to Project: NFCTimeSheets. Click "Add Package".
//   6. In "Choose Package Products", set EXACTLY ONE product to target NFCTimeSheets:
//        Sentry                        -> NFCTimeSheets
//        Sentry-Dynamic                -> None
//        SentrySwiftUI                 -> None   (deprecated; SwiftUI APIs are in Sentry)
//        Sentry-WithoutUIKitOrAppKit   -> None
//        SentrySPM / SentryObjC        -> None
//      Xcode lets you tick several. Ticking several breaks the build.
//      Click "Add Package".
//   7. Verify: target NFCTimeSheets -> General -> Frameworks, Libraries, and Embedded
//      Content lists "Sentry".
//   8. Commit BOTH project.pbxproj AND
//      NFCTimeSheets.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
//      (xcuserdata/ is gitignored, xcshareddata/ is not). Package.resolved is what pins
//      the exact build; do not hand-write it.
//   9. Paste the iOS project's DSN into the SentryDSN key in Info.plist.
//
// Do NOT run `sentry-wizard -i ios`: it also installs a dSYM upload build phase that
// needs a SENTRY_AUTH_TOKEN nobody has created, and edits project.pbxproj unattended.
// CONSEQUENCE of skipping dSYM upload: iOS stack traces stay unsymbolicated. Logs, spans
// and the tap journey below are unaffected - they are what this is for.
