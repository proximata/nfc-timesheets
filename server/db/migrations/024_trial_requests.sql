CREATE TABLE trial_requests (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 320),
  company TEXT NOT NULL CHECK (length(company) BETWEEN 1 AND 200),
  locale TEXT NOT NULL CHECK (locale IN ('de','en')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE trial_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON trial_requests USING (workspace_system()) WITH CHECK (workspace_system());
