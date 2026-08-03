// Standalone Gradle build. Deliberately NOT wired into any root build: the repo stays
// multi-root (iOS / server / web / ops / android) and ops/deploy.sh never learns about
// this directory.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "NFCTimeSheets"
include(":app")
