package io.github.qwadratic.nfctimesheets.sync

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.os.Build

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
 *       exists and why launch re-schedules.
 *     - Doze and App Standby buckets can delay a job by hours on a phone that is asleep in
 *       a locker. The row is not lost; it is late, and the app says so.
 *     - Exponential backoff is capped by the platform at 5 hours between retries.
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
     * Idempotent. CALLED FROM THE TAP PATH, so it must be cheap and must never throw: it
     * is one binder call, it happens AFTER the row is already on disk, and every caller
     * is off the main thread.
     *
     * ALREADY-PENDING WINS. Re-scheduling the same id REPLACES the pending job and RESETS
     * its backoff — so a worker tapping every few minutes in a dead spot would pin the
     * retry to the 30s floor for the whole shift. If a job is already waiting for a
     * network, leave it waiting.
     */
    fun ensure(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        if (isScheduled(scheduler)) return

        val job = JobInfo.Builder(JOB_ID, ComponentName(context, ShiftSyncJob::class.java))
            // ANY, not UNMETERED: a shift is a few hundred bytes and a cleaner's phone in a
            // stairwell has mobile data and no wifi. Requiring wifi would be the same bug
            // as having no worker at all, dressed as a battery optimisation.
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            // Survives a reboot. This is what RECEIVE_BOOT_COMPLETED is already held for
            // (see AndroidManifest.xml) — the permission is not requested for this, it was
            // already there for the notification, and the job rides along.
            .setPersisted(true)
            .setBackoffCriteria(BACKOFF_MS, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .build()

        // A binder call to system_server. It can fail (too many jobs, a dying process);
        // it must never take a clock-in down with it. The row is already on disk and the
        // next launch re-arms.
        runCatching { scheduler.schedule(job) }
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
