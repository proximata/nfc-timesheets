package io.github.qwadratic.nfctimesheets.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlin.math.cos
import kotlin.math.sin

/**
 * THE FLAG-ON DECORATION, AND NOTHING ELSE (decision-57 §3, amended by decision-60 §3).
 *
 * A slow dark-to-light BLUE cycle: a vertical gradient that breathes between
 * [FunShift.Deep] and [FunShift.Lift], plus three soft orbs of [FunShift.Lift] drifting
 * across it on the same clock. Compose `Canvas` and `rememberInfiniteTransition` only —
 * no Lottie, no Rive, no bundled asset, no new dependency. It REPLACES decision-57's
 * walking silhouettes, which decision-60 §3 makes optional and which would be clutter
 * behind a moving gradient.
 *
 * IT IS NEVER A SIGNAL. Every colour it paints is a fixed literal from [FunShift], so a
 * wallpaper cannot reach it (see ui/Theme.kt's header for the regression that rule exists
 * for). The lightest pixel it can ever produce is [FunShift.Lift], and the running
 * screen's text colours are all above WCAG AA against THAT — so no frame of the animation
 * can make the state word or the clock unreadable, and the state stays spelled out in
 * words regardless (DESIGN.md § 3.4).
 *
 * IT IS INVISIBLE TO TALKBACK: `clearAndSetSemantics {}`, the same instrument the ticking
 * digits already use on this screen (`hidden()` is not public API in this Compose version).
 * A per-frame decoration in the a11y tree of a screen whose whole job is one spoken card
 * would be pure noise.
 */
@Composable
fun FunShiftBackdrop(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "fun-shift")
    // ONE clock for the whole scene, and every element is a phase offset of it. Two
    // independent infinite transitions would drift apart and re-render twice as often.
    // RepeatMode.Restart, not Reverse: the orb positions below are periodic in `t`, so a
    // restart is seamless while a reverse would visibly run the drift backwards.
    val t by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 24_000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "drift",
    )

    Canvas(modifier.fillMaxSize().clearAndSetSemantics { }) {
        // The wash. `sin` of the one clock, so the whole screen breathes once per cycle
        // rather than snapping at the loop point.
        val breathe = 0.5f + 0.5f * sin(t * 2f * Math.PI.toFloat())
        drawRect(
            brush = Brush.verticalGradient(
                listOf(
                    lerp(FunShift.Deep, FunShift.Lift, 0.10f + 0.35f * breathe),
                    FunShift.Deep,
                ),
            ),
        )
        // Three orbs, each a radial fade to transparent so there is no hard edge anywhere.
        // Sized off the WIDTH so a tablet and a phone get the same proportions rather than
        // the same pixels.
        val unit = size.width
        for (i in 0 until 3) {
            val phase = t * 2f * Math.PI.toFloat() + i * 2.1f
            val cx = size.width * (0.5f + 0.42f * sin(phase))
            val cy = size.height * (0.5f + 0.34f * cos(phase * 0.7f + i))
            val radius = unit * (0.42f + 0.08f * sin(phase * 1.3f))
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(FunShift.Lift.copy(alpha = 0.34f), Color.Transparent),
                    center = Offset(cx, cy),
                    radius = radius,
                ),
                radius = radius,
                center = Offset(cx, cy),
            )
        }
    }
}

/**
 * Straight-line mix of two opaque colours. `androidx.compose.ui.graphics.lerp` exists and
 * does the same job in the Oklab-free sRGB space these two literals already live in — it
 * is imported under the same name as `androidx.compose.ui.unit.lerp` in enough files to be
 * a footgun, so it is spelled out here in four lines instead. Both inputs are opaque, so
 * alpha is not interpolated.
 */
private fun lerp(from: Color, to: Color, f: Float) = Color(
    red = from.red + (to.red - from.red) * f,
    green = from.green + (to.green - from.green) * f,
    blue = from.blue + (to.blue - from.blue) * f,
)
