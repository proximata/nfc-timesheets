package io.github.qwadratic.nfctimesheets.sync

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.os.Build
import java.time.Instant

/**
 * THE BACKGROUND PUSH (TASK-225). One JobScheduler job, scheduled by the platform, run
 * when there is a network — with the app closed, after a task-swipe, and after a reboot.
 *
 * ponytail: `android.app.job.JobScheduler`, NOT WorkManager.
 *
 *   Ladder. (1) Needed — yes: before this, a tap taken with no signal sat on the phone
 *   until a human opened the app, and a basement crew that never opens it is a payroll
 *   that is quietly short every month. (2)/(3) A platform answer EXISTS and this is it:
 *   JobScheduler is in android.jar, ships on every device since API 21, does the network
 *   constraint, the exponential backoff and the reboot persistence itself. (4) WorkManager
 *   is the obvious alternative and is *literally a wrapper over this class* on API 23+;
 *   what it adds is its own Room database, a KSP-free but still non-trivial dependency
 *   tree, and its own boot receiver — to buy chained work and LiveData observation, both
 *   of which this app has exactly zero use for. (6) Minimum code: this file is 60 lines.
 *
 *   CEILING, and it is shared with WorkManager and with every other scheduler on Android,
 *   because they all end up here:
 *     - A FORCE-STOPPED app has all of its jobs cancelled by the system, and nothing runs
 *       again until a human launches it. `adb shell am force-stop`, "Force stop" in
 *       Settings, and some OEM task killers do this. There is no fix; there is only not
 *       lying about it, which is why [io.github.qwadratic.nfctimesheets.core.PendingWork]
 *       exists and why launch re-schedules. `demo/prove-offline-push.mjs` § 5 measures it
 *       rather than asserting it: it force-stops the app, asks the platform, and gets
 *       "unknown".
 *     - Doze and App Standby buckets can delay a job by hours on a phone that is asleep in
 *       a locker. The row is not lost; it is late, and the app says so.
 *     - Exponential backoff is capped by the platform at 5 hours between retries. The
 *       delay costs nobody money: `start_time` and `end_time` are stamped ON THE PHONE at
 *       the tap, so a row that arrives five hours late is still paid for the right hours
 *       (prove-offline-push § 2 asserts exactly that, against the tap's own clock).
 *     - The job is NOT periodic. It is one-shot and re-arms itself while work remains, so
 *       a phone with an empty queue schedules nothing at all and costs no battery.
 *
 *   UPGRADE PATH: WorkManager, if chained or observable work ever appears. The push logic
 *   is in data/ShiftSync.kt + core/SyncPlan.kt and knows nothing about either scheduler.
 */
object SyncScheduler {

    /** Arbitrary, stable, and ours alone — the id namespace is per-application. */
    const val JOB_ID = 225

    /**
     * The floor for the first retry. The platform doubles it per failure and caps at 5h.
     * 30s and not 5s: a phone in a basement fails instantly and repeatedly, and hammering
     * a dead radio every five seconds is how a battery dies before the shift does.
     */
    private const val BACKOFF_MS = 30_000L

    /**
     * WHAT THE PLATFORM SAID when it was last asked to hold a job.
     *
     * THIS TYPE EXISTS BECAUSE THE FIRST VERSION OF THIS FILE THREW THE ANSWER AWAY.
     * `runCatching { scheduler.schedule(job) }` swallows two different failures at once —
     * a thrown [IllegalArgumentException] AND a returned [JobScheduler.RESULT_FAILURE] —
     * and `demo/prove-offline-push.mjs` then caught the consequence on a real device:
     * `cmd jobscheduler get-job-state … 225` answered "unknown" after every single offline
     * tap. The delivery half of TASK-225 had never once run, and nothing in the app, on the
     * screen, or in any check could have said so. That is the bug of TASK-225 itself,
     * rebuilt one layer down: a promise nobody can audit.
     */
    sealed interface Armed {
        /** The platform has accepted the job and will run it when there is a network. */
        data object Scheduled : Armed

        /** A job was already pending; its backoff was deliberately not reset. */
        data object Already : Armed

        /**
         * The platform REFUSED to hold it. The queue is intact and the next launch will
         * try again, but until then delivery depends on a human opening the app — the
         * same ceiling as a force-stop, arrived at by a different road.
         *
         * @param why short, stable, and safe to print: a result code or an exception
         *        class plus message. NEVER a worker name, a code or a cookie.
         */
        data class Refused(val why: String) : Armed
    }

    /**
     * The last answer, and when. Read by
     * [io.github.qwadratic.nfctimesheets.ui.TimeSheetViewModel] so a refusal reaches the
     * screen instead of a log — this app has no logging at all, deliberately, and
     * android/checks asserts that stays true.
     */
    @Volatile
    var lastArmed: Pair<Armed, Instant>? = null
        private set

    /**
     * Idempotent. CALLED FROM THE TAP PATH, so it must be cheap and must never throw: it
     * is one binder call, it happens AFTER the row is already on disk, and every caller
     * is off the main thread.
     *
     * ALREADY-PENDING WINS. Re-scheduling the same id REPLACES the pending job and RESETS
     * its backoff — so a worker tapping every few minutes in a dead spot would pin the
     * retry to the 30s floor for the whole shift. If a job is already waiting for a
     * network, leave it waiting.
     *
     * @return what the platform said, for the caller that wants to SHOW it. Callers on the
     *         clock-in path ignore it, which is correct: nothing here may block a tap.
     */
    fun ensure(context: Context): Armed {
        val outcome = arm(context)
        lastArmed = outcome to Instant.now()
        return outcome
    }

    private fun arm(context: Context): Armed {
        val scheduler = context.getSystemService(JobScheduler::class.java)
            ?: return Armed.Refused("no JobScheduler service")
        if (isScheduled(scheduler)) return Armed.Already

        val job = try {
            JobInfo.Builder(JOB_ID, ComponentName(context, ShiftSyncJob::class.java))
                // ANY, not UNMETERED: a shift is a few hundred bytes and a cleaner's phone
                // in a stairwell has mobile data and no wifi. Requiring wifi would be the
                // same bug as having no worker at all, dressed as a battery optimisation.
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                // Survives a reboot. This is what RECEIVE_BOOT_COMPLETED is already held
                // for (see AndroidManifest.xml) — the permission is not requested for this,
                // it was already there for the notification, and the job rides along.
                .setPersisted(true)
                .setBackoffCriteria(BACKOFF_MS, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .build()
        } catch (err: Throwable) {
            // setPersisted without RECEIVE_BOOT_COMPLETED, a JobInfo with no constraints,
            // a component the manifest does not declare: all of these throw here, and all
            // of them are build faults that must be visible in one run rather than
            // reappear as "the shift never arrived" a month later.
            return Armed.Refused("${err.javaClass.simpleName}: ${err.message}")
        }

        // A binder call to system_server. It can fail (too many jobs, a dying process, an
        // OEM policy); it must never take a clock-in down with it. The row is already on
        // disk and the next launch re-arms.
        return try {
            // RESULT_FAILURE is a RETURN VALUE, not an exception. Ignoring it is how a
            // background push can be entirely absent on a device and entirely green in
            // every check that only looks at the source.
            if (scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS) {
                Armed.Scheduled
            } else {
                Armed.Refused("JobScheduler.RESULT_FAILURE")
            }
        } catch (err: Throwable) {
            Armed.Refused("${err.javaClass.simpleName}: ${err.message}")
        }
    }

    /** True when the platform is already holding a job for us. */
    fun isScheduled(context: Context): Boolean =
        context.getSystemService(JobScheduler::class.java)?.let(::isScheduled) ?: false

    private fun isScheduled(scheduler: JobScheduler): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            scheduler.getPendingJob(JOB_ID) != null
        } else {
            // API 23. getPendingJob arrived in 24; the list is the only way to ask.
            scheduler.allPendingJobs.any { it.id == JOB_ID }
        }
}
