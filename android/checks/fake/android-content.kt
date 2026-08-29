package android.content

/**
 * STUB. The absolute minimum of `android.content` for net/CookieJar.kt to COMPILE on a
 * plain JVM — see checks/fake/android-nfc.kt for why the package name is the real one.
 *
 * Nothing here runs. `PrefsCookieJar` is never constructed by any check: what the checks
 * need out of that file is the `CookieJar` INTERFACE, which is Android-free and which
 * net/Api.kt takes as a constructor argument, and the two happen to live in one file. So
 * these three declarations exist to let the file parse and for no other reason —
 * [Context.getSharedPreferences] throws rather than pretending to be a store.
 */
interface SharedPreferences {
    fun getString(key: String, defValue: String?): String?
    fun edit(): Editor

    interface Editor {
        fun putString(key: String, value: String?): Editor
        fun remove(key: String): Editor
        fun commit(): Boolean
        fun apply()
    }
}

open class Context {
    val applicationContext: Context get() = this

    fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
        throw UnsupportedOperationException("checks never touch real preferences")

    companion object {
        const val MODE_PRIVATE = 0
    }
}
