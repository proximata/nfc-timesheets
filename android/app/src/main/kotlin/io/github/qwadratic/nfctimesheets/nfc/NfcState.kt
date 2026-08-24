package io.github.qwadratic.nfctimesheets.nfc

/**
 * Checked in onResume by every operator screen that touches a card — [VerifyZoneActivity]
 * (test scan) and [WriteTagActivity] (write). ONE DEFINITION, TWO CALL SITES (TASK-257).
 */
enum class NfcState { READY, UNSUPPORTED, DISABLED }
