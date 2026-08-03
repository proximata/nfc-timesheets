package io.github.qwadratic.nfctimesheets.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import io.github.qwadratic.nfctimesheets.core.QueuedMaterialRequest
import io.github.qwadratic.nfctimesheets.core.Wire
import io.github.qwadratic.nfctimesheets.core.WireMaterialRequest
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/**
 * Material requests on disk.
 *
 * A SEPARATE DATABASE FILE from [ShiftStore], on purpose and not by accident. `timesheets.db`
 * holds unpushed shifts, i.e. unpaid hours; a schema version bump on it for a feature that
 * is explicitly not the product puts a migration between a crew and their clock-in every
 * morning, and `ShiftStore.onUpgrade` deliberately throws rather than guess. The worst
 * this file can do is lose material requests. iOS makes the same split for the same
 * reason — a JSON file beside the SwiftData store, never inside it.
 *
 * ponytail: SQLiteOpenHelper, not Room, matching ShiftStore. CEILING: hand-written
 * migrations, no compile-time query checking. UPGRADE PATH: everything outside this file
 * talks in [QueuedMaterialRequest] and [WireMaterialRequest].
 */
class MaterialStore(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "materials.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        // The outbox: what the worker wrote that the server has not acknowledged.
        db.execSQL(
            """
            CREATE TABLE material_outbox (
              id          TEXT PRIMARY KEY,
              worker_id   INTEGER NOT NULL,
              body        TEXT NOT NULL,
              location_id TEXT,
              created_at  TEXT NOT NULL,
              error_key   TEXT,
              blocked     INTEGER NOT NULL DEFAULT 0
            )
            """.trimIndent(),
        )
        // The server's own rows, cached so the list renders in a stairwell. The whole
        // JSON is kept rather than a column per field: this table is a CACHE of somebody
        // else's shape, and re-parsing it means a field the server adds later needs no
        // migration here.
        db.execSQL(
            """
            CREATE TABLE material_server (
              id         INTEGER PRIMARY KEY,
              worker_id  INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              payload    TEXT NOT NULL
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Version 1 is the first release. When there is a version 2, write the ALTER
        // TABLE here. Never DROP material_outbox: those rows are things a worker asked
        // for that nobody has answered yet.
        throw IllegalStateException("no migration from $oldVersion to $newVersion")
    }

    // ---- whose phone is this -------------------------------------------------------

    /**
     * Called every time a session resolves.
     *
     * A DIFFERENT worker gets an EMPTY store: their colleague's free text is their
     * colleague's business, and a queued row would otherwise be posted under the wrong
     * session (decision-22). The same worker keeps everything, which is the whole point
     * of the file. Mirrors MaterialCache.adopted(by:) on iOS.
     */
    fun adopt(workerId: Int) {
        writableDatabase.run {
            delete("material_outbox", "worker_id != ?", arrayOf(workerId.toString()))
            delete("material_server", "worker_id != ?", arrayOf(workerId.toString()))
        }
    }

    // ---- outbox --------------------------------------------------------------------

    /** @param body ALREADY normalised by MaterialQueue.normalise(). */
    fun enqueue(workerId: Int, body: String, locationId: String?): QueuedMaterialRequest {
        val row = QueuedMaterialRequest(
            id = UUID.randomUUID().toString().lowercase(),
            workerId = workerId,
            body = body,
            locationId = locationId,
            createdAt = Instant.now(),
        )
        writableDatabase.insertOrThrow(
            "material_outbox",
            null,
            ContentValues().apply {
                put("id", row.id)
                put("worker_id", row.workerId)
                put("body", row.body)
                put("location_id", row.locationId)
                put("created_at", row.createdAt.toString())
            },
        )
        return row
    }

    fun outbox(): List<QueuedMaterialRequest> = readableDatabase
        .query("material_outbox", null, null, null, null, null, "created_at DESC")
        .use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(
                        QueuedMaterialRequest(
                            id = cursor.getString(cursor.getColumnIndexOrThrow("id")),
                            workerId = cursor.getInt(cursor.getColumnIndexOrThrow("worker_id")),
                            body = cursor.getString(cursor.getColumnIndexOrThrow("body")),
                            locationId = cursor.getColumnIndexOrThrow("location_id")
                                .let { if (cursor.isNull(it)) null else cursor.getString(it) },
                            createdAt = Instant.parse(
                                cursor.getString(cursor.getColumnIndexOrThrow("created_at")),
                            ),
                            errorKey = cursor.getColumnIndexOrThrow("error_key")
                                .let { if (cursor.isNull(it)) null else cursor.getString(it) },
                            blocked = cursor.getInt(cursor.getColumnIndexOrThrow("blocked")) != 0,
                        ),
                    )
                }
            }
        }

    fun dequeue(id: String) {
        writableDatabase.delete("material_outbox", "id = ?", arrayOf(id))
    }

    /**
     * A failure ALWAYS leaves a message on the row. A row with no message is a row that
     * looks sent — the same data-loss-wearing-a-clean-UI bug ShiftStore.markFailed exists
     * to prevent. `errorKey` is a string RESOURCE NAME so it re-localises.
     */
    fun markFailed(id: String, errorKey: String, blocked: Boolean) {
        writableDatabase.update(
            "material_outbox",
            ContentValues().apply {
                put("error_key", errorKey)
                put("blocked", if (blocked) 1 else 0)
            },
            "id = ?",
            arrayOf(id),
        )
    }

    // ---- the server's rows ---------------------------------------------------------

    /**
     * Replace the cached list with the server's. It is the truth, including for rows this
     * phone never saw — a request filed from the worker's other device, or a status the
     * admin changed five minutes ago.
     */
    fun replaceServer(workerId: Int, requests: List<JSONObject>) {
        writableDatabase.run {
            beginTransaction()
            try {
                delete("material_server", null, null)
                for (payload in requests) {
                    // Parsed before it is stored: a row we cannot read is a row that would
                    // crash the list later, and dropping it here is visible (it is simply
                    // absent) rather than fatal.
                    val parsed = runCatching { Wire.materialRequest(payload) }.getOrNull() ?: continue
                    insertWithOnConflict(
                        "material_server",
                        null,
                        ContentValues().apply {
                            put("id", parsed.id)
                            put("worker_id", workerId)
                            put("created_at", parsed.createdAt.toString())
                            put("payload", payload.toString())
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

    /** One row, after the server answered a POST — so a fresh request shows up at once. */
    fun upsertServer(workerId: Int, payload: JSONObject) {
        val parsed = runCatching { Wire.materialRequest(payload) }.getOrNull() ?: return
        writableDatabase.insertWithOnConflict(
            "material_server",
            null,
            ContentValues().apply {
                put("id", parsed.id)
                put("worker_id", workerId)
                put("created_at", parsed.createdAt.toString())
                put("payload", payload.toString())
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun server(): List<WireMaterialRequest> = readableDatabase
        .query("material_server", arrayOf("payload"), null, null, null, null, "created_at DESC")
        .use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    val parsed = runCatching {
                        Wire.materialRequest(JSONObject(cursor.getString(0)))
                    }.getOrNull()
                    if (parsed != null) add(parsed)
                }
            }
        }
}
