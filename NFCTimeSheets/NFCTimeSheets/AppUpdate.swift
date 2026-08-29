//
//  AppUpdate.swift
//  NFCTimeSheets
//
//  decision-62: an app update invalidates CACHED SERVER READS on first launch - never the
//  pending write queue, never the session, never the SwiftData schema.
//
//  WHAT IS DROPPED: the roster snapshot (`Site` rows, refilled by refreshRoster) and the
//  operator worklist (`OperatorZoneCache`). Both are verbatim copies of a server answer
//  and are re-fetched by the exact calls pull-to-refresh already makes, so dropping them
//  costs one request and can lose nothing.
//
//  WHAT IS NEVER TOUCHED, and the reason this is not a "clear local data" button:
//  - `Shift` rows. An unsynced shift IS the work; it is a write queue, not a cache.
//  - the ts_worker / ts_operator cookies. A release must never sign anybody out.
//  - material requests (MaterialStore's own file) - also a queue of the worker's own words.
//  - the SwiftData store's schema. Lightweight migration keeps handling that, as before.
//
//  Foundation-only ON PURPOSE, like TagLink/FeatureFlags: checks/app-update-check.swift
//  cat-s this file together with the check and runs it with plain `swift`.
//

import Foundation

enum AppUpdate {
    /// Namespaced like FeatureFlags' keys, so a sweep can still tell app state from
    /// server-delivered state. A cache-generation marker, never a secret.
    static let defaultsKey = "app.lastBootBuild"

    /// Did the build number change since the last successful boot? Records the new one as
    /// a side effect, so a second call in the same process answers false.
    ///
    /// A FRESH INSTALL IS NOT AN UPDATE: with nothing stored there is nothing cached to
    /// invalidate either, so it returns false and only records. That keeps the very first
    /// launch on exactly one roster fetch.
    static func didChangeBuild(current: String, defaults: UserDefaults = .standard) -> Bool {
        let previous = defaults.string(forKey: defaultsKey)
        defaults.set(current, forKey: defaultsKey)
        guard let previous else { return false }
        return previous != current
    }

    /// The value decision-52's version line already displays: CFBundleVersion.
    static func currentBuild(bundle: Bundle = .main) -> String {
        bundle.infoDictionary?["CFBundleVersion"] as? String ?? "?"
    }
}
