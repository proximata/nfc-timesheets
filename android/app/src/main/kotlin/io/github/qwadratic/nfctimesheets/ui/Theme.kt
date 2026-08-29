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
 * THE RUNNING-SHIFT SCREEN'S OWN COLOUR (decision-60 §2), AND WHY IT DOES NOT REOPEN THE
 * BUG THE REST OF THIS FILE CLOSES.
 *
 * decision-57 §3 froze this screen's flag-OFF default as achromatic and required a
 * superseding decision before touching it. decision-60 is that decision: the owner ruled
 * out green on iOS and ruled the Android baseline over to a BLUE. So the running screen —
 * and only the running screen — is the one place in this app that carries a hue by
 * default.
 *
 * THESE ARE FIXED LITERALS. Not `MaterialTheme`, not `dynamicDarkColorScheme`, not
 * `isSystemInDarkTheme()`. The wallpaper-bleed regression this file's header describes at
 * length (Material You painting the clocked-in screen bright pink, then Material's
 * BASELINE PURPLE painting it pink again through unassigned roles) is a class of bug, and
 * the way it stays impossible is that this screen's colour is a constant — which colour
 * the constant is was never the point. `demo/check-shift-screen-brand.mjs` measures these
 * exact values on a device, `demo/check-app-not-wallpaper.mjs` proves the app still does
 * not follow the system palette, and `checks/core-check.kt` § 17/§ 18 read them out of
 * this file on a plain JVM.
 *
 * CONTRAST, computed (WCAG 2.1 relative luminance), not eyeballed:
 *   OnContainer #E6ECF5 on Container #10243D   13.2:1
 *   Outline     #9FC4E8 on Container #10243D    8.6:1
 * The state word under the clock (DESIGN.md § 3.4) still carries the meaning in WORDS —
 * greyscale legibility is unaffected by any of this.
 */
object ShiftBrand {
    /** The running shift's field. Fixed, dark, blue-tinted (decision-60 §2). */
    val Container = Color(0xFF10243D)
    val OnContainer = Color(0xFFE6ECF5)

    /**
     * The border of an OUTLINED control sitting ON [Container]. Material resolves an
     * OutlinedButton's border from `colorScheme.outline`, which is this project's muted
     * grey — chosen against the app's own surfaces, not against this screen's overridden
     * field. The result was a „Ohne Tag beenden" button with no visible border at all: the
     * one control a worker reaches for when their card will not read, looking inert (the
     * 2026-08-29 cross-platform UX audit's B1). 8.6:1 against [Container].
     */
    val Outline = Color(0xFF9FC4E8)
}

/**
 * THE OPT-IN PLAYFUL RUNNING-SHIFT SCREEN (decision-57 §3, as amended by decision-60 §3).
 *
 * The flag's visual payload used to be a true black plus walking silhouettes. decision-60
 * §3 replaces it with a slow gradient cycling between a darker and a lighter blue — the
 * SAME native-primitives-only ceiling (Compose `Canvas` + `rememberInfiniteTransition`, no
 * asset, no library), and the same literal-only rule as [ShiftBrand] above. The
 * silhouettes are gone rather than layered under the gradient: two decorations competing
 * on one screen is exactly the clutter decision-60 §3 tells the implementer to cut.
 *
 * The flag is still OFF by default, and OFF is now [ShiftBrand]'s plain blue.
 *
 * CONTRAST at the WORST point of the cycle, i.e. against [Lift], the lightest the screen
 * ever gets: [ShiftBrand.OnContainer] 7.1:1, [Overdue] 5.0:1, [ShiftBrand.Outline] 4.6:1.
 * All above AA for body text, so no frame of the animation can make a word unreadable.
 */
object FunShift {
    /** The bottom of the cycle. */
    val Deep = Color(0xFF0A1626)
    /** The top of the cycle, and the contrast floor every value above is computed against. */
    val Lift = Color(0xFF1F4E85)
    /** Overdue still reads red — the one thing that must never mean "fine". */
    val Overdue = Color(0xFFFFB4AB)
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
