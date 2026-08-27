package io.github.qwadratic.nfctimesheets.data

import android.content.Context

/**
 * The last answer GET /flags gave (decision-57 §1). One boolean per name, cached so a
 * launch in a basement renders the same screen the worker saw yesterday instead of
 * flickering back to the default while the fetch is in flight.
 *
 * ponytail: plain SharedPreferences, and the whole "flag system" on this phone is a
 * Map<String, Boolean>. NONE OF IT IS A SECRET and none of it gates a clock-in — the only
 * flag today decides which colours a screen is painted in. CEILING: the default for an
 * unknown name is FALSE, so a flag the server has never mentioned is off, and a server
 * that cannot be reached leaves whatever was last written. UPGRADE PATH: if a flag ever
 * needs to gate behaviour rather than paint, it needs a real staleness policy first.
 */
class FlagCache(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("flags", Context.MODE_PRIVATE)

    /** @return false for every name the server has not affirmatively switched on. */
    fun isOn(name: String): Boolean = prefs.getBoolean(name, false)

    /** Replaces the whole map: a flag the server no longer returns goes back to false. */
    fun replace(flags: Map<String, Boolean>) {
        val edit = prefs.edit().clear()
        for ((name, on) in flags) edit.putBoolean(name, on)
        edit.apply()
    }

    companion object {
        /** decision-57 §3: the running-shift screen's playful variant. */
        const val FUN_SHIFT_SCREEN = "fun_shift_screen"
    }
}
