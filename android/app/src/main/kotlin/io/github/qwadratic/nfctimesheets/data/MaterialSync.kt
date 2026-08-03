package io.github.qwadratic.nfctimesheets.data

import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.MaterialPushOutcome
import io.github.qwadratic.nfctimesheets.core.MaterialQueue
import io.github.qwadratic.nfctimesheets.net.Api

/**
 * Executes what [MaterialQueue] decided. This file makes NO decisions of its own — the
 * ordering, the account guard and the four failure outcomes are all pure code that
 * android/checks runs without a device. Anything clever added here is untested by
 * construction; put it in MaterialQueue instead. Same contract as [ShiftSync].
 *
 * IT MUST NEVER BE ABLE TO BLOCK A CLOCK-IN. Nothing here is called from the tap path or
 * from [ShiftSync]; the material tab drives it, every failure ends as a resource name on
 * a row, and a server that has never heard of these routes changes nothing else.
 *
 * ponytail: no background worker, exactly like ShiftSync. CEILING: a request written with
 * no signal sits on the phone until the app is next opened. UPGRADE PATH: WorkManager
 * with a network constraint — and the same WorkManager would carry shifts, so it is one
 * change, not two.
 */
class MaterialSync(private val api: Api, private val store: MaterialStore) {

    /** @return true when the server does not have these routes (see MaterialQueue.outcome). */
    suspend fun push(sessionWorkerId: Int): Boolean {
        val plan = MaterialQueue.plan(store.outbox(), sessionWorkerId)

        for (id in plan.wrongAccount) {
            // Somebody else's words under this session would be filed under this name.
            // Blocked loudly instead — a visible failure beats a wrong attribution.
            store.markFailed(id, MaterialQueue.messageKey(ApiFailure(0, "wrong_account")), blocked = true)
        }

        plan.send.forEachIndexed { index, queued ->
            val failure = try {
                store.upsertServer(
                    sessionWorkerId,
                    api.createMaterialRequest(queued.body, queued.locationId),
                )
                store.dequeue(queued.id)
                return@forEachIndexed
            } catch (rejected: ApiFailure) {
                rejected
            }

            when (MaterialQueue.outcome(failure)) {
                MaterialPushOutcome.FEATURE_UNAVAILABLE ->
                    // The ROUTE is missing, not the request. Every remaining row stays
                    // queued and UNTOUCHED.
                    return true

                MaterialPushOutcome.BLOCKED ->
                    store.markFailed(queued.id, MaterialQueue.messageKey(failure), blocked = true)

                MaterialPushOutcome.RETRY_LATER ->
                    store.markFailed(queued.id, MaterialQueue.messageKey(failure), blocked = false)

                MaterialPushOutcome.STOP_PASS -> {
                    store.markFailed(queued.id, MaterialQueue.messageKey(failure), blocked = false)
                    // Say so on the rows being skipped too: a row with no message is a
                    // row that looks sent. Only the ones AFTER this point — an earlier
                    // row's own rejection must never be overwritten by a dead connection.
                    for (skipped in plan.send.drop(index + 1)) {
                        store.markFailed(skipped.id, MaterialQueue.messageKey(failure), blocked = false)
                    }
                    return false
                }
            }
        }
        return false
    }

    /**
     * GET /material-requests/mine. The server's list REPLACES the cached one.
     *
     * @return true when the routes are missing. Any other failure keeps the cache: a list
     *         that goes blank in a stairwell is worse than one that is a few hours old.
     */
    suspend fun pull(sessionWorkerId: Int): Boolean {
        val requests = try {
            api.myMaterialRequests()
        } catch (failure: ApiFailure) {
            return failure.code == "not_found"
        }
        store.replaceServer(sessionWorkerId, requests)
        return false
    }

    /**
     * "I have read that it arrived."
     *
     * @return true when the acknowledgement landed. A 404 means the admin deleted the row
     *         or it is not `arrived` any more; re-pulling is the only honest repair —
     *         never invent a local state for it.
     */
    suspend fun markSeen(sessionWorkerId: Int, id: Int): Boolean =
        try {
            store.upsertServer(sessionWorkerId, api.markMaterialRequestSeen(id))
            true
        } catch (failure: ApiFailure) {
            if (failure.status == 404) pull(sessionWorkerId)
            false
        }
}
