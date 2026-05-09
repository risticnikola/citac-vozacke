-- db/migrations/V3__indexes.sql

-- users
CREATE INDEX idx_users_tenant_email
  ON users(tenant_id, email) WHERE deleted_at IS NULL;

-- devices
CREATE INDEX idx_devices_tenant
  ON devices(tenant_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_devices_serial ON devices(serial);

-- vehicles
CREATE INDEX idx_vehicles_tenant ON vehicles(tenant_id);
CREATE INDEX idx_vehicles_vin
  ON vehicles(tenant_id, vin) WHERE vin IS NOT NULL;
CREATE INDEX idx_vehicles_plate
  ON vehicles(tenant_id, plate) WHERE plate IS NOT NULL;

-- card_reads (highest query volume — most critical)
CREATE INDEX idx_card_reads_tenant_created
  ON card_reads(tenant_id, created_at DESC);
CREATE INDEX idx_card_reads_vehicle
  ON card_reads(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_card_reads_device
  ON card_reads(device_id);
-- cursor-based pagination: (tenant_id, created_at DESC, id DESC)
CREATE INDEX idx_card_reads_cursor
  ON card_reads(tenant_id, created_at DESC, id DESC);

-- reports
CREATE INDEX idx_reports_card_read  ON reports(card_read_id);
CREATE INDEX idx_reports_tenant     ON reports(tenant_id, created_at DESC);

-- audit_log (append-only, never deleted)
CREATE INDEX idx_audit_tenant_created
  ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_resource
  ON audit_log(resource_type, resource_id);

-- billing_events
CREATE INDEX idx_billing_tenant_created
  ON billing_events(tenant_id, created_at DESC);
CREATE INDEX idx_billing_unprocessed
  ON billing_events(tenant_id) WHERE processed_at IS NULL;
