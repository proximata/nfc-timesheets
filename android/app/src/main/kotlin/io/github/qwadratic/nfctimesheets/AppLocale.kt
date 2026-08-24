package io.github.qwadratic.nfctimesheets

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/**
 * IN-APP LANGUAGE OVERRIDE (TASK-258). A plain platform `Configuration` override — NOT
 * androidx.appcompat's `AppCompatDelegate.setApplicationLocales` — because appcompat is not
 * a dependency of this app, its automatic per-Activity recreate only works when every
 * Activity extends `AppCompatActivity` (this app's four UI activities all extend plain
 * `ComponentActivity`/`Activity`, several with hand-tuned NFC reader-mode timing in their
 * own onResume/onPause), and `Theme.TimeSheets` parents a plain platform theme rather than
 * `Theme.AppCompat.*`, so adopting it would also force a theme migration. The platform call
 * this file wraps has existed since API 17, well under this app's minSdk 23 — nothing new
 * to add for it.
 *
 * German is the app default (decision-8/decision-17); [Choice.SYSTEM] therefore means
 * "whatever the OS is set to", not "German" — [wrap] returns the base [Context] UNCHANGED
 * for it, so a phone whose OS is already German or English keeps behaving exactly as it
 * did before this file existed.
 */
enum class Choice(val tag: String?) {
    SYSTEM(null),
    GERMAN("de"),
    ENGLISH("en"),
}

object AppLocale {
    private const val PREFS = "app-locale"
    private const val KEY_CHOICE = "choice"

    fun get(context: Context): Choice {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val stored = prefs.getString(KEY_CHOICE, null) ?: return Choice.SYSTEM
        return Choice.entries.firstOrNull { it.name == stored } ?: Choice.SYSTEM
    }

    fun set(context: Context, choice: Choice) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CHOICE, choice.name)
            .apply()
    }

    /**
     * Called from every UI Activity's `attachBaseContext`, before `onCreate` — the moment
     * an Activity's `Resources` are fixed for its lifetime. [Choice.SYSTEM] never touches
     * [base]: never clobber the OS default when nobody asked for an override. Otherwise a
     * [Configuration] is copied (never mutated in place — [base]'s own config is shared,
     * mutable state this app does not own), the requested locale set on the copy, and
     * `Locale.setDefault` updated too so date/time formatting elsewhere in the app (e.g.
     * `VerifyZoneActivity`'s `DateTimeFormatter.ofLocalizedDateTime`) follows the same
     * choice as the UI text.
     */
    fun wrap(base: Context): Context {
        val choice = get(base)
        val tag = choice.tag ?: return base
        val locale = Locale.forLanguageTag(tag)
        Locale.setDefault(locale)
        val config = Configuration(base.resources.configuration)
        config.setLocale(locale)
        config.setLayoutDirection(locale)
        return base.createConfigurationContext(config)
    }
}
