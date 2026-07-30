//
//  MigrationCore.swift
//  NFCTimeSheets
//
//  The parts of on-device migration that are pure logic: the ordering/idempotency rule,
//  the legacy-row classifier, and the archive format. Foundation only, no SwiftData, so
//  checks/migration-check.swift can run all of it outside Xcode. The SwiftData glue and
//  the actual steps live in DataMigrations.swift.
//
//  TWO VERSION NUMBERS. DO NOT CONFLATE THEM.
//
//    SwiftData SCHEMA migration   - model SHAPE changes (attributes, types, relations).
//                                   Run by SwiftData when the container opens. Today that
//                                   is implicit lightweight migration driven by
//                                   @Attribute(originalName:) on Shift.
//    Our DATA migration (here)    - row CONTENTS. Run by us, after the container opens.
//                                   Version lives in UserDefaults.
//
//  The runner below must never try to do schema work. The day a model change is NOT
//  lightweight-migratable, SwiftData needs a VersionedSchema + SchemaMigrationPlan passed
//  to ModelContainer(for:migrationPlan:) and that runs BEFORE this. Do not bolt a schema
//  change onto the data runner.
//

import Foundation

// MARK: - The runner

enum MigrationRunner {
    /// Run every step newer than `applied`, in version order, advancing after each one.
    ///
    /// THE CONTRACT, and why it is shaped like this:
    ///
    ///   - Ordered, not a single `if`. A worker who skipped a version runs 1..N in turn.
    ///     A worker who never installed the old version runs the same steps and they
    ///     match zero rows - a genuine no-op, not a special case.
    ///   - `run` MUST have made its changes durable (context.save()) before it returns.
    ///     The version is written AFTER, never before, so the only possible inconsistency
    ///     is "did the work, will do it again" - never "skipped the work".
    ///   - EVERY STEP MUST THEREFORE BE IDEMPOTENT. Killed mid-step, the version has not
    ///     moved and the step runs again on the next launch.
    ///   - A throw stops the WHOLE chain. Later steps do not run, the version does not
    ///     advance, and the store is exactly as the last successful save left it. The app
    ///     keeps running; the migration retries next launch.
    ///
    /// - Returns: the version now applied.
    @discardableResult
    static func runPending<Step>(
        steps: [Step],
        applied: Int,
        version: (Step) -> Int,
        run: (Step) throws -> Void,
        advance: (Int) -> Void
    ) rethrows -> Int {
        var current = applied
        for step in steps.sorted(by: { version($0) < version($1) }) {
            let next = version(step)
            guard next > current else { continue }
            try run(step)      // durable before the version moves
            advance(next)
            current = next
        }
        return current
    }
}

// MARK: - Classifying a legacy row

/// What to do with one pre-rewrite `Shift`.
///
/// Three signals decide it, and only three, because only three can be read honestly off
/// the row itself: is the location a real UUID, did anybody work measurable hours, and do
/// we know which worker. Nothing here guesses.
enum LegacyBucket: String {
    /// A normal row. The sync engine already handles it. Do not touch.
    case leaveAlone
    /// No location and no hours: unpostable and unpayable. Archive, then delete.
    case archiveAndDelete
    /// No location but real hours. Somebody worked. Archive, KEEP, and say so out loud.
    case keepBlocked
    /// Real location, but no worker id (pre-decision-22). Ask the server who holds it.
    case reconcile
}

enum LegacyClassifier {
    /// A locationless row shorter than this carries no payroll value.
    ///
    /// 60s is not a guess dressed up as a constant: `fmtDur` renders anything under a
    /// minute as "0h 0m", so this is exactly the set of rows the worker was already
    /// shown as zero. The classifier and the screen agree, which is the only threshold
    /// that can be explained to the person whose hours they are. Anything at or above a
    /// minute is hours, and hours are never deleted.
    static let worthlessDuration: TimeInterval = 60

    /// - Parameters:
    ///   - duration: nil = the shift is still open (no end time).
    ///
    /// Total by construction: every combination of the three inputs lands in exactly one
    /// case, so no row can fall through and quietly keep its old behaviour.
    static func bucket(locationId: String, duration: TimeInterval?, workerId: Int) -> LegacyBucket {
        guard TagLink.normalizedUUID(locationId) != nil else {
            // No building. It cannot be posted (the server answers 422 unknown_location),
            // so by construction the server does not hold it, and it cannot be corrected
            // without INVENTING a building. Never invent one - fabricated payroll data is
            // worse than none.
            if let duration, duration >= worthlessDuration { return .keepBlocked }
            return .archiveAndDelete
        }
        // Real location, but the row predates worker identity coming from the session.
        // Same phone is a strong prior, not a fact, so the server is asked rather than
        // assumed. See DataMigrations.swift.
        if workerId == 0 { return .reconcile }
        return .leaveAlone
    }
}

// MARK: - The archive

/// One shift, frozen exactly as it was before the migration touched it.
///
/// Every field of the model, deliberately - including the ones nothing reads today. The
/// point of an archive is that you did not have to be right about what mattered.
struct ArchivedShift: Codable, Identifiable, Hashable {
    var id: String { clientUuid }

    let clientUuid: String
    let workerId: Int
    let workerName: String
    let locationId: String
    let startTime: Date
    let endTime: Date?
    let autoClosed: Bool
    let correctedAt: Date?
    let serverId: Int?
    let syncError: String?
    let syncBlocked: Bool
    /// Which bucket sent it here, so the receipt can say what happened without guessing.
    let disposition: String
}

struct LegacyShiftArchive: Codable {
    let migrationVersion: Int
    let archivedAt: Date
    let shifts: [ArchivedShift]

    /// Union by `clientUuid`, EXISTING WINS.
    ///
    /// This is what makes re-running safe. A step killed between "archive written" and
    /// "rows deleted" re-runs and sees the same rows: merging keeps one copy. A step
    /// killed between "rows deleted" and "version advanced" re-runs and sees NO rows:
    /// merging with an empty incoming set leaves the archive intact instead of
    /// overwriting the only copy of the deleted rows with `[]`. A blind overwrite would
    /// destroy exactly the data this file exists to protect.
    static func merged(existing: [ArchivedShift], incoming: [ArchivedShift]) -> [ArchivedShift] {
        var byKey: [String: ArchivedShift] = [:]
        for shift in incoming { byKey[shift.clientUuid] = shift }
        for shift in existing { byKey[shift.clientUuid] = shift }   // existing wins
        return byKey.values.sorted { $0.startTime > $1.startTime }
    }
}

/// What one migration step did, for the log line and for the receipt the worker sees.
struct MigrationOutcome: Equatable {
    let version: Int
    let name: String
    var archived = 0
    var deleted = 0
    var keptBlocked = 0
    var reconciled = 0

    var touchedAnything: Bool { archived + deleted + keptBlocked + reconciled > 0 }
}
