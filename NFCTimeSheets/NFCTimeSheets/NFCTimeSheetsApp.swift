//
//  NFCTimeSheetsApp.swift
//  NFCTimeSheets
//
//  Created by qwadratic on 14.07.26.
//

import SwiftUI
import SwiftData

// A shift = one work session at one location. Open while `endTime == nil`.
//
// decision-19: the shift is posted to the server at clock-IN (POST /shifts/open) and
// closed at clock-OUT (POST /shifts/close). This local row still exists so the app
// works with no signal and retries later - it is a queue, not the source of truth.
//
// `clientUuid` is the idempotency key for BOTH halves of the shift's life. A double tap
// at the door, or a retry after a dropped connection, must never produce two rows.
@Model
final class Shift {
    // originalName: kept so an existing install migrates instead of crashing at launch.
    // The fields that changed TYPE (worker name -> worker id, tag UID -> location UUID)
    // deliberately have no originalName: there is no honest mapping from a worker's name
    // to a server worker id, so old rows land with workerId 0 / locationId "" and fail
    // sync LOUDLY as blocked rows the worker can see, instead of silently vanishing.
    @Attribute(.unique, originalName: "id") var clientUuid: UUID = UUID()
    /// Who was signed in when this row was written. NOT sent to the server - the session
    /// cookie decides that (decision-22) - it is here so a row queued by one account is
    /// never pushed under another one's session. See pushOpen in Sync.swift.
    var workerId: Int = 0
    /// Worker name at the time of the tap. Display only.
    var workerName: String = ""
    /// Location UUID from the tag URI (decision-21). Lowercase, UUID-shaped.
    var locationId: String = ""
    @Attribute(originalName: "start") var startTime: Date = Date.now
    @Attribute(originalName: "end") var endTime: Date?   // nil = still running

    // The two decision-10 facts, mirrored from the server. `manualFinish` is gone: one
    // column could not tell "the 8h timer closed this" apart from "a human fixed it".
    var autoClosed: Bool = false
    var correctedAt: Date?

    var serverId: Int?         // set once /shifts/open has landed
    var openSyncedAt: Date?    // nil = the server has not been told this shift started
    var closeSyncedAt: Date?   // nil = the server has not been told it finished
    var syncError: String?     // last failure, shown in the UI. Never left nil on failure.
    var syncBlocked: Bool = false  // terminal rejection: stop retrying, a human must act

    init(workerId: Int, workerName: String, locationId: String, startTime: Date = .now) {
        self.workerId = workerId
        self.workerName = workerName
        self.locationId = locationId
        self.startTime = startTime
    }

    var isOpen: Bool { endTime == nil }
    var duration: TimeInterval? { endTime.map { $0.timeIntervalSince(startTime) } }
    var isFullySynced: Bool { openSyncedAt != nil && (isOpen || closeSyncedAt != nil) }
    /// Wire form of the idempotency key. Lowercased: the server lowercases UUIDs before
    /// storing them, so sending uppercase would only make log lines disagree.
    var clientUuidString: String { clientUuid.uuidString.lowercased() }
}

// Cached roster location. `locationId` is the UUID a tag carries; `slug` is for humans.
@Model
final class Site {
    @Attribute(.unique, originalName: "uid") var locationId: String = ""
    var slug: String = ""
    var name: String = ""
    init(locationId: String, slug: String, name: String) {
        self.locationId = locationId
        self.slug = slug
        self.name = name
    }
}

/// Where a tap arrives from, whichever way it came in: the in-app NDEF scan, or iOS
/// opening the universal link off the tag while the app was in the background.
///
/// Both paths can fire for a single physical tap, so identical taps inside a short
/// window collapse into one. Without this, one tap would clock in and straight back out.
@Observable
final class TapInbox {
    var pendingLocationId: String?
    private var last: (locationId: String, at: Date)?
    private let window: TimeInterval = 3

    func accept(_ locationId: String) {
        if let last, last.locationId == locationId, Date.now.timeIntervalSince(last.at) < window { return }
        last = (locationId, .now)
        pendingLocationId = locationId
    }

    func take() -> String? {
        defer { pendingLocationId = nil }
        return pendingLocationId
    }
}

@main
struct NFCTimeSheetsApp: App {
    @State private var inbox = TapInbox()
    // One Session for the life of the process. It owns the three states the whole UI
    // switches on (decision-22) and it is the only thing that talks to /auth/*.
    @State private var session = Session()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(inbox)
                .environment(session)
                // Cached worker first, server's verdict second. A worker deactivated in
                // the admin panel is signed out here, on their next launch.
                .task {
                    purgeLegacyIdentityDefaults()
                    await session.restore()
                }
                // Universal link off the tag: https://timesheets.exe.xyz/t?l=<uuid>.
                // Anything that is not a well-formed tag link is dropped on the floor -
                // the tag is unlocked and its contents are untrusted (decision-15).
                .onOpenURL { url in
                    if let id = TagLink.locationId(from: url) { inbox.accept(id) }
                }
        }
        .modelContainer(for: [Shift.self, Site.self])
    }
}
