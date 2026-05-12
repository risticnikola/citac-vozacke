-- db/migrations/V14__vin_unique.sql
-- Replace the non-unique V3 VIN index with a unique partial one.
-- V6 added deleted_at to vehicles; the original idx_vehicles_vin predicate
-- (vin IS NOT NULL) never excluded soft-deleted rows. This index does.
-- Deleted vehicles (deleted_at IS NOT NULL) free their VIN slot.

-- Fail fast if existing data already has duplicate VINs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM vehicles
    WHERE vin IS NOT NULL AND deleted_at IS NULL
    GROUP BY tenant_id, vin HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active VINs exist; deduplicate before running V14';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_vehicles_vin;
CREATE UNIQUE INDEX idx_vehicles_vin
  ON vehicles(tenant_id, vin)
  WHERE vin IS NOT NULL AND deleted_at IS NULL;
