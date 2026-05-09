-- db/migrations/V2__rls_policies.sql
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_reads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- All policies use current_setting('app.current_tenant_id', true).
-- The 'true' arg means: return NULL (not error) if setting is not set.
-- NULL::UUID causes the USING clause to evaluate to NULL → row hidden.
-- The app must call SET LOCAL app.current_tenant_id = '<uuid>' inside
-- every transaction before issuing any query against these tables.

CREATE POLICY tenant_iso ON users
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY tenant_iso ON devices
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY tenant_iso ON vehicles
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY tenant_iso ON card_reads
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY tenant_iso ON reports
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY tenant_iso ON audit_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY tenant_iso ON billing_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
