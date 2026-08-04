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

// TapInbox moved to TapInbox.swift - the cold-launch ordering it guarantees is the exact
// thing that lost the owner's first real tap, and it is now pinned by a runnable check.

@main
struct NFCTimeSheetsApp: App {
    @State private var inbox = TapInbox()
    // One Session for the life of the process. It owns the three states the whole UI
    // switches on (decision-22) and it is the only thing that talks to /auth/*.
    @State private var session = Session()

    /// Built here rather than by the `.modelContainer(for:)` modifier so the app owns a
    /// ModelContext before any view exists. SwiftData's own lightweight SCHEMA migration
    /// happens inside this initialiser; our DATA migration runs after it, below.
    private let container: ModelContainer

    init() {
        // First statement, before the container: a crash in schema or data migration is a
        // silent launch failure otherwise, and that is precisely the class of bug this
        // whole change exists to make visible. Costs nothing when no DSN is configured -
        // SentrySDK.start is then never called at all.
        Telemetry.start()
        do {
            container = try ModelContainer(for: Shift.self, Site.self)
        } catch {
            // Parity with the `.modelContainer(for:)` modifier this replaced, which also
            // fatalErrors on a store it cannot open. The difference is that the reason now
            // reaches Sentry before the process dies. No recovery path is invented here.
            Telemetry.capture(error)
            fatalError("SwiftData store could not be opened: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(inbox)
                .environment(session)
                // The badge, the reminder ladder and the Live Activity. One instance for
                // the life of the process, because the OS surfaces it drives are
                // process-wide. It is armed from exactly two places (LogView.handleTap
                // and LogView.refresh) and it can never block a tap - see the header of
                // ShiftSignalCenter.swift.
                .environment(ShiftSignalCenter.shared)
                // Cached worker first, server's verdict second. A worker deactivated in
                // the admin panel is signed out here, on their next launch.
                //
                // Data migrations run BEFORE session.restore() on purpose: until the
                // session resolves, ContentView renders a spinner and nothing else, so no
                // @Query is on screen and the worker never sees a flash of pre-migration
                // rows that are about to disappear.
                .task {
                    purgeLegacyIdentityDefaults()
                    await DataMigrations.runPending(context: container.mainContext)
                    await session.restore()
                }
                // Universal link off the tag: https://timesheets.exe.xyz/t?l=<uuid>.
                // Anything that is not a well-formed tag link is dropped on the floor -
                // the tag is unlocked and its contents are untrusted (decision-15).
                //
                // BOTH handlers are required, and wiring only the first is why the very
                // first real tap did nothing. iOS delivers a link two different ways:
                //   - onOpenURL              : tapping a link in Safari, Notes, Messages
                //   - onContinueUserActivity : BACKGROUND NFC TAG READS. Core NFC reads the
                //     tag with the app closed and hands the URL over as an NSUserActivity of
                //     type NSUserActivityTypeBrowsingWeb, which is a different entry point.
                // With only onOpenURL the app LAUNCHED from the tap - so it looked like it
                // worked - and then never learned which location was tapped. The server log
                // showed the launch refreshes (/auth/session, /roster, /shifts/open,
                // /shifts/unresolved) and no POST at all.
                //
                // Delivering the same tap twice is safe and expected: TapInbox collapses
                // identical taps inside a 3s window, which is exactly what it was built for.
                .onOpenURL { url in
                    if let id = TagLink.locationId(from: url) { inbox.accept(id) }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL,
                          let id = TagLink.locationId(from: url) else { return }
                    inbox.accept(id)
                }
        }
        .modelContainer(container)
    }
}
