package io.github.qwadratic.nfctimesheets.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * THE BRAND'S PALETTE, NOT THE WORKER'S WALLPAPER.
 *
 * This file used to call `dynamicLightColorScheme(context)` on API 31+, i.e. Material You:
 * the app took the palette Android generates from the user's own wallpaper. On the test
 * instance the clocked-in screen rendered BRIGHT PINK; setting the system palette to green
 * re-rendered the same APK green (`demo/check-app-not-wallpaper.mjs`, which is red against
 * 0.5.1 / versionCode 8 and green against this one).
 *
 * `docs/brand/DESIGN.md` names this exact failure in § 7 — "Android takes the same values
 * into ui/Theme.kt … the drift will show up as an app that does not look like its own
 * admin" — and § 1 measured the company's mark as ACHROMATIC: saturation exactly zero. A
 * per-user hue is not a neutral default here; it is a different product for every cleaner,
 * and the one the director opens in front of a client is whatever is on that phone.
 *
 * It was never caught because nobody had looked: LOOK.md and LOOK-PHONE.md are both about
 * the admin panel. This is the only screen the person doing the work ever sees.
 *
 * WHAT IS KEPT FROM THE OLD FILE, because it was right: every colour used anywhere in the
 * app is a Material ROLE (`onSurfaceVariant`, `error`, `tertiary`), never a literal. Only
 * this file knows a hex. The values below are DESIGN.md § 3.1–3.4 verbatim, so the app and
 * `web/app/globals.css` are two renderings of one list rather than two lists.
 *
 * CONTRAST, computed and not eyeballed (WCAG 2.1 relative luminance, AA is 4.5:1 for body):
 *   dark   onBackground #E9EAEC on #0B0C0E   15.3:1
 *          onSurfaceVariant #A9ADB4 on #1B1E23  7.4:1
 *          onPrimary #0B0C0E on #46E5E0        12.6:1
 *   light  onBackground #16181C on #FAFAFA    16.6:1
 *          onSurfaceVariant #4B5057 on #F0F1F3  7.9:1
 *          onPrimary #0B0C0E on #52BFC0         8.4:1
 *
 * The accent is the live/primary state only, and it is NEVER the only signal — the state
 * words carry the meaning (DESIGN.md § 3.4). Nothing here changes that; it changes which
 * hue the accent is, from "whatever the phone feels like" to one.
 */
@Composable
fun TimeSheetsTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkBrand else LightBrand
    MaterialTheme(colorScheme = colors, content = content)
}

// DESIGN.md § 3.1 surfaces, § 3.2 text, § 3.3 accent. Names are the document's names.
private val BgBaseDark = Color(0xFF0B0C0E)
private val BgRaisedDark = Color(0xFF131519)
private val BgOverlayDark = Color(0xFF1B1E23)
private val TextPrimaryDark = Color(0xFFE9EAEC)
private val TextSecondaryDark = Color(0xFFA9ADB4)
private val TextMutedDark = Color(0xFF6C7178)
private val AccentDark = Color(0xFF46E5E0) // oklch(0.82 0.16 190)

private val BgBaseLight = Color(0xFFFAFAFA)
private val BgRaisedLight = Color(0xFFFFFFFF)
private val BgOverlayLight = Color(0xFFF0F1F3)
private val TextPrimaryLight = Color(0xFF16181C)
private val TextSecondaryLight = Color(0xFF4B5057)
private val TextMutedLight = Color(0xFF767C85)
private val AccentLight = Color(0xFF52BFC0) // oklch(0.72 0.09 190)

/** § 3.4: auto-closed and unresolved. Amber, and always beside the word, never instead. */
private val AmberDark = Color(0xFFE8B45C)
private val AmberLight = Color(0xFFB07A16)

/** Material's own baseline error pair — the one hue in this system nobody invented. */
private val ErrorDark = Color(0xFFFFB4AB)
private val OnErrorDark = Color(0xFF690005)
private val ErrorLight = Color(0xFFBA1A1A)

private val DarkBrand = darkColorScheme(
    primary = AccentDark,
    onPrimary = BgBaseDark,
    primaryContainer = BgOverlayDark,
    onPrimaryContainer = TextPrimaryDark,
    secondary = TextSecondaryDark,
    onSecondary = BgBaseDark,
    secondaryContainer = BgOverlayDark,
    onSecondaryContainer = TextPrimaryDark,
    tertiary = AmberDark,
    onTertiary = BgBaseDark,
    background = BgBaseDark,
    onBackground = TextPrimaryDark,
    surface = BgBaseDark,
    onSurface = TextPrimaryDark,
    surfaceVariant = BgOverlayDark,
    onSurfaceVariant = TextSecondaryDark,
    surfaceContainer = BgRaisedDark,
    surfaceContainerHigh = BgOverlayDark,
    surfaceContainerLow = BgRaisedDark,
    outline = TextMutedDark,
    outlineVariant = BgOverlayDark,
    error = ErrorDark,
    onError = OnErrorDark,
    errorContainer = BgOverlayDark,
    onErrorContainer = ErrorDark,
)

private val LightBrand = lightColorScheme(
    primary = AccentLight,
    onPrimary = BgBaseDark,
    primaryContainer = BgOverlayLight,
    onPrimaryContainer = TextPrimaryLight,
    secondary = TextSecondaryLight,
    onSecondary = BgRaisedLight,
    secondaryContainer = BgOverlayLight,
    onSecondaryContainer = TextPrimaryLight,
    tertiary = AmberLight,
    onTertiary = BgRaisedLight,
    background = BgBaseLight,
    onBackground = TextPrimaryLight,
    surface = BgBaseLight,
    onSurface = TextPrimaryLight,
    surfaceVariant = BgOverlayLight,
    onSurfaceVariant = TextSecondaryLight,
    surfaceContainer = BgOverlayLight,
    surfaceContainerHigh = BgOverlayLight,
    surfaceContainerLow = BgRaisedLight,
    outline = TextMutedLight,
    outlineVariant = BgOverlayLight,
    error = ErrorLight,
    onError = BgRaisedLight,
    errorContainer = BgOverlayLight,
    onErrorContainer = ErrorLight,
)
