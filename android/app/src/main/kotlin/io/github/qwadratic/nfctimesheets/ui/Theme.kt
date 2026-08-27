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
 *
 * EVERY ROLE IS ASSIGNED, AND THAT IS THE POINT OF THE SECOND FIX (2026-08-21 verdict pass).
 * The first version of this file assigned 24 of Material's roles and left the rest at
 * Google's baseline — which is a PURPLE family, not a neutral one. `TimeSheetApp.kt` paints
 * the running shift with `tertiaryContainer`/`onTertiaryContainer` and its clock card with
 * `surfaceContainerHighest`, and none of those three was assigned. Measured on the shipped
 * 0.5.2 / versionCode 9, on the clocked-in screen:
 *
 *   #FFD8E4  47.9% of the app's pixels   channel spread 39   baseline tertiaryContainer
 *   #E6E0E9  40.9%                       channel spread  9   baseline surfaceContainerHighest
 *   #31111D   0.7%                       channel spread 32   baseline onTertiaryContainer
 *
 * So 88.8% of the ONE screen the person doing the work looks at all day was still a colour
 * nobody in this project chose — after the fix, and with `check-app-not-wallpaper.mjs`
 * green over it, because that check cold-starts the app with no tap intent and therefore
 * photographs the idle screen and never the running one.
 *
 * A partial scheme is a scheme with a silent default behind it. `checks/core-check.kt` § 17
 * now fails if any role rendered anywhere in `app/src` is missing from EITHER scheme, and
 * `demo/check-shift-screen-brand.mjs` measures the running screen on a device.
 *
 * ELEVATION READS THE SAME WAY IN BOTH THEMES: the card on the running screen must be one
 * step ABOVE its background. Dark raises by getting lighter (#131519 field, #1B1E23 card);
 * light raises by getting lighter too (#F0F1F3 field, #FFFFFF card). `surfaceTint` is set
 * to the surface itself so Material's tonal-elevation overlay adds nothing — in a flat
 * achromatic system that overlay is a hue leak, and it is the accent it leaks.
 */
@Composable
fun TimeSheetsTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkBrand else LightBrand
    MaterialTheme(colorScheme = colors, content = content)
}

/**
 * THE OPT-IN PLAYFUL RUNNING-SHIFT SCREEN (decision-57 §3), AND WHY IT DOES NOT REOPEN
 * THE BUG THE REST OF THIS FILE CLOSES.
 *
 * These are FIXED LITERALS, exactly like every other value in this file, and they are the
 * only ones the flag-ON screen paints with. They are NOT derived from `MaterialTheme`, NOT
 * from `dynamicDarkColorScheme`, and NOT from `isSystemInDarkTheme()` — the whole point of
 * the flag is a screen that is the SAME black on every phone, so a wallpaper still cannot
 * reach it. `demo/check-fun-shift-black.mjs` reads this file and fails if it ever becomes
 * anything but a literal black.
 *
 * The flag is OFF by default and OFF is bit-for-bit today's screen: nothing below is read
 * unless the server has switched `fun_shift_screen` on, and `TimeSheetsTheme` itself is
 * untouched, so `check-app-not-wallpaper.mjs`, `check-shift-screen-brand.mjs` and
 * `core-check.kt` § 17 keep measuring exactly what they measured before.
 *
 * CONTRAST, computed the same way as above: FunOnBlack #E9EAEC on #000000 is 16.9:1, and
 * FunOverdue #FFB4AB on #000000 is 10.0:1 — both above AA for body text. The silhouettes
 * are drawn at #1A1D22, i.e. 1.2:1 against the black: they are texture, never a signal,
 * and they are painted BEHIND the words, which keep their own full contrast.
 */
object FunShift {
    /** A true black, on purpose and regardless of the system theme (decision-57 §3). */
    val Black = Color(0xFF000000)
    val OnBlack = Color(0xFFE9EAEC)
    /** Overdue still reads red — the one thing that must never mean "fine". */
    val Overdue = Color(0xFFFFB4AB)
    /** The moving shapes. Barely above the background: decoration, never the state. */
    val Silhouette = Color(0xFF1A1D22)
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

/** The dim behind a modal. Black is correct here and is the one place it is. */
private val ScrimBlack = Color(0xFF000000)

private val DarkBrand = darkColorScheme(
    primary = AccentDark,
    onPrimary = BgBaseDark,
    primaryContainer = BgOverlayDark,
    onPrimaryContainer = TextPrimaryDark,
    inversePrimary = AccentLight,
    secondary = TextSecondaryDark,
    onSecondary = BgBaseDark,
    secondaryContainer = BgOverlayDark,
    onSecondaryContainer = TextPrimaryDark,
    tertiary = AmberDark,
    onTertiary = BgBaseDark,
    // The RUNNING shift's field. Achromatic on purpose: DESIGN.md § 3.4 makes the state
    // readable from the word and the clock, and the accent is one thing per screen — not a
    // half-screen wash. onTertiaryContainer #E9EAEC on #131519 is 14.9:1.
    tertiaryContainer = BgRaisedDark,
    onTertiaryContainer = TextPrimaryDark,
    background = BgBaseDark,
    onBackground = TextPrimaryDark,
    surface = BgBaseDark,
    onSurface = TextPrimaryDark,
    surfaceVariant = BgOverlayDark,
    onSurfaceVariant = TextSecondaryDark,
    surfaceTint = BgBaseDark,
    inverseSurface = TextPrimaryDark,
    inverseOnSurface = BgBaseDark,
    surfaceBright = BgOverlayDark,
    surfaceDim = BgBaseDark,
    surfaceContainerLowest = BgBaseDark,
    surfaceContainerLow = BgRaisedDark,
    surfaceContainer = BgRaisedDark,
    surfaceContainerHigh = BgOverlayDark,
    surfaceContainerHighest = BgOverlayDark,
    outline = TextMutedDark,
    outlineVariant = BgOverlayDark,
    scrim = ScrimBlack,
    error = ErrorDark,
    onError = OnErrorDark,
    // The OVERDUE field is the same geometry as the running one; what differs is the word
    // and the red it is set in, so the two survive a greyscale screenshot (DESIGN.md § 3.4).
    errorContainer = BgRaisedDark,
    onErrorContainer = ErrorDark,
)

private val LightBrand = lightColorScheme(
    primary = AccentLight,
    onPrimary = BgBaseDark,
    primaryContainer = BgOverlayLight,
    onPrimaryContainer = TextPrimaryLight,
    inversePrimary = AccentDark,
    secondary = TextSecondaryLight,
    onSecondary = BgRaisedLight,
    secondaryContainer = BgOverlayLight,
    onSecondaryContainer = TextPrimaryLight,
    tertiary = AmberLight,
    onTertiary = BgRaisedLight,
    // See DarkBrand. onTertiaryContainer #16181C on #F0F1F3 is 15.9:1.
    tertiaryContainer = BgOverlayLight,
    onTertiaryContainer = TextPrimaryLight,
    background = BgBaseLight,
    onBackground = TextPrimaryLight,
    surface = BgBaseLight,
    onSurface = TextPrimaryLight,
    surfaceVariant = BgOverlayLight,
    onSurfaceVariant = TextSecondaryLight,
    surfaceTint = BgBaseLight,
    inverseSurface = TextPrimaryLight,
    inverseOnSurface = BgBaseLight,
    surfaceBright = BgRaisedLight,
    surfaceDim = BgOverlayLight,
    surfaceContainerLowest = BgRaisedLight,
    surfaceContainerLow = BgRaisedLight,
    surfaceContainer = BgOverlayLight,
    surfaceContainerHigh = BgOverlayLight,
    surfaceContainerHighest = BgRaisedLight,
    outline = TextMutedLight,
    outlineVariant = BgOverlayLight,
    scrim = ScrimBlack,
    error = ErrorLight,
    onError = BgRaisedLight,
    errorContainer = BgOverlayLight,
    onErrorContainer = ErrorLight,
)
