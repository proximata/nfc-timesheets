//
//  FeatureFlags.swift
//  NFCTimeSheets
//
//  decision-57. A flag is a NAME and a BOOLEAN and nothing else: no percentage rollout,
//  no per-user targeting, no SDK. GET /flags (worker auth) answers {name: bool} for every
//  row; the phone fetches it on the same pass as the roster and caches the answer.
//
//  Foundation-only ON PURPOSE, like TagLink/ShiftSignal/Materials: checks/flags-check.swift
//  cat-s this file together with the check and runs it with plain `swift`.
//
//  THE DEFAULT IS OFF, and every layer defends that separately: an unknown name is false, a
//  server that has not shipped /flags yet leaves the cache untouched, and a cache that has
//  never been written reads false. OFF is bit-for-bit today's app, so a flag that never
//  arrives can never change what a worker sees.
//

import Foundation

enum FeatureFlags {
    /// The first (and so far only) flag: the playful running-shift theme (decision-57 §3).
    static let funShiftScreen = "fun_shift_screen"

    /// UserDefaults key for one flag. Namespaced so a flag can never collide with an
    /// existing preference key, and so `purgeLegacyIdentityDefaults`-style sweeps stay
    /// able to tell app state from server-delivered state.
    static func defaultsKey(_ name: String) -> String { "flag.\(name)" }

    /// The server's answer, reduced to what the app stores. Unknown -> absent -> false.
    ///
    /// Values the server may add later that are NOT booleans are dropped rather than
    /// coerced: a flag whose meaning we cannot read must not turn anything on.
    static func store(_ flags: [String: Bool], into defaults: UserDefaults = .standard) {
        for (name, enabled) in flags {
            defaults.set(enabled, forKey: defaultsKey(name))
        }
    }

    static func enabled(_ name: String, in defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: defaultsKey(name))     // absent == false
    }
}

/// The motion behind the fun theme, as arithmetic rather than as drawing code, so it can be
/// checked without a simulator (checks/flags-check.swift). The view in ShiftScreen.swift does
/// nothing but turn these two numbers into shapes.
///
/// ponytail CEILING (decision-57 §3): these are simple moving shapes, not illustrated
/// characters. UPGRADE PATH is swapping in real sprite/Lottie assets behind the SAME flag.
enum FunShiftAnimation {
    /// How many figures walk across the screen. Small on purpose: this is a background.
    static let figureCount = 4

    /// Horizontal position of one figure at time `t` seconds, in 0..<1 of the width.
    /// Each figure is offset by an equal share of the cycle so they never bunch up, and the
    /// walk WRAPS rather than bouncing, so there is no visible turn-around beat.
    static func walkPhase(figure: Int, at t: Double, cycle: Double = 14) -> Double {
        let stride = Double(figure) / Double(max(figureCount, 1))
        let raw = t / cycle + stride
        return raw - raw.rounded(.down)     // always 0..<1, including for negative t
    }

    /// The sweep/mop swing, -1...1, one full back-and-forth per `period` seconds. A figure's
    /// own phase offset keeps the crew from mopping in unison like a chorus line.
    static func sweepSwing(figure: Int, at t: Double, period: Double = 1.6) -> Double {
        sin((t / period + Double(figure) * 0.37) * 2 * Double.pi)
    }
}
