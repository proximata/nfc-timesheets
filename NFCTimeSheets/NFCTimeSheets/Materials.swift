//
//  Materials.swift
//  NFCTimeSheets
//
//  Material requests, worker half: the wire contract, the on-disk queue and the two
//  pure decisions that queue makes. Foundation only - no SwiftUI, no SwiftData, no
//  Observation - so checks/materials-check.swift can compile and exercise all of it
//  outside Xcode, exactly like API.swift and MigrationCore.swift. The observable store
//  is MaterialStore.swift and the screen is MaterialsView.swift.
//
//  WHY THIS DOES NOT USE SWIFTDATA.
//  The SwiftData store holds unpushed SHIFTS, i.e. unpaid hours, and the container is
//  opened with a fatalError on failure (NFCTimeSheetsApp.swift). Adding an entity to it
//  puts a schema migration between a live crew and their clock-in every morning, for a
//  feature that is explicitly not the product. A separate JSON file cannot take the
//  shift store down with it: the worst it can do is lose material requests, and even
//  that is guarded below. Android does the same thing for the same reason - a separate
//  SQLite file, not a version bump on the shifts database.
//
//  Field names are snake_case in explicit CodingKeys, for the reason spelled out at the
//  top of API.swift: a name of our own invention is a silent 400 for ever.
//

import Foundation

// MARK: - Wire

/// The lifecycle, mirrored from server/lib/materials.js MATERIAL_TRANSITIONS:
///
///     submitted -> approved | rejected
///     approved  -> ordered  | rejected
///     ordered   -> arrived
///     arrived, rejected are terminal
///
/// The app NEVER sends a status. It is the admin's decision and the server enforces
/// which move is legal; this type exists to render one, not to propose one.
enum MaterialStatus: String, Codable, Sendable, CaseIterable {
    case submitted, approved, ordered, arrived, rejected

    /// Still waiting on somebody. Derived from the transition table, never a second list.
    var isOpen: Bool {
        switch self {
        case .submitted, .approved, .ordered: return true
        case .arrived, .rejected: return false
        }
    }
}

/// One request as the server holds it. GET /material-requests/mine.
///
/// Deliberately does NOT decode `cost_cents`, `inventory_item_id`, `decided_by` or
/// `location_id`: the worker has no use for them, and a field that is never rendered is
/// a field that cannot be rendered wrongly. `item_name` IS decoded - "der blaue Reiniger"
/// mapped by a human to "Glasreiniger 5 l" is the one useful thing that mapping produces
/// for the person who asked.
///
/// `status` is decoded as a raw String and mapped afterwards. If the server ever adds a
/// sixth status, an app in the field must show something honest rather than throw a
/// decoding error that would blank the whole list.
struct WireMaterialRequest: Codable, Identifiable, Sendable, Equatable {
    let id: Int
    let body: String
    let statusRaw: String
    let adminNote: String?
    let quantity: Int?
    let orderedAt: Date?
    let arrivedAt: Date?
    let seenAt: Date?
    let createdAt: Date
    let locationName: String?
    let itemName: String?

    enum CodingKeys: String, CodingKey {
        case id
        case body
        case statusRaw = "status"
        case adminNote = "admin_note"
        case quantity
        case orderedAt = "ordered_at"
        case arrivedAt = "arrived_at"
        case seenAt = "seen_at"
        case createdAt = "created_at"
        case locationName = "location_name"
        case itemName = "item_name"
    }

    /// nil when the server used a status this build has never heard of.
    var status: MaterialStatus? { MaterialStatus(rawValue: statusRaw) }

    /// It is in the warehouse and the worker has not acknowledged it yet. This, and
    /// nothing else, is what raises the banner and the tab badge.
    var isUnseenArrival: Bool { status == .arrived && seenAt == nil }
}

struct WireMaterialRequestEnvelope: Codable {
    let request: WireMaterialRequest
}

struct WireMaterialRequestListEnvelope: Codable {
    let requests: [WireMaterialRequest]
}

/// POST /material-requests.
///
/// decision-22, once more: there is NO worker_id here and there must never be one. Who
/// asked is the session's worker, decided on the server.
///
/// `location_uuid` is OPTIONAL CONTEXT - the building the worker had in mind - and is
/// explicitly NOT a cost attribution: decision-6 splits material cost pro-rata by labour
/// hours and rejected per-request attribution. Nothing in this app may present it as
/// "charge this to that building".
struct CreateMaterialRequest: Encodable {
    let body: String
    let locationUuid: String?

    enum CodingKeys: String, CodingKey {
        case body
        case locationUuid = "location_uuid"
    }
}

/// `{}` for the POST that carries no fields, so the server's JSON parse is never handed
/// zero bytes. (API.swift keeps its own private copy for /auth/logout.)
private struct MaterialEmptyBody: Encodable {}

enum MaterialAPI {
    /// Same ceiling the server enforces (server/routes/app.js REQUEST_BODY_MAX). Applied
    /// here so a worker who pastes a novel is stopped by a character counter instead of
    /// by a 400 they cannot read.
    static let bodyMaxLength = 2000

    /// POST /material-requests -> 201 {request}.
    static func create(body: String, locationId: String?) async throws -> WireMaterialRequest {
        let envelope: WireMaterialRequestEnvelope =
            try await apiPost("/material-requests",
                              CreateMaterialRequest(body: body, locationUuid: locationId))
        return envelope.request
    }

    /// GET /material-requests/mine -> 200 {requests} newest first, this session's worker
    /// only. There is no ?worker= and there must never be one (decision-22).
    static func mine() async throws -> [WireMaterialRequest] {
        let envelope: WireMaterialRequestListEnvelope = try await apiGet("/material-requests/mine")
        return envelope.requests
    }

    /// POST /material-requests/:id/seen -> "I have read that it arrived". Idempotent
    /// server-side (COALESCE keeps the first acknowledgement).
    static func markSeen(id: Int) async throws -> WireMaterialRequest {
        let envelope: WireMaterialRequestEnvelope =
            try await apiPost("/material-requests/\(id)/seen", MaterialEmptyBody())
        return envelope.request
    }
}

// MARK: - The local queue

/// A request the worker has written but the server has not acknowledged. This row is a
/// QUEUE ENTRY, not a record: the server is the truth (same rule as shifts,
/// decision-19). It exists so a request typed in a basement survives.
///
/// `workerId` is who was signed in when it was written. It is NOT sent - the session
/// decides that - it is here so a row queued by one account is never posted under
/// another one's session. Same guard as Sync.pushOpen.
struct QueuedMaterialRequest: Codable, Identifiable, Sendable, Equatable {
    let id: UUID
    let workerId: Int
    let body: String
    let locationId: String?
    let createdAt: Date
    /// Last failure, shown to the worker. Never left nil on a failure.
    var errorMessage: String?
    /// Terminal rejection: nobody is retrying, a human has to act.
    var blocked: Bool

    init(id: UUID = UUID(),
         workerId: Int,
         body: String,
         locationId: String?,
         createdAt: Date = .now,
         errorMessage: String? = nil,
         blocked: Bool = false)
    {
        self.id = id
        self.workerId = workerId
        self.body = body
        self.locationId = locationId
        self.createdAt = createdAt
        self.errorMessage = errorMessage
        self.blocked = blocked
    }
}

/// Everything this feature keeps on disk.
///
/// `workerId` is stamped on the FILE, not just the rows: a phone handed to a colleague
/// must not show them the previous worker's free text. `MaterialCache.adopted(by:)` is
/// the one place that is enforced.
struct MaterialCache: Codable, Sendable, Equatable {
    var workerId: Int
    var outbox: [QueuedMaterialRequest]
    var server: [WireMaterialRequest]

    init(workerId: Int = 0, outbox: [QueuedMaterialRequest] = [], server: [WireMaterialRequest] = []) {
        self.workerId = workerId
        self.outbox = outbox
        self.server = server
    }

    static let empty = MaterialCache()

    /// Called every time a session resolves.
    ///
    /// A DIFFERENT worker gets an EMPTY cache - their colleague's requests are their
    /// colleague's business, and a queued row would otherwise be posted under the wrong
    /// session. The same worker keeps everything, which is the whole point of the file.
    func adopted(by newWorkerId: Int) -> MaterialCache {
        guard workerId == newWorkerId else { return MaterialCache(workerId: newWorkerId) }
        return self
    }

    /// Requests that are in the warehouse and have not been acknowledged.
    var unseenArrivals: [WireMaterialRequest] { server.filter(\.isUnseenArrival) }
}

/// One row of the list, from either side of the queue.
enum MaterialEntry: Identifiable, Sendable, Equatable {
    case queued(QueuedMaterialRequest)
    case sent(WireMaterialRequest)

    /// Prefixed so a local UUID and a server integer can never collide in a ForEach.
    var id: String {
        switch self {
        case .queued(let row): return "q-\(row.id.uuidString)"
        case .sent(let row): return "s-\(row.id)"
        }
    }

    var createdAt: Date {
        switch self {
        case .queued(let row): return row.createdAt
        case .sent(let row): return row.createdAt
        }
    }
}

enum MaterialFeed {
    /// What the screen shows: everything, newest first, unsent rows never hidden.
    ///
    /// The two halves are sorted TOGETHER rather than "outbox on top": a request that
    /// failed to send three days ago belongs where it was written, not permanently above
    /// today's. It is still visibly unsent - the row says so in words.
    static func entries(_ cache: MaterialCache) -> [MaterialEntry] {
        let rows = cache.outbox.map(MaterialEntry.queued) + cache.server.map(MaterialEntry.sent)
        // Ties broken by id so the order is stable across renders; Date has millisecond
        // resolution on the wire and two rows can land in the same millisecond.
        return rows.sorted { ($0.createdAt, $0.id) > ($1.createdAt, $1.id) }
    }
}

/// What the store does with a row whose POST failed.
enum MaterialPushOutcome: Equatable, Sendable {
    /// The route does not exist on this server. Keep every remaining row queued and
    /// UNTOUCHED: telling a worker their request was rejected when it was never
    /// delivered is a lie the app would have no way to take back.
    case featureUnavailable
    /// Keep it queued with a message on it. The next pass tries again.
    case retryLater
    /// Keep it queued with a message on it, and give up on the whole pass - there is no
    /// network, so the rows behind it would only burn a timeout each.
    case stopPass
    /// Terminal. Nobody is retrying and a human has to act.
    case blocked
}

enum MaterialQueue {
    /// Split the outbox into "post this now" and "stop, a human must act".
    ///
    /// Oldest first, so the list the worker wrote arrives in the order they wrote it.
    ///
    /// The block is decision-22 from the client side: the server attributes a request to
    /// whoever holds the cookie, so posting worker A's queued row while worker B is
    /// signed in would file A's words under B's name. `MaterialCache.adopted(by:)`
    /// normally clears those rows at sign-in; this is the second net, for a row written
    /// between a session change and the next adopt.
    ///
    /// Rows already `blocked` are not retried, and rows are not re-blocked here - the
    /// caller keeps whatever message it recorded.
    static func plan(_ outbox: [QueuedMaterialRequest], sessionWorkerId: Int)
        -> (send: [QueuedMaterialRequest], wrongAccount: [UUID])
    {
        let live = outbox.filter { !$0.blocked }.sorted { $0.createdAt < $1.createdAt }
        return (send: live.filter { $0.workerId == sessionWorkerId },
                wrongAccount: live.filter { $0.workerId != sessionWorkerId }.map(\.id))
    }

    /// What a failed POST /material-requests means for the row that failed and for the
    /// rest of the queue behind it.
    ///
    /// Pure, and separate from the store, because this is the only part of the push that
    /// can lose a worker's request by being wrong - and it is the part with no device,
    /// no network and no session in it. checks/materials-check.swift pins all four arms.
    static func outcome(of failure: APIFailure) -> MaterialPushOutcome {
        // An UNROUTED PATH. This build is newer than the server: the deploy has not
        // landed, or the phone has an update the VM has not had. It is emphatically NOT
        // a rejection of what was sent, and 404 would otherwise classify as terminal and
        // block the row for ever. Checked FIRST for exactly that reason.
        if failure.code == "not_found" { return .featureUnavailable }
        // Offline, DNS, timeout, TLS. The rest of the queue will fail identically.
        if failure.status == 0 { return .stopPass }
        if failure.isRetryable { return .retryLater }
        return .blocked
    }

    /// Trim and refuse what the server would refuse anyway (validate.js `str`, min 1).
    ///
    /// Trimming HERE and not only at the server is what stops a whitespace-only request
    /// becoming a queued row that is rejected 400 for ever with nothing the worker can do
    /// about it. Returns nil when there is nothing to ask for.
    static func normalise(_ typed: String) -> String? {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= MaterialAPI.bodyMaxLength else { return nil }
        return trimmed
    }
}

// MARK: - Disk

/// Loading a queue can go three ways and only one of them is "it worked". A corrupt file
/// must not be silently replaced with an empty one - that is somebody's request deleted
/// by an error handler.
enum MaterialCacheLoad: Equatable {
    case fresh                       // nothing on disk yet
    case loaded(MaterialCache)
    case corrupt(movedTo: URL?)      // unreadable; the bytes were kept, see below
}

/// The file. Atomic writes, and a corrupt file is moved aside rather than overwritten.
enum MaterialQueueFile {
    static let filename = "material-requests.json"

    /// Application Support, created if missing. The app's container is already protected
    /// by iOS file protection, which is the same place the SwiftData store lives.
    static func defaultURL() throws -> URL {
        let dir = try FileManager.default.url(for: .applicationSupportDirectory,
                                              in: .userDomainMask,
                                              appropriateFor: nil,
                                              create: true)
        return dir.appending(path: filename)
    }

    static func load(from url: URL) -> MaterialCacheLoad {
        guard let data = try? Data(contentsOf: url) else { return .fresh }
        guard let cache = try? Wire.decoder.decode(MaterialCache.self, from: data) else {
            // Keep the bytes. A worker's own words are not something an error path gets
            // to delete, and a support request can still recover them from the container.
            let quarantine = url.appendingPathExtension("corrupt")
            try? FileManager.default.removeItem(at: quarantine)
            let moved = (try? FileManager.default.moveItem(at: url, to: quarantine)) != nil
            return .corrupt(movedTo: moved ? quarantine : nil)
        }
        return .loaded(cache)
    }

    /// `.atomic` on purpose: the process can be killed at any moment (a background NFC
    /// launch is a short-lived process), and a half-written queue file is a lost request.
    static func save(_ cache: MaterialCache, to url: URL) throws {
        try Wire.encoder.encode(cache).write(to: url, options: [.atomic])
    }
}
