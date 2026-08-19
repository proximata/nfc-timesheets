package io.github.qwadratic.nfctimesheets.data

import io.github.qwadratic.nfctimesheets.core.ApiFailure
import io.github.qwadratic.nfctimesheets.core.SyncPlan
import io.github.qwadratic.nfctimesheets.net.Api

/**
 * Executes what [SyncPlan] decided. This file makes NO decisions of its own — the
 * ordering, the blocking rules and the retry classification are all in pure code that
 * android/checks runs without a device. Anything clever added here is untested by
 * construction; put it in SyncPlan instead.
 *
 * ponytail: called on tap, on pull-to-refresh and when the log screen appears. There is
 * no background worker. CEILING: a shift taken with no signal sits on the phone until the
 * app is next opened — fine for a crew that opens it twice a day at a door anyway.
 * UPGRADE PATH: WorkManager with a network constraint, once somebody actually gets bitten.
 */
class ShiftSync(private val api: Api, private val store: ShiftStore) {

    /** @param sessionWorkerId the worker the SERVER says holds this session (decision-22). */
    suspend fun push(sessionWorkerId: Int) {
        val pass = SyncPlan.plan(store.queue(), sessionWorkerId)

        for (block in pass.blocks) {
            store.markFailed(block.clientUuid, ApiFailure(0, block.code).messageKey, blocked = true)
        }

        // A shift whose OPEN failed must not have its CLOSE attempted: closing something
        // the server never heard of answers 404 unknown_shift, which is terminal, which
        // would block a row that was only ever waiting for a signal.
        val giveUpOn = mutableSetOf<String>()
        for (step in pass.steps) {
            if (step.clientUuid in giveUpOn) continue
            try {
                when (step) {
                    is SyncPlan.Step.Open -> {
                        val shift = api.openShift(step.clientUuid, step.locationId, step.startTime)
                        store.applyServer(shift)
                        store.markOpenSynced(step.clientUuid)
                    }
                    is SyncPlan.Step.Close -> {
                        // The server's row wins. If the 8h timer got there first this comes
                        // back auto_closed=true / corrected_at=null and the worker is routed
                        // to the resolution sheet: closing does NOT silently resolve it.
                        val shift = api.closeShift(step.clientUuid, step.endTime, step.autoClosed)
                        store.applyServer(shift)
                        store.markCloseSynced(step.clientUuid)
                    }
                }
            } catch (failure: ApiFailure) {
                store.markFailed(step.clientUuid, failure.messageKey, SyncPlan.blocksRow(failure))
                giveUpOn += step.clientUuid
            }
        }
    }

    /**
     * GET /roster -> cache the location names AND the adopted-tag zone table
     * (decision-44). Failure is silent and harmless (see below).
     */
    suspend fun refreshRoster() {
        val roster = try {
            api.roster()
        } catch (_: ApiFailure) {
            // A stale or empty name/zone cache costs a label, or a scan that falls back
            // to the compiled KnownTags table. It must never cost a shift, and nothing
            // in this app branches on a location or zone being in the cache to allow a
            // tap through.
            return
        }
        store.replaceRoster(roster.locations, roster.zones)
    }

    /** decision-19: the server, not the phone, is authoritative for "who is clocked in". */
    suspend fun adoptServerOpenShift() {
        val remote = try {
            api.currentOpenShift()
        } catch (_: ApiFailure) {
            return
        }
        remote?.let(store::adopt)
    }
}
