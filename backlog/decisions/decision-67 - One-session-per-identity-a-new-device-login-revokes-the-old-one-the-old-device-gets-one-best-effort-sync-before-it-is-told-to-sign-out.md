---
id: decision-67
title: >-
  One session per identity: a new device login revokes the old one; the old
  device gets one best-effort sync before it is told to sign out
date: '2026-08-30 04:57'
status: accepted
---
## Context

Today `worker_sessions`/`operator_sessions` place no limit on how many concurrent
sessions one identity holds — signing in on a second phone does not affect the first.
The owner wants signing in on a new device to end the old one, without losing whatever
the old device had not yet synced.

The server cannot wait for a possibly-offline old device to flush before revoking it —
there is nothing to wait ON. The correct pattern is optimistic revoke plus a best-effort
client-side flush attempt, not a server-side handshake.

## Decision

`worker_sessions`/`operator_sessions` gain `device_id` (client-generated UUID, sent at
login). `createWorkerSession`/`createOperatorSession` **revoke every existing session**
for that identity before minting the new one — one live session per worker, one per
operator, enforced at the moment of login, not eventually.

The old device's next request gets the same 401 it would get from an ordinary expired
session today — nothing new on the wire. Client-side (both platforms already have an
outbox for pending writes — PendingTagReport/MaterialStore-style, decision-62 already
treats it as sacred): on that specific 401, make **one** best-effort attempt to flush the
outbox, then show "signed in on another device" and return to sign-in. No server-side
waiting, no new sync protocol — reuses the retry path that already exists for "came back
online."

Every login and every session-revoking logout writes an `action_log` row (decision-65)
carrying `device_id`.

## Consequences

A worker who legitimately uses two devices (borrows a phone, replaces one mid-shift) is
now bounced off the first the moment the second signs in — this is the requested
behavior, not a defect to soften. If the old device is fully offline when revoked, queued
writes simply wait: they are not lost, they surface again the next time that device is
opened and attempts its own flush, per decision-62's existing rule that the write queue
is never touched by anything except the write queue's own sync logic.
