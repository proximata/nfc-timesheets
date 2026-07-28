//
//  TagLink.swift
//  NFCTimeSheets
//
//  The NFC tag carries a universal link, never a hardware UID (decision-5):
//
//      https://timesheets.exe.xyz/t?l=<location uuid>
//
//  The identifier is a UUID and NOT the human-readable slug (decision-21): the slug is
//  guessable, and a guessable id on a tag lets anyone enumerate every building the
//  company cleans. The slug must never appear in a tag URI.
//
//  Pure Foundation on purpose - see checks/tag-link-check.swift for the runnable check.
//

import Foundation

enum TagLink {
    static let host = "timesheets.exe.xyz"
    static let path = "/t"

    /// Location UUID carried by a tag link, lowercased. `nil` = not one of our tags.
    static func locationId(from url: URL) -> String? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https",
              parts.host?.lowercased() == host
        else { return nil }

        // The server serves both /t and /t/ rather than redirecting (a redirect breaks
        // the universal-link handoff), so accept both here too.
        var p = parts.path
        if p.count > 1, p.hasSuffix("/") { p.removeLast() }
        guard p == path else { return nil }

        guard let raw = parts.queryItems?.first(where: { $0.name == "l" })?.value else { return nil }
        return normalizedUUID(raw)
    }

    /// Trust boundary. Tags are left UNLOCKED as migration insurance (decision-15), so
    /// anyone with a phone can rewrite one to carry whatever they like. Nothing that is
    /// not a well-formed UUID is ever put on the wire.
    static func normalizedUUID(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard UUID(uuidString: trimmed) != nil else { return nil }
        return trimmed.lowercased()
    }
}
