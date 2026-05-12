-- db/migrations/V10__mechanic_features.sql
-- Adds job tracking, mileage history, and service reminders.

-- ─── current_mileage_km on vehicles ───────────────────────────────────────
-- Denormalised for fast filtering ("show all cars over 100k km").
-- Updated by the application on each mileage_history insert.
ALTER TABLE vehicles ADD COLUMN current_mileage_km INTEGER CHECK (current_mileage_km >= 0);

-- ─── mileage_history ──────────────────────────────────────────────────────
-- One row per mileage reading (recorded on each visit or card read).
CREATE TABLE mileage_history (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id      UUID        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  mileage_km      INTEGER     NOT NULL CHECK (mileage_km >= 0),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by     UUID        REFERENCES users(id),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mileage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON mileage_history
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE INDEX idx_mileage_vehicle ON mileage_history(vehicle_id, recorded_at DESC);
CREATE INDEX idx_mileage_tenant  ON mileage_history(tenant_id, recorded_at DESC);

-- ─── jobs ─────────────────────────────────────────────────────────────────
-- Work performed on a vehicle at a visit (parts replaced, labour, etc.).
-- price_cents avoids floating-point rounding; divide by 100 in the app.
CREATE TABLE jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id      UUID        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  price_cents     INTEGER     NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  performed_at    DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_by      UUID        REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE INDEX idx_jobs_vehicle      ON jobs(vehicle_id, performed_at DESC);
CREATE INDEX idx_jobs_tenant       ON jobs(tenant_id, performed_at DESC);
CREATE INDEX idx_jobs_performed_at ON jobs(tenant_id, performed_at DESC);

-- ─── service_reminders ────────────────────────────────────────────────────
-- Tracks upcoming maintenance per vehicle.
-- A reminder triggers by date, by mileage, or both — at least one required.
-- This drives the filtering views: "tyres due in 30 days", "big service overdue".
CREATE TABLE service_reminders (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id          UUID        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_type        TEXT        NOT NULL
                      CHECK (service_type IN (
                        'oil_change',
                        'tire_rotation',
                        'small_service',
                        'big_service',
                        'technical_inspection',
                        'registration_renewal',
                        'brake_check',
                        'other'
                      )),
  due_date            DATE,
  due_mileage_km      INTEGER     CHECK (due_mileage_km > 0),
  completed_at        TIMESTAMPTZ,
  completed_by        UUID        REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reminder_has_trigger
    CHECK (due_date IS NOT NULL OR due_mileage_km IS NOT NULL)
);

ALTER TABLE service_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON service_reminders
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Primary search pattern: "all open reminders for my tenant, ordered by due_date"
CREATE INDEX idx_reminders_tenant_due
  ON service_reminders(tenant_id, due_date)
  WHERE completed_at IS NULL;

-- Vehicle timeline view
CREATE INDEX idx_reminders_vehicle
  ON service_reminders(vehicle_id, due_date);

-- Mileage-triggered reminders (for the "X km overdue" query)
CREATE INDEX idx_reminders_mileage
  ON service_reminders(tenant_id, due_mileage_km)
  WHERE completed_at IS NULL AND due_mileage_km IS NOT NULL;
