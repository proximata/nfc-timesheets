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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlin.math.sin

/**
 * THE FLAG-ON DECORATION, AND NOTHING ELSE (decision-57 §3).
 *
 * Simple silhouette figures walking across the screen with a mop, drawn with Compose
 * `Canvas` primitives and driven by `rememberInfiniteTransition`. No Lottie, no Rive, no
 * bundled asset, no new dependency — decision-57 is explicit that the ceiling is "simple
 * moving shapes, not illustrated characters", and the upgrade path is swapping real assets
 * in behind the SAME flag if this is not fun enough.
 *
 * IT IS NEVER A SIGNAL. It is painted underneath the content, in [FunShift.Silhouette],
 * which sits ~1.2:1 against the black — the state words and the clock keep their own
 * contrast against the background and never sit on top of a shape that changes what they
 * read as (DESIGN.md § 3.4's rule survives the flag). The figures are also confined to the
 * BOTTOM THIRD of the screen: the heading, the building name, the clock card and the state
 * words all live above that, so nothing moves behind the text at all.
 *
 * IT IS INVISIBLE TO TALKBACK: `clearAndSetSemantics {}`, the same instrument the ticking
 * digits already use on this screen (`hidden()` is not public API in this Compose version).
 * A per-frame decoration in the a11y tree of a screen whose whole job is one spoken card
 * would be pure noise.
 */
@Composable
fun FunShiftBackdrop(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "fun-shift")
    // ONE clock for the whole scene, and every figure is a phase offset of it. Two
    // independent infinite transitions would drift apart and re-render twice as often.
    val t by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 9_000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "walk",
    )

    Canvas(modifier.fillMaxSize().clearAndSetSemantics { }) {
        // Bottom third only — see the note above. Figures are sized off the WIDTH so a
        // tablet and a phone get the same proportions rather than the same pixels.
        val unit = size.width / 14f
        for (i in 0 until 3) {
            val phase = (t + i / 3f) % 1f
            val x = -2f * unit + phase * (size.width + 4f * unit)
            val y = size.height * (0.80f + 0.06f * i)
            worker(x, y, unit * (1f - 0.12f * i), phase)
        }
    }
}

/**
 * One figure: head, body, two legs mid-stride, and a mop that sweeps. `phase` drives the
 * gait, so all of it is a function of the single animation clock — there is no per-figure
 * state to get out of step.
 */
private fun DrawScope.worker(x: Float, y: Float, unit: Float, phase: Float) {
    val swing = sin(phase * 2f * Math.PI.toFloat() * 6f) // six strides per crossing
    val c = FunShift.Silhouette
    val head = unit * 0.28f
    val bodyH = unit * 0.9f
    val bodyW = unit * 0.36f

    drawCircle(c, radius = head, center = Offset(x, y - bodyH - head))
    drawRoundRect(
        color = c,
        topLeft = Offset(x - bodyW / 2f, y - bodyH),
        size = Size(bodyW, bodyH),
        cornerRadius = androidx.compose.ui.geometry.CornerRadius(bodyW / 2f),
    )
    // Legs: one forward, one back, mirrored around the body. Stroke width is the leg.
    val stride = unit * 0.34f * swing
    drawLine(c, Offset(x, y - unit * 0.2f), Offset(x - stride, y), strokeWidth = unit * 0.16f)
    drawLine(c, Offset(x, y - unit * 0.2f), Offset(x + stride, y), strokeWidth = unit * 0.16f)
    // The mop: a handle held forward, with a head that sweeps a little out of phase.
    val handleTop = Offset(x + bodyW * 0.4f, y - bodyH * 0.8f)
    val handleEnd = Offset(x + unit * (0.9f + 0.12f * swing), y - unit * 0.05f)
    drawLine(c, handleTop, handleEnd, strokeWidth = unit * 0.09f)
    rotate(degrees = 12f * swing, pivot = handleEnd) {
        drawRoundRect(
            color = c,
            topLeft = Offset(handleEnd.x - unit * 0.3f, handleEnd.y),
            size = Size(unit * 0.6f, unit * 0.12f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(unit * 0.06f),
        )
    }
}
