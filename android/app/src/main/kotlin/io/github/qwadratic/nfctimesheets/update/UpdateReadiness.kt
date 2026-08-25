package io.github.qwadratic.nfctimesheets.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Whether THIS app is currently allowed to trigger a package install — the per-app
 * "install unknown apps" toggle Android 8+ requires for anything outside Play. Checked
 * before ever handing the downloaded APK to the system installer, so a refusal is a
 * labelled screen with a button to the right settings page, not the installer silently
 * doing nothing (or, on some OEM builds, a confusing generic dialog).
 *
 * Mirrors nfc/NfcReadiness.kt's shape on purpose: same kind of silent, device-specific
 * failure mode, same fix (send the worker straight to the one setting that matters).
 */
enum class UpdateReadiness {
    ALLOWED,
    BLOCKED,
    ;

    companion object {
        fun of(context: Context): UpdateReadiness =
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()) {
                // Below O the permission does not exist at all; the OS's own "unknown
                // sources" prompt (a global toggle, not per-app) handles it if disabled.
                ALLOWED
            } else {
                BLOCKED
            }

        /** THIS app's own toggle, not the general "special app access" list — one fewer
         *  tap for the worker to find it. */
        fun settingsIntent(context: Context): Intent =
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:${context.packageName}"))

        /**
         * A download genuinely QUEUED_FOR_WIFI (TASK-264) despite enqueueDownload()
         * already setting setAllowedOverMetered(true)/setAllowedOverRoaming(true) is the
         * OS's own background-data/Data-Saver restriction for THIS app -- there is no
         * DownloadManager API to force it through from code, so the honest fix is the
         * same shape as [settingsIntent]: send the worker straight to the one setting
         * that matters. ACTION_IGNORE_BACKGROUND_DATA_RESTRICTIONS_SETTINGS is API 24+;
         * this app's minSdk is 23, so below that falls back to the app's own details page,
         * which carries the same Data usage / background data controls on every OEM build.
         */
        fun wifiOnlySettingsIntent(context: Context): Intent =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                Intent(Settings.ACTION_IGNORE_BACKGROUND_DATA_RESTRICTIONS_SETTINGS)
                    .setData(Uri.parse("package:${context.packageName}"))
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:${context.packageName}"))
            }
    }
}
