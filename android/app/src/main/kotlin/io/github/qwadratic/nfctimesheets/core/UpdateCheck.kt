package io.github.qwadratic.nfctimesheets.core

/**
 * Self-update (this iteration): "is the build the server has newer than the one running
 * right now", and how to read android.app.DownloadManager's own status/reason codes.
 *
 * PURE KOTLIN, no Android imports, so android/checks/core-check.kt can run this on a
 * plain JVM — see ShiftSignal.kt's header for why that constraint exists and what it
 * buys. NEVER on the tap or clock-out path: this module is read only from the update
 * surface in ui/TimeSheetApp.kt's Settings screen (update/UpdateManager, the only
 * caller). A launch-time check is silent and only ever OFFERS an update; downloading and
 * installing are both an explicit button press — see UpdateManager's own header.
 */
data class RemoteRelease(
    val versionCode: Int,
    val versionName: String?,
    val sha256: String?,
    val notes: String?,
    val url: String,
)

object UpdateCheck {

    /**
     * server/routes/release.js's own contract: `version_code` only ever goes up, exactly
     * like Android's own versionCode. Strictly greater, never `>=` — a phone re-asking
     * about the exact build it is already running must answer "up to date", not "update
     * available", or the worker would be offered the same APK for ever.
     */
    fun isNewer(remote: RemoteRelease, currentVersionCode: Int): Boolean =
        remote.versionCode > currentVersionCode

    // ---- reading android.app.DownloadManager's own status/reason -----------------
    //
    // Mirrored here as plain Ints rather than imported, so classification stays pure
    // Kotlin and testable off-device — the same idiom ShiftSignal.AUTO_CLOSE_AFTER uses
    // for the server's own 8h boundary. These are DOCUMENTED, STABLE public API
    // constants, unchanged since DownloadManager shipped in API 9:
    // https://developer.android.com/reference/android/app/DownloadManager
    const val DM_STATUS_PENDING = 1
    const val DM_STATUS_RUNNING = 2
    const val DM_STATUS_PAUSED = 4
    const val DM_STATUS_SUCCESSFUL = 8
    const val DM_STATUS_FAILED = 16

    const val DM_PAUSED_WAITING_FOR_NETWORK = 1
    const val DM_PAUSED_WAITING_TO_RETRY = 2
    const val DM_PAUSED_QUEUED_FOR_WIFI = 3
    const val DM_PAUSED_UNKNOWN = 4

    const val DM_ERROR_INSUFFICIENT_SPACE = 1007

    /**
     * What the worker should be told, collapsed from DownloadManager's ~20 reason codes
     * down to the shapes this task names by name: running, done, no network, storage
     * full, everything else. Storage full gets its OWN case rather than folding into
     * FAILED because "delete something" is a different instruction from "wait" or "try
     * again", and a worker cannot fix a mis-diagnosed problem.
     */
    //
    // The three PAUSED reasons are kept apart (TASK-264): only WAITING_FOR_NETWORK is
    // genuinely "no internet" -- WAITING_TO_RETRY is a healthy backoff before
    // DownloadManager tries again on its own, and QUEUED_FOR_WIFI is the OS's own
    // metered/background-data policy, not a connectivity problem at all. Folding all
    // three into one sentence told a worker with mobile data but no WiFi to go find a
    // network that was never the issue.
    enum class DownloadOutcome {
        RUNNING, SUCCESS, WAITING_FOR_NETWORK, WAITING_TO_RETRY, QUEUED_FOR_WIFI, STORAGE_FULL, FAILED
    }

    fun classify(status: Int, reason: Int): DownloadOutcome = when (status) {
        DM_STATUS_SUCCESSFUL -> DownloadOutcome.SUCCESS
        DM_STATUS_PENDING, DM_STATUS_RUNNING -> DownloadOutcome.RUNNING
        DM_STATUS_PAUSED -> when (reason) {
            DM_PAUSED_WAITING_FOR_NETWORK -> DownloadOutcome.WAITING_FOR_NETWORK
            DM_PAUSED_WAITING_TO_RETRY -> DownloadOutcome.WAITING_TO_RETRY
            DM_PAUSED_QUEUED_FOR_WIFI -> DownloadOutcome.QUEUED_FOR_WIFI
            else -> DownloadOutcome.RUNNING
        }
        DM_STATUS_FAILED -> if (reason == DM_ERROR_INSUFFICIENT_SPACE) {
            DownloadOutcome.STORAGE_FULL
        } else {
            DownloadOutcome.FAILED
        }
        else -> DownloadOutcome.FAILED
    }
}
