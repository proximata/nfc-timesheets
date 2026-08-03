//
//  MaterialStore.swift
//  NFCTimeSheets
//
//  The observable half of material requests: disk, network and the one flag the tab
//  badge reads. Every DECISION it makes lives in Materials.swift as a pure function and
//  is pinned by checks/materials-check.swift; this file is the plumbing around them.
//
//  IT MUST NEVER BE ABLE TO BLOCK A CLOCK-IN. Nothing here is awaited from LogView, from
//  handleTap, from syncPending or from the launch path. It is started by the Materials
//  tab's own task, it swallows every failure into a message on a row, and if the whole
//  feature is missing on the server the app carries on clocking people in.
//
//  ponytail: @MainActor, including the file read and write. CEILING: a several-hundred
//  kilobyte queue would stutter the UI. The file holds at most a few hundred short rows
//  and the shift sync is @MainActor for the same reason (Sync.swift). UPGRADE PATH: move
//  MaterialQueueFile behind an actor - it is already a free function over a URL.
//

import Foundation
import Observation

@MainActor
@Observable
final class MaterialStore {
    /// Everything on disk, as last read or written. The screen renders this and nothing
    /// else, so what is on screen is what would survive a kill.
    private(set) var cache = MaterialCache.empty

    /// The server does not have these routes: an old build talking to a new server, or a
    /// new build talking to a server that has not been deployed yet. NOT an error - the
    /// rows stay queued and go out when the deploy lands. See `push`.
    private(set) var featureUnavailable = false

    /// Set when the queue file could not be read. The bytes were kept (see
    /// MaterialQueueFile.load); this is here so the worker is told rather than quietly
    /// shown an empty list.
    private(set) var cacheWasCorrupt = false

    /// A pass is in flight. Two overlapping passes could post the same queued row twice.
    private var running = false

    /// `start` has read the file. NOTHING may write before this is true: `persist()`
    /// would otherwise flush the empty in-memory cache over a disk file that still holds
    /// queued requests, which is the feature deleting its own reason to exist. The tab's
    /// own task and the launch task race by construction, so this is not theoretical.
    private var started = false

    private let url: URL?

    /// - Parameter url: injectable for checks and previews. nil means "no queue file was
    ///   reachable at all", which is survivable: requests are still posted, they are just
    ///   not durable. That is strictly better than refusing to take the request.
    init(url: URL? = try? MaterialQueueFile.defaultURL()) {
        self.url = url
    }

    // MARK: - Lifecycle

    /// Called when the Materials tab appears, keyed on the worker.
    ///
    /// Load, adopt (a different worker gets an empty cache - see MaterialCache.adopted),
    /// then push anything queued and pull the current state. Both halves are best effort.
    func start(workerId: Int) async {
        if let url {
            switch MaterialQueueFile.load(from: url) {
            case .fresh:
                cache = MaterialCache(workerId: workerId)
            case .loaded(let loaded):
                cache = loaded.adopted(by: workerId)
            case .corrupt(let movedTo):
                cacheWasCorrupt = true
                cache = MaterialCache(workerId: workerId)
                Telemetry.log("material queue file unreadable", .error, [
                    "ts.materials.quarantined": movedTo != nil,
                ])
            }
        } else {
            cache = cache.adopted(by: workerId)
        }
        started = true
        persist()
        await sync(workerId: workerId)
    }

    /// Push then pull. Pull second so an arrival that landed while we were pushing is
    /// visible on the same refresh.
    func sync(workerId: Int) async {
        guard started, !running else { return }
        running = true
        defer { running = false }
        await push(workerId: workerId)
        await pull()
    }

    // MARK: - Writing

    /// The worker asked for something.
    ///
    /// The row is written to disk FIRST and pushed afterwards, exactly like a shift: a
    /// request typed in a basement has to survive. Returns false only when there was
    /// nothing to ask for (empty, or past the server's own length cap), which the screen
    /// prevents anyway.
    @discardableResult
    func submit(body typed: String, locationId: String?, workerId: Int) -> Bool {
        // `started` because a request accepted before the file was read would be written
        // into a cache that is about to be replaced by the one on disk. The button is
        // only reachable from a screen whose task has already started us, so this is the
        // net, not the mechanism.
        guard started, let body = MaterialQueue.normalise(typed) else { return false }
        cache.outbox.append(QueuedMaterialRequest(workerId: workerId,
                                                  body: body,
                                                  locationId: locationId))
        persist()
        Task { await sync(workerId: workerId) }
        return true
    }

    /// "I have read that it arrived."
    ///
    /// Optimistic locally so the banner clears the instant it is tapped, then confirmed
    /// with the server's own row. A failure leaves the banner up, which is the honest
    /// outcome: the acknowledgement did not land.
    func markSeen(_ request: WireMaterialRequest) async {
        do {
            let updated = try await MaterialAPI.markSeen(id: request.id)
            replace(updated)
        } catch let failure as APIFailure {
            // 404 unknown_request means the admin deleted it, or it is not `arrived` any
            // more. Re-pulling is the only honest repair - do not invent a local state.
            if failure.status == 404 { await pull() }
        } catch {
            // Transport. Leave it: the banner is still true.
        }
    }

    // MARK: - Network passes

    /// Everything queued, oldest first, under the SESSION's worker (decision-22).
    private func push(workerId: Int) async {
        let plan = MaterialQueue.plan(cache.outbox, sessionWorkerId: workerId)

        for id in plan.wrongAccount {
            // A wrong name against somebody's words is worse than a visible failure.
            mark(id, error: "This request was written by a different account and can't be sent.",
                 blocked: true)
        }

        for (index, queued) in plan.send.enumerated() {
            let failure: APIFailure
            do {
                let created = try await MaterialAPI.create(body: queued.body, locationId: queued.locationId)
                cache.outbox.removeAll { $0.id == queued.id }
                cache.server.insert(created, at: 0)
                featureUnavailable = false
                persist()
                continue
            } catch let apiFailure as APIFailure {
                failure = apiFailure
            } catch {
                failure = APIFailure(status: 0, code: "network")
            }

            switch MaterialQueue.outcome(of: failure) {
            case .featureUnavailable:
                featureUnavailable = true
                return
            case .blocked:
                mark(queued.id, error: failure.workerMessage, blocked: true)
                Telemetry.log("material request rejected", .error, [
                    "ts.api.status": failure.status,
                    "ts.api.code": failure.code,
                ])
                continue  // this row is a human's problem; the next may still be fine
            case .retryLater:
                mark(queued.id, error: failure.workerMessage, blocked: false)
                continue
            case .stopPass:
                mark(queued.id, error: failure.workerMessage, blocked: false)
                // Say so on the rows being skipped too - a row with no message is a row
                // that looks sent. Only the ones AFTER this point: an earlier row's own
                // rejection must never be overwritten by a transport failure.
                for skipped in plan.send.dropFirst(index + 1) {
                    mark(skipped.id, error: failure.workerMessage, blocked: false)
                }
                return
            }
        }
    }

    /// GET /material-requests/mine. The server's list REPLACES the cached one: it is the
    /// truth, including for rows this phone never saw (a request filed from the worker's
    /// other device, or a status the admin changed five minutes ago).
    private func pull() async {
        do {
            cache.server = try await MaterialAPI.mine()
            featureUnavailable = false
            persist()
        } catch let failure as APIFailure where failure.code == "not_found" {
            featureUnavailable = true
        } catch {
            // Offline, or the server is unhappy. Keep the cache: a list that goes blank
            // in a stairwell is worse than a list that is a few hours old.
        }
    }

    // MARK: - Small mutations

    private func mark(_ id: UUID, error: String, blocked: Bool) {
        guard let index = cache.outbox.firstIndex(where: { $0.id == id }) else { return }
        cache.outbox[index].errorMessage = error
        cache.outbox[index].blocked = blocked
        persist()
    }

    private func replace(_ request: WireMaterialRequest) {
        if let index = cache.server.firstIndex(where: { $0.id == request.id }) {
            cache.server[index] = request
        } else {
            cache.server.insert(request, at: 0)
        }
        persist()
    }

    /// Best effort by design. A queue that cannot be written still works for this launch;
    /// refusing the request instead would lose it outright.
    private func persist() {
        guard started, let url else { return }
        do {
            try MaterialQueueFile.save(cache, to: url)
        } catch {
            Telemetry.capture(error)
        }
    }

    // MARK: - Read-only, for the UI

    var entries: [MaterialEntry] { MaterialFeed.entries(cache) }
    var unseenArrivals: [WireMaterialRequest] { cache.unseenArrivals }
    var unseenArrivalCount: Int { cache.unseenArrivals.count }
}
