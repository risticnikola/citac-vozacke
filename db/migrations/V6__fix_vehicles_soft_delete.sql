-- db/migrations/V6__fix_vehicles_soft_delete.sql
-- vehicles table was missing deleted_at; all soft-delete queries were failing.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
