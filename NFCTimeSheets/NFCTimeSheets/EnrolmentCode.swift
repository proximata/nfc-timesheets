//
//  EnrolmentCode.swift
//  NFCTimeSheets
//
//  The enrolment code, as the phone sees it (decision-26, decision-45). A MIRROR of
//  server/lib/enrolment.js normaliseCode() and android/.../core/EnrolmentCode.kt, and it
//  must stay one. The server is authoritative — it normalises the string again before it
//  hashes it — so nothing here is a security control. What this buys is the two things
//  the server cannot do from Vienna:
//
//    1. It does not spend one of the operator's few rate-limited attempts on a string
//       that could not possibly be a code. The limiter is LOAD-BEARING on a 40-bit secret
//       (5 failures, then 30s doubling to 15 min), so a fat-fingered paste must not push
//       a tired operator into a lockout at a door.
//    2. It lets the button stay disabled until the input is plausibly a code, which is
//       the only feedback that may safely be given — see OperatorSession.signIn.
//
//  IT MUST NEVER BE MORE PERMISSIVE THAN THE SERVER. If it accepted something the server
//  rejects, the operator gets a lockout instead of an answer. If it normalised something
//  DIFFERENTLY, they would get "code not accepted" for a code that is correct.
//
//  Foundation-only on purpose, same discipline as TagLink.swift and MigrationCore.swift:
//  it must compile and be exercised outside Xcode by a runnable check.
//
//  THE ALPHABET is Crockford base32 — 0123456789ABCDEFGHJKMNPQRSTVWXYZ, no I, L, O, U.
//  The excluded letters are not merely absent, they are ALIASED on the way in: an
//  operator who hears "oh" and types O gets 0, and I or l gets 1. Case is folded and
//  anything that is not a letter or a digit is dropped, because people type the hyphen,
//  and spaces, and sometimes a non-breaking space out of a chat app.
//

import Foundation

enum EnrolmentCode {
    /// Canonical length. 32^8 = 2^40; the arithmetic is in server/lib/enrolment.js.
    static let length = 8

    /// Longest input worth looking at, matching the server's cap. Applied to the RAW
    /// string, before separators are stripped, exactly as the server does it.
    static let maxInput = 64

    private static let canonicalPattern = try! NSRegularExpression(pattern: "^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$")

    /// Whatever was typed -> the canonical 8-character code, or nil.
    ///
    /// nil is the only failure signal, and the caller must treat it exactly like a
    /// server rejection — no distinction between "too short" and "bad character",
    /// for the same reason the server collapses unknown / expired / already-used /
    /// revoked into one byte-identical 401 (decision-45): any distinction confirms
    /// something about a live code.
    ///
    /// `uppercased()` is Unicode-default-case, not locale-sensitive, matching JS
    /// `toUpperCase()` on the server — the Kotlin port calls out the same trap with
    /// Turkish `İ` and picks `uppercase()` for the same reason.
    static func normalise(_ input: String) -> String? {
        guard input.count <= maxInput else { return nil }
        var canonical = ""
        canonical.reserveCapacity(input.count)
        for ch in input.uppercased() {
            guard ch.isASCII, ch.isLetter || ch.isNumber else { continue }
            switch ch {
            case "O": canonical.append("0")
            case "I", "L": canonical.append("1")
            default: canonical.append(ch)
            }
        }
        let range = NSRange(canonical.startIndex..., in: canonical)
        return canonicalPattern.firstMatch(in: canonical, range: range) != nil ? canonical : nil
    }

    /// `K7QF-3MZ2`. Purely cosmetic — `normalise` strips the hyphen straight back off.
    static func grouped(_ code: String) -> String {
        guard code.count == length else { return code }
        let mid = code.index(code.startIndex, offsetBy: 4)
        return "\(code[..<mid])-\(code[mid...])"
    }
}
