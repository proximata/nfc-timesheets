-- Plans never write to shifts or affect NFC eligibility or payroll.
CREATE TABLE planned_shifts (
  id UUID PRIMARY KEY,
  tenant_id BIGINT NOT NULL DEFAULT workspace_id() REFERENCES tenants(id),
  worker_id BIGINT NOT NULL,
  location_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  cancelled_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (worker_id,tenant_id) REFERENCES workers(id,tenant_id),
  FOREIGN KEY (location_id,tenant_id) REFERENCES locations(id,tenant_id),
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '24 hours')
);
CREATE INDEX planned_shifts_calendar ON planned_shifts (tenant_id,starts_at,id);
CREATE INDEX planned_shifts_worker ON planned_shifts (tenant_id,worker_id,ends_at) WHERE cancelled_at IS NULL;
ALTER TABLE planned_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE planned_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON planned_shifts USING (workspace_system() OR tenant_id=workspace_id()) WITH CHECK (workspace_system() OR tenant_id=workspace_id());
