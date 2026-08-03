// Runnable check: on-device migration ordering, idempotency, classification and the
// archive merge. No test framework, no Xcode.
//
//   cd NFCTimeSheets
//   cat NFCTimeSheets/Branding.swift NFCTimeSheets/TagLink.swift NFCTimeSheets/API.swift \
//       NFCTimeSheets/MigrationCore.swift \
//       checks/migration-check.swift > /tmp/migration-check.swift && swift /tmp/migration-check.swift
//
// (MigrationCore.swift is Foundation-only precisely so this is possible; the SwiftData
// half lives in DataMigrations.swift and is exercised on device.)
//
// These are timesheets. The properties below are the ones that stop a migration from
// losing somebody's hours, so they are asserted rather than reasoned about.

func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        exit(1)
    }
}

let uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"

// ============================ 1. the runner =========================================

struct FakeStep { let version: Int }
struct Killed: Error {}

/// Runs steps against a mutable log, exactly as DataMigrations does, and hands back what
/// ran plus the version that would be persisted.
@discardableResult
func drive(_ versions: [Int], applied: Int, failAt: Int? = nil,
           ran: inout [Int], stored: inout Int) -> Bool {
    do {
        try MigrationRunner.runPending(
            steps: versions.map(FakeStep.init),
            applied: applied,
            version: { $0.version },
            run: { step in
                if step.version == failAt { throw Killed() }
                ran.append(step.version)
            },
            advance: { stored = $0 })
        return true
    } catch {
        return false
    }
}

// Ordered, not a single `if`: a worker who skipped a version runs every step in between.
do {
    var ran: [Int] = []; var stored = 0
    // Deliberately out of order in the source array - the runner sorts, so a later
    // append to DataMigrations.all in the wrong place cannot reorder history.
    drive([3, 1, 2], applied: 0, ran: &ran, stored: &stored)
    check(ran == [1, 2, 3], "steps run in version order: \(ran)")
    check(stored == 3, "version advances to the last step")
}

// A worker who skipped one version runs only what they missed.
do {
    var ran: [Int] = []; var stored = 1
    drive([1, 2, 3], applied: 1, ran: &ran, stored: &stored)
    check(ran == [2, 3], "already-applied steps do not re-run: \(ran)")
}

// Idempotent: a second pass at the same version does nothing at all.
do {
    var ran: [Int] = []; var stored = 3
    drive([1, 2, 3], applied: 3, ran: &ran, stored: &stored)
    check(ran.isEmpty && stored == 3, "re-running a fully-migrated store is a no-op")
}

// A fresh install: same steps, and they simply match nothing. Not a special case.
do {
    var ran: [Int] = []; var stored = 0
    drive([1], applied: 0, ran: &ran, stored: &stored)
    check(ran == [1] && stored == 1, "fresh install runs the chain and advances")
}

// A throw stops the WHOLE chain, and the version stays where the last SUCCESS left it.
// This is what makes "killed mid-migration" safe: the failed step runs again next launch.
do {
    var ran: [Int] = []; var stored = 0
    let ok = drive([1, 2, 3], applied: 0, failAt: 2, ran: &ran, stored: &stored)
    check(!ok, "a failing step is reported, not swallowed")
    check(ran == [1], "steps after the failure do not run: \(ran)")
    check(stored == 1, "version stays at the last successful step, not \(stored)")

    // Next launch resumes from there and completes.
    var again: [Int] = []
    drive([1, 2, 3], applied: stored, ran: &again, stored: &stored)
    check(again == [2, 3] && stored == 3, "the retry resumes: \(again)")
}

// ============================ 2. the classifier =====================================

typealias B = LegacyBucket

// The four rows on the owner's live phone: no location, "0h 0m", pre-rewrite worker.
// Every one of them must be archivable and deletable, or the migration does not do the
// thing it was asked to do.
for seconds in [0.0, 1.0, 59.0] {
    check(LegacyClassifier.bucket(locationId: "", duration: seconds, workerId: 0) == B.archiveAndDelete,
          "locationless + \(seconds)s reads as 0h 0m on screen -> archive and delete")
}
check(LegacyClassifier.bucket(locationId: "hardware-uid-A1B2", duration: 0, workerId: 0) == B.archiveAndDelete,
      "a legacy hardware UID is not a location uuid")
check(LegacyClassifier.bucket(locationId: "", duration: nil, workerId: 0) == B.archiveAndDelete,
      "a locationless shift that never ended can never be closed usefully either")

// Hours with no building. Somebody worked. NEVER deleted - the row stays, visibly blocked.
check(LegacyClassifier.bucket(locationId: "", duration: 60, workerId: 0) == B.keepBlocked,
      "exactly one minute is hours: keep it")
check(LegacyClassifier.bucket(locationId: "", duration: 8 * 3600, workerId: 3) == B.keepBlocked,
      "a full shift with no building is kept and flagged for the admin")

// Real location, no worker id (pre-decision-22): ask the server, never assume the phone.
check(LegacyClassifier.bucket(locationId: uuid, duration: 3600, workerId: 0) == B.reconcile,
      "valid location + no worker -> reconcile against the server")
check(LegacyClassifier.bucket(locationId: uuid.uppercased(), duration: nil, workerId: 0) == B.reconcile,
      "uuid case does not decide a worker's hours")

// Healthy rows are not the migration's business. The sync engine already owns them,
// including ones that are blocked for unrelated reasons.
check(LegacyClassifier.bucket(locationId: uuid, duration: 3600, workerId: 7) == B.leaveAlone,
      "a normal completed row is untouched")
check(LegacyClassifier.bucket(locationId: uuid, duration: nil, workerId: 7) == B.leaveAlone,
      "a shift that is running RIGHT NOW is untouched")

// Total: every combination of the three inputs lands somewhere. Nothing falls through.
for location in ["", "garbage", uuid] {
    for duration in [nil, 0, 30, 60, 28_800] as [TimeInterval?] {
        for workerId in [0, 7] {
            _ = LegacyClassifier.bucket(locationId: location, duration: duration, workerId: workerId)
        }
    }
}

// ============================ 3. the archive merge ==================================

func frozen(_ key: String, _ day: Double) -> ArchivedShift {
    ArchivedShift(clientUuid: key, workerId: 0, workerName: "", locationId: "",
                  startTime: Date(timeIntervalSince1970: day * 86_400), endTime: nil,
                  autoClosed: false, correctedAt: nil, serverId: nil,
                  syncError: "This shift is missing its location and can't be sent.",
                  syncBlocked: true, disposition: "cleared")
}

let a = frozen("aaaa", 1), b = frozen("bbbb", 2), c = frozen("cccc", 3)

// The crash window that would otherwise destroy data: killed after the rows were deleted
// but before the version advanced, the step re-runs and sees NOTHING. Merging with an
// empty incoming set must LEAVE THE ARCHIVE ALONE, never overwrite it with [].
check(LegacyShiftArchive.merged(existing: [a, b], incoming: []).count == 2,
      "an empty re-run must not wipe the archive")

// Killed between archiving and deleting: the same rows come back. One copy, not two.
check(LegacyShiftArchive.merged(existing: [a, b], incoming: [a, b]).map(\.clientUuid).sorted()
        == ["aaaa", "bbbb"],
      "re-archiving the same rows is idempotent")

// A later migration adds to the archive rather than replacing it.
let grown = LegacyShiftArchive.merged(existing: [a, b], incoming: [c])
check(grown.count == 3, "new rows are added")
check(grown.map(\.clientUuid) == ["cccc", "bbbb", "aaaa"], "newest first: \(grown.map(\.clientUuid))")

// Existing wins: the archive is a record of how a row looked BEFORE anything touched it,
// so a re-run must not overwrite it with a version that has already been mutated.
let mutated = ArchivedShift(clientUuid: "aaaa", workerId: 99, workerName: "someone else",
                            locationId: uuid, startTime: .now, endTime: nil, autoClosed: false,
                            correctedAt: nil, serverId: 1, syncError: nil, syncBlocked: false,
                            disposition: "cleared")
check(LegacyShiftArchive.merged(existing: [a], incoming: [mutated]).first?.workerId == 0,
      "the first archived copy of a row wins for ever")

// It has to survive a round trip through the file format, or the archive is decoration.
let encoded = try! Wire.encoder.encode(
    LegacyShiftArchive(migrationVersion: 1, archivedAt: Date(timeIntervalSince1970: 0), shifts: [a, b]))
let decoded = try! Wire.decoder.decode(LegacyShiftArchive.self, from: encoded)
check(decoded.shifts.count == 2 && decoded.migrationVersion == 1, "archive round-trips")
check(decoded.shifts.first(where: { $0.clientUuid == "aaaa" })?.startTime == a.startTime,
      "timestamps round-trip - they are the only payroll fact these rows still carry")

print("migration-check: OK")
