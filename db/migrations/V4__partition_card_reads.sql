-- db/migrations/V4__partition_card_reads.sql
-- Converts card_reads to a range-partitioned table by created_at.
-- Run during a low-traffic maintenance window.
-- After verifying row counts match: DROP TABLE card_reads_v1;

BEGIN;

ALTER TABLE card_reads RENAME TO card_reads_v1;

CREATE TABLE card_reads (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  device_id        UUID        NOT NULL,
  vehicle_id       UUID,
  idempotency_key  TEXT        NOT NULL,
  raw_dump_s3_key  TEXT        NOT NULL,
  parsed_data      JSONB       NOT NULL,
  card_serial      TEXT,
  card_type        TEXT        CHECK (card_type IN ('driver','vehicle','workshop','control')),
  read_status      TEXT        NOT NULL DEFAULT 'success'
                               CHECK (read_status IN ('success','partial','error')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Two years of monthly partitions (automate with pg_partman in production)
DO $$
DECLARE
  y INT; m INT;
  s DATE; e DATE;
  pname TEXT;
BEGIN
  FOR y IN 2026..2027 LOOP
    FOR m IN 1..12 LOOP
      s := make_date(y, m, 1);
      e := s + INTERVAL '1 month';
      pname := format('card_reads_%s_%s', y, lpad(m::text, 2, '0'));
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF card_reads FOR VALUES FROM (%L) TO (%L)',
        pname, s, e
      );
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE card_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON card_reads
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

ALTER TABLE card_reads
  ADD CONSTRAINT card_reads_idempotency_unique
  UNIQUE (idempotency_key, created_at);

INSERT INTO card_reads SELECT * FROM card_reads_v1;

CREATE INDEX idx_card_reads_tenant_created ON card_reads(tenant_id, created_at DESC);
CREATE INDEX idx_card_reads_vehicle        ON card_reads(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_card_reads_device         ON card_reads(device_id);
CREATE INDEX idx_card_reads_cursor         ON card_reads(tenant_id, created_at DESC, id DESC);

COMMIT;
