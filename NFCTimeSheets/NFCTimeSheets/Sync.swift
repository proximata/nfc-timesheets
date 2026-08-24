//
//  Sync.swift
//  NFCTimeSheets
//
//  The glue between the local SwiftData queue and the two-halves shift API
//  (decision-19). Everything here is @MainActor: the store is small (a handful of
//  workers, a few hundred rows a year) and a background context would buy nothing but
//  concurrency bugs.
//

import Foundation
import SwiftData

// MARK: - Roster

/// Drop what the picker era left behind: the self-chosen worker id/name, and the cached
/// list of every colleague's name. Nothing reads these any more (decision-22), but they
/// sit in the app's defaults plist - and in its backups - until something deletes them.
/// `session.appleUserId` joins the list for the same reason (decision-50): Sign in with
/// Apple is retired from this screen, and Auth.swift no longer writes or reads that key.
/// One upgrade does it; the keys are dead and will never be written again.
func purgeLegacyIdentityDefaults() {
    for key in ["workerId", "workerName", "rosterWorkersV2", "rosterWorkers", "session.appleUserId"] {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

/// GET /roster -> cache locations in SwiftData.
///
/// The worker list that used to be cached here fed the Settings picker, and the picker
/// is gone (decision-22): the app no longer needs to know who ELSE exists, only who the
/// server says the holder of this session is. Caching a staff list on every phone was a
/// small leak with no remaining purpose, so it is not cached at all.
@MainActor
func refreshRoster(context: ModelContext) async {
    guard let roster = try? await RosterAPI.fetch() else { return }

    let existing = (try? context.fetch(FetchDescriptor<Site>())) ?? []
    let wanted = Set(roster.locations.map(\.id))
    for location in roster.locations {
        if let site = existing.first(where: { $0.locationId == location.id }) {
            site.name = location.name
            site.slug = location.slug
        } else {
            context.insert(Site(locationId: location.id, slug: location.slug, name: location.name))
        }
    }
    // Locations that are gone (or, on the first launch after this version, the stale
    // hardware-UID rows the old build cached) drop out.
    for site in existing where !wanted.contains(site.locationId) { context.delete(site) }
    try? context.save()
}

// MARK: - Shift sync

/// Push every local shift the server has not acknowledged yet.
///
/// ponytail: called on tap, on pull-to-refresh and when the Log tab appears - there is
/// no background retry. CEILING: a shift taken with no signal sits on the phone until
/// the app is next opened. Fine for a crew that opens the app twice a day anyway.
/// UPGRADE PATH: BGAppRefreshTask, once someone actually gets bitten.
///
/// Order matters: oldest first, and for each shift OPEN before CLOSE. The server allows
/// one open shift per worker, so a newer open would 409 until the older one is closed.
///
/// `workerId` is the SESSION's worker, and rows belonging to anyone else are refused
/// rather than sent: the server now attributes a shift to whoever holds the cookie, so
/// posting worker A's queued row while worker B is signed in would file A's hours under
/// B's name. That is the exact hole decision-22 closes, re-opened from the client side.
@MainActor
func syncPending(context: ModelContext, workerId: Int) async {
    let all = (try? context.fetch(FetchDescriptor<Shift>(sortBy: [SortDescriptor<Shift>(\.startTime)]))) ?? []
    for shift in all where !shift.syncBlocked && !shift.isFullySynced {
        if shift.openSyncedAt == nil {
            guard await pushOpen(shift, as: workerId) else { continue }  // don't close what never opened
        }
        if let end = shift.endTime, shift.closeSyncedAt == nil {
            await pushClose(shift, end: end)
        }
    }
    try? context.save()
}

/// - Returns: true when the server now holds this shift as open.
@MainActor
private func pushOpen(_ shift: Shift, as workerId: Int) async -> Bool {
    guard TagLink.normalizedUUID(shift.locationId) != nil else {
        // A row from before this version, or a tag that never parsed. It can never be
        // posted, so say so once and stop retrying it forever.
        shift.syncBlocked = true
        shift.syncError = String(localized: "This shift is missing its location and can't be sent.")
        return false
    }
    guard shift.workerId == workerId else {
        // Queued by a different worker on this phone (or by a build old enough to have
        // no worker at all). The server would happily file it under whoever is signed in
        // now, so it is blocked LOUDLY instead - a wrong name on a payslip is worse than
        // a visible failure.
        shift.syncBlocked = true
        shift.syncError = String(localized: "This shift was logged by a different account and can't be sent.")
        return false
    }
    do {
        let envelope = try await ShiftAPI.open(clientUuid: shift.clientUuidString,
                                               locationId: shift.locationId,
                                               startTime: shift.startTime)
        apply(envelope.shift, to: shift)
        shift.openSyncedAt = .now
        shift.syncError = nil
        return true
    } catch let failure as APIFailure {
        record(failure, on: shift)
        return false
    } catch {
        shift.syncError = APIFailure(status: 0, code: "network").workerMessage
        return false
    }
}

@MainActor
private func pushClose(_ shift: Shift, end: Date) async {
    do {
        // Carry the local flag up. The server only ever raises auto_closed, never clears it,
        // so a plain tap-out cannot downgrade a shift the 8h timer already flagged.
        let envelope = try await ShiftAPI.close(clientUuid: shift.clientUuidString,
                                                endTime: end,
                                                autoClosed: shift.autoClosed)
        // The server's row wins. If the 8h timer got there first this comes back with
        // auto_closed = true and corrected_at = null, and the worker is routed to the
        // resolution sheet: closing does NOT silently resolve a timer-closed shift.
        apply(envelope.shift, to: shift)
        shift.closeSyncedAt = .now
        shift.syncError = nil
    } catch let failure as APIFailure {
        record(failure, on: shift)
    } catch {
        shift.syncError = APIFailure(status: 0, code: "network").workerMessage
    }
}

/// Copy the server's version of the row over the local one.
@MainActor
private func apply(_ wire: WireShift, to shift: Shift) {
    shift.serverId = wire.id
    shift.autoClosed = wire.autoClosed
    shift.correctedAt = wire.correctedAt
    if let end = wire.endTime { shift.endTime = end }
}

/// A failure ALWAYS leaves a message on the row. The old code caught 400s into a bare
/// `catch {}`, which left syncError nil, the row looking fine and the shift retrying for
/// ever - a data-loss bug wearing a clean UI.
@MainActor
private func record(_ failure: APIFailure, on shift: Shift) {
    shift.syncError = failure.workerMessage
    shift.syncBlocked = !failure.isRetryable
    // The one place every rejection passes through, so this is the one place it has to be
    // reported from. `ts.api.code` is the server's own error code, which is what makes a
    // failed clock-in diagnosable without reading this file.
    Telemetry.log("shift sync rejected", .error, [
        "ts.api.status": failure.status,
        "ts.api.code": failure.code,
        "ts.sync.blocked": !failure.isRetryable,
        "ts.shift.client_uuid": shift.clientUuidString,
        "ts.location.id": shift.locationId,
    ])
}

// MARK: - Server-authoritative reconciliation

/// Adopt an open shift the server knows about but this phone does not: app reinstalled,
/// second device, or a background tap that opened the shift before the store was written.
/// Without this the worker would tap out and get 404 unknown_shift for ever.
///
/// No worker argument: GET /shifts/open answers for the session's worker and nobody
/// else (decision-22), so the row that comes back is by construction ours.
@MainActor
func adoptServerOpenShift(context: ModelContext) async {
    guard let remote = try? await ShiftAPI.currentOpen() else { return }
    guard let key = remote.clientUuid.flatMap({ UUID(uuidString: $0) }) else { return }

    let known = (try? context.fetch(FetchDescriptor<Shift>())) ?? []
    if known.contains(where: { $0.clientUuid == key }) { return }

    let local = Shift(workerId: remote.workerId,
                      workerName: "",
                      locationId: remote.locationId,
                      startTime: remote.startTime)
    local.clientUuid = key
    local.serverId = remote.id
    local.openSyncedAt = .now
    local.autoClosed = remote.autoClosed
    local.correctedAt = remote.correctedAt
    context.insert(local)
    try? context.save()
}

/// Shifts the 8h timer closed that no human has fixed yet (decision-10), for the
/// session's worker.
func fetchUnresolved() async -> [WireShift] {
    (try? await ShiftAPI.unresolved()) ?? []
}

/// POST /shifts/:id/resolve, then mirror the result locally.
@MainActor
func resolveShift(context: ModelContext, shift: WireShift, end: Date) async -> String? {
    do {
        let updated = try await ShiftAPI.resolve(shiftId: shift.id, endTime: end)
        if let key = updated.clientUuid.flatMap({ UUID(uuidString: $0) }),
           let local = ((try? context.fetch(FetchDescriptor<Shift>())) ?? [])
               .first(where: { $0.clientUuid == key })
        {
            local.endTime = updated.endTime
            local.autoClosed = updated.autoClosed
            local.correctedAt = updated.correctedAt
            local.closeSyncedAt = .now
            local.syncError = nil
            local.syncBlocked = false
            try? context.save()
        }
        return nil
    } catch let failure as APIFailure {
        return failure.workerMessage
    } catch {
        return APIFailure(status: 0, code: "network").workerMessage
    }
}
