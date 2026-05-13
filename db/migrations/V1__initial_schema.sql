-- db/migrations/V1__initial_schema.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE tenants (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  slug          TEXT        NOT NULL UNIQUE,
  plan          TEXT        NOT NULL DEFAULT 'starter'
                            CHECK (plan IN ('starter','professional','enterprise')),
  max_devices   INTEGER     NOT NULL DEFAULT 5,
  max_reads_per_month INTEGER NOT NULL DEFAULT 1000,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE users (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email             TEXT        NOT NULL,
  role              TEXT        NOT NULL DEFAULT 'mechanic'
                                CHECK (role IN ('mechanic','garage_admin','saas_admin')),
  password_hash     TEXT,
  auth_provider     TEXT        DEFAULT 'local',
  auth_provider_id  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);

CREATE TABLE devices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  serial          TEXT        NOT NULL,
  name            TEXT,
  platform        TEXT        CHECK (platform IN ('windows','linux','macos')),
  bridge_version  TEXT,
  public_key_pem  TEXT        NOT NULL,
  key_id          TEXT        NOT NULL,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, serial)
);

CREATE TABLE vehicles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vin         TEXT,
  plate       TEXT,
  make        TEXT,
  model       TEXT,
  year        INTEGER,
  owner_name  TEXT,
  owner_phone TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE card_reads (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  device_id        UUID        NOT NULL REFERENCES devices(id),
  vehicle_id       UUID        REFERENCES vehicles(id),
  idempotency_key  TEXT        NOT NULL UNIQUE,
  raw_dump_s3_key  TEXT        NOT NULL,
  parsed_data      JSONB       NOT NULL,
  card_serial      TEXT,
  card_type        TEXT        CHECK (card_type IN ('vehicle_registration','id_card','other')),
  read_status      TEXT        NOT NULL DEFAULT 'success'
                               CHECK (read_status IN ('success','partial','error')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE TABLE reports (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  card_read_id UUID        NOT NULL REFERENCES card_reads(id),
  pdf_s3_key   TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','generating','ready','failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
  id            BIGSERIAL   PRIMARY KEY,
  tenant_id     UUID        NOT NULL,
  user_id       UUID,
  device_id     UUID,
  action        TEXT        NOT NULL,
  resource_type TEXT        NOT NULL,
  resource_id   UUID,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE billing_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  event_type   TEXT        NOT NULL,
  card_read_id UUID,
  amount_units INTEGER     NOT NULL DEFAULT 1,
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
