//
//  Branding.swift
//  NFCTimeSheets
//
//  Operator identity, in ONE place. A different company signing and shipping this app needs
//  their team id, their bundle id and their host, and a single mismatch between any of them
//  and the AASA file served from that host makes universal links fail SILENTLY - which in
//  this product means a worker standing at a door unable to clock in, with tags already glued
//  to walls. So every identity value the app reads at runtime is resolved here.
//
//  INERT BY DEFAULT, and that property is load-bearing. With nothing configured - no
//  Branding.xcconfig attached, no Info.plist substitution - every accessor returns the
//  literal this app ships with today, so an unconfigured build behaves EXACTLY as the
//  current TestFlight build does. checks/tag-link-check.swift pins that.
//
//  Configure by attaching NFCTimeSheets/Branding.xcconfig; see ops/REBRAND.md.
//  Pure Foundation on purpose, like TagLink.swift, so the runnable checks still compile
//  outside Xcode.
//

import Foundation

enum Branding {
    // MARK: - Shipping defaults
    //
    // These are the fallbacks, not merely examples. They must stay equal to ops/branding.json;
    // `node ops/check-branding.mjs` fails if they drift.

    static let defaultTagHost = "timesheets.exe.xyz"
    static let defaultBundleId = "io.github.qwadratic.NFCTimeSheets"

    // MARK: - Resolved values

    /// Universal-link host for the tag URI. Overridden by the `TSTagHost` Info.plist key,
    /// which Xcode fills from `TS_TAG_HOST` in Branding.xcconfig.
    ///
    /// This MUST equal the `applinks:` host in NFCTimeSheets.entitlements. The entitlement
    /// cannot read this value - it is evaluated by codesign, not by Swift - so the two are
    /// kept in step by ops/check-branding.mjs rather than by hope.
    static var tagHost: String { infoString("TSTagHost") ?? defaultTagHost }

    /// Apple audience for the identity token, i.e. what the SERVER checks `aud` against.
    /// Taken from the running bundle so it is automatically right under any signing identity;
    /// the literal is only reached outside an app bundle (the runnable checks).
    static var bundleId: String { Bundle.main.bundleIdentifier ?? defaultBundleId }

    // MARK: - Info.plist reader

    static func infoString(_ key: String) -> String? {
        normalize(Bundle.main.object(forInfoDictionaryKey: key) as? String)
    }

    /// `nil` for missing AND for empty AND for an unsubstituted `$(VAR)`.
    ///
    /// Empty matters more than missing: an UNDEFINED Xcode build setting expands to the
    /// EMPTY STRING, so a build with the xcconfig detached hands us `""` for every
    /// `$(TS_*)` key. Treating that as "configured" would point the app at `https://`
    /// and kill every request. Same pattern as Telemetry.swift's DSN guard.
    ///
    /// Split out as a pure function so checks/tag-link-check.swift can exercise the empty
    /// expansion directly - there is no way to fake an Info.plist from the swift interpreter,
    /// and this is the branch that decides whether an unconfigured build works.
    static func normalize(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        return trimmed
    }
}
