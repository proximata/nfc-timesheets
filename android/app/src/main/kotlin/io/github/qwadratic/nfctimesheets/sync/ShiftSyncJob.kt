package io.github.qwadratic.nfctimesheets.sync

import android.app.job.JobParameters
import android.app.job.JobService
import io.github.qwadratic.nfctimesheets.TimeSheetsApplication
import io.github.qwadratic.nfctimesheets.core.ApiFailure
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The pass the platform runs for us when there is a signal. THIS FILE MAKES NO DECISIONS:
 * the ordering, the blocking rules and the retry classification are all in core/SyncPlan.kt,
 * which android/checks runs on a laptop with no device. Anything clever added here is
 * untested by construction.
 *
 * WHAT IT MUST NEVER DO, and each of these is a way the same bug comes back:
 *   - never open or close a shift of its own accord. It pushes rows a TAP already wrote.
 *   - never delete a row. A row that cannot be sent stays, visibly, and says why.
 *   - never sign anybody out. A 401 here is "expired", not "revoked": SyncPlan classifies
 *     it retryable and it must not block a queued shift (core-check pins that).
 *   - never touch the notification. THE ONE WIRE has exactly two callers (the tap path and
 *     the recovery path in the ViewModel) and a third would be how a stale "eingestempelt"
 *     notification outlives the shift. The screen catches up on next foreground.
 */
class ShiftSyncJob : JobService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var running: Job? = null

    /** @return true = "still working, I will call jobFinished myself". */
    override fun onStartJob(params: JobParameters): Boolean {
        val app = application as? TimeSheetsApplication ?: return false
        running = scope.launch {
            // A THROW HERE IS A CRASH IN A SYSTEM-STARTED SERVICE, on a phone in a pocket,
            // with nobody to see it. Whatever went wrong, the row is still on disk and the
            // honest answer is "try again later" — which is what `true` means.
            val again = runCatching { pass(app) }.getOrDefault(true)
            jobFinished(params, again)
        }
        return true
    }

    /**
     * The constraint went away mid-pass — the lift doors closed, the network dropped, or
     * the system needs the slot back. @return true = reschedule with backoff.
     */
    override fun onStopJob(params: JobParameters): Boolean {
        running?.cancel()
        return true
    }

    /** @return whether the platform should run us again. */
    private suspend fun pass(app: TimeSheetsApplication): Boolean {
        // SIGNED OUT. Queued rows are NOT deleted on sign-out — they belong to the worker
        // who logged them (SyncPlan blocks them under any other session rather than filing
        // hours under the wrong name). But nothing can be pushed without a cookie, so stop
        // asking: the sign-in path re-arms the job the moment there is a session again.
        if (app.cookies.header() == null) return false

        if (app.store.pendingSummary().waiting == 0) return false

        // decision-22: the SERVER says who this session is, never the phone. The cached
        // worker IS the server's last answer (WorkerCache is only ever written from
        // GET /auth/session), so the common path costs no round trip; an empty cache — a
        // reinstall that restored the cookie, say — asks.
        val workerId = app.workers.read()?.id ?: try {
            app.api.session().also(app.workers::write).id
        } catch (failure: ApiFailure) {
            // 401 -> the session died. Come back later: the row is not lost, it is waiting
            // for a human to re-enrol, and the app says exactly that on the shift screen.
            // Anything else -> offline or a 5xx, which is the ordinary case here.
            return failure.status != 401
        }

        app.sync.push(workerId)

        // Re-arm ONLY while something can still move. A queue of blocked-only rows needs a
        // human, not a retry, and a job that wakes up for ever over a row it can never send
        // is a battery complaint that ends with the whole app being restricted.
        return app.store.pendingSummary().waiting > 0
    }
}
