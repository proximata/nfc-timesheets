package io.github.qwadratic.nfctimesheets.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.qwadratic.nfctimesheets.core.WireOperatorLocation

/**
 * WHICH BUILDING. One list of buildings, tapped to choose one — and it is ONE list because
 * decision-54 gives the operator two moments that ask the identical question: naming a
 * freshly written card (nfc/WriteTagActivity, §2) and binding a zone that was created
 * without a building (nfc/VerifyZoneActivity, §3). Two copies of a row of buttons would
 * drift the day one of them grows a search box.
 *
 * WHAT IS NOT IN HERE, deliberately: the zone-name field, the Skip button, and the submit.
 * Only the write flow has a name to type, and only the write flow may skip — on the bind
 * side "no building" is not a choice to make, it is the state the operator came here to
 * leave, and they leave it by picking another zone off the worklist instead. Pulling those
 * into this composable would mean parameterising them away again at every call site.
 *
 * @param emptyText what to say when there is nothing to pick, which differs per caller: the
 *   write flow can still create the zone unbound, the bind flow cannot do anything at all.
 */
@Composable
fun BuildingPicker(
    locations: List<WireOperatorLocation>,
    selectedId: String?,
    emptyText: String,
    onPick: (WireOperatorLocation) -> Unit,
) {
    if (locations.isEmpty()) Text(emptyText)
    for (location in locations) {
        OutlinedButton(
            onClick = { onPick(location) },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
        ) {
            // A tapped row is marked in the label itself rather than by a RadioButton: both
            // screens are a column of OutlinedButtons and one control that looks different
            // would read as doing something different.
            Text(if (selectedId == location.id) "\u2713 ${location.name}" else location.name)
        }
    }
}
