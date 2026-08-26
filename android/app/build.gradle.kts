import java.util.Properties

plugins {
    // AGP 9 has built-in Kotlin support: applying org.jetbrains.kotlin.android on top of it
    // is a hard error ("no longer required for Kotlin support since AGP 9.0").
    // See https://kotl.in/gradle/agp-built-in-kotlin
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// ---------------------------------------------------------------------------------
// White-label surface. Every operator identity comes from ONE committed file, and
// every signing secret comes from a file that is NOT committed.
// ---------------------------------------------------------------------------------

fun props(file: File): Properties = Properties().apply {
    if (file.exists()) file.inputStream().use { load(it) }
}

val branding = props(rootProject.file("branding.properties"))

/**
 * A missing branding key is a HARD FAILURE, never an empty string.
 *
 * This is the one place Android is better than Xcode and it is deliberate: an
 * undefined Xcode build setting expands to "" and silently produces
 * `applinks:` in the entitlement, which kills universal links on the next build.
 * Gradle can just refuse. So it does.
 */
fun brand(key: String): String = branding.getProperty(key)?.trim().orEmpty().ifEmpty {
    throw GradleException("branding.properties is missing '$key' — see android/README.md")
}


// Resolution order: keystore.properties (gitignored) -> environment -> debug signing.
val keystore = props(rootProject.file("keystore.properties"))
fun signing(key: String, env: String): String? =
    (keystore.getProperty(key) ?: System.getenv(env))?.trim()?.takeIf { it.isNotEmpty() }

val storeFilePath = signing("storeFile", "TS_KEYSTORE_PATH")
val storePasswordValue = signing("storePassword", "TS_KEYSTORE_PASSWORD")
val keyAliasValue = signing("keyAlias", "TS_KEY_ALIAS")
val keyPasswordValue = signing("keyPassword", "TS_KEY_PASSWORD")
val hasUploadKey = listOf(storeFilePath, storePasswordValue, keyAliasValue, keyPasswordValue)
    .all { it != null } && file(storeFilePath!!).exists()

android {
    namespace = brand("ts.namespace")
    compileSdk = 36

    defaultConfig {
        // IMMUTABLE once uploaded to Play, and it is what
        // server/wellknown/assetlinks.json already publishes. Do not "tidy" the case.
        applicationId = brand("ts.applicationId")
        // 21 = Android 5.0. Lowered from 26 to reach older phones already in cleaners'
        // hands. The cost is three compatibility shims in ShiftSignals.kt (notification
        // channels are 26+, FLAG_IMMUTABLE and getSystemService(Class) are 23+), each
        // guarded and commented at its site. Compose itself supports 21.
        //
        // CEILING: below API 26 there are no notification channels, so the worker cannot
        // silence the shift reminder per-category — only for the whole app. Below 23 the
        // PendingIntent is mutable, which is acceptable only because it carries no extras.
        // If either becomes a real problem, raise this to 23 or 26 rather than working
        // around it further.
        minSdk = 23
        targetSdk = 36
        versionCode = brand("ts.versionCode").toInt()
        versionName = brand("ts.versionName")

        // Consumed by AndroidManifest.xml. An unresolved placeholder FAILS the build,
        // which is the whole reason the host is templated here and not in source.
        //
        // ONLY the TAG host reaches the manifest (decision-40). The API host is renameable,
        // and App Link verification is all-or-nothing across the hosts in an autoVerify
        // filter: putting a renameable host in there means the day it is renamed, taps on
        // the PERMANENT host stop working too.
        manifestPlaceholders["tagHost"] = brand("ts.tagHost")

        resValue("string", "app_name", brand("ts.appName"))

        // TAG_HOST: what a tag NAMES. Parsed (TagLink), never fetched.
        // API_HOST:  what the app TALKS to (Api.kt). Never in the manifest.
        // One value once; the box got renamed and a tag on a wall died. decision-40.
        buildConfigField("String", "TAG_HOST", "\"${brand("ts.tagHost")}\"")
        buildConfigField("String", "API_HOST", "\"${brand("ts.apiHost")}\"")
        // Hosts we ONCE wrote onto tags. Accepted by the PARSER only; deliberately not a
        // manifest placeholder, because App Link verification is all-or-nothing across the
        // hosts in an autoVerify filter and a dead legacy host would un-verify the live one.
        // NOT a secret — see branding.properties. It proves "our app", never "this person".
        buildConfigField("String", "APP_KEY", "\"${brand("ts.appKey")}\"")
    }

    signingConfigs {
        if (hasUploadKey) {
            create("upload") {
                storeFile = file(storeFilePath!!)
                storePassword = storePasswordValue
                keyAlias = keyAliasValue
                keyPassword = keyPasswordValue
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // No upload key on this machine -> debug signature. The build succeeds, the
            // app runs, and Play refuses the artifact. Loud, and in the right place.
            signingConfig = if (hasUploadKey) {
                signingConfigs.getByName("upload")
            } else {
                signingConfigs.getByName("debug")
            }
        }
        debug {
            // Same applicationId as release ON PURPOSE. An applicationId suffix would
            // make App Links verification fail against the published assetlinks.json,
            // i.e. the debug build could never reproduce the only bug that matters.
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
        // AGP 9 turns resValues off by default. defaultConfig calls resValue("string",
        // "app_name", ...) — without this the build fails with "defaultConfig contains
        // custom resource values, but the feature is disabled".
        resValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // src/main/kotlin is a default Kotlin source directory under AGP 9's built-in Kotlin.
    // The old sourceSets.getByName("main").java.srcDir(...) is both redundant and deprecated.

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // org.json and android.database.sqlite are in android.jar. There is no HTTP, JSON
    // or persistence dependency here, and adding one needs a reason in writing.
}
