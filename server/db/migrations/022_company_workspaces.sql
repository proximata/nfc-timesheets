-- Existing records keep their IDs and all printed tags remain valid (decision-66).
CREATE TABLE tenants (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  locale TEXT NOT NULL DEFAULT 'de' CHECK (locale IN ('de', 'en')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO tenants (id, name) VALUES (0, 'Platform'), (1, 'Schimmer & Glanz');
SELECT setval(pg_get_serial_sequence('tenants', 'id'), 1);

-- Scope is set transaction-locally by lib/db.js, never taken from a request parameter.
CREATE FUNCTION workspace_id() RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::bigint
$$;
CREATE FUNCTION workspace_system() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.system', true) = 'on', false)
$$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'admins','workers','operators','locations','zones','shifts','clients','contacts',
    'sessions','worker_sessions','operator_sessions','phone_identities','email_identities',
    'otp_challenges','email_challenges','sms_deliveries','inventory_items','material_requests',
    'location_contracts','location_revenue','portal_grants','reported_tags','tag_aliases','app_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id bigint NOT NULL DEFAULT 1 REFERENCES tenants(id)', tbl);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT workspace_id()', tbl);
    EXECUTE format('CREATE INDEX %I ON %I (tenant_id)', tbl || '_tenant_idx', tbl);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY workspace_scope ON %I USING (workspace_system() OR tenant_id = workspace_id()) WITH CHECK (workspace_system() OR tenant_id = workspace_id())', tbl);
  END LOOP;
END $$;

ALTER TABLE admins DROP CONSTRAINT admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('admin','flags','superadmin'));
ALTER TABLE admins ADD CONSTRAINT admins_workspace_role CHECK ((role = 'superadmin') = (tenant_id = 0));
ALTER TABLE locations DROP CONSTRAINT locations_slug_key;
ALTER TABLE locations ADD CONSTRAINT locations_tenant_slug_key UNIQUE (tenant_id, slug);
ALTER TABLE app_settings DROP CONSTRAINT app_settings_pkey;
ALTER TABLE app_settings ADD PRIMARY KEY (tenant_id, key);

-- RLS alone does not protect FK references: PostgreSQL checks referential integrity
-- outside row visibility. Add a same-company FK alongside EVERY existing domain FK.
-- Original FKs keep their CASCADE/SET NULL actions. Nullable audit references remain nullable.
DO $$
DECLARE fk record; parent_cols text; child_cols text; suffix text;
BEGIN
  FOR fk IN
    SELECT c.oid, c.conrelid, c.confrelid, c.conkey, c.confkey
      FROM pg_constraint c
      JOIN pg_class child ON child.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
     WHERE c.contype = 'f' AND ns.nspname = current_schema()
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'tenant_id')
       AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = c.confrelid AND attname = 'tenant_id')
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) INTO parent_cols
      FROM unnest(fk.confkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid = fk.confrelid AND a.attnum = k.num;
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) INTO child_cols
      FROM unnest(fk.conkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = k.num;
    suffix := fk.oid::text;
    EXECUTE format('CREATE UNIQUE INDEX %I ON %s (%s, tenant_id)', 'workspace_ref_' || suffix, fk.confrelid::regclass, parent_cols);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s, tenant_id) REFERENCES %s (%s, tenant_id)', fk.conrelid::regclass, 'workspace_fk_' || suffix, child_cols, fk.confrelid::regclass, parent_cols);
  END LOOP;
END $$;

-- Login bootstrap knows a globally unique identity, but has no company session yet.
-- These child records derive their scope from that identity, never from a fallback to 1.
CREATE FUNCTION inherit_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_tenant bigint;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    EXECUTE format('SELECT tenant_id FROM %I WHERE %I::text = $1', TG_ARGV[0], TG_ARGV[1])
      INTO parent_tenant USING to_jsonb(NEW)->>TG_ARGV[2];
    NEW.tenant_id := parent_tenant;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_workspace BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION inherit_workspace('admins','id','admin_id');
CREATE TRIGGER worker_session_workspace BEFORE INSERT ON worker_sessions FOR EACH ROW EXECUTE FUNCTION inherit_workspace('workers','id','worker_id');
CREATE TRIGGER operator_session_workspace BEFORE INSERT ON operator_sessions FOR EACH ROW EXECUTE FUNCTION inherit_workspace('operators','id','operator_id');
CREATE TRIGGER otp_workspace BEFORE INSERT ON otp_challenges FOR EACH ROW EXECUTE FUNCTION inherit_workspace('phone_identities','phone_e164','phone_e164');
CREATE TRIGGER email_challenge_workspace BEFORE INSERT ON email_challenges FOR EACH ROW EXECUTE FUNCTION inherit_workspace('email_identities','email','email');
CREATE TRIGGER sms_worker_workspace BEFORE INSERT ON sms_deliveries FOR EACH ROW EXECUTE FUNCTION inherit_workspace('workers','id','worker_id');
CREATE TRIGGER sms_operator_workspace BEFORE INSERT ON sms_deliveries FOR EACH ROW EXECUTE FUNCTION inherit_workspace('operators','id','operator_id');

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON tenants USING (workspace_system() OR id = workspace_id()) WITH CHECK (workspace_system() OR id = workspace_id());

-- Flags are release configuration shared by the shipped apps. Ordinary company
-- sessions may read them, but only the platform/legacy maintenance scope may change them.
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;
CREATE POLICY flags_read ON feature_flags FOR SELECT USING (true);
CREATE POLICY flags_write ON feature_flags FOR ALL USING (workspace_system()) WITH CHECK (workspace_system());
