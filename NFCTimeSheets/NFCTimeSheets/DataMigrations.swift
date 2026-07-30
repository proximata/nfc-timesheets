//
//  DataMigrations.swift
//  NFCTimeSheets
//
//  On-device DATA migrations: the SwiftData half. The ordering rule, the classifier and
//  the archive format are pure logic and live in MigrationCore.swift, where a check can
//  reach them. Read the header there first - especially the schema-vs-data distinction.
//
//  WHY THE VERSION IS IN UserDefaults. It has to be readable before the ModelContainer
//  exists, so it cannot be a SwiftData model (a MigrationRecord entity is itself schema:
//  chicken, meet egg). It is not a secret, so not the Keychain. It survives an app kill,
//  rides along in device backups, and is one line to inspect and one line to reset in a
//  support call. UserDefaults already is a file; adding a second one buys nothing.
//
//  NOTHING IS DESTROYED WITHOUT BEING RECOVERABLE FIRST. These are timesheets. Every
//  destructive step is: write the archive -> verify it re-reads -> then delete -> then
//  save -> then advance the version. There is no window in that order that loses data,
//  and the worker is shown a receipt rather than watching four rows vanish overnight.
//

import Foundation
import SwiftData

// MARK: - Step shape

struct DataMigration {
    /// Strictly increasing. Never reused, never reordered, never renumbered.
    let version: Int
    let name: String
    /// MUST save before returning, and MUST be safe to run twice. See MigrationRunner.
    let run: (ModelContext, [String: WireShift]) throws -> MigrationOutcome
}

enum MigrationError: Error {
    /// A step needed the server's answer and did not get one. Deliberately fatal to the
    /// whole chain: a migration that silently degrades to "delete without checking" is
    /// the exact failure the reconciliation rules forbid.
    case serverUnreachable
    /// The archive could not be written, or could not be read back. Nothing is deleted.
    case archiveNotVerified
}

// MARK: - Runner

enum DataMigrations {
    static let appliedVersionKey = "ts.dataMigrationVersion"

    /// Ordered. Append only.
    static let all: [DataMigration] = [legacyShiftReconciliation]

    /// Run every pending step. Never throws out to the caller - a failed migration must
    /// not stop the app from opening, and the worker at the door does not care.
    ///
    /// Called from the same launch task that restores the session, BEFORE the tabs exist:
    /// while `session.state == .unknown` ContentView renders a spinner and nothing else,
    /// so no `@Query` can render a pre-migration row. That ordering is the whole reason
    /// this is not fired off in the background.
    ///
    /// ponytail: on a device that needs the server (a legacy row with a real location but
    /// no worker id) this adds one request to the launch spinner. CEILING: a dead network
    /// makes that spinner wait out URLSession's timeout, once, and then the app opens
    /// normally with the migration deferred. UPGRADE PATH: a shorter URLRequest timeout on
    /// that one call, if anyone is ever actually bitten.
    @MainActor
    @discardableResult
    static func runPending(context: ModelContext, defaults: UserDefaults = .standard) async -> [MigrationOutcome] {
        let applied = defaults.integer(forKey: appliedVersionKey)
        guard all.contains(where: { $0.version > applied }) else { return [] }

        let serverShifts: [String: WireShift]
        do {
            serverShifts = try await serverShiftsIfNeeded(context: context)
        } catch {
            Telemetry.log("data migration deferred", .warning, ["ts.migration.version": applied + 1])
            return []
        }

        var outcomes: [MigrationOutcome] = []
        do {
            try MigrationRunner.runPending(
                steps: all,
                applied: applied,
                version: { $0.version },
                run: { step in outcomes.append(try step.run(context, serverShifts)) },
                advance: { defaults.set($0, forKey: appliedVersionKey) })
        } catch {
            // Chain stopped. Version not advanced, store exactly as the last successful
            // save left it, app keeps running, retried on the next launch.
            Telemetry.capture(error)
            Telemetry.log("data migration failed", .error, ["ts.migration.version": applied + 1])
            return outcomes
        }

        for outcome in outcomes where outcome.touchedAnything {
            Telemetry.log("data migration applied", .info, [
                "ts.migration.version": outcome.version,
                "ts.migration.archived": outcome.archived,
                "ts.migration.deleted": outcome.deleted,
                "ts.migration.kept_blocked": outcome.keptBlocked,
                "ts.migration.reconciled": outcome.reconciled,
            ])
            MigrationReceipt.unseen = true
        }
        return outcomes
    }

    /// Ask the server for this worker's shifts ONLY when a row actually needs reconciling.
    ///
    /// Gating on the classifier rather than fetching unconditionally is what makes the
    /// common case - a locationless, hourless legacy row, which is all four of the rows on
    /// the owner's phone - migrate with no signal at all, and makes a fresh install a
    /// genuine no-op instead of a launch that waits on the network to do nothing.
    @MainActor
    private static func serverShiftsIfNeeded(context: ModelContext) async throws -> [String: WireShift] {
        let rows = (try? context.fetch(FetchDescriptor<Shift>())) ?? []
        let needed = rows.contains { shift in
            LegacyClassifier.bucket(locationId: shift.locationId,
                                    duration: shift.duration,
                                    workerId: shift.workerId) == .reconcile
        }
        guard needed else { return [:] }

        guard let oldest = rows.map(\.startTime).min() else { return [:] }
        do {
            let mine = try await ShiftAPI.mine(since: oldest.addingTimeInterval(-86_400))
            // client_uuid is the idempotency key on both halves of a shift's life
            // (decision-19), so it is the only honest way to ask "does the server already
            // hold this row?". Matching on timestamps would invent duplicates.
            return Dictionary(mine.compactMap { wire in wire.clientUuid.map { ($0.lowercased(), wire) } },
                              uniquingKeysWith: { first, _ in first })
        } catch {
            throw MigrationError.serverUnreachable
        }
    }
}

// MARK: - Version 1: legacy shift reconciliation

private let legacyBlockedMessage =
    "This shift is missing its location. Your admin has to enter it - it has not been lost."

extension DataMigrations {
    /// The one beta migration. Reconciles pre-rewrite rows against the server instead of
    /// blindly deleting them.
    ///
    /// Those rows exist because `workerId` and `locationId` deliberately got NO
    /// @Attribute(originalName:) mapping - there is no honest mapping from a worker's
    /// NAME to a server worker id, nor from a tag's hardware UID to a location UUID - so
    /// lightweight migration lands them as workerId 0 / locationId "" and the sync engine
    /// blocks them loudly. That was the correct design; this is the cleanup it implies.
    ///
    /// Idempotent: re-running re-archives the same rows (merged, existing wins), re-marks
    /// the same rows blocked with the same message, and finds nothing left to delete.
    static var legacyShiftReconciliation: DataMigration {
        DataMigration(version: 1, name: "legacy shift reconciliation") { context, serverShifts in
            var outcome = MigrationOutcome(version: 1, name: "legacy shift reconciliation")
            let rows = try context.fetch(FetchDescriptor<Shift>())

            var toArchive: [ArchivedShift] = []
            var toDelete: [Shift] = []
            var toBlock: [Shift] = []

            for shift in rows {
                switch LegacyClassifier.bucket(locationId: shift.locationId,
                                               duration: shift.duration,
                                               workerId: shift.workerId) {
                case .leaveAlone:
                    continue

                case .archiveAndDelete:
                    // No building and no hours. It was never postable (the server answers
                    // 422 unknown_location), so by construction the server does not hold
                    // it; it cannot be invoiced, cannot be paid, and cannot be corrected
                    // without inventing a building. Its only remaining function is to sit
                    // in History saying "can't be sent" for ever. Archived first, because
                    // "I am sure it was worthless" is not a thing to be sure about with
                    // somebody else's timesheet.
                    toArchive.append(frozen(shift, disposition: "cleared"))
                    toDelete.append(shift)

                case .keepBlocked:
                    // Hours with no building. Somebody worked. Fabricating a location is
                    // worse than none - but so is deleting the evidence that hours exist.
                    // The row stays, visibly blocked, and the receipt sends the worker to
                    // their admin, who can enter it by hand in the admin panel.
                    toArchive.append(frozen(shift, disposition: "needs your admin"))
                    toBlock.append(shift)

                case .reconcile:
                    if let wire = serverShifts[shift.clientUuidString] {
                        adopt(wire, into: shift)
                        outcome.reconciled += 1
                    } else {
                        // The server has never seen it and we cannot honestly say who
                        // worked it. Do NOT reassign workerId to whoever holds the phone
                        // now: same phone is a strong prior, not a fact, and this is
                        // payroll. Park it where a human decides.
                        toArchive.append(frozen(shift, disposition: "needs your admin"))
                        toBlock.append(shift)
                    }
                }
            }

            // ORDER IS THE SAFETY. archive -> verify -> mutate -> save. Killed anywhere in
            // here, the version has not advanced and the next launch redoes it.
            if !toArchive.isEmpty {
                try writeArchive(version: 1, adding: toArchive)
                outcome.archived = toArchive.count
            }

            for shift in toBlock {
                shift.syncBlocked = true
                shift.syncError = legacyBlockedMessage
            }
            outcome.keptBlocked = toBlock.count

            for shift in toDelete { context.delete(shift) }
            outcome.deleted = toDelete.count

            try context.save()   // durable BEFORE MigrationRunner advances the version
            return outcome
        }
    }

    private static func frozen(_ shift: Shift, disposition: String) -> ArchivedShift {
        ArchivedShift(clientUuid: shift.clientUuidString,
                      workerId: shift.workerId,
                      workerName: shift.workerName,
                      locationId: shift.locationId,
                      startTime: shift.startTime,
                      endTime: shift.endTime,
                      autoClosed: shift.autoClosed,
                      correctedAt: shift.correctedAt,
                      serverId: shift.serverId,
                      syncError: shift.syncError,
                      syncBlocked: shift.syncBlocked,
                      disposition: disposition)
    }

    /// The server's row wins, and the row is ADOPTED rather than re-posted: it already
    /// exists there under this client_uuid, so pushing it again would be a duplicate.
    private static func adopt(_ wire: WireShift, into shift: Shift) {
        shift.serverId = wire.id
        shift.workerId = wire.workerId          // from the SERVER, never from the session
        shift.autoClosed = wire.autoClosed
        shift.correctedAt = wire.correctedAt
        shift.openSyncedAt = .now
        if let end = wire.endTime {
            shift.endTime = end
            shift.closeSyncedAt = .now
        }
        shift.syncError = nil
        shift.syncBlocked = false
    }
}

// MARK: - The archive file

enum MigrationArchive {
    static func url(version: Int) throws -> URL {
        try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appending(path: "ts-migration-archive-v\(version).json")
    }

    /// nil = there is no archive for this version. An archive that EXISTS but cannot be
    /// read throws, and the caller must not overwrite it - see writeArchive.
    static func read(version: Int) throws -> LegacyShiftArchive? {
        let path = try url(version: version)
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }
        return try Wire.decoder.decode(LegacyShiftArchive.self, from: try Data(contentsOf: path))
    }
}

private func writeArchive(version: Int, adding incoming: [ArchivedShift]) throws {
    // If a file is there but unreadable (a locked device under complete file protection,
    // a truncated write) we must NOT continue: merging against "nothing" and writing that
    // back would replace the only copy of already-deleted rows with an empty list.
    let existing = try MigrationArchive.read(version: version)?.shifts ?? []

    let archive = LegacyShiftArchive(
        migrationVersion: version,
        archivedAt: .now,
        shifts: LegacyShiftArchive.merged(existing: existing, incoming: incoming))

    let path = try MigrationArchive.url(version: version)
    try Wire.encoder.encode(archive).write(to: path, options: [.atomic, .completeFileProtection])

    // Verify by RE-READING, not by trusting the write. Nothing has been deleted yet at
    // this point, so a failure here costs nothing but a retry next launch.
    guard let readBack = try MigrationArchive.read(version: version),
          Set(incoming.map(\.clientUuid)).isSubset(of: Set(readBack.shifts.map(\.clientUuid)))
    else { throw MigrationError.archiveNotVerified }
}

// MARK: - What the worker sees

enum MigrationReceipt {
    private static let unseenKey = "ts.migration.receiptUnseen"

    /// A one-time flag. The CONTENT is read from the archive file, never duplicated into
    /// defaults - one copy, one thing to keep true.
    static var unseen: Bool {
        get { UserDefaults.standard.bool(forKey: unseenKey) }
        set { UserDefaults.standard.set(newValue, forKey: unseenKey) }
    }

    /// Everything ever archived, newest first. Empty when there is nothing - which is the
    /// normal state for a worker who never had the old build.
    static func archived() -> [ArchivedShift] {
        DataMigrations.all
            .compactMap { try? MigrationArchive.read(version: $0.version) }
            .flatMap(\.shifts)
            .sorted { $0.startTime > $1.startTime }
    }
}
