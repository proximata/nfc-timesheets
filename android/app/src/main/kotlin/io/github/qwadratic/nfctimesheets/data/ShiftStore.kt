package io.github.qwadratic.nfctimesheets.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import io.github.qwadratic.nfctimesheets.core.PendingWork
import io.github.qwadratic.nfctimesheets.core.SyncPlan.QueuedShift
import io.github.qwadratic.nfctimesheets.core.WireLocation
import io.github.qwadratic.nfctimesheets.core.WireShift
import io.github.qwadratic.nfctimesheets.core.WireZone
import java.time.Instant
import java.util.UUID

/**
 * The local queue. THE SERVER IS THE TRUTH (decision-19); this table exists so a tap in
 * a basement still counts and is pushed when there is a signal.
 *
 * Columns mirror the SwiftData `Shift` model in NFCTimeSheetsApp.swift one-for-one, so
 * one worker's two phones behave identically and one reader can diff the two.
 *
 * ponytail: SQLiteOpenHelper, not Room. CEILING: no compile-time query checking, no Flow,
 * migrations are hand-written. Justified because the store is one table of a few hundred
 * rows a year, and because Room means a KSP plugin and generated DAOs — code this project
 * cannot compile or inspect without a full Android toolchain. UPGRADE PATH: everything
 * outside this file talks in [QueuedShift] and [LocalShift]; swapping the implementation
 * is one file.
 */
class ShiftStore(context: Context) : SQLiteOpenHelper(context.applicationContext, "timesheets.db", null, 3) {

    override fun onCreate(db: SQLiteDatabase) {
        // client_uuid is the PRIMARY KEY, not an afterthought: it is the idempotency key
        // for BOTH halves of the shift (decision-19). A double tap at the door and a
        // retry after a dropped connection must never produce two rows, locally either.
        db.execSQL(
            """
            CREATE TABLE shifts (
              client_uuid     TEXT PRIMARY KEY,
              worker_id       INTEGER NOT NULL,
              location_id     TEXT NOT NULL,
              start_time      TEXT NOT NULL,
              end_time        TEXT,
              auto_closed     INTEGER NOT NULL DEFAULT 0,
              corrected_at    TEXT,
              server_id       INTEGER,
              open_synced_at  TEXT,
              close_synced_at TEXT,
              sync_error      TEXT,
              sync_blocked    INTEGER NOT NULL DEFAULT 0,
              last_attempt_at TEXT
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX shifts_start_idx ON shifts (start_time)")
        db.execSQL(
            """
            CREATE TABLE locations (
              id   TEXT PRIMARY KEY,
              slug TEXT NOT NULL,
              name TEXT NOT NULL
            )
            """.trimIndent(),
        )
        createZonesTable(db)
    }

    /**
     * decision-44: the roster-cached adopted-tag map. Cleared and repopulated by
     * [replaceRoster], same as `locations`. `tag_serial` is nullable — a zone with no
     * adopted tag on it (the ordinary case, since most zones will only ever carry a
     * proper URL tag) still rides along so a name is cached for it.
     */
    private fun createZonesTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE zones (
              id          TEXT PRIMARY KEY,
              location_id TEXT NOT NULL,
              name        TEXT NOT NULL,
              tag_serial  TEXT
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // THIS RUNS AGAINST THE FIELD PHONE'S REAL, ALREADY-INSTALLED FILE on its next
        // launch after `adb install -r`. Never DROP: these rows are somebody's unpaid
        // hours. version 1 -> 2 only ADDS the zones table; shifts and locations are
        // untouched.
        // Sequential and cumulative, not a pair of exact-version arms. The old shape was
        // `if (oldVersion == 1 && newVersion == 2)` and it would have THROWN on the phone
        // in the field the moment a second migration existed: that phone is on version 1,
        // the new app is on version 3, and 1 -> 3 matched nothing. A throw here is a crash
        // at launch on a device holding somebody's unpaid hours.
        if (oldVersion < 2) createZonesTable(db)
        if (oldVersion < 3) {
            // TASK-225. ADD COLUMN, nullable, no default: every existing row means "never
            // attempted", which is exactly what NULL says and exactly what the screen
            // then prints ("noch nicht versucht"), rather than inventing a timestamp.
            db.execSQL("ALTER TABLE shifts ADD COLUMN last_attempt_at TEXT")
        }
        // No downgrade arm: SQLiteOpenHelper never calls this for newVersion < oldVersion
        // (it calls onDowngrade, which throws by default). A branch here could not fire.
    }

    // ---- shifts --------------------------------------------------------------------

    fun startShift(workerId: Int, locationId: String, startTime: Instant = Instant.now()): LocalShift {
        val row = LocalShift(
            clientUuid = UUID.randomUUID().toString().lowercase(),
            workerId = workerId,
            locationId = locationId,
            startTime = startTime,
        )
        writableDatabase.insertOrThrow("shifts", null, row.values())
        invalidatePending()
        return row
    }

    fun closeShift(clientUuid: String, endTime: Instant, autoClosed: Boolean) {
        writableDatabase.update(
            "shifts",
            ContentValues().apply {
                put("end_time", endTime.toString())
                if (autoClosed) put("auto_closed", 1)
                putNull("close_synced_at")
            },
            "client_uuid = ?",
            arrayOf(clientUuid),
        )
        invalidatePending()
    }

    fun all(): List<LocalShift> = readableDatabase
        .query("shifts", null, null, null, null, null, "start_time DESC")
        .use { it.readAll() }

    fun openShift(): LocalShift? = readableDatabase
        .query("shifts", null, "end_time IS NULL", null, null, null, "start_time DESC", "1")
        .use { it.readAll().firstOrNull() }

    fun queue(): List<QueuedShift> = all().map { it.toQueued() }

    fun has(clientUuid: String): Boolean = readableDatabase
        .query("shifts", arrayOf("client_uuid"), "client_uuid = ?", arrayOf(clientUuid), null, null, null)
        .use { it.count > 0 }

    /** Copy the server's version of a row over the local one. The server's row wins. */
    fun applyServer(shift: WireShift) {
        val values = ContentValues().apply {
            put("server_id", shift.id)
            put("auto_closed", if (shift.autoClosed) 1 else 0)
            put("corrected_at", shift.correctedAt?.toString())
            shift.endTime?.let { put("end_time", it.toString()) }
        }
        writableDatabase.update("shifts", values, "client_uuid = ?", arrayOf(shift.clientUuid ?: return))
        invalidatePending()
    }

    /**
     * Adopt an open shift the server knows about but this phone does not: app
     * reinstalled, second device, or a tap that opened the shift before the row landed.
     * Without this the worker taps out and gets 404 unknown_shift for ever.
     */
    fun adopt(shift: WireShift) {
        val key = shift.clientUuid ?: return
        if (has(key)) return
        val row = LocalShift(
            clientUuid = key,
            workerId = shift.workerId,
            locationId = shift.locationId,
            startTime = shift.startTime,
            endTime = shift.endTime,
            autoClosed = shift.autoClosed,
            correctedAt = shift.correctedAt,
            serverId = shift.id,
            openSyncedAt = Instant.now(),
        )
        writableDatabase.insertWithOnConflict("shifts", null, row.values(), SQLiteDatabase.CONFLICT_IGNORE)
        invalidatePending()
    }

    /**
     * "A push was tried for this row, now." Written BEFORE the call goes out and for BOTH
     * outcomes, which is the only ordering that survives the interesting failure: a
     * process killed mid-request would otherwise leave a row that has been tried many
     * times still claiming it was never attempted.
     */
    fun markAttempted(clientUuid: String, at: Instant = Instant.now()) = mark(clientUuid) {
        put("last_attempt_at", at.toString())
    }

    fun markOpenSynced(clientUuid: String) = mark(clientUuid) {
        put("open_synced_at", Instant.now().toString())
        putNull("sync_error")
        put("sync_blocked", 0)
    }

    fun markCloseSynced(clientUuid: String) = mark(clientUuid) {
        put("close_synced_at", Instant.now().toString())
        putNull("sync_error")
        put("sync_blocked", 0)
    }

    /**
     * A failure ALWAYS leaves a message on the row. The iOS code this mirrors once caught
     * 400s into a bare `catch {}`, which left the error null, the row looking fine and the
     * shift retrying for ever — a data-loss bug wearing a clean UI. `errorKey` is a string
     * RESOURCE NAME, so it re-localises instead of freezing the language it failed in.
     */
    fun markFailed(clientUuid: String, errorKey: String, blocked: Boolean) = mark(clientUuid) {
        put("sync_error", errorKey)
        put("sync_blocked", if (blocked) 1 else 0)
    }

    private inline fun mark(clientUuid: String, build: ContentValues.() -> Unit) {
        writableDatabase.update("shifts", ContentValues().apply(build), "client_uuid = ?", arrayOf(clientUuid))
        invalidatePending()
    }

    // ---- what this phone is still holding ------------------------------------------

    /**
     * Cached because [io.github.qwadratic.nfctimesheets.net.Api] reads it on EVERY request
     * to fill the X-Pending-* headers, and the one request that must never get slower is
     * a clock-in. Recomputed only after a write, so the common path is a field read and
     * touches neither SQLite nor the disk.
     *
     * `@Volatile` and not a lock: the job thread writes, the UI thread and the request
     * thread read, and the worst a torn read can do is recompute once more than needed.
     */
    @Volatile
    private var cachedPending: PendingWork.Summary? = null

    private fun invalidatePending() {
        cachedPending = null
    }

    fun pendingSummary(): PendingWork.Summary =
        cachedPending ?: PendingWork.summarise(queue()).also { cachedPending = it }

    // ---- locations -----------------------------------------------------------------

    /**
     * Replace the cached roster: locations AND zones, one transaction. Rows that are gone
     * drop out of both tables. `zones` may be empty forever — that is HOIV's shape today
     * (decision-43 §3) and is not an error.
     */
    fun replaceRoster(locations: List<WireLocation>, zones: List<WireZone>) {
        writableDatabase.run {
            beginTransaction()
            try {
                delete("locations", null, null)
                for (location in locations) {
                    insertWithOnConflict(
                        "locations",
                        null,
                        ContentValues().apply {
                            put("id", location.id)
                            put("slug", location.slug)
                            put("name", location.name)
                        },
                        SQLiteDatabase.CONFLICT_REPLACE,
                    )
                }
                delete("zones", null, null)
                for (zone in zones) {
                    insertWithOnConflict(
                        "zones",
                        null,
                        ContentValues().apply {
                            put("id", zone.id)
                            put("location_id", zone.locationId)
                            put("name", zone.name)
                            put("tag_serial", zone.tagSerial)
                        },
                        SQLiteDatabase.CONFLICT_REPLACE,
                    )
                }
                setTransactionSuccessful()
            } finally {
                endTransaction()
            }
        }
    }

    /**
     * The cached zone table — empty until an admin creates HOIV's first zone
     * (decision-44). Read by [io.github.qwadratic.nfctimesheets.nfc.ScanActivity] to
     * resolve a scanned serial, and by [io.github.qwadratic.nfctimesheets.core.Zones]
     * callers in the ViewModel to translate a tapped place into its building.
     */
    fun zones(): List<WireZone> = readableDatabase
        .query("zones", null, null, null, null, null, null)
        .use { cursor ->
            val idIdx = cursor.getColumnIndexOrThrow("id")
            val locationIdIdx = cursor.getColumnIndexOrThrow("location_id")
            val nameIdx = cursor.getColumnIndexOrThrow("name")
            val tagSerialIdx = cursor.getColumnIndexOrThrow("tag_serial")
            buildList {
                while (cursor.moveToNext()) {
                    add(
                        WireZone(
                            id = cursor.getString(idIdx),
                            locationId = cursor.getString(locationIdIdx),
                            name = cursor.getString(nameIdx),
                            tagSerial = if (cursor.isNull(tagSerialIdx)) null else cursor.getString(tagSerialIdx),
                        ),
                    )
                }
            }
        }

    /**
     * Location UUID -> display name. A MISSING NAME IS COSMETIC; a missing shift is
     * unpaid work. Nothing anywhere may branch on this being present — that mistake cost
     * the iOS owner paid time standing at a door on a cold launch.
     */
    fun locationNames(): Map<String, String> = readableDatabase
        .query("locations", arrayOf("id", "name"), null, null, null, null, null)
        .use { cursor ->
            buildMap {
                while (cursor.moveToNext()) put(cursor.getString(0), cursor.getString(1))
            }
        }

    private fun Cursor.readAll(): List<LocalShift> = buildList {
        while (moveToNext()) add(readShift(this@readAll))
    }
}

/** One row of the queue. */
data class LocalShift(
    val clientUuid: String,
    val workerId: Int,
    val locationId: String,
    val startTime: Instant,
    val endTime: Instant? = null,
    val autoClosed: Boolean = false,
    val correctedAt: Instant? = null,
    val serverId: Int? = null,
    val openSyncedAt: Instant? = null,
    val closeSyncedAt: Instant? = null,
    /** String RESOURCE NAME of the last failure, never a message. Null when clean. */
    val syncError: String? = null,
    /** Terminal rejection: stop retrying, a human must act. */
    val syncBlocked: Boolean = false,
    /** Last push ATTEMPT, success or failure. Null = never tried. See ShiftStore.markAttempted. */
    val lastAttemptAt: Instant? = null,
) {
    val isOpen: Boolean get() = endTime == null
    val isFullySynced: Boolean get() = openSyncedAt != null && (isOpen || closeSyncedAt != null)
    val durationSeconds: Long? get() = endTime?.let { it.epochSecond - startTime.epochSecond }
    val needsResolution: Boolean get() = autoClosed && correctedAt == null

    fun toQueued() = QueuedShift(
        clientUuid = clientUuid,
        workerId = workerId,
        locationId = locationId,
        startTime = startTime,
        endTime = endTime,
        autoClosed = autoClosed,
        openSyncedAt = openSyncedAt,
        closeSyncedAt = closeSyncedAt,
        syncBlocked = syncBlocked,
        lastAttemptAt = lastAttemptAt,
    )

    internal fun values() = ContentValues().apply {
        put("client_uuid", clientUuid)
        put("worker_id", workerId)
        put("location_id", locationId)
        put("start_time", startTime.toString())
        put("end_time", endTime?.toString())
        put("auto_closed", if (autoClosed) 1 else 0)
        put("corrected_at", correctedAt?.toString())
        put("server_id", serverId)
        put("open_synced_at", openSyncedAt?.toString())
        put("close_synced_at", closeSyncedAt?.toString())
        put("sync_error", syncError)
        put("sync_blocked", if (syncBlocked) 1 else 0)
        put("last_attempt_at", lastAttemptAt?.toString())
    }
}

private fun readShift(c: Cursor): LocalShift {
    fun str(name: String): String? = c.getColumnIndex(name).let { if (it < 0 || c.isNull(it)) null else c.getString(it) }
    fun int(name: String): Int? = c.getColumnIndex(name).let { if (it < 0 || c.isNull(it)) null else c.getInt(it) }
    fun time(name: String): Instant? = str(name)?.let(Instant::parse)
    return LocalShift(
        clientUuid = str("client_uuid")!!,
        workerId = int("worker_id") ?: 0,
        locationId = str("location_id").orEmpty(),
        startTime = time("start_time")!!,
        endTime = time("end_time"),
        autoClosed = (int("auto_closed") ?: 0) != 0,
        correctedAt = time("corrected_at"),
        serverId = int("server_id"),
        openSyncedAt = time("open_synced_at"),
        closeSyncedAt = time("close_synced_at"),
        syncError = str("sync_error"),
        syncBlocked = (int("sync_blocked") ?: 0) != 0,
        lastAttemptAt = time("last_attempt_at"),
    )
}
