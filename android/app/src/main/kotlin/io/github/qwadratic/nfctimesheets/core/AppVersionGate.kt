package io.github.qwadratic.nfctimesheets.core

/**
 * "IS THIS THE FIRST LAUNCH AFTER AN UPDATE?" — the whole of decision-62's decision, as a
 * pure function, so it can be driven off-device by android/checks/core-check.kt.
 *
 * The SharedPreferences shell around it is `data/CacheVersion.kt`; the ACTIONS it triggers
 * are in `TimeSheetsApplication.onCreate`. Split this way for the reason everything in
 * `core/` is: the interesting part is a three-case decision, and a three-case decision that
 * only runs inside an Application object on a phone is a decision nothing ever checks.
 */
object AppVersionGate {

    /**
     * @param lastSeen the versionCode this phone last successfully booted as, or null if
     *   this store has never been written — i.e. a FRESH INSTALL, or the first launch of
     *   the build that introduced this mechanism.
     * @param current [io.github.qwadratic.nfctimesheets.BuildConfig.VERSION_CODE].
     * @return true when cached SERVER READS should be dropped and re-fetched.
     *
     * FRESH INSTALL IS NOT AN UPDATE. There is nothing cached to be stale, so returning
     * true would mean every new install's first act is clearing empty stores. It also
     * matters for the build that ships this: on that one launch `lastSeen` is null for
     * every existing phone, and treating that as an update would drop a worklist for a
     * reason that has nothing to do with the worklist.
     *
     * ANY CHANGE, NOT AN INCREASE. A downgrade (a sideloaded older APK, a Play Store
     * rollback) is exactly as capable of reading a cache written by code that is not it,
     * and `!=` is one character cheaper to be right about than `>`.
     */
    fun invalidatesCaches(lastSeen: Int?, current: Int): Boolean =
        lastSeen != null && lastSeen != current
}
