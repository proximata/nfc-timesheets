// Root build file. No shared configuration on purpose — there is exactly one module.
plugins {
    alias(libs.plugins.android.application) apply false
    // No org.jetbrains.kotlin.android: AGP 9 brings its own Kotlin and rejects it.
    alias(libs.plugins.kotlin.compose) apply false
}
