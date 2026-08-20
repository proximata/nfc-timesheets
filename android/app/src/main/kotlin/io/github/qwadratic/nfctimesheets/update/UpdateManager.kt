package io.github.qwadratic.nfctimesheets.update

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import io.github.qwadratic.nfctimesheets.BuildConfig
import io.github.qwadratic.nfctimesheets.core.RemoteRelease
import io.github.qwadratic.nfctimesheets.core.UpdateCheck
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.net.Api
import java.io.File
import java.security.MessageDigest

sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val release: RemoteRelease) : UpdateState
    data class Downloading(val release: RemoteRelease, val percent: Int?, val waitingForNetwork: Boolean) :
        UpdateState
    data class ReadyToInstall(val release: RemoteRelease, val uri: Uri) : UpdateState
    /** @param release null only for a check that never got far enough to name one. */
    data class Failed(val release: RemoteRelease?, val reasonKey: String) : UpdateState
}

/**
 * Self-update (this iteration). "Is there a newer build" + "get it onto this phone" — the
 * whole reason the field phone sat dead for five days shipping a fix over Telegram.
 *
 * WORKER-INITIATED, WORKER-VISIBLE ONLY IN SETTINGS (ui/TimeSheetApp.kt SettingsScreen,
 * driven by TimeSheetViewModel's update* functions — the only callers). NOTHING HERE
 * RUNS ON THE TAP OR CLOCK-OUT PATH: a launch-time check is silent and only ever OFFERS
 * an update; downloading and installing are both an explicit button press. A running
 * shift is never interrupted by any of this — see the note rendered next to the install
 * button when one is open.
 *
 * DownloadManager, not a hand-rolled HTTP download: it already handles a paused network,
 * a resumed connection, a completed-download system notification and process-death
 * survival — exactly the "no network / partial download" cases this task names, for
 * free, from a system service instead of new code that could get them wrong.
 */
class UpdateManager(context: Context, private val api: Api) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("update", Context.MODE_PRIVATE)
    private val downloadManager
        get() = appContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

    /**
     * GET /app/version, classified against the running build. Never throws: a network
     * failure here is exactly as unremarkable as a roster refresh failing
     * (data/ShiftSync) — the phone is offline, not rejected, and the caller shows that
     * as a retryable state, never an error dialog that blocks anything.
     */
    suspend fun checkForUpdate(): UpdateState {
        val json = runCatching { api.appVersion() }.getOrElse {
            return UpdateState.Failed(null, "err_network")
        }
        val release = runCatching { Wire.release(json) }.getOrNull()
            ?: return UpdateState.UpToDate
        return if (UpdateCheck.isNewer(release, BuildConfig.VERSION_CODE)) {
            UpdateState.Available(release)
        } else {
            UpdateState.UpToDate
        }
    }

    /**
     * Enqueues the download and returns DownloadManager's own id, which the caller polls
     * with [pollDownload]. Synchronous and cheap — DownloadManager does the actual work
     * on its own thread, outside this process even, which is what makes [resumePending]
     * meaningful: the download keeps going even if this process is killed.
     */
    fun enqueueDownload(release: RemoteRelease): Long {
        targetFile().delete() // a stale half-written attempt must never look like a fresh one

        val url = "https://${BuildConfig.API_HOST}${release.url}"
        val request = DownloadManager.Request(Uri.parse(url))
            // Same gate as every other route: the app key proves "our app", never "this
            // person" (net/Api.kt's own comment). DownloadManager attaches it to every
            // request it issues for this download, including a retry after a paused wait.
            .addRequestHeader("X-App-Key", BuildConfig.APP_KEY)
            .setDestinationInExternalFilesDir(appContext, Environment.DIRECTORY_DOWNLOADS, FILENAME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            // A fix for a phone that cannot clock in must not wait for wifi.
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
            .setMimeType("application/vnd.android.package-archive")

        val id = downloadManager.enqueue(request)
        prefs.edit()
            .putLong(KEY_DOWNLOAD_ID, id)
            .putInt(KEY_VERSION_CODE, release.versionCode)
            .putString(KEY_VERSION_NAME, release.versionName)
            .putString(KEY_SHA256, release.sha256)
            .putString(KEY_NOTES, release.notes)
            .putString(KEY_URL, release.url)
            .apply()
        return id
    }

    /**
     * A download this manager started that may still be running. Read once, at launch
     * (TimeSheetViewModel.checkForUpdateSilently), so a worker who left the app
     * mid-download — or whose process was killed by the OS — does not lose the progress
     * bar on return; DownloadManager itself already kept going without them.
     */
    fun resumePending(): Pair<Long, RemoteRelease>? {
        val id = prefs.getLong(KEY_DOWNLOAD_ID, -1).takeIf { it > 0 } ?: return null
        val versionCode = prefs.getInt(KEY_VERSION_CODE, -1).takeIf { it > 0 } ?: return null
        val url = prefs.getString(KEY_URL, null) ?: return null
        return id to RemoteRelease(
            versionCode = versionCode,
            versionName = prefs.getString(KEY_VERSION_NAME, null),
            sha256 = prefs.getString(KEY_SHA256, null),
            notes = prefs.getString(KEY_NOTES, null),
            url = url,
        )
    }

    /**
     * One query against DownloadManager's own table, classified. Called from a loop on
     * the CALLER's side (ViewModel + Compose) rather than from a coroutine owned by this
     * class — exactly the pattern the running-shift clock already uses (`produceState`
     * in ui/TimeSheetApp.kt) — so nothing here keeps polling after the screen that
     * started it is gone, and the download itself is never at risk of being cancelled by
     * that: DownloadManager owns it independently of anyone watching.
     */
    fun pollDownload(id: Long, release: RemoteRelease): UpdateState {
        val cursor = downloadManager.query(DownloadManager.Query().setFilterById(id))
        cursor.use {
            if (!it.moveToFirst()) return UpdateState.Failed(release, "err_update_failed")
            val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
            val downloaded = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
            val percent = if (total > 0) ((downloaded * 100) / total).toInt() else null

            return when (UpdateCheck.classify(status, reason)) {
                UpdateCheck.DownloadOutcome.RUNNING ->
                    UpdateState.Downloading(release, percent, waitingForNetwork = false)
                UpdateCheck.DownloadOutcome.WAITING_FOR_NETWORK ->
                    UpdateState.Downloading(release, percent, waitingForNetwork = true)
                UpdateCheck.DownloadOutcome.STORAGE_FULL ->
                    UpdateState.Failed(release, "err_update_storage_full")
                UpdateCheck.DownloadOutcome.FAILED ->
                    UpdateState.Failed(release, "err_update_failed")
                UpdateCheck.DownloadOutcome.SUCCESS -> verify(id, release)
            }
        }
    }

    /**
     * The download reports SUCCESSFUL. Verified against the manifest's own sha256 (when
     * one is published — server/routes/release.js §2's field is optional) before it is
     * ever offered for install: a truncated byte stream that DownloadManager still calls
     * "successful" (seen on flaky mobile networks, mid-tunnel drops) must not reach
     * PackageInstaller looking like the real build. The OS's own signature check on
     * install is a second, independent line of defence, not a substitute for this one —
     * a corrupted file may not even carry a parseable signature block to reject.
     */
    private fun verify(id: Long, release: RemoteRelease): UpdateState {
        val file = targetFile()
        val expected = release.sha256?.trim()?.lowercase()
        if (!expected.isNullOrEmpty()) {
            val actual = runCatching { sha256Of(file) }.getOrNull()
            if (actual != expected) {
                file.delete() // never left lying around looking like a good file
                return UpdateState.Failed(release, "err_update_corrupt")
            }
        }
        // content:// from DownloadManager's own provider, NOT a file:// Uri: handing a
        // file:// Uri to another app's Intent (PackageInstaller) throws
        // FileUriExposedException on this app's targetSdk. getUriForDownloadedFile is
        // the documented, no-FileProvider-needed way to get one back for a download this
        // manager itself created.
        val uri = runCatching { downloadManager.getUriForDownloadedFile(id) }.getOrNull()
            ?: return UpdateState.Failed(release, "err_update_failed")
        return UpdateState.ReadyToInstall(release, uri)
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * The install hand-off. ACTION_VIEW + the apk mime type is the same path a browser
     * download uses; the OS shows its own PackageInstaller confirmation UI, which is
     * also where a SIGNATURE MISMATCH is refused — "Android refuses an update signed
     * with a different key... that is the behaviour you want" (this task's own brief).
     * FLAG_GRANT_READ_URI_PERMISSION grants PackageInstaller read access to a Uri this
     * app owns but the installer does not.
     */
    fun installIntent(uri: Uri): Intent =
        Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)

    fun installReadiness(context: Context): UpdateReadiness = UpdateReadiness.of(context)

    private fun targetFile(): File {
        val dir = appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        return File(dir, FILENAME)
    }

    private companion object {
        // Fixed filename, overwritten every attempt: this iteration ships "the latest
        // build", never a rollback shelf (routes/release.js's own header says the same
        // about GET /app/download), so there is never a second file to disambiguate.
        const val FILENAME = "nfc-timesheets-update.apk"

        const val KEY_DOWNLOAD_ID = "download_id"
        const val KEY_VERSION_CODE = "version_code"
        const val KEY_VERSION_NAME = "version_name"
        const val KEY_SHA256 = "sha256"
        const val KEY_NOTES = "notes"
        const val KEY_URL = "url"
    }
}
