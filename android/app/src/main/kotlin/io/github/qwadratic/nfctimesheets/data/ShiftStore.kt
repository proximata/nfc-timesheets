package io.github.qwadratic.nfctimesheets.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import io.github.qwadratic.nfctimesheets.core.SyncPlan.QueuedShift
import io.github.qwadratic.nfctimesheets.core.WireLocation
import io.github.qwadratic.nfctimesheets.core.WireShift
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
class ShiftStore(context: Context) : SQLiteOpenHelper(context.applicationContext, "timesheets.db", null, 1) {

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
              sync_blocked    INTEGER NOT NULL DEFAULT 0
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
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Version 1 is the first release; there is nothing to migrate FROM. When there is,
        // write the ALTER TABLE here. Never DROP: these rows are somebody's unpaid hours.
        throw IllegalStateException("no migration from $oldVersion to $newVersion")
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
    }

    // ---- locations -----------------------------------------------------------------

    /** Replace the cached roster. Locations that are gone drop out. */
    fun replaceLocations(locations: List<WireLocation>) {
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
                setTransactionSuccessful()
            } finally {
                endTransaction()
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
    )
}
