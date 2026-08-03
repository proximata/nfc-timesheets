package io.github.qwadratic.nfctimesheets.core

import java.time.Instant

/**
 * Material requests, worker half: the wire shapes and every decision the offline queue
 * makes, as pure functions. Port of NFCTimeSheets/NFCTimeSheets/Materials.swift, and the
 * two files are meant to be diffable by eye — one worker's two phones must behave the
 * same way.
 *
 * Pure on purpose: android/checks runs all of it with no device, no emulator, no Android
 * SDK and no server. The executor is data/MaterialSync.kt and it decides nothing.
 *
 * WHY THIS IS A SEPARATE DATABASE FILE (see data/MaterialStore.kt). The shifts database
 * holds unpaid hours. A schema version bump on it, for a feature that is explicitly not
 * the product, puts a migration between a crew and their clock-in every morning. The
 * worst a separate file can do is lose material requests. iOS does the same thing for the
 * same reason: a JSON file beside the SwiftData store, never inside it.
 */

/**
 * The lifecycle, mirrored from server/lib/materials.js MATERIAL_TRANSITIONS:
 *
 *     submitted -> approved | rejected
 *     approved  -> ordered  | rejected
 *     ordered   -> arrived
 *     arrived, rejected are terminal
 *
 * The app NEVER sends a status. It is the admin's decision and the server enforces which
 * move is legal; this type renders one, it does not propose one.
 */
enum class MaterialStatus(val wire: String) {
    SUBMITTED("submitted"),
    APPROVED("approved"),
    ORDERED("ordered"),
    ARRIVED("arrived"),
    REJECTED("rejected"),
    ;

    /** Still waiting on somebody. Derived from the table above, never a second list. */
    val isOpen: Boolean get() = this == SUBMITTED || this == APPROVED || this == ORDERED

    companion object {
        /** null for a status this build has never heard of. See [WireMaterialRequest]. */
        fun from(raw: String?): MaterialStatus? = entries.firstOrNull { it.wire == raw }
    }
}

/**
 * One request as the server holds it (GET /material-requests/mine).
 *
 * Deliberately does NOT carry `cost_cents`, `inventory_item_id`, `decided_by` or
 * `location_id`: the worker has no use for them, and a field that is never rendered
 * cannot be rendered wrongly. `item_name` IS carried — "der blaue Reiniger" mapped by a
 * human to "Glasreiniger 5 l" is the one useful thing that mapping produces for the
 * person who asked.
 *
 * `statusRaw` is the string, and [status] is the mapping. If the server ever grows a
 * sixth status, a phone in the field shows something honest instead of throwing and
 * blanking the whole list.
 */
data class WireMaterialRequest(
    val id: Int,
    val body: String,
    val statusRaw: String,
    val adminNote: String?,
    val quantity: Int?,
    val orderedAt: Instant?,
    val arrivedAt: Instant?,
    val seenAt: Instant?,
    val createdAt: Instant,
    val locationName: String?,
    val itemName: String?,
) {
    val status: MaterialStatus? get() = MaterialStatus.from(statusRaw)

    /**
     * It is in the warehouse and the worker has not acknowledged it. This, and nothing
     * else, raises the banner and the tab badge.
     */
    val isUnseenArrival: Boolean get() = status == MaterialStatus.ARRIVED && seenAt == null
}

/**
 * POST /material-requests.
 *
 * decision-22 once more: there is NO worker_id here and there must never be one. Who
 * asked is decided by the ts_worker cookie on the server. android/checks asserts the
 * serialised body contains no "worker" substring.
 *
 * `locationUuid` is OPTIONAL CONTEXT — the building the worker had in mind — and is
 * explicitly NOT a cost attribution: decision-6 splits material cost pro-rata by labour
 * hours and REJECTED per-request building attribution. Nothing in this app may present
 * it as "charge this to that building".
 */
data class CreateMaterialRequest(val body: String, val locationUuid: String?) {
    fun toJson(): String = Wire.obj(
        "body" to body,
        "location_uuid" to locationUuid,
    )
}

/**
 * A request the worker has written that the server has not acknowledged. A QUEUE ENTRY,
 * not a record — the server is the truth. It exists so a request typed in a basement
 * survives.
 *
 * `workerId` is who was signed in when it was written. NOT sent; it is here so a row
 * queued under one account is never posted under another one's session.
 */
data class QueuedMaterialRequest(
    val id: String,
    val workerId: Int,
    val body: String,
    val locationId: String?,
    val createdAt: Instant,
    /** String RESOURCE NAME of the last failure, never a message, so it re-localises. */
    val errorKey: String? = null,
    /** Terminal rejection: nobody is retrying, a human must act. */
    val blocked: Boolean = false,
)

/** One row of the list, from either side of the queue. */
sealed interface MaterialEntry {
    /** Prefixed so a local UUID and a server integer can never collide in a LazyColumn. */
    val key: String
    val createdAt: Instant

    data class Queued(val row: QueuedMaterialRequest) : MaterialEntry {
        override val key: String get() = "q-${row.id}"
        override val createdAt: Instant get() = row.createdAt
    }

    data class Sent(val row: WireMaterialRequest) : MaterialEntry {
        override val key: String get() = "s-${row.id}"
        override val createdAt: Instant get() = row.createdAt
    }
}

/** What the store does with a row whose POST failed. */
enum class MaterialPushOutcome {
    /**
     * The route does not exist on this server: this build is ahead of the deploy. Keep
     * every remaining row queued and UNTOUCHED — telling a worker their request was
     * rejected when it was never delivered is a lie the app cannot take back.
     */
    FEATURE_UNAVAILABLE,

    /** Keep it queued with a message on it. The next pass tries again. */
    RETRY_LATER,

    /**
     * Keep it queued with a message on it and give up on the whole pass: there is no
     * network, so the rows behind it would only burn a timeout each.
     */
    STOP_PASS,

    /** Terminal. Nobody is retrying and a human has to act. */
    BLOCKED,
}

object MaterialQueue {

    /**
     * The same ceiling the server enforces (server/routes/app.js REQUEST_BODY_MAX).
     * Applied here so a worker who dictates a novel is stopped by a character counter
     * instead of by a 400 they cannot read.
     */
    const val BODY_MAX = 2000

    /** Rows to post now, and rows that belong to somebody else. */
    data class Plan(val send: List<QueuedMaterialRequest>, val wrongAccount: List<String>)

    /**
     * Oldest first, so the list the worker wrote arrives in the order they wrote it.
     *
     * [Plan.wrongAccount] is decision-22 from the client side: the server attributes a
     * request to whoever holds the cookie, so posting worker A's queued row while worker
     * B is signed in would file A's words under B's name. [MaterialStore.adopt] normally
     * deletes those rows at sign-in; this is the second net, for a row written between a
     * session change and the next adopt.
     *
     * Rows already `blocked` are not retried and are not re-blocked here — the caller
     * keeps whatever message it recorded.
     */
    fun plan(outbox: List<QueuedMaterialRequest>, sessionWorkerId: Int): Plan {
        val live = outbox.filterNot { it.blocked }.sortedBy { it.createdAt }
        return Plan(
            send = live.filter { it.workerId == sessionWorkerId },
            wrongAccount = live.filter { it.workerId != sessionWorkerId }.map { it.id },
        )
    }

    /**
     * What a failed POST /material-requests means for the row that failed and for the
     * rest of the queue behind it.
     *
     * Pure and separate from the store because this is the only part of the push that can
     * lose a worker's request by being wrong, and the part with no device, no network and
     * no session in it.
     */
    fun outcome(failure: ApiFailure): MaterialPushOutcome = when {
        // An UNROUTED PATH — server.js answers {"error":"not_found"} — i.e. this build is
        // ahead of the server. It is emphatically NOT a rejection of what was sent, and
        // 404 would otherwise classify as terminal and block the row for ever. Checked
        // FIRST for exactly that reason.
        failure.code == "not_found" -> MaterialPushOutcome.FEATURE_UNAVAILABLE
        // Offline, DNS, timeout, TLS. The rest of the queue will fail identically.
        failure.status == 0 -> MaterialPushOutcome.STOP_PASS
        failure.isRetryable -> MaterialPushOutcome.RETRY_LATER
        else -> MaterialPushOutcome.BLOCKED
    }

    /**
     * The same failure, worded for a REQUEST rather than for a shift.
     *
     * [ApiFailure.messageKey] is shared with the shift queue and two of its strings say
     * "Schicht" out loud. Telling a worker their SHIFT was rejected when what failed was
     * a request for mops sends them to the admin about the wrong thing. Everything else
     * is already noun-neutral and passes through untouched.
     */
    fun messageKey(failure: ApiFailure): String = when (val key = failure.messageKey) {
        "err_rejected" -> "err_rejected_request"
        "err_wrong_account" -> "err_wrong_account_request"
        else -> key
    }

    /**
     * Trim and refuse what the server would refuse anyway (validate.js `str`, min 1).
     *
     * Trimming HERE and not only on the server is what stops a whitespace-only request
     * becoming a queued row that is rejected 400 for ever with nothing the worker can do
     * about it. Returns null when there is nothing to ask for.
     */
    fun normalise(typed: String): String? {
        val trimmed = typed.trim()
        return if (trimmed.isEmpty() || trimmed.length > BODY_MAX) null else trimmed
    }

    /**
     * What the screen shows: everything, newest first, unsent rows never hidden.
     *
     * The two halves are sorted TOGETHER rather than "outbox on top": a request that
     * failed to send three days ago belongs where it was written, not permanently above
     * today's. It is still visibly unsent — the row says so in words.
     *
     * Ties broken by key so the order is stable across recompositions; the wire carries
     * milliseconds and two rows can share one.
     */
    fun entries(outbox: List<QueuedMaterialRequest>, server: List<WireMaterialRequest>): List<MaterialEntry> =
        (outbox.map(MaterialEntry::Queued) + server.map(MaterialEntry::Sent))
            .sortedWith(compareByDescending<MaterialEntry> { it.createdAt }.thenByDescending { it.key })
}
