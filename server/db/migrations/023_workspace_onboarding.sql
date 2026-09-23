-- migrate.js wraps the pending files in a transaction. The schema owner is subject
-- to FORCE RLS too, so the one-time backfill needs an explicit maintenance scope.
SET LOCAL app.system = 'on';
ALTER TABLE tenants ADD COLUMN company_confirmed_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN provisioning_key UUID UNIQUE;
ALTER TABLE workers ADD COLUMN setup_key UUID;
ALTER TABLE workers ADD UNIQUE (tenant_id, setup_key);
ALTER TABLE locations ADD COLUMN setup_key UUID;
ALTER TABLE locations ADD UNIQUE (tenant_id, setup_key);
UPDATE tenants SET company_confirmed_at = created_at WHERE id = 1;

CREATE TABLE workspace_invitations (
  tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id),
  email TEXT NOT NULL CHECK (email = lower(email)),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON workspace_invitations USING (workspace_system()) WITH CHECK (workspace_system());
CREATE UNIQUE INDEX workspace_invitation_pending_email ON workspace_invitations(email) WHERE consumed_at IS NULL;

-- Shared append-only audit vocabulary from decision-65; no parallel workspace ledger.
CREATE TABLE action_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  actor_type TEXT NOT NULL,
  actor_id BIGINT NOT NULL,
  device_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('tenant','superadmin')),
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT
);
ALTER TABLE action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON action_log FOR SELECT USING (workspace_system());
CREATE POLICY audit_append ON action_log FOR INSERT WITH CHECK (workspace_system());
CREATE FUNCTION reject_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'action_log is append-only'; END $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE OR TRUNCATE ON action_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
