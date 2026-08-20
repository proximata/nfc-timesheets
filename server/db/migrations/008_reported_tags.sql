-- 008_reported_tags.sql — an UNBOUND tag: the app writes one before any zone or building
-- exists to claim it.
--
-- THE SHAPE OF THE PROBLEM. An operator's phone writes a fresh NDEF URI tag in the field —
-- https://timesheets.exe.xyz/t?l=<uuid> — and mints the <uuid> ITSELF, client-side, before
-- calling the server at all. Nobody has decided yet whether that uuid becomes a building or
-- a zone; that decision is the admin's, made later, at a desk. Between the write and the
-- resolve, the id has to live SOMEWHERE the server knows about it, or an admin has no list
-- of "tags waiting for a decision" and a worker who taps the tag early gets a refusal
-- indistinguishable from a stranger's garbage tag.
--
-- WHO MINTS THE ID, AND WHY THAT IS SAFE (tags are unlocked and untrusted, decision-15):
-- the OPERATOR'S PHONE mints a random UUIDv4, client-side, at write time. This is safe for
-- exactly the same reason every other id on a tag is safe: the id is NEVER a credential and
-- is NEVER trusted as identity or authorisation. It means nothing at all until a signed-in
-- ADMIN deliberately claims it via one of the three resolve routes below, and until that
-- happens it resolves to a named refusal (422 tag_unbound, lib/validate.js activePlace) —
-- never a shift, never a building, never anything the server invents on its own.
--
-- MODELLED EXPLICITLY, NOT AS A ZONE ROW WITH NULL COLUMNS. `zones.location_id` is
-- NOT NULL for a reason (decision-43: "a zone IS a place inside a building"); an unbound
-- tag is not a place at all yet, so it does not belong in that table with a hole punched in
-- its one required column. A separate table also means "list every tag waiting for a
-- decision" is one WHERE clause instead of a NULL-location special case threaded through
-- every zones query that exists today (upsertZone, /admin/data, activePlace, roster).
--
-- ZERO ROWS ARE CREATED HERE, same convention as 006 (zones/location_revenue) and 007
-- (operators/phone_identities): a migration does not get to invent a reported tag any more
-- than it gets to invent a wage.
--
-- ADDITIVE ONLY, no BEGIN/COMMIT (migrate.js already runs each file with `psql -1`).

-- ===========================================================================
-- reported_tags — "this tag now exists and carries this id". One row per physical tag an
-- operator has WRITTEN AND REPORTED, whether or not it has been resolved yet.
--
-- `id` is the tag's own uuid — the SAME id space shared with locations and zones
-- (decision-37/43, unchanged): once resolved into a NEW building or zone, that row's PK
-- literally equals this one, so the physical bytes already on the card never have to be
-- rewritten. See the resolve routes in routes/admin.js for the two ways that happens.
--
-- `resolved_at` is the ONLY resolution state stored here, and "what it resolved to" is
-- DERIVED — by checking whether a locations/zones row now carries this id, or whether a
-- tag_aliases row does — never duplicated into a second column. 005's rule: a derivable
-- fact is not stored twice, because a stored copy drifts the first time someone edits the
-- zone it points at.
--
-- IDEMPOTENT BY CONSTRUCTION. `id` is the PRIMARY KEY, so "the same tag reported twice" and
-- "two operators reporting the same physical tag at once" both collapse onto ONE row: the
-- route does `INSERT ... ON CONFLICT (id) DO NOTHING` and reads back whichever row won.
-- ===========================================================================
CREATE TABLE reported_tags (
  id                        UUID PRIMARY KEY,
  reported_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Audit only, same idiom as workers.enrolment_code_issued_by / zones has no equivalent
  -- because zones are admin-created; THIS row is field-created, so "who reported it" is the
  -- one fact worth keeping. ON DELETE SET NULL: a deactivated operator's past reports are
  -- not deleted history.
  reported_by_operator_id   BIGINT REFERENCES operators(id) ON DELETE SET NULL,
  -- NULL = still unbound. Non-NULL = an admin resolved it, at this moment, into whatever a
  -- join against locations/zones/tag_aliases on `id` now shows.
  resolved_at                TIMESTAMPTZ
);

-- "list every tag waiting for a decision" — the one read GET /admin/data does with this
-- table, and the reason `resolved_at` exists as a column instead of "delete the row once
-- resolved": deleting would lose the audit trail of who wrote which physical tag and when.
CREATE INDEX reported_tags_unresolved_idx ON reported_tags (reported_at) WHERE resolved_at IS NULL;

-- ===========================================================================
-- tag_aliases — the ONE resolve target that cannot reuse "this row's own id becomes the
-- new PK": binding a freshly-written physical tag to a zone that ALREADY has its own id
-- (and very possibly its own already-printed tag). Re-keying that zone's PK to match the
-- new tag would strand whatever ELSE was ever printed with the zone's original id; an
-- alias is purely additive and never touches the zone's own identity.
--
-- ZONES ONLY, deliberately, not buildings too — the owner's brief names exactly three
-- resolve targets: a new building, a new zone, or AN EXISTING ZONE. There is no
-- "existing building" case to build.
-- ponytail: one alias row per reported tag (the PK), unbounded aliases PER ZONE (a real
-- need — a lost or damaged tag gets replaced by a second physical card that must resolve
-- to the SAME zone). CEILING: an existing BUILDING cannot be re-tagged this way; only a
-- fresh `resolve-building` mints a new one. UPGRADE PATH: drop the ZONES ONLY restriction
-- by adding a nullable location_id counterpart the day the owner asks for it — the shape
-- already generalises, it is just not built until it is needed.
-- ===========================================================================
CREATE TABLE tag_aliases (
  id         UUID PRIMARY KEY REFERENCES reported_tags(id),
  zone_id    UUID NOT NULL REFERENCES zones(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "every physical tag currently aliased to this zone" — not unique: replacement tags over
-- a zone's lifetime are additive, not a one-to-one relationship.
CREATE INDEX tag_aliases_zone_idx ON tag_aliases (zone_id);
