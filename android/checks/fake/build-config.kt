package io.github.qwadratic.nfctimesheets

/**
 * STUB for the Gradle-generated `BuildConfig`, so net/Api.kt — the byte-identical file that
 * ships — compiles and RUNS off-device. `var`, not `const`: checks/operator-401-check.kt
 * points [API_HOST] at the loopback HTTPS server it starts, which is the only way to make a
 * real 401 travel through Api's real choke point without a device and without a server.
 */
object BuildConfig {
    @JvmStatic
    var API_HOST: String = "localhost:0"
    const val APP_KEY: String = "checks-app-key"
    const val VERSION_NAME: String = "checks"
}
