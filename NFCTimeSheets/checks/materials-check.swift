// Runnable check: the worker half of material requests - the exact bytes on the wire,
// the decoder against a real server row, the queue's four failure outcomes, and the fact
// that a request written in a basement survives a process kill.
//
//   cd NFCTimeSheets
//   cat NFCTimeSheets/Branding.swift NFCTimeSheets/TagLink.swift NFCTimeSheets/API.swift \
//       NFCTimeSheets/Materials.swift \
//       checks/materials-check.swift \
//     > /tmp/materials-check.swift && swift /tmp/materials-check.swift
//
// (concatenated because the swift interpreter only runs one file; Materials.swift is pure
// Foundation precisely so this stays possible. MaterialStore.swift and MaterialsView.swift
// are the Observation/SwiftUI halves and are NOT covered here - every decision they make
// is a function in Materials.swift, which is.)

func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        exit(1)
    }
}

let UUID_A = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"

// ---------------------------------------------------------------------------------
// 1. THE BYTES. decision-22: who asked is the session's worker, decided on the server.
//    A worker field here is the hole that whole decision exists to close.
// ---------------------------------------------------------------------------------
func wireBytes() {
    let withLocation = CreateMaterialRequest(body: "zwei Mopps", locationUuid: UUID_A)
    let json = String(data: try! Wire.encoder.encode(withLocation), encoding: .utf8)!
    check(json.contains("\"body\":\"zwei Mopps\""), "body is sent verbatim: \(json)")
    check(json.contains("\"location_uuid\":\"\(UUID_A)\""), "location_uuid is snake_case: \(json)")
    check(!json.lowercased().contains("worker"), "NO worker field, ever (decision-22): \(json)")
    check(!json.contains("status"), "the app never proposes a status: \(json)")

    // No open shift: the field must be present and null, not absent under a different
    // name. server/routes/app.js treats undefined, null and "" identically, so either
    // encoding works - this pins that we send one of them and not "location_id".
    let without = CreateMaterialRequest(body: "Glasreiniger", locationUuid: nil)
    let bare = String(data: try! Wire.encoder.encode(without), encoding: .utf8)!
    check(!bare.contains("location_id"), "the slug/uuid column name is not a wire name: \(bare)")
    check(bare.contains("\"body\":\"Glasreiniger\""), "body still sent with no building: \(bare)")

    // The free text is the worker's own words and may contain anything a phone keyboard
    // produces. JSONEncoder has to escape it, not the caller.
    let awkward = CreateMaterialRequest(body: "\"Ajax\"\n\tund 3 Säcke", locationUuid: nil)
    let escaped = String(data: try! Wire.encoder.encode(awkward), encoding: .utf8)!
    check(escaped.contains("\\\"Ajax\\\""), "quotes escaped: \(escaped)")
    check(escaped.contains("\\n"), "newlines escaped: \(escaped)")
}

// ---------------------------------------------------------------------------------
// 2. Decoding, against the shape server/routes/app.js myMaterialRequests actually
//    returns (MATERIAL_REQUEST_FIELDS + location_name + item_name).
// ---------------------------------------------------------------------------------
func decoding() {
    let full = """
    {"requests":[{
      "id": 7, "worker_id": 1, "location_id": "\(UUID_A)",
      "body": "der blaue Reiniger, der große", "status": "arrived",
      "admin_note": "5 Liter bestellt", "inventory_item_id": 3, "quantity": 2,
      "cost_cents": 1799, "decided_by": 1,
      "decided_at": "2026-08-01T09:00:00.000Z", "ordered_at": "2026-08-01T10:00:00.000Z",
      "arrived_at": "2026-08-04T07:30:00Z", "seen_at": null,
      "created_at": "2026-07-31T18:12:04.412Z",
      "location_name": "HOIV", "item_name": "Glasreiniger 5 l"
    }]}
    """
    let list = try! Wire.decoder.decode(WireMaterialRequestListEnvelope.self, from: Data(full.utf8))
    let row = list.requests[0]
    check(row.id == 7, "id")
    check(row.status == .arrived, "status maps")
    check(row.itemName == "Glasreiniger 5 l", "item_name rides along")
    check(row.locationName == "HOIV", "location_name rides along")
    check(row.adminNote == "5 Liter bestellt", "admin_note reaches the worker")
    check(row.quantity == 2, "quantity")
    check(row.seenAt == nil, "seen_at null decodes as nil")
    // Whole-second AND fractional timestamps in the same payload. Postgres emits both.
    check(row.arrivedAt != nil, "whole-second timestamp decodes")
    check(row.createdAt.timeIntervalSince1970 > 0, "fractional timestamp decodes")
    check(row.isUnseenArrival, "arrived + never seen = the banner")

    // Minimum shape: everything nullable actually null. A row the admin has not touched.
    let bare = """
    {"request":{"id": 8, "worker_id": 1, "location_id": null, "body": "Mopp",
      "status": "submitted", "admin_note": null, "inventory_item_id": null,
      "quantity": null, "cost_cents": null, "decided_by": null, "decided_at": null,
      "ordered_at": null, "arrived_at": null, "seen_at": null,
      "created_at": "2026-07-31T18:12:04.412Z"}}
    """
    let created = try! Wire.decoder.decode(WireMaterialRequestEnvelope.self, from: Data(bare.utf8))
    check(created.request.status == .submitted, "a fresh request is submitted")
    check(created.request.locationName == nil, "location_name absent entirely is fine")
    check(!created.request.isUnseenArrival, "submitted is not an arrival")

    // A SIXTH STATUS. The server may grow one; a build in the field must degrade to
    // "unknown", not throw and blank the whole list.
    let future = bare.replacingOccurrences(of: "\"submitted\"", with: "\"back_ordered\"")
    let odd = try! Wire.decoder.decode(WireMaterialRequestEnvelope.self, from: Data(future.utf8))
    check(odd.request.status == nil, "an unknown status decodes as nil, not a crash")
    check(odd.request.statusRaw == "back_ordered", "the raw value is kept")
    check(!odd.request.isUnseenArrival, "an unknown status never raises the arrival banner")

    // The five known statuses, and which of them are still waiting on somebody. Copied
    // from server/lib/materials.js MATERIAL_TRANSITIONS - terminal there, closed here.
    check(MaterialStatus.submitted.isOpen && MaterialStatus.approved.isOpen && MaterialStatus.ordered.isOpen,
          "submitted/approved/ordered are open")
    check(!MaterialStatus.arrived.isOpen && !MaterialStatus.rejected.isOpen,
          "arrived and rejected are terminal")
    check(MaterialStatus.allCases.count == 5, "exactly five statuses exist server-side")
}

// ---------------------------------------------------------------------------------
// 3. What the worker typed. Trimmed HERE so a whitespace-only row never becomes a
//    permanently-400 queue entry the worker cannot clear.
// ---------------------------------------------------------------------------------
func normalising() {
    check(MaterialQueue.normalise("  zwei Mopps \n") == "zwei Mopps", "trimmed")
    check(MaterialQueue.normalise("") == nil, "empty is not a request")
    check(MaterialQueue.normalise("   \n\t ") == nil, "whitespace-only is not a request")
    let atLimit = String(repeating: "a", count: MaterialAPI.bodyMaxLength)
    check(MaterialQueue.normalise(atLimit) == atLimit, "exactly the server's cap is accepted")
    check(MaterialQueue.normalise(atLimit + "a") == nil, "one over the cap is refused")
    check(MaterialAPI.bodyMaxLength == 2000, "same cap as server/routes/app.js REQUEST_BODY_MAX")
}

// ---------------------------------------------------------------------------------
// 4. THE FOUR OUTCOMES. Every way this feature can lose a worker's request runs
//    through here, and none of them has a device or a network in it.
// ---------------------------------------------------------------------------------
func outcomes() {
    // The one that would otherwise be catastrophic: 404 not_found is an UNROUTED PATH
    // (server.js answers {"error":"not_found"}), i.e. this build is ahead of the server.
    // APIFailure classifies 404 as terminal, so without this arm every queued request
    // would be permanently blocked by a deploy that had not happened yet.
    check(!APIFailure(status: 404, code: "not_found").isRetryable,
          "404 is terminal by the general rule - which is why the arm below must exist")
    check(MaterialQueue.outcome(of: APIFailure(status: 404, code: "not_found")) == .featureUnavailable,
          "an unrouted path keeps the row queued and untouched")

    check(MaterialQueue.outcome(of: APIFailure(status: 0, code: "network")) == .stopPass,
          "no network stops the pass")
    check(MaterialQueue.outcome(of: APIFailure(status: 503, code: "http_503")) == .retryLater,
          "a 5xx is retried")
    check(MaterialQueue.outcome(of: APIFailure(status: 429, code: "too_many_attempts")) == .retryLater,
          "a 429 is retried")
    check(MaterialQueue.outcome(of: APIFailure(status: 400, code: "invalid_field")) == .blocked,
          "a rejected payload is terminal - a human must act")
    check(MaterialQueue.outcome(of: APIFailure(status: 422, code: "unknown_location")) == .blocked,
          "a removed building is terminal")
    // INVERTED alongside APIFailure.isRetryable (decision-50's retry fix,
    // checks/tag-link-check.swift): a dead session is a statement about the CREDENTIAL,
    // not this request's payload. Session already drops the app to signed-out on this
    // same 401 (API.swift's .sessionRejected), so the Materials tab is gone until the
    // worker signs back in - and `.task(id: worker.id)` re-runs `push()` the moment it
    // does, picking this row back up. `invalid_code` is the one 401 that stays terminal,
    // and it cannot reach this queue: no material request is ever posted mid sign-in.
    check(MaterialQueue.outcome(of: APIFailure(status: 401, code: "no_session")) == .retryLater,
          "a dead session retries once the worker signs back in")
    check(MaterialQueue.outcome(of: APIFailure(status: 401, code: "invalid_code")) == .blocked,
          "invalid_code stays terminal even here, for the same reason it does in shift sync")

    // Every arm says something. A blank row is a row that looks sent.
    for failure in [APIFailure(status: 0, code: "network"),
                    APIFailure(status: 404, code: "not_found"),
                    APIFailure(status: 400, code: "invalid_field"),
                    APIFailure(status: 404, code: "unknown_request")] {
        check(!failure.workerMessage.isEmpty, "\(failure.code) has a worker-facing message")
    }
    check(APIFailure(status: 404, code: "unknown_request").workerMessage.contains("admin"),
          "unknown_request tells the worker who to ask")
}

// ---------------------------------------------------------------------------------
// 5. The queue plan. decision-22 from the client side.
// ---------------------------------------------------------------------------------
func planning() {
    let t0 = Date(timeIntervalSince1970: 1_770_000_000)
    let mine1 = QueuedMaterialRequest(workerId: 1, body: "erste", locationId: nil, createdAt: t0)
    let mine2 = QueuedMaterialRequest(workerId: 1, body: "zweite", locationId: nil,
                                      createdAt: t0.addingTimeInterval(60))
    let theirs = QueuedMaterialRequest(workerId: 2, body: "kollege", locationId: nil,
                                       createdAt: t0.addingTimeInterval(30))
    let dead = QueuedMaterialRequest(workerId: 1, body: "schon abgelehnt", locationId: nil,
                                     createdAt: t0.addingTimeInterval(10),
                                     errorMessage: "nope", blocked: true)

    // Deliberately out of order on the way in.
    let plan = MaterialQueue.plan([mine2, theirs, dead, mine1], sessionWorkerId: 1)
    check(plan.send.map(\.body) == ["erste", "zweite"], "oldest first, mine only: \(plan.send.map(\.body))")
    check(plan.wrongAccount == [theirs.id], "a colleague's row is never posted under my session")
    check(!plan.send.contains { $0.blocked }, "a blocked row is not retried")

    // The same outbox under the colleague's session: the mirror image, and my rows are
    // not silently sent as theirs.
    let flipped = MaterialQueue.plan([mine2, theirs, dead, mine1], sessionWorkerId: 2)
    check(flipped.send.map(\.body) == ["kollege"], "only the session's own rows go out")
    check(Set(flipped.wrongAccount) == Set([mine1.id, mine2.id]), "and mine are the blocked ones now")
}

// ---------------------------------------------------------------------------------
// 6. Whose phone is this. A handed-over phone must not show the previous worker's
//    free text, and must not post their queued rows under the new session.
// ---------------------------------------------------------------------------------
func adoption() {
    let row = QueuedMaterialRequest(workerId: 1, body: "geheim", locationId: nil)
    let sent = try! Wire.decoder.decode(
        WireMaterialRequestEnvelope.self,
        from: Data("""
        {"request":{"id":1,"worker_id":1,"location_id":null,"body":"alt","status":"arrived",
        "admin_note":null,"inventory_item_id":null,"quantity":null,"cost_cents":null,
        "decided_by":null,"decided_at":null,"ordered_at":null,"arrived_at":null,
        "seen_at":null,"created_at":"2026-07-31T18:12:04.412Z"}}
        """.utf8)).request
    let cache = MaterialCache(workerId: 1, outbox: [row], server: [sent])

    let same = cache.adopted(by: 1)
    check(same.outbox.count == 1 && same.server.count == 1, "the same worker keeps everything")

    let other = cache.adopted(by: 2)
    check(other.workerId == 2, "the new worker owns the file")
    check(other.outbox.isEmpty, "the previous worker's queued words are gone")
    check(other.server.isEmpty, "and so is their history")
    check(cache.unseenArrivals.count == 1, "the arrival banner counts arrived + unseen")
    check(other.unseenArrivals.isEmpty, "...for the right worker only")
}

// ---------------------------------------------------------------------------------
// 7. THE BASEMENT. A request written with no signal has to survive the process being
//    killed, and a file we cannot read must never be silently replaced with an empty one.
// ---------------------------------------------------------------------------------
func disk() {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appending(path: "materials-check-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let file = dir.appending(path: MaterialQueueFile.filename)

    check(MaterialQueueFile.load(from: file) == .fresh, "nothing on disk yet is not an error")

    let queued = QueuedMaterialRequest(workerId: 3, body: "3 Säcke Müllsäcke", locationId: UUID_A)
    try! MaterialQueueFile.save(MaterialCache(workerId: 3, outbox: [queued], server: []), to: file)

    guard case .loaded(let back) = MaterialQueueFile.load(from: file) else {
        check(false, "the queue reloads after a kill"); return
    }
    check(back.workerId == 3, "the file remembers whose it is")
    check(back.outbox.count == 1, "the request survived")
    check(back.outbox[0].body == "3 Säcke Müllsäcke", "verbatim, umlauts and all")
    check(back.outbox[0].locationId == UUID_A, "with the building it was written in")
    check(back.outbox[0].id == queued.id, "and the same identity, so a retry cannot duplicate it locally")

    // Corruption: half a write from an older build, or a truncated file. The bytes are
    // KEPT. An error handler does not get to delete somebody's words.
    try! Data("{ not json".utf8).write(to: file)
    guard case .corrupt(let movedTo) = MaterialQueueFile.load(from: file) else {
        check(false, "an unreadable file is reported as corrupt, not as empty"); return
    }
    check(movedTo != nil, "the unreadable bytes were quarantined, not dropped")
    check(FileManager.default.fileExists(atPath: movedTo!.path), "and they are still on disk")
    check(!FileManager.default.fileExists(atPath: file.path), "the live file is out of the way")

    // Quarantining twice in a row must work - the second corrupt file overwrites the
    // first quarantine rather than throwing and losing the load entirely.
    try! Data("{ still not json".utf8).write(to: file)
    guard case .corrupt(let again) = MaterialQueueFile.load(from: file) else {
        check(false, "a second corruption is handled too"); return
    }
    check(again != nil, "and is quarantined again")
}

// ---------------------------------------------------------------------------------
// 8. The list. Unsent rows are never hidden behind sent ones.
// ---------------------------------------------------------------------------------
func feed() {
    let t0 = Date(timeIntervalSince1970: 1_770_000_000)
    func serverRow(_ id: Int, _ offset: TimeInterval) -> WireMaterialRequest {
        let iso = Wire.string(from: t0.addingTimeInterval(offset))
        return try! Wire.decoder.decode(WireMaterialRequestEnvelope.self, from: Data("""
        {"request":{"id":\(id),"worker_id":1,"location_id":null,"body":"s\(id)",
        "status":"ordered","admin_note":null,"inventory_item_id":null,"quantity":null,
        "cost_cents":null,"decided_by":null,"decided_at":null,"ordered_at":null,
        "arrived_at":null,"seen_at":null,"created_at":"\(iso)"}}
        """.utf8)).request
    }
    let cache = MaterialCache(
        workerId: 1,
        outbox: [QueuedMaterialRequest(workerId: 1, body: "q-neu", locationId: nil,
                                       createdAt: t0.addingTimeInterval(300)),
                 QueuedMaterialRequest(workerId: 1, body: "q-alt", locationId: nil,
                                       createdAt: t0.addingTimeInterval(100))],
        server: [serverRow(2, 200), serverRow(1, 0)])

    let ids = MaterialFeed.entries(cache).map { entry -> String in
        switch entry {
        case .queued(let row): return row.body
        case .sent(let row): return row.body
        }
    }
    check(ids == ["q-neu", "s2", "q-alt", "s1"],
          "queued and sent are interleaved by when they were written: \(ids)")
    check(Set(MaterialFeed.entries(cache).map(\.id)).count == 4,
          "a local UUID and a server integer can never collide")
    check(MaterialFeed.entries(.empty).isEmpty, "an empty cache is an empty list, not a crash")

    // Stable across calls: a ForEach that reorders itself every render is unusable with
    // VoiceOver, and two rows can share a millisecond.
    check(MaterialFeed.entries(cache).map(\.id) == MaterialFeed.entries(cache).map(\.id),
          "ordering is deterministic")
}

wireBytes()
decoding()
normalising()
outcomes()
planning()
adoption()
disk()
feed()
print("materials-check: OK")
