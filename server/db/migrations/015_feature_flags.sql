-- 015_feature_flags.sql — a name, a boolean, and a second admin role scoped to nothing else.
--
-- decision-57 §1/§2. The running-shift recolour + animation must be opt-in, because
-- Android's achromatic theme is defended by three regression checks and an unconditional
-- recolour would reverse a decision that was fought for. OFF is bit-for-bit today.
--
-- ONE TABLE, NAME + BOOLEAN. No percentage rollout, no per-user targeting, no client SDK.
-- A second flag later costs one INSERT, not a schema change — which is the whole reason
-- the table is generic and the flag name is data rather than a column.
--
-- updated_by is a FREE-TEXT EMAIL SNAPSHOT, not a FK to admins: the audit line must
-- survive the admin row being deleted, and this table is written by hand a few times a
-- year. ponytail: no history table, so only the LAST change is knowable. CEILING: "who
-- turned it off in March" is unanswerable. UPGRADE PATH: a feature_flag_events table.
--
-- admins.role: DEFAULT 'admin' so every existing row keeps exactly today's access, and a
-- CHECK rather than an enum type — two values, and a third would otherwise need ALTER TYPE
-- on the live box. 'flags' is a scoped account: it can reach GET/PATCH /admin/flags and
-- NOTHING else. That refusal lives in requireAdminSession (lib/auth.js), which defaults to
-- role='admin' — every existing route is unchanged and stays admin-only by construction,
-- not by remembering to add a check.
--
-- NO BEGIN/COMMIT — migrate.js already runs each file with `psql -1`.
-- 001-014 are APPLIED ON THE LIVE BOX and are not editable (db/README.md).
ALTER TABLE admins
  ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'flags'));

CREATE TABLE feature_flags (
  name       TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- The first (and today only) flag, seeded DISABLED. Seeded here and not by the route so
-- the admin Flags page has something to show on a fresh box, and so GET /flags answers
-- the same shape everywhere. ON CONFLICT: re-running this file must never flip a live flag.
INSERT INTO feature_flags (name, enabled) VALUES ('fun_shift_screen', false)
  ON CONFLICT (name) DO NOTHING;
