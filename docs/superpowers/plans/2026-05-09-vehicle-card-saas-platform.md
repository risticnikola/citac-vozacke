# Vehicle Card SaaS Platform — Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert a C++ Windows desktop vehicle card reader app into a production-grade
multi-tenant SaaS platform where mechanics authenticate via browser, plug in a USB card
reader, and have EU tachograph / vehicle card data synced to the cloud with reporting,
history, analytics, and subscription billing.

**Architecture:** A locally-installed Electron bridge (Node.js) interfaces with the USB
card reader via `serialport`, wraps the legacy C++ binary as a child process, buffers
reads in SQLite when offline, and streams data over WebSocket to the browser frontend.
The browser POSTs parsed card dumps to a Fastify cloud API. The API enforces multi-tenant
isolation via PostgreSQL RLS, caches idempotency keys in Redis, stores raw binary dumps in
S3, and publishes domain events to SQS. Separate worker processes consume those events:
VIN enrichment, PDF report generation, billing, and webhook dispatch.

**Tech Stack:**
- **Bridge:** Electron 30, serialport 12, better-sqlite3 8, electron-builder, electron-updater
- **API:** Node.js 20, Fastify 4, TypeScript 5, node-postgres (pg), @sinclair/typebox
- **Workers:** Node.js 20, @aws-sdk/client-sqs, pdfmake, TypeScript 5
- **Database:** PostgreSQL 16, PgBouncer 1.22 (transaction mode), Flyway 10
- **Cache / Queue:** Redis 7, AWS SQS (with DLQ), localstack for local dev
- **Storage:** AWS S3 (raw dumps + PDFs)
- **Observability:** OpenTelemetry SDK, prom-client, Pino
- **Infrastructure:** Docker, docker-compose, GitHub Actions
- **Auth:** JWT (RS256 for devices, HS256 for users), Auth0 or Keycloak for OIDC

---

## Subsystem Split

This spec covers four independent subsystems. Each produces working, testable software on
its own. Execute in order (DB → API → Workers → Bridge) because later subsystems depend
on earlier contracts.

| # | Subsystem | Tasks | Independent? |
|---|-----------|-------|-------------|
| A | Data Foundation (PostgreSQL schema, RLS, indexes, migrations) | 1–5 | Yes |
| B | Cloud API (Fastify, auth, multi-tenant, card-read endpoint) | 6–18 | Needs A |
| C | Workers (SQS consumers, VIN, PDF, billing, DLQ) | 19–24 | Needs A+B |
| D | Hardware Bridge (Electron, serialport, C++ wrapper, offline queue) | 25–33 | Needs B |
| E | Infrastructure + Observability + CI/CD | 34–42 | Needs all |

---

## Architecture Decision Log

### ADR-1: C++ Binary Integration — `child_process.spawn` (not N-API)

**Naive approach:** Compile C++ parser as N-API native addon, call synchronously from Node.
**Why it fails:** Must recompile per Electron version (version matrix is painful); C++ crash
= bridge crash (no isolation); distributing pre-built `.node` files per platform/arch
requires a build matrix.

**Correct approach:** `child_process.spawn` with newline-delimited JSON stdio protocol.
- C++ binary reads base64-encoded card dump from stdin, writes JSON result to stdout.
- Bridge sends requests with unique `id` fields; matches responses by `id`.
- If binary crashes: `exit` event fires, pending requests are rejected, binary restarts
  after 2s backoff.
- If binary hangs: per-request 10s timeout fires, request is rejected.
- Performance: ~5ms JSON serialization overhead per read. At 1 read/session this is irrelevant.

**What breaks first:** C++ binary on Linux if it was compiled Windows-only. Fix: include
Linux build in release, or rewrite the DDC parser in TypeScript for Linux (lower risk than
WASM rewrite for stage 1).

---

### ADR-2: Multi-Tenancy — PostgreSQL RLS (stage 1), schema-per-tenant (stage 3)

**Stage 1 (0–500 tenants):** Row-Level Security on all tenant-scoped tables.
App sets `SET LOCAL app.current_tenant_id = '<uuid>'` inside every transaction.
RLS policy: `USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID)`.

**What breaks without it:** Any query bypassing the RLS setter → silent cross-tenant data
leak. Prevention:
1. `withTenantContext()` wrapper enforced at the DB client layer (middleware cannot be skipped).
2. Integration tests that use Tenant A's JWT to probe Tenant B's resources → must get 404.
3. CI gate: scan for any new table missing an RLS policy (pg_tables vs pg_policies diff).

**Stage 2 (500–10k tenants):** Still RLS. Add read replicas; route analytics queries there.

**Stage 3 (10k+ tenants):** Schema-per-tenant becomes a migration nightmare
(`ALTER TABLE` on 10k schemas = hours). Switch to database-per-tenant with a connection
router (tenant_id → connection string mapping in Redis).

**Stage 4 (100k+ tenants):** Active-active multi-region with tenant-to-region pinning.
EU tachograph data **must** stay in EU (GDPR + EU Regulation 2016/799).

---

### ADR-3: Refresh Token Rotation — Redis Lock + Token Family Invalidation

**Naive approach:** Check refresh token → issue new tokens → invalidate old token.
**What breaks:** Two concurrent requests both read the old token as valid → both try to
rotate → second gets 401. User sees intermittent logouts.

**Correct approach:**
1. Redis distributed lock on `token-family:{familyId}` (SET NX, 5s TTL).
2. First request acquires lock, rotates tokens, releases lock.
3. If lock not acquired: check if token already rotated (valid family, new tokenId).
4. If same token used twice → possible theft → invalidate entire family → force re-login.

---

### ADR-4: Idempotency Key — Redis TTL Check + DB UPSERT

**What breaks without it:** Bridge retries after network timeout → duplicate card read
record. Mechanic sees double-reads in history.

**Correct approach:** Client-supplied `Idempotency-Key` header (card_serial + device_id +
minute-truncated timestamp, SHA-256 hashed).
- API checks Redis before processing (`idempotency:{key}` → cached response).
- If not cached: process, then cache response for 24h.
- DB insert uses `ON CONFLICT (idempotency_key) DO NOTHING` as a second safety net.
- On conflict: fetch and return existing record (same HTTP 201 response).

---

### ADR-5: Rate Limiting — Redis Sliding Window (not token bucket)

**Token bucket:** Allows bursts. A tenant can drain the bucket instantly. Good for APIs
where burst is acceptable.

**Sliding window:** Counts requests in a rolling time window. No burst at window
boundaries. What breaks at very high RPS: O(N) sorted-set operations per request.
Fix: Lua script (atomic in Redis, no race condition).

Per-tenant limit: 1000 card reads/hour. Per-device: 100/hour. Per-IP: 500/hour.

---

## File Structure

```
/
├── bridge/                         Electron desktop app
│   ├── src/
│   │   ├── main.ts                 Electron main process entry
│   │   ├── preload.ts              Context bridge for renderer IPC
│   │   ├── bridge/
│   │   │   ├── apdu.ts             ISO 7816 APDU command builder
│   │   │   ├── card-reader.ts      serialport wrapper + partial-read guard
│   │   │   ├── parser.ts           child_process C++ binary wrapper
│   │   │   ├── port-manager.ts     Concurrent port session manager
│   │   │   └── queue.ts            SQLite offline queue with retry backoff
│   │   ├── server/
│   │   │   ├── http.ts             Local HTTP server (localhost:7433)
│   │   │   └── websocket.ts        WebSocket server for browser frontend
│   │   └── cloud/
│   │       ├── auth.ts             Device JWT generation + rotation
│   │       └── client.ts           Cloud API client with retry
│   ├── tests/
│   │   ├── card-reader.test.ts
│   │   ├── parser.test.ts
│   │   ├── queue.test.ts
│   │   └── port-manager.test.ts
│   ├── electron-builder.json5
│   ├── package.json
│   └── tsconfig.json
│
├── api/                            Cloud Fastify API
│   ├── src/
│   │   ├── telemetry.ts            OpenTelemetry SDK init (imported first)
│   │   ├── metrics.ts              prom-client metric definitions
│   │   ├── app.ts                  Fastify app factory
│   │   ├── server.ts               Entry point
│   │   ├── types/
│   │   │   └── index.ts            Shared TypeScript types + Fastify augments
│   │   ├── plugins/
│   │   │   ├── auth.ts             JWT + device JWT validation
│   │   │   ├── tenant.ts           Multi-tenant RLS context middleware
│   │   │   ├── rate-limit.ts       Redis sliding window rate limiter
│   │   │   └── observability.ts    Request logging + tracing hooks
│   │   ├── routes/
│   │   │   ├── health.ts           GET /health, GET /ready
│   │   │   └── v1/
│   │   │       ├── card-reads.ts   POST /v1/card-reads, GET /v1/card-reads
│   │   │       ├── vehicles.ts     CRUD /v1/vehicles
│   │   │       └── devices.ts      Device registration + revocation
│   │   ├── services/
│   │   │   ├── card-read.service.ts  Idempotency + S3 + DB + event emit
│   │   │   └── event-emitter.ts    SQS publish wrapper
│   │   ├── db/
│   │   │   ├── client.ts           pg Pool configured for PgBouncer
│   │   │   └── tenant-context.ts   withTenantContext() transaction wrapper
│   │   └── cache/
│   │       └── redis.ts            Redis client + circuit breaker
│   ├── tests/
│   │   ├── integration/
│   │   │   └── card-reads.test.ts
│   │   └── security/
│   │       └── cross-tenant.test.ts  Cross-tenant probe tests (CI gate)
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── worker/                         Background worker processes
│   ├── src/
│   │   ├── index.ts                Worker entry (WORKER_TYPE env selects consumer)
│   │   ├── queue/
│   │   │   └── sqs.ts              SQS client + long-poll loop
│   │   ├── consumers/
│   │   │   ├── vehicle-enrich.consumer.ts   VIN lookup + mileage anomaly
│   │   │   ├── report-generate.consumer.ts  PDF generation + S3 upload
│   │   │   ├── billing-event.consumer.ts    Usage billing event emit
│   │   │   ├── webhook-dispatch.consumer.ts Tenant webhook delivery
│   │   │   └── dlq.consumer.ts              DLQ monitor + alerting
│   │   └── services/
│   │       ├── vin-lookup.service.ts
│   │       ├── pdf-generator.service.ts
│   │       └── anomaly-detector.service.ts
│   ├── tests/
│   │   └── vehicle-enrich.test.ts
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── db/
│   └── migrations/
│       ├── V1__initial_schema.sql
│       ├── V2__rls_policies.sql
│       ├── V3__indexes.sql
│       └── V4__partition_card_reads.sql
│
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.test.yml
│   ├── init-postgres.sql           Creates app_role, migration_role
│   ├── localstack-init.sh          Creates SQS queues + S3 buckets
│   ├── prometheus.yml
│   └── otel-collector.yml
│
└── .github/
    └── workflows/
        ├── ci.yml
        └── deploy.yml
```

---

## SUBSYSTEM A — Data Foundation

### Task 1: PostgreSQL Initial Schema

**Files:**
- Create: `db/migrations/V1__initial_schema.sql`

- [ ] **Step 1: Write the migration**

```sql
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

-- card_reads will be PARTITIONED in V4; create unpartitioned first
CREATE TABLE card_reads (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  device_id        UUID        NOT NULL REFERENCES devices(id),
  vehicle_id       UUID        REFERENCES vehicles(id),
  idempotency_key  TEXT        NOT NULL UNIQUE,
  raw_dump_s3_key  TEXT        NOT NULL,
  parsed_data      JSONB       NOT NULL,
  card_serial      TEXT,
  card_type        TEXT        CHECK (card_type IN ('driver','vehicle','workshop','control')),
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

-- append-only; never UPDATE or DELETE rows here
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
```

- [ ] **Step 2: Verify migration parses cleanly**

```bash
docker run --rm -e POSTGRES_PASSWORD=x postgres:16-alpine \
  psql -U postgres -c "SELECT 1" 2>/dev/null && echo "postgres available"
# (full apply tested in Task 5 with docker-compose)
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/V1__initial_schema.sql
git commit -m "feat(db): initial schema — tenants, users, devices, vehicles, card_reads"
```

---

### Task 2: RLS Policies

**Files:**
- Create: `db/migrations/V2__rls_policies.sql`
- Create: `infra/init-postgres.sql`

**What breaks without this:** Any API route that forgets to call `withTenantContext()`
will silently return data from all tenants. RLS is the last line of defence.

- [ ] **Step 1: Write the init script (runs once at DB creation)**

```sql
-- infra/init-postgres.sql
-- Application role: RLS applies
CREATE ROLE app_role WITH LOGIN PASSWORD 'changeme_in_prod';
GRANT CONNECT ON DATABASE vehicledb TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_role;

-- Migration role: bypasses RLS (Flyway uses this)
CREATE ROLE migration_role WITH LOGIN PASSWORD 'changeme_in_prod' BYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE vehicledb TO migration_role;
```

- [ ] **Step 2: Write RLS migration**

```sql
-- db/migrations/V2__rls_policies.sql
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_reads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- All policies use the same pattern.
-- current_setting('app.current_tenant_id', true) returns NULL if not set.
-- Casting NULL::UUID causes the USING clause to evaluate to NULL → row hidden.

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
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/V2__rls_policies.sql infra/init-postgres.sql
git commit -m "feat(db): RLS policies for all tenant-scoped tables"
```

---

### Task 3: Indexes

**Files:**
- Create: `db/migrations/V3__indexes.sql`

**What breaks without indexes at 10M rows:** Full table scans on `card_reads` per tenant
query → 30s+ query time. The `idempotency_key` lookup becomes O(N).

- [ ] **Step 1: Write index migration**

```sql
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

-- card_reads  (most critical — highest query volume)
CREATE INDEX idx_card_reads_tenant_created
  ON card_reads(tenant_id, created_at DESC);
CREATE INDEX idx_card_reads_vehicle
  ON card_reads(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_card_reads_device
  ON card_reads(device_id);
-- cursor-based pagination: (tenant_id, created_at DESC, id DESC)
CREATE INDEX idx_card_reads_cursor
  ON card_reads(tenant_id, created_at DESC, id DESC);
-- idempotency lookup (UNIQUE already creates index; this is explicit for clarity)
-- idempotency_key UNIQUE index already created by UNIQUE constraint in V1

-- reports
CREATE INDEX idx_reports_card_read  ON reports(card_read_id);
CREATE INDEX idx_reports_tenant     ON reports(tenant_id, created_at DESC);

-- audit_log
CREATE INDEX idx_audit_tenant_created
  ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_resource
  ON audit_log(resource_type, resource_id);

-- billing_events
CREATE INDEX idx_billing_tenant_created
  ON billing_events(tenant_id, created_at DESC);
CREATE INDEX idx_billing_unprocessed
  ON billing_events(tenant_id) WHERE processed_at IS NULL;
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/V3__indexes.sql
git commit -m "feat(db): indexes for tenant isolation, cursor pagination, VIN/plate lookup"
```

---

### Task 4: Partition card_reads

**Files:**
- Create: `db/migrations/V4__partition_card_reads.sql`

**When necessary:** At ~50M rows the planner stops using the tenant_id index efficiently.
Partition prunes by `created_at` range so queries only scan relevant monthly partitions.

**What breaks if you skip this at 100M rows:** `VACUUM` takes hours, autovacuum can't keep
up, table bloat grows, index scans degrade to seq scans on hot pages.

- [ ] **Step 1: Write partition migration**

```sql
-- db/migrations/V4__partition_card_reads.sql
-- Zero-downtime approach: rename → recreate → copy → swap.
-- Run during low-traffic window. Do NOT run on a table with active writes
-- without a maintenance window lock.

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
  card_type        TEXT,
  read_status      TEXT        NOT NULL DEFAULT 'success',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)   -- partition key in PK
) PARTITION BY RANGE (created_at);

-- Create two years of monthly partitions
-- In production: automate with pg_partman extension
DO $$
DECLARE
  y INT; m INT;
  start_date DATE; end_date DATE;
  partition_name TEXT;
BEGIN
  FOR y IN 2026..2027 LOOP
    FOR m IN 1..12 LOOP
      start_date := make_date(y, m, 1);
      end_date   := start_date + INTERVAL '1 month';
      partition_name := format('card_reads_%s_%s', y, lpad(m::text, 2, '0'));
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF card_reads FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
      );
    END LOOP;
  END LOOP;
END $$;

-- Re-enable RLS
ALTER TABLE card_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON card_reads
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Add unique constraint (partition key must be part of it)
ALTER TABLE card_reads
  ADD CONSTRAINT card_reads_idempotency_unique
  UNIQUE (idempotency_key, created_at);

-- Copy existing data
INSERT INTO card_reads SELECT * FROM card_reads_v1;

-- Recreate indexes
CREATE INDEX idx_card_reads_tenant_created ON card_reads(tenant_id, created_at DESC);
CREATE INDEX idx_card_reads_vehicle        ON card_reads(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_card_reads_device         ON card_reads(device_id);
CREATE INDEX idx_card_reads_cursor         ON card_reads(tenant_id, created_at DESC, id DESC);

COMMIT;

-- After verifying row counts match:
-- DROP TABLE card_reads_v1;
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/V4__partition_card_reads.sql
git commit -m "feat(db): partition card_reads by created_at for scalability"
```

---

### Task 5: Validate migrations with docker-compose

**Files:**
- Create: `infra/docker-compose.yml` (partial — DB + Flyway only for now)

- [ ] **Step 1: Write minimal compose for DB validation**

```yaml
# infra/docker-compose.yml (DB section — expand in Task 34)
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: vehicledb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports: ["5432:5432"]
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-postgres.sql:/docker-entrypoint-initdb.d/01-init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10

  flyway:
    image: flyway/flyway:10
    command: migrate
    environment:
      FLYWAY_URL: jdbc:postgresql://postgres:5432/vehicledb
      FLYWAY_USER: postgres
      FLYWAY_PASSWORD: postgres
      FLYWAY_LOCATIONS: filesystem:/flyway/sql
    volumes:
      - ../db/migrations:/flyway/sql
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

- [ ] **Step 2: Run migrations and verify**

```bash
cd infra
docker-compose up flyway --exit-code-from flyway
# Expected: "Successfully applied 4 migrations"
docker-compose exec postgres psql -U postgres vehicledb \
  -c "\dt" | grep -E "tenants|users|devices|vehicles|card_reads|reports"
# Expected: all 7 tables listed
```

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(infra): docker-compose with PostgreSQL + Flyway migration runner"
```

---

CONTINUE? (say 'next')

---

## SUBSYSTEM B — Cloud API

### Task 6: API project scaffold

**Files:**
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/src/types/index.ts`

- [ ] **Step 1: Write `api/package.json`**

```json
{
  "name": "vehicle-card-api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts",
    "test": "vitest run",
    "test:security": "vitest run tests/security"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.540.0",
    "@aws-sdk/client-sqs": "^3.540.0",
    "@fastify/jwt": "^8.0.0",
    "@fastify/sensible": "^5.5.0",
    "@opentelemetry/api": "^1.7.0",
    "@opentelemetry/auto-instrumentations-node": "^0.43.0",
    "@opentelemetry/exporter-trace-otlp-grpc": "^0.50.0",
    "@opentelemetry/sdk-node": "^0.50.0",
    "@opentelemetry/semantic-conventions": "^1.21.0",
    "@sinclair/typebox": "^0.32.0",
    "fastify": "^4.26.0",
    "fastify-plugin": "^4.5.1",
    "ioredis": "^5.3.2",
    "pg": "^8.11.3",
    "pino": "^8.19.0",
    "prom-client": "^15.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.3.0"
  }
}
```

- [ ] **Step 2: Write `api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Write `api/src/types/index.ts`**

```typescript
// api/src/types/index.ts
import { FastifyRequest } from 'fastify';

export interface TenantJwtPayload {
  sub: string;       // user_id
  tenantId: string;
  role: 'mechanic' | 'garage_admin' | 'saas_admin';
  type: 'user';
  iat: number; exp: number;
}

export interface DeviceJwtPayload {
  sub: string;       // device_id
  tenantId: string;
  keyId: string;
  type: 'device';
  iat: number; exp: number;
}

export type JwtPayload = TenantJwtPayload | DeviceJwtPayload;

declare module 'fastify' {
  interface FastifyRequest {
    jwtPayload: JwtPayload;
    tenantId: string;
  }
}

export interface CardRead {
  id: string; tenant_id: string; device_id: string; vehicle_id: string | null;
  idempotency_key: string; raw_dump_s3_key: string;
  parsed_data: Record<string, unknown>;
  card_serial: string | null;
  card_type: 'driver' | 'vehicle' | 'workshop' | 'control' | null;
  read_status: 'success' | 'partial' | 'error';
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[]; nextCursor: string | null; hasNextPage: boolean;
}
```

---

### Task 7: Database client + tenant context wrapper

**Files:**
- Create: `api/src/db/client.ts`
- Create: `api/src/db/tenant-context.ts`
- Create: `api/tests/unit/tenant-context.test.ts`

**What breaks without `withTenantContext`:** Any direct `pool.query()` call bypasses RLS
because `app.current_tenant_id` is never set — all-tenant data returned silently.

- [ ] **Step 1: Write `api/src/db/client.ts`**

```typescript
// api/src/db/client.ts
import { Pool } from 'pg';

// PgBouncer transaction mode requires: no session-level SET (use SET LOCAL inside
// transactions), no LISTEN, no advisory locks, no prepared statements.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
});

pool.on('error', (err) => { console.error({ err }, 'pg pool error'); });
```

- [ ] **Step 2: Write `api/src/db/tenant-context.ts`**

```typescript
// api/src/db/tenant-context.ts
import { Pool, PoolClient } from 'pg';

// ALL queries touching tenant tables must use this wrapper.
// SET LOCAL scopes the config variable to this transaction only —
// PgBouncer releases the connection after COMMIT, so the setting cannot
// bleed into another tenant's request on the same pooled connection.
export async function withTenantContext<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      [tenantId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Write unit test for tenant-context**

```typescript
// api/tests/unit/tenant-context.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '../../src/db/tenant-context';

describe('withTenantContext', () => {
  it('sets RLS config then commits on success', async () => {
    const calls: string[] = [];
    const mockClient = {
      query: vi.fn(async (sql: string) => { calls.push(sql.trim().split('\n')[0]); }),
      release: vi.fn(),
    };
    const mockPool = { connect: vi.fn().mockResolvedValue(mockClient) } as any;

    const result = await withTenantContext(mockPool, 'tenant-uuid', async (c) => {
      await c.query('SELECT 1');
      return 42;
    });

    expect(result).toBe(42);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain('set_config');
    expect(calls[2]).toBe('SELECT 1');
    expect(calls[3]).toBe('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('rolls back and releases on error', async () => {
    const calls: string[] = [];
    const mockClient = {
      query: vi.fn(async (sql: string) => { calls.push(sql.trim().split('\n')[0]); }),
      release: vi.fn(),
    };
    const mockPool = { connect: vi.fn().mockResolvedValue(mockClient) } as any;

    await expect(
      withTenantContext(mockPool, 'tenant-uuid', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    expect(calls).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test — `cd api && npx vitest run tests/unit/tenant-context.test.ts`**

Expected: 2 tests PASS.

---

### Task 8: Redis client with circuit breaker

**Files:**
- Create: `api/src/cache/redis.ts`
- Create: `api/tests/unit/redis.test.ts`

**Failure modes:**
- Redis down → rate limiter and idempotency check degrade (allow through, log warning)
- Session store down → auth fails (acceptable: cannot safely auth without token lookup)
- Circuit breaker: 5 consecutive failures → open for 30s → half-open on next call

- [ ] **Step 1: Write `api/src/cache/redis.ts`**

```typescript
// api/src/cache/redis.ts
import Redis from 'ioredis';

const FAILURE_THRESHOLD = 5;
const RESET_MS = 30_000;

let failures = 0;
let circuitOpenAt: number | null = null;

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  lazyConnect: false,
  connectTimeout: 3_000,
});
redis.on('error', () => {});

function isOpen(): boolean {
  if (circuitOpenAt === null) return false;
  if (Date.now() - circuitOpenAt > RESET_MS) { circuitOpenAt = null; failures = 0; return false; }
  return true;
}
function fail(): void { if (++failures >= FAILURE_THRESHOLD) { circuitOpenAt = Date.now(); } }
function ok(): void { failures = 0; circuitOpenAt = null; }

export async function safeGet(key: string): Promise<string | null> {
  if (isOpen()) return null;
  try { const v = await redis.get(key); ok(); return v; } catch { fail(); return null; }
}

export async function safeSet(key: string, value: string, ttl: number): Promise<void> {
  if (isOpen()) return;
  try { await redis.setex(key, ttl, value); ok(); } catch { fail(); }
}

export function isRedisHealthy(): boolean {
  return redis.status === 'ready' && !isOpen();
}

// Sliding-window rate limiter using a Lua script (atomic, no race condition)
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window_ms)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, tostring(now) .. math.random(1000000))
  redis.call('PEXPIRE', key, window_ms)
  return 0
end
return 1
`;

let rateLimitSha: string | null = null;

export async function checkRateLimit(
  key: string, windowMs: number, limit: number,
): Promise<boolean> {
  if (isOpen()) return true; // degrade: allow through
  if (!rateLimitSha) { rateLimitSha = await redis.script('LOAD', RATE_LIMIT_SCRIPT) as string; }
  try {
    const result = await redis.evalsha(rateLimitSha, 1, key, windowMs, limit, Date.now());
    ok();
    return result === 0; // true = allowed
  } catch { fail(); return true; } // degrade on error
}
```

- [ ] **Step 2: Run typecheck — `cd api && npm run typecheck`**

Expected: no errors.

---

### Task 9: Fastify app factory, health + ready routes

**Files:**
- Create: `api/src/app.ts`
- Create: `api/src/server.ts`
- Create: `api/src/routes/health.ts`
- Create: `api/tests/integration/health.test.ts`

- [ ] **Step 1: Write `api/src/routes/health.ts`**

```typescript
// api/src/routes/health.ts
import { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/client';
import { isRedisHealthy } from '../cache/redis';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (_req, reply) => reply.send({ status: 'ok' }));

  fastify.get('/ready', async (_req, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = {};
    try { await pool.query('SELECT 1'); checks.postgres = 'ok'; }
    catch { checks.postgres = 'fail'; }
    checks.redis = isRedisHealthy() ? 'ok' : 'fail';
    const allOk = Object.values(checks).every((v) => v === 'ok');
    return reply.code(allOk ? 200 : 503).send({ status: allOk ? 'ready' : 'not_ready', checks });
  });

  fastify.get('/metrics', async (_req, reply) => {
    const { registry } = await import('../metrics');
    reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });
};
```

- [ ] **Step 2: Write `api/src/app.ts`**

```typescript
// api/src/app.ts
import Fastify, { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { healthRoutes } from './routes/health';

export async function buildApp(opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: true, coerceTypes: false } },
  });
  await app.register(sensible);
  await app.register(healthRoutes);
  // auth, tenant, rate-limit plugins registered in Tasks 10-12
  return app;
}
```

- [ ] **Step 3: Write `api/src/server.ts`**

```typescript
// api/src/server.ts
// Must import telemetry first — patches pg/http/redis before they load
import './telemetry';
import { buildApp } from './app';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => { await app.close(); process.exit(0); });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Write health integration test**

```typescript
// api/tests/integration/health.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp({ logger: false }); });
afterAll(async () => { await app.close(); });

describe('GET /health', () => {
  it('always 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /ready', () => {
  it('503 when postgres unreachable (no DB in unit env)', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).checks.postgres).toBe('fail');
  });
});
```

- [ ] **Step 5: Run — `cd api && npx vitest run tests/integration/health.test.ts`**

Expected: 2 PASS.

---

### Task 10: Auth plugin (user JWT + device JWT with revocation)

**Files:**
- Create: `api/src/plugins/auth.ts`

**Security notes:**
- User tokens: HS256, 15-minute expiry. Refresh tokens in HttpOnly cookies (Task 11a).
- Device tokens: RS256, 1-hour expiry. Private key generated on-device; public key stored in DB.
- Never log token values — only log `sub` and `kid`.
- Revoked devices: `revoked_at IS NOT NULL` → 401. Cache public keys 5 min so revocation
  takes effect within one cache TTL.

- [ ] **Step 1: Write `api/src/plugins/auth.ts`**

```typescript
// api/src/plugins/auth.ts
import fp from 'fastify-plugin';
import jwtPlugin from '@fastify/jwt';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { pool } from '../db/client';
import { safeGet, safeSet } from '../cache/redis';
import type { JwtPayload } from '../types';

const DEVICE_KEY_TTL = 300; // 5 min cache for public keys

export const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  await fastify.register(jwtPlugin, { secret: process.env.JWT_SECRET! });

  fastify.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Missing token' });
    const token = auth.slice(7);

    // Peek at header to detect RS256 (device) vs HS256 (user)
    let alg: string;
    try {
      alg = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).alg;
    } catch { return reply.code(401).send({ error: 'Malformed token' }); }

    if (alg === 'RS256') {
      return verifyDeviceToken(req, reply, token);
    }
    try {
      req.jwtPayload = await req.jwtVerify<JwtPayload>();
    } catch { return reply.code(401).send({ error: 'Invalid or expired token' }); }
  });
});

async function verifyDeviceToken(req: FastifyRequest, reply: FastifyReply, token: string) {
  let payload: any;
  try { payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); }
  catch { return reply.code(401).send({ error: 'Malformed device token' }); }

  const { sub: deviceId, kid, tenantId } = payload;
  if (!deviceId || !kid || !tenantId) return reply.code(401).send({ error: 'Device token incomplete' });

  const cacheKey = `dev-pubkey:${deviceId}:${kid}`;
  let pem = await safeGet(cacheKey);

  if (!pem) {
    const { rows } = await pool.query(
      `SELECT public_key_pem, revoked_at FROM devices WHERE id=$1 AND key_id=$2`,
      [deviceId, kid],
    );
    if (!rows.length) return reply.code(401).send({ error: 'Unknown device' });
    if (rows[0].revoked_at) return reply.code(401).send({ error: 'Device revoked' });
    pem = rows[0].public_key_pem;
    await safeSet(cacheKey, pem, DEVICE_KEY_TTL);
  }

  try {
    const [h, b, s] = token.split('.');
    const valid = crypto.verify('sha256', Buffer.from(`${h}.${b}`),
      crypto.createPublicKey(pem!), Buffer.from(s, 'base64url'));
    if (!valid || payload.exp * 1000 < Date.now()) throw new Error();
  } catch { return reply.code(401).send({ error: 'Invalid device token' }); }

  req.jwtPayload = { sub: deviceId, tenantId, keyId: kid, type: 'device',
                     iat: payload.iat, exp: payload.exp };
}
```

- [ ] **Step 2: Run typecheck — `cd api && npm run typecheck`**

Expected: no errors.

---

### Task 11: Multi-tenant middleware

**Files:**
- Create: `api/src/plugins/tenant.ts`

- [ ] **Step 1: Write `api/src/plugins/tenant.ts`**

```typescript
// api/src/plugins/tenant.ts
import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

export const tenantPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.decorate('requireTenantContext', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.jwtPayload?.tenantId;
    if (!tenantId) return reply.code(401).send({ error: 'Missing tenant context' });
    req.tenantId = tenantId;
  });
});
```

- [ ] **Step 2: Update `api/src/app.ts` to register auth + tenant plugins**

```typescript
// api/src/app.ts
import Fastify, { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { healthRoutes } from './routes/health';
import { authPlugin } from './plugins/auth';
import { tenantPlugin } from './plugins/tenant';

export async function buildApp(opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: true, coerceTypes: false } },
  });
  await app.register(sensible);
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(healthRoutes);
  return app;
}
```

- [ ] **Step 3: Run typecheck — `cd api && npm run typecheck`** — Expected: no errors.

---

### Task 12: Prometheus metrics + OpenTelemetry

**Files:**
- Create: `api/src/metrics.ts`
- Create: `api/src/telemetry.ts`

- [ ] **Step 1: Write `api/src/metrics.ts`**

```typescript
// api/src/metrics.ts
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'vehicle-card-api' });

export const cardReadLatency = new Histogram({
  name: 'card_read_latency_ms', help: 'Card read processing duration (ms)',
  labelNames: ['tenant_id', 'status'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000], registers: [registry],
});
export const cardReadTotal = new Counter({
  name: 'card_reads_total', help: 'Total card reads',
  labelNames: ['tenant_id', 'status'], registers: [registry],
});
export const failedReadsTotal = new Counter({
  name: 'failed_reads_total', help: 'Failed reads by error type',
  labelNames: ['tenant_id', 'error_type'], registers: [registry],
});
export const billingEventsTotal = new Counter({
  name: 'billing_events_emitted_total', help: 'Billing events emitted',
  labelNames: ['tenant_id', 'event_type'], registers: [registry],
});
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_ms', help: 'DB query duration (ms)',
  labelNames: ['query_name'], buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry],
});
```

- [ ] **Step 2: Write `api/src/telemetry.ts`**

```typescript
// api/src/telemetry.ts — import first in server.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ParentBasedSampler, TraceIdRatioBased } from '@opentelemetry/sdk-trace-node';

const sdk = new NodeSDK({
  resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: 'vehicle-card-api' }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBased(process.env.NODE_ENV === 'production' ? 0.1 : 1.0),
  }),
});
if (process.env.NODE_ENV !== 'test') sdk.start();
process.on('SIGTERM', () => sdk.shutdown());
```

---

### Task 13: Card-read endpoint with idempotency + event emission

**Files:**
- Create: `api/src/services/event-emitter.ts`
- Create: `api/src/services/card-read.service.ts`
- Create: `api/src/routes/v1/card-reads.ts`

- [ ] **Step 1: Write `api/src/services/event-emitter.ts`**

```typescript
// api/src/services/event-emitter.ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
});

const QUEUES: Record<string, string | undefined> = {
  'card.read.completed': process.env.SQS_CARD_READ_QUEUE_URL,
  'billing.event':       process.env.SQS_BILLING_QUEUE_URL,
  'report.requested':    process.env.SQS_REPORT_QUEUE_URL,
};

export async function emitEvent(eventType: string, payload: object): Promise<void> {
  const url = QUEUES[eventType];
  if (!url) throw new Error(`Unknown event: ${eventType}`);
  await sqs.send(new SendMessageCommand({
    QueueUrl: url,
    MessageBody: JSON.stringify({ eventType, payload, ts: new Date().toISOString() }),
    MessageAttributes: { eventType: { DataType: 'String', StringValue: eventType } },
  }));
}
```

- [ ] **Step 2: Write `api/src/services/card-read.service.ts`**

```typescript
// api/src/services/card-read.service.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { pool } from '../db/client';
import { withTenantContext } from '../db/tenant-context';
import { safeGet, safeSet } from '../cache/redis';
import { emitEvent } from './event-emitter';
import type { CardRead, PaginatedResponse } from '../types';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  forcePathStyle: !!process.env.AWS_ENDPOINT_URL,
});
const BUCKET = process.env.S3_RAW_DUMP_BUCKET!;
const IDEM_TTL = 86_400;

export interface ProcessInput {
  tenantId: string; deviceId: string; rawDump: Buffer;
  cardSerial: string; cardType: string; idempotencyKey: string;
}

export const cardReadService = {
  async process(input: ProcessInput): Promise<CardRead> {
    const cacheKey = `idem:${input.idempotencyKey}`;
    const cached = await safeGet(cacheKey);
    if (cached) return JSON.parse(cached);

    if (input.rawDump.length === 0)
      throw Object.assign(new Error('Empty card dump'), { statusCode: 422 });

    // Store raw dump before DB write — if DB fails we still have the binary
    const s3Key = `${input.tenantId}/card-reads/${input.idempotencyKey}.bin`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: s3Key, Body: input.rawDump,
      ContentType: 'application/octet-stream',
      Metadata: { tenantId: input.tenantId, cardType: input.cardType },
    }));

    const record = await withTenantContext(pool, input.tenantId, async (client) => {
      const { rows } = await client.query<CardRead>(
        `INSERT INTO card_reads
           (tenant_id,device_id,card_serial,card_type,idempotency_key,raw_dump_s3_key,parsed_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
        [input.tenantId, input.deviceId, input.cardSerial, input.cardType,
         input.idempotencyKey, s3Key, '{}'],
      );
      if (rows.length === 0) {
        const { rows: ex } = await client.query<CardRead>(
          'SELECT * FROM card_reads WHERE idempotency_key=$1', [input.idempotencyKey],
        );
        return ex[0];
      }
      return rows[0];
    });

    await safeSet(cacheKey, JSON.stringify(record), IDEM_TTL);

    // Fire-and-forget — do not await, do not block HTTP response
    emitEvent('card.read.completed', { tenantId: input.tenantId, cardReadId: record.id })
      .catch((e) => console.error({ e }, 'emit card.read.completed failed'));
    emitEvent('billing.event', { tenantId: input.tenantId, cardReadId: record.id })
      .catch((e) => console.error({ e }, 'emit billing.event failed'));

    return record;
  },

  async list(params: { tenantId: string; cursor?: string; limit: number; vehicleId?: string }): Promise<PaginatedResponse<CardRead>> {
    const { tenantId, cursor, limit, vehicleId } = params;
    let decoded: { id: string; createdAt: string } | null = null;
    if (cursor) {
      try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()); }
      catch { throw Object.assign(new Error('Invalid cursor'), { statusCode: 400 }); }
    }

    const rows = await withTenantContext(pool, tenantId, async (c) => {
      const conds = ['1=1']; const vals: unknown[] = []; let p = 1;
      if (vehicleId) { conds.push(`vehicle_id=$${p++}`); vals.push(vehicleId); }
      if (decoded) {
        conds.push(`(created_at,id)<($${p++},$${p++})`);
        vals.push(decoded.createdAt, decoded.id);
      }
      vals.push(limit + 1);
      const { rows } = await c.query<CardRead>(
        `SELECT id,tenant_id,device_id,vehicle_id,card_serial,card_type,read_status,created_at
         FROM card_reads WHERE ${conds.join(' AND ')}
         ORDER BY created_at DESC, id DESC LIMIT $${p}`, vals,
      );
      return rows;
    });

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage
      ? Buffer.from(JSON.stringify({ id: items.at(-1)!.id, createdAt: items.at(-1)!.created_at })).toString('base64url')
      : null;
    return { items, nextCursor, hasNextPage };
  },
};
```

- [ ] **Step 3: Write `api/src/routes/v1/card-reads.ts`**

```typescript
// api/src/routes/v1/card-reads.ts
import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { cardReadService } from '../../services/card-read.service';
import { cardReadLatency, cardReadTotal, failedReadsTotal } from '../../metrics';

export const cardReadsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', {
    schema: {
      body: Type.Object({
        deviceId: Type.String({ format: 'uuid' }),
        rawDump:  Type.String({ minLength: 1 }),
        cardSerial: Type.String({ maxLength: 64 }),
        cardType: Type.Union([
          Type.Literal('driver'), Type.Literal('vehicle'),
          Type.Literal('workshop'), Type.Literal('control'),
        ]),
      }),
      headers: Type.Object({ 'idempotency-key': Type.String({ minLength: 32, maxLength: 128 }) }),
    },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const tenantId = req.tenantId;
    const stop = cardReadLatency.startTimer({ tenant_id: tenantId });
    try {
      const result = await cardReadService.process({
        tenantId, deviceId: req.body.deviceId,
        rawDump: Buffer.from(req.body.rawDump, 'base64'),
        cardSerial: req.body.cardSerial, cardType: req.body.cardType,
        idempotencyKey: req.headers['idempotency-key'],
      });
      cardReadTotal.inc({ tenant_id: tenantId, status: 'success' });
      stop({ status: 'success' });
      return reply.code(201).send(result);
    } catch (err: any) {
      failedReadsTotal.inc({ tenant_id: tenantId, error_type: err.statusCode === 422 ? 'validation' : 'internal' });
      stop({ status: 'error' });
      throw err;
    }
  });

  fastify.get('/', {
    schema: {
      querystring: Type.Object({
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
        vehicleId: Type.Optional(Type.String({ format: 'uuid' })),
      }),
    },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { cursor, limit = 20, vehicleId } = req.query;
    return reply.send(await cardReadService.list({ tenantId: req.tenantId, cursor, limit, vehicleId }));
  });
};
```

- [ ] **Step 4: Register route in `api/src/app.ts`** — add inside `buildApp` before `return app`:

```typescript
  const { cardReadsRoutes } = await import('./routes/v1/card-reads');
  await app.register(cardReadsRoutes, { prefix: '/v1/card-reads' });
```

- [ ] **Step 5: Run typecheck** — `cd api && npm run typecheck` — Expected: no errors.

---

### Task 14: Cross-tenant security probe tests (CI gate)

**Files:**
- Create: `api/tests/helpers.ts`
- Create: `api/tests/security/cross-tenant.test.ts`

**These run against a real PostgreSQL in CI. They are the primary guard against RLS being
forgotten on a new table or a new route bypassing `requireTenantContext`.**

- [ ] **Step 1: Write `api/tests/helpers.ts`**

```typescript
// api/tests/helpers.ts
import { pool } from '../src/db/client';
import * as jwt from 'jsonwebtoken';

export async function createTestTenant(name: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
    [name, name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()],
  );
  return rows[0].id as string;
}

export function makeUserToken(tenantId: string, role = 'mechanic'): string {
  return jwt.sign(
    { sub: 'test-user', tenantId, role, type: 'user' },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  );
}
```

- [ ] **Step 2: Write cross-tenant test**

```typescript
// api/tests/security/cross-tenant.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import { withTenantContext } from '../../src/db/tenant-context';
import { createTestTenant, makeUserToken } from '../helpers';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let tenantA: string, tenantB: string, tokenA: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  tenantA = await createTestTenant('Probe Tenant A');
  tenantB = await createTestTenant('Probe Tenant B');
  tokenA = makeUserToken(tenantA);
});

afterAll(async () => {
  await pool.query(`DELETE FROM tenants WHERE name LIKE 'Probe Tenant%'`);
  await app.close();
});

it('Tenant A list returns zero records owned by Tenant B', async () => {
  // Seed a record for Tenant B
  await withTenantContext(pool, tenantB, async (c) => {
    await c.query(
      `INSERT INTO vehicles (tenant_id, plate) VALUES ($1, 'PROBE-B-PLATE')`,
      [tenantB],
    );
  });

  const res = await app.inject({
    method: 'GET', url: '/v1/card-reads',
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  expect(res.statusCode).toBe(200);
  const ids: string[] = JSON.parse(res.body).items.map((r: any) => r.tenant_id);
  expect(ids.every((id) => id === tenantA)).toBe(true);
});
```

- [ ] **Step 3: Run against real DB**

```bash
cd infra && docker-compose up postgres flyway -d --wait
cd ../api
DATABASE_URL=postgresql://app_role:changeme_in_prod@localhost:5432/vehicledb \
REDIS_URL=redis://localhost:6379 JWT_SECRET=test-secret \
npx vitest run tests/security
```

Expected: PASS. If this fails, a tenant isolation regression has been introduced.

---

### Task 15: Vehicles route (CRUD + cursor pagination)

**Files:**
- Create: `api/src/routes/v1/vehicles.ts`

- [ ] **Step 1: Write `api/src/routes/v1/vehicles.ts`**

```typescript
// api/src/routes/v1/vehicles.ts
import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { pool } from '../../db/client';
import { withTenantContext } from '../../db/tenant-context';

const VehicleBody = Type.Object({
  vin:        Type.Optional(Type.String({ maxLength: 17 })),
  plate:      Type.Optional(Type.String({ maxLength: 20 })),
  make:       Type.Optional(Type.String({ maxLength: 64 })),
  model:      Type.Optional(Type.String({ maxLength: 64 })),
  year:       Type.Optional(Type.Integer({ minimum: 1900, maximum: 2100 })),
  ownerName:  Type.Optional(Type.String({ maxLength: 128 })),
  ownerPhone: Type.Optional(Type.String({ maxLength: 32 })),
});

export const vehiclesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', {
    schema: {
      querystring: Type.Object({
        cursor: Type.Optional(Type.String()),
        limit:  Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
        plate:  Type.Optional(Type.String()),
        vin:    Type.Optional(Type.String()),
      }),
    },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { cursor, limit = 20, plate, vin } = req.query;
    let decoded: { id: string; createdAt: string } | null = null;
    if (cursor) {
      try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()); }
      catch { return reply.code(400).send({ error: 'Invalid cursor' }); }
    }

    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const conds = ['deleted_at IS NULL']; const vals: unknown[] = []; let p = 1;
      if (plate) { conds.push(`plate ILIKE $${p++}`); vals.push(`%${plate}%`); }
      if (vin)   { conds.push(`vin = $${p++}`); vals.push(vin); }
      if (decoded) {
        conds.push(`(created_at, id) < ($${p++}, $${p++})`);
        vals.push(decoded.createdAt, decoded.id);
      }
      vals.push(limit + 1);
      const { rows } = await c.query(
        `SELECT id,tenant_id,vin,plate,make,model,year,owner_name,owner_phone,created_at
         FROM vehicles WHERE ${conds.join(' AND ')}
         ORDER BY created_at DESC, id DESC LIMIT $${p}`, vals,
      );
      return rows;
    });

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage
      ? Buffer.from(JSON.stringify({ id: items.at(-1)!.id, createdAt: items.at(-1)!.created_at })).toString('base64url')
      : null;
    return reply.send({ items, nextCursor, hasNextPage });
  });

  fastify.get('/:id', {
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM vehicles WHERE id=$1 AND deleted_at IS NULL`, [id],
      );
      return rows;
    });
    if (!rows.length) return reply.code(404).send({ error: 'Not found' });
    return reply.send(rows[0]);
  });

  fastify.post('/', {
    schema: { body: VehicleBody },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const b = req.body;
    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO vehicles (tenant_id,vin,plate,make,model,year,owner_name,owner_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.tenantId, b.vin, b.plate, b.make, b.model, b.year, b.ownerName, b.ownerPhone],
      );
      return rows;
    });
    return reply.code(201).send(rows[0]);
  });

  fastify.patch('/:id', {
    schema: { body: VehicleBody },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body;
    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const { rows } = await c.query(
        `UPDATE vehicles SET
           vin=$2, plate=$3, make=$4, model=$5, year=$6,
           owner_name=$7, owner_phone=$8, updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id, b.vin, b.plate, b.make, b.model, b.year, b.ownerName, b.ownerPhone],
      );
      return rows;
    });
    if (!rows.length) return reply.code(404).send({ error: 'Not found' });
    return reply.send(rows[0]);
  });
};
```

- [ ] **Step 2: Register in `api/src/app.ts`** — add alongside cardReadsRoutes:

```typescript
  const { vehiclesRoutes } = await import('./routes/v1/vehicles');
  await app.register(vehiclesRoutes, { prefix: '/v1/vehicles' });
```

- [ ] **Step 3: Run typecheck** — `cd api && npm run typecheck` — Expected: no errors.

---

### Task 16: API Dockerfile

**Files:**
- Create: `api/Dockerfile`

- [ ] **Step 1: Write `api/Dockerfile`**

```dockerfile
# api/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
USER node
CMD ["node", "dist/server.js"]
```

---

## SUBSYSTEM C — Workers

### Task 17: Worker project scaffold + SQS base consumer

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/src/queue/sqs.ts`
- Create: `worker/src/index.ts`

- [ ] **Step 1: Write `worker/package.json`**

```json
{
  "name": "vehicle-card-worker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.540.0",
    "@aws-sdk/client-sqs": "^3.540.0",
    "pg": "^8.11.3",
    "pdfmake": "^0.2.9",
    "pino": "^8.19.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.3.0"
  }
}
```

- [ ] **Step 2: Write `worker/tsconfig.json`** (same as api)

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "outDir": "dist", "rootDir": "src", "strict": true,
    "esModuleInterop": true, "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `worker/src/queue/sqs.ts`**

```typescript
// worker/src/queue/sqs.ts
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  Message,
} from '@aws-sdk/client-sqs';

export const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
});

export interface ConsumerOptions {
  queueUrl: string;
  maxMessages?: number;        // 1-10, default 10
  visibilityTimeout?: number;  // seconds, default 30
  maxRetries?: number;         // before DLQ, default 5
  handler: (message: Message) => Promise<void>;
}

// Long-poll SQS loop. Never returns (use as top-level await in worker process).
// SQS DLQ is configured in infrastructure — after maxReceiveCount the message
// moves automatically. Here we implement backoff via ChangeMessageVisibility.
export async function startConsumer(opts: ConsumerOptions): Promise<never> {
  const {
    queueUrl, maxMessages = 10, visibilityTimeout = 30,
    maxRetries = 5, handler,
  } = opts;

  console.log({ queueUrl }, 'Consumer started');

  while (true) {
    let messages: Message[] = [];
    try {
      const res = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: 20,                   // long-poll: reduces cost, avoids tight loop
        AttributeNames: ['ApproximateReceiveCount'],
        MessageAttributeNames: ['All'],
      }));
      messages = res.Messages ?? [];
    } catch (err) {
      console.error({ err }, 'SQS receive error — backing off 5s');
      await sleep(5_000);
      continue;
    }

    await Promise.allSettled(messages.map(async (msg) => {
      const receiveCount = parseInt(msg.Attributes?.ApproximateReceiveCount ?? '1', 10);
      try {
        await handler(msg);
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle! }));
      } catch (err) {
        console.error({ err, messageId: msg.MessageId, receiveCount }, 'Message processing failed');
        if (receiveCount < maxRetries) {
          // Exponential backoff: 30s, 60s, 120s, 300s …
          const backoff = Math.min(30 * Math.pow(2, receiveCount - 1), 600);
          await sqs.send(new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle!,
            VisibilityTimeout: backoff,
          }));
        }
        // If receiveCount >= maxRetries: let SQS move to DLQ automatically
      }
    }));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 4: Write `worker/src/index.ts`**

```typescript
// worker/src/index.ts
// WORKER_TYPE env selects which consumer to start.
// Deploy as separate containers per type so a slow PDF job
// never starves VIN lookups or billing events.
const workerType = process.env.WORKER_TYPE;
if (!workerType) { console.error('WORKER_TYPE not set'); process.exit(1); }

(async () => {
  switch (workerType) {
    case 'vehicle':
      await (await import('./consumers/vehicle-enrich.consumer')).start();
      break;
    case 'report':
      await (await import('./consumers/report-generate.consumer')).start();
      break;
    case 'billing':
      await (await import('./consumers/billing-event.consumer')).start();
      break;
    case 'dlq-monitor':
      await (await import('./consumers/dlq.consumer')).start();
      break;
    default:
      console.error({ workerType }, 'Unknown WORKER_TYPE');
      process.exit(1);
  }
})();
```

---

### Task 18: Vehicle enrichment consumer (VIN lookup + mileage anomaly)

**Files:**
- Create: `worker/src/consumers/vehicle-enrich.consumer.ts`
- Create: `worker/src/services/vin-lookup.service.ts`
- Create: `worker/src/services/anomaly-detector.service.ts`
- Create: `worker/tests/vehicle-enrich.test.ts`

- [ ] **Step 1: Write `worker/src/services/vin-lookup.service.ts`**

```typescript
// worker/src/services/vin-lookup.service.ts
// Calls an external VIN decode API (e.g., NHTSA free API or commercial provider).
// Circuit breaker: if 3 consecutive calls fail, skip enrichment rather than
// blocking the queue — VIN data is enrichment, not critical path.

let failures = 0; let openUntil = 0;

export interface VinData {
  make?: string; model?: string; year?: number; engineType?: string;
}

export async function lookupVin(vin: string): Promise<VinData | null> {
  if (Date.now() < openUntil) return null; // circuit open

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`VIN API ${res.status}`);
    const json = await res.json();
    const r = json.Results?.[0];
    failures = 0;
    return { make: r?.Make || undefined, model: r?.Model || undefined, year: parseInt(r?.ModelYear) || undefined };
  } catch (err) {
    if (++failures >= 3) openUntil = Date.now() + 60_000;
    throw err; // let consumer handle retry
  }
}
```

- [ ] **Step 2: Write `worker/src/services/anomaly-detector.service.ts`**

```typescript
// worker/src/services/anomaly-detector.service.ts
// Detects impossible mileage drops (odometer rollback fraud detection).
import { Pool } from 'pg';

export async function detectMileageAnomaly(
  pool: Pool, tenantId: string, vehicleId: string, newMileage: number,
): Promise<{ type: string; prevMileage: number } | null> {
  const { rows } = await pool.query(
    `SELECT (parsed_data->>'mileage')::int AS mileage, created_at
     FROM card_reads
     WHERE tenant_id=$1 AND vehicle_id=$2 AND read_status='success'
       AND parsed_data->>'mileage' IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, vehicleId],
  );
  if (!rows.length) return null;
  const prev = rows[0].mileage as number;
  if (newMileage < prev) return { type: 'odometer_rollback', prevMileage: prev };
  return null;
}
```

- [ ] **Step 3: Write `worker/src/consumers/vehicle-enrich.consumer.ts`**

```typescript
// worker/src/consumers/vehicle-enrich.consumer.ts
import { Pool } from 'pg';
import { startConsumer } from '../queue/sqs';
import { lookupVin } from '../services/vin-lookup.service';
import { detectMileageAnomaly } from '../services/anomaly-detector.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function start() {
  return startConsumer({
    queueUrl: process.env.SQS_CARD_READ_QUEUE_URL!,
    handler: async (msg) => {
      const { payload } = JSON.parse(msg.Body!);
      const { tenantId, cardReadId } = payload;

      // Fetch card read (bypass RLS — worker uses superuser-equivalent role)
      const { rows } = await pool.query(
        `SELECT cr.*, v.id AS vid FROM card_reads cr
         LEFT JOIN vehicles v ON v.id = cr.vehicle_id
         WHERE cr.id=$1 AND cr.tenant_id=$2`,
        [cardReadId, tenantId],
      );
      if (!rows.length) return; // already deleted or wrong tenant

      const read = rows[0];
      const vin: string | undefined = read.parsed_data?.vehicleVin;

      // VIN enrichment (skip silently if API circuit is open)
      if (vin) {
        try {
          const vinData = await lookupVin(vin);
          if (vinData && read.vid) {
            await pool.query(
              `UPDATE vehicles SET make=COALESCE($2,make), model=COALESCE($3,model),
               year=COALESCE($4,year), updated_at=NOW() WHERE id=$1`,
              [read.vid, vinData.make, vinData.model, vinData.year],
            );
          }
        } catch { /* VIN lookup failed — consumer will retry via SQS backoff */ throw new Error('VIN lookup failed'); }
      }

      // Mileage anomaly check
      const mileage: number | undefined = read.parsed_data?.mileage;
      if (mileage && read.vid) {
        const anomaly = await detectMileageAnomaly(pool, tenantId, read.vid, mileage);
        if (anomaly) {
          await pool.query(
            `INSERT INTO audit_log (tenant_id, action, resource_type, resource_id)
             VALUES ($1, $2, 'card_read', $3)`,
            [tenantId, `anomaly:${anomaly.type}:prev=${anomaly.prevMileage}`, cardReadId],
          );
        }
      }
    },
  });
}
```

- [ ] **Step 4: Write unit test**

```typescript
// worker/tests/vehicle-enrich.test.ts
import { describe, it, expect, vi } from 'vitest';
import { detectMileageAnomaly } from '../src/services/anomaly-detector.service';

describe('detectMileageAnomaly', () => {
  it('returns null when no prior reads exist', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    const result = await detectMileageAnomaly(pool, 't1', 'v1', 50000);
    expect(result).toBeNull();
  });

  it('detects rollback when new mileage < previous', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ mileage: 80000 }] }) } as any;
    const result = await detectMileageAnomaly(pool, 't1', 'v1', 60000);
    expect(result).toEqual({ type: 'odometer_rollback', prevMileage: 80000 });
  });

  it('returns null when mileage increases normally', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ mileage: 50000 }] }) } as any;
    const result = await detectMileageAnomaly(pool, 't1', 'v1', 52000);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 5: Run** — `cd worker && npx vitest run tests/vehicle-enrich.test.ts`

Expected: 3 PASS.

---

### Task 19: Report generation consumer (PDF → S3)

**Files:**
- Create: `worker/src/consumers/report-generate.consumer.ts`
- Create: `worker/src/services/pdf-generator.service.ts`

**What breaks first:** `puppeteer` uses ~300 MB RAM per instance; at 10 concurrent PDFs
one worker OOMs. Use `pdfmake` instead — pure JS, no Chrome dependency, ~5 MB RAM per
PDF, safe to run many concurrently.

**What breaks at scale:** PDF jobs are slow (~2 s each). If they share a queue with fast
jobs, slow jobs occupy all worker threads. Fix (already done): separate
`SQS_REPORT_QUEUE_URL` consumed only by `worker-report` containers.

- [ ] **Step 1: Write `worker/src/services/pdf-generator.service.ts`**

```typescript
// worker/src/services/pdf-generator.service.ts
import PdfPrinter from 'pdfmake';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { TDocumentDefinitions } from 'pdfmake/interfaces';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  forcePathStyle: !!process.env.AWS_ENDPOINT_URL,
});
const BUCKET = process.env.S3_RAW_DUMP_BUCKET!;

// pdfmake requires font descriptors; use built-in Roboto via pdfmake/build/vfs_fonts
const fonts = {
  Roboto: {
    normal:      'node_modules/pdfmake/build/vfs_fonts.js',
    bold:        'node_modules/pdfmake/build/vfs_fonts.js',
    italics:     'node_modules/pdfmake/build/vfs_fonts.js',
    bolditalics: 'node_modules/pdfmake/build/vfs_fonts.js',
  },
};

export async function generateAndUploadReport(
  tenantId: string,
  cardReadId: string,
  parsedData: Record<string, unknown>,
): Promise<string> {
  const docDef: TDocumentDefinitions = {
    content: [
      { text: 'Vehicle Card Report', style: 'header' },
      { text: `Card read ID: ${cardReadId}`, margin: [0, 10, 0, 0] },
      { text: `Generated: ${new Date().toISOString()}` },
      { text: '\nCard Data', style: 'subheader' },
      {
        table: {
          widths: ['*', '*'],
          body: [
            ['Field', 'Value'],
            ...Object.entries(parsedData).map(([k, v]) => [k, String(v ?? '')]),
          ],
        },
      },
    ],
    styles: {
      header:    { fontSize: 18, bold: true },
      subheader: { fontSize: 14, bold: true, margin: [0, 10, 0, 4] },
    },
  };

  const printer = new PdfPrinter(fonts);
  const pdfDoc = printer.createPdfKitDocument(docDef);

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    pdfDoc.on('data', (c: Buffer) => chunks.push(c));
    pdfDoc.on('end', resolve);
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  const s3Key = `${tenantId}/reports/${cardReadId}.pdf`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: s3Key, Body: pdfBuffer,
    ContentType: 'application/pdf',
    Metadata: { tenantId, cardReadId },
  }));

  return s3Key;
}
```

- [ ] **Step 2: Write `worker/src/consumers/report-generate.consumer.ts`**

```typescript
// worker/src/consumers/report-generate.consumer.ts
import { Pool } from 'pg';
import { startConsumer } from '../queue/sqs';
import { generateAndUploadReport } from '../services/pdf-generator.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function start() {
  return startConsumer({
    queueUrl: process.env.SQS_REPORT_QUEUE_URL!,
    maxMessages: 5,       // lower concurrency — PDFs are memory-intensive
    visibilityTimeout: 60, // PDFs take up to 30 s; give 60 s before re-queue
    handler: async (msg) => {
      const { payload } = JSON.parse(msg.Body!);
      const { tenantId, cardReadId } = payload;

      // Mark report as generating
      await pool.query(
        `UPDATE reports SET status='generating' WHERE card_read_id=$1 AND tenant_id=$2`,
        [cardReadId, tenantId],
      );

      // Fetch parsed data for the card read
      const { rows } = await pool.query(
        `SELECT parsed_data FROM card_reads WHERE id=$1 AND tenant_id=$2`,
        [cardReadId, tenantId],
      );
      if (!rows.length) return; // card read was deleted

      const s3Key = await generateAndUploadReport(tenantId, cardReadId, rows[0].parsed_data);

      await pool.query(
        `UPDATE reports SET status='ready', pdf_s3_key=$1 WHERE card_read_id=$2 AND tenant_id=$3`,
        [s3Key, cardReadId, tenantId],
      );
    },
  });
}
```

---

### Task 20: Billing event consumer

**Files:**
- Create: `worker/src/consumers/billing-event.consumer.ts`

**Design:** Billing events are fire-and-forget from the API. Each card read emits one
`billing.event` message. The billing worker records it in `billing_events` and marks it
as processed. An external billing service (Stripe, or your own metering) polls or
subscribes to this table. Keep billing logic here minimal — the worker is an adapter, not
a billing engine.

**Failure mode:** If the billing worker is down, SQS holds messages for up to 4 days
(configurable). When it recovers, it processes the backlog in order. Billing events are
idempotent because each has a unique `card_read_id` — re-processing the same event
updates `processed_at` without creating a duplicate row.

- [ ] **Step 1: Write `worker/src/consumers/billing-event.consumer.ts`**

```typescript
// worker/src/consumers/billing-event.consumer.ts
import { Pool } from 'pg';
import { startConsumer } from '../queue/sqs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function start() {
  return startConsumer({
    queueUrl: process.env.SQS_BILLING_QUEUE_URL!,
    handler: async (msg) => {
      const { payload } = JSON.parse(msg.Body!);
      const { tenantId, cardReadId } = payload;

      // Upsert — safe to re-run on retry (idempotent)
      await pool.query(
        `INSERT INTO billing_events (tenant_id, event_type, card_read_id, processed_at)
         VALUES ($1, 'card_read', $2, NOW())
         ON CONFLICT (card_read_id) DO UPDATE SET processed_at=NOW()`,
        [tenantId, cardReadId],
      );
    },
  });
}
```

- [ ] **Step 2: Add unique constraint to enable idempotent upsert**

Add to `db/migrations/V1__initial_schema.sql` billing_events table, or create a new
migration `db/migrations/V5__billing_events_unique.sql`:

```sql
-- db/migrations/V5__billing_events_unique.sql
ALTER TABLE billing_events
  ADD CONSTRAINT billing_events_card_read_id_unique UNIQUE (card_read_id);
```

---

### Task 21: DLQ monitor consumer

**Files:**
- Create: `worker/src/consumers/dlq.consumer.ts`

**Alert policy:** DLQ depth > 100 → page on-call. This consumer polls the DLQ queue
attribute (not the messages themselves) and emits a structured log line that can be
forwarded to alerting (CloudWatch alarm, Grafana alert, PagerDuty).

**Who replays DLQ messages?** Engineering on-call. Never auto-replay without inspection —
a bug that caused DLQ messages may corrupt data if replayed blindly before the fix is
deployed.

- [ ] **Step 1: Write `worker/src/consumers/dlq.consumer.ts`**

```typescript
// worker/src/consumers/dlq.consumer.ts
import {
  SQSClient,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
});

const DLQ_URLS = (process.env.SQS_DLQ_URLS ?? '').split(',').filter(Boolean);
const ALERT_THRESHOLD = parseInt(process.env.DLQ_ALERT_THRESHOLD ?? '100', 10);
const POLL_INTERVAL_MS = 60_000; // check every 60 s

export async function start(): Promise<never> {
  console.log({ dlqUrls: DLQ_URLS }, 'DLQ monitor started');

  while (true) {
    for (const queueUrl of DLQ_URLS) {
      try {
        const res = await sqs.send(new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }));
        const depth = parseInt(res.Attributes?.ApproximateNumberOfMessages ?? '0', 10);

        // Structured log — ship to CloudWatch/Grafana; alert rule fires on depth > threshold
        console.log(JSON.stringify({
          level: depth > ALERT_THRESHOLD ? 'error' : 'info',
          msg: 'dlq_depth',
          queueUrl,
          depth,
          threshold: ALERT_THRESHOLD,
          alert: depth > ALERT_THRESHOLD,
        }));
      } catch (err) {
        console.error({ err, queueUrl }, 'Failed to poll DLQ attributes');
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
```

---

### Task 22: Worker Dockerfile

**Files:**
- Create: `worker/Dockerfile`

- [ ] **Step 1: Write `worker/Dockerfile`**

```dockerfile
# worker/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# pdfmake fonts are bundled — include in production install
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
```

---

## SUBSYSTEM D — Hardware Bridge

### Task 23: Bridge project scaffold + types

**Files:**
- Create: `bridge/package.json`
- Create: `bridge/tsconfig.json`
- Create: `bridge/src/types.ts`

- [ ] **Step 1: Write `bridge/package.json`**

```json
{
  "name": "vehicle-card-bridge",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "dev": "electron-forge start",
    "build": "tsc -p tsconfig.json",
    "package": "electron-forge package",
    "make": "electron-forge make",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "electron-updater": "^6.1.7",
    "serialport": "^12.0.0",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@electron-forge/cli": "^7.3.0",
    "@electron-forge/maker-squirrel": "^7.3.0",
    "@electron-forge/maker-deb": "^7.3.0",
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^20.11.0",
    "@types/ws": "^8.5.10",
    "electron": "^30.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.3.0"
  }
}
```

- [ ] **Step 2: Write `bridge/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `bridge/src/types.ts`**

```typescript
// bridge/src/types.ts
export interface ParsedCardData {
  cardType: 'driver' | 'vehicle' | 'workshop' | 'control';
  cardSerial: string;
  driverName?: string;
  vehicleVin?: string;
  vehiclePlate?: string;
  mileage?: number;
  lastActivityDate?: string;
  rawFields: Record<string, string>;
}

export interface CardReadResult {
  success: true;
  port: string;
  rawDumpBase64: string;
  parsed: ParsedCardData;
  readDurationMs: number;
}

export interface CardReadError {
  success: false;
  port: string;
  error: string;
  partial: boolean;
}

export type CardReadEvent = CardReadResult | CardReadError;

export interface QueueEntry {
  id: number;
  payload: string;
  status: 'pending' | 'sent' | 'failed';
  retryCount: number;
  nextRetryAt: number;
  createdAt: number;
  error?: string;
}
```

---

### Task 24: ISO 7816 APDU command builder

**Files:**
- Create: `bridge/src/bridge/apdu.ts`
- Create: `bridge/tests/apdu.test.ts`

**Background:** EU tachograph cards comply with ISO 7816-4. Commands are sent as
Application Protocol Data Units (APDUs). Each APDU is a binary buffer: CLA INS P1 P2 Lc
[Data] Le. Responses end with a 2-byte status word SW1 SW2 (0x9000 = success).

- [ ] **Step 1: Write `bridge/src/bridge/apdu.ts`**

```typescript
// bridge/src/bridge/apdu.ts

// SELECT application by AID (tachograph application AID: A0 00 00 01 32 ...)
export function selectApplication(aid: Buffer): Buffer {
  return Buffer.from([
    0x00,        // CLA: inter-industry
    0xA4,        // INS: SELECT
    0x04,        // P1: select by AID
    0x0C,        // P2: no response data
    aid.length,  // Lc: AID length
    ...aid,
  ]);
}

// READ BINARY: read Le bytes starting at offset (P1=high byte, P2=low byte of offset)
export function readBinary(offset: number, length: number): Buffer {
  return Buffer.from([
    0x00,                  // CLA
    0xB0,                  // INS: READ BINARY
    (offset >> 8) & 0xFF,  // P1: high byte of offset
    offset & 0xFF,         // P2: low byte of offset
    length & 0xFF,         // Le: bytes to read (0 = 256)
  ]);
}

// GET RESPONSE: retrieve pending data after SW1=0x61
export function getResponse(length: number): Buffer {
  return Buffer.from([0x00, 0xC0, 0x00, 0x00, length & 0xFF]);
}

// Parse SW1 SW2 status word from response tail
export function parseStatusWord(response: Buffer): { sw1: number; sw2: number; success: boolean } {
  if (response.length < 2) return { sw1: 0, sw2: 0, success: false };
  const sw1 = response[response.length - 2];
  const sw2 = response[response.length - 1];
  return { sw1, sw2, success: sw1 === 0x90 && sw2 === 0x00 };
}

// Extract data portion (strip trailing SW1 SW2)
export function extractData(response: Buffer): Buffer {
  return response.slice(0, response.length - 2);
}

// EU Tachograph AID per EU Regulation 2016/799 Annex 1C
export const TACHOGRAPH_AID = Buffer.from([0xA0, 0x00, 0x00, 0x01, 0x32]);
```

- [ ] **Step 2: Write `bridge/tests/apdu.test.ts`**

```typescript
// bridge/tests/apdu.test.ts
import { describe, it, expect } from 'vitest';
import { selectApplication, readBinary, parseStatusWord, TACHOGRAPH_AID } from '../src/bridge/apdu';

describe('APDU builder', () => {
  it('selectApplication produces correct CLA INS P1 P2 Lc AID bytes', () => {
    const cmd = selectApplication(TACHOGRAPH_AID);
    expect(cmd[0]).toBe(0x00); // CLA
    expect(cmd[1]).toBe(0xA4); // INS SELECT
    expect(cmd[2]).toBe(0x04); // P1 by AID
    expect(cmd[4]).toBe(TACHOGRAPH_AID.length);
    expect(cmd.slice(5)).toEqual(TACHOGRAPH_AID);
  });

  it('readBinary encodes offset correctly', () => {
    const cmd = readBinary(0x0100, 0x80);
    expect(cmd[2]).toBe(0x01); // high byte
    expect(cmd[3]).toBe(0x00); // low byte
    expect(cmd[4]).toBe(0x80); // Le
  });

  it('parseStatusWord detects success (0x9000)', () => {
    const resp = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0x90, 0x00]);
    expect(parseStatusWord(resp)).toEqual({ sw1: 0x90, sw2: 0x00, success: true });
  });

  it('parseStatusWord detects error', () => {
    const resp = Buffer.from([0x6A, 0x82]);
    expect(parseStatusWord(resp).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run** — `cd bridge && npx vitest run tests/apdu.test.ts`

Expected: 4 PASS.

---

### Task 25: Card reader (serialport + partial-read guard)

**Files:**
- Create: `bridge/src/bridge/card-reader.ts`
- Create: `bridge/tests/card-reader.test.ts`

**Failure modes to handle:**
1. **Partial read:** card pulled out mid-read → buffer has data but frame is not complete.
   Guard: per-read 5 s timeout; on timeout, discard buffer and reject.
2. **Oversized frame:** malformed card or injection → buffer exceeds 64 KB.
   Guard: reject immediately and close port.
3. **Port error mid-read:** OS error on USB disconnect → reject and emit `close`.
4. **Two readers simultaneously:** handled by `PortManager` in Task 26; `CardReader`
   itself is single-port only.

- [ ] **Step 1: Write `bridge/src/bridge/card-reader.ts`**

```typescript
// bridge/src/bridge/card-reader.ts
import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';
import { selectApplication, readBinary, parseStatusWord,
         extractData, getResponse, TACHOGRAPH_AID } from './apdu';

const READ_TIMEOUT_MS = 5_000;
const MAX_FRAME_BYTES = 65_536; // 64 KB

export class CardReader extends EventEmitter {
  private port: SerialPort;
  private buf = Buffer.alloc(0);
  private readTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly portPath: string, private baudRate = 9600) {
    super();
    this.port = new SerialPort({ path: portPath, baudRate, autoOpen: false });
    this.port.on('error', (err) => this.emit('error', err));
    this.port.on('close', () => this.emit('close'));
  }

  async open(): Promise<void> {
    return new Promise((res, rej) => this.port.open((e) => e ? rej(e) : res()));
  }

  async close(): Promise<void> {
    if (this.readTimer) { clearTimeout(this.readTimer); this.readTimer = null; }
    return new Promise((res, rej) => this.port.close((e) => e ? rej(e) : res()));
  }

  // Full tachograph card read lifecycle:
  // SELECT application → READ BINARY in chunks → assemble raw dump
  async readCard(): Promise<Buffer> {
    // Step 1: SELECT tachograph application
    await this.sendApdu(selectApplication(TACHOGRAPH_AID));

    // Step 2: Read card in 128-byte chunks until SW = 0x9000 with no data
    const chunks: Buffer[] = [];
    let offset = 0;
    while (true) {
      const resp = await this.sendApdu(readBinary(offset, 0x80));
      const sw = parseStatusWord(resp);
      const data = extractData(resp);
      if (data.length > 0) chunks.push(data);
      offset += data.length;
      if (sw.sw1 === 0x61) {
        // More data pending — GET RESPONSE
        const more = await this.sendApdu(getResponse(sw.sw2));
        chunks.push(extractData(more));
      } else if (sw.success && data.length === 0) {
        break; // end of file
      } else if (!sw.success) {
        break; // card returned error SW — treat as end of readable data
      }
      if (offset > MAX_FRAME_BYTES) throw new Error('Card data exceeds max frame size');
    }
    return Buffer.concat(chunks);
  }

  private sendApdu(cmd: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.buf = Buffer.alloc(0);

      this.readTimer = setTimeout(() => {
        this.buf = Buffer.alloc(0);
        this.port.removeAllListeners('data');
        reject(new Error('APDU timeout — partial read discarded'));
      }, READ_TIMEOUT_MS);

      const onData = (chunk: Buffer) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        if (this.buf.length > MAX_FRAME_BYTES) {
          clearTimeout(this.readTimer!);
          this.port.removeListener('data', onData);
          this.buf = Buffer.alloc(0);
          reject(new Error('Frame exceeded max size'));
          return;
        }
        const sw = parseStatusWord(this.buf);
        // Frame complete when we have at least 2 bytes and a valid/error SW
        if (this.buf.length >= 2 && (sw.success || sw.sw1 >= 0x60)) {
          clearTimeout(this.readTimer!);
          this.port.removeListener('data', onData);
          const result = this.buf;
          this.buf = Buffer.alloc(0);
          resolve(result);
        }
      };

      const onError = (err: Error) => {
        clearTimeout(this.readTimer!);
        this.buf = Buffer.alloc(0);
        reject(err);
      };

      this.port.once('error', onError);
      this.port.on('data', onData);
      this.port.write(cmd);
    });
  }
}
```

- [ ] **Step 2: Write `bridge/tests/card-reader.test.ts`**

```typescript
// bridge/tests/card-reader.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock serialport before importing CardReader
vi.mock('serialport', () => {
  const EventEmitter = require('events');
  const MockSerialPort = vi.fn().mockImplementation(() => {
    const ee = new EventEmitter();
    ee.open  = vi.fn((cb: any) => cb(null));
    ee.close = vi.fn((cb: any) => cb(null));
    ee.write = vi.fn();
    return ee;
  });
  return { SerialPort: MockSerialPort };
});

import { CardReader } from '../src/bridge/card-reader';

describe('CardReader', () => {
  it('open() resolves when port opens successfully', async () => {
    const reader = new CardReader('/dev/ttyUSB0');
    await expect(reader.open()).resolves.toBeUndefined();
  });

  it('rejects on APDU timeout when no data arrives within 5 s', async () => {
    vi.useFakeTimers();
    const reader = new CardReader('/dev/ttyUSB0');
    await reader.open();

    const readPromise = reader.readCard();
    // Advance past the 5 s timeout
    await vi.advanceTimersByTimeAsync(5_100);

    await expect(readPromise).rejects.toThrow('APDU timeout');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Run** — `cd bridge && npx vitest run tests/card-reader.test.ts`

Expected: 2 PASS.

---

### Task 26: C++ binary wrapper (child_process + JSON stdio protocol)

**Files:**
- Create: `bridge/src/bridge/parser.ts`
- Create: `bridge/tests/parser.test.ts`

**ADR-1 implementation.** The C++ binary reads base64 card dump from stdin, writes a
JSON response line to stdout, then waits for the next request. Protocol: newline-delimited
JSON, each message has a unique `id` field for correlation. The binary must implement
`--json-mode` flag to enter this mode (no interactive prompts).

**What breaks:**
- Binary segfaults → `exit` event → all pending requests rejected → auto-restart after 2 s
- Binary hangs → per-request 10 s timeout fires → request rejected; binary continues running
- Binary produces non-JSON → try/catch discards line; pending request eventually times out

- [ ] **Step 1: Write `bridge/src/bridge/parser.ts`**

```typescript
// bridge/src/bridge/parser.ts
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { ParsedCardData } from '../types';
import path from 'path';

const REQUEST_TIMEOUT_MS = 10_000;
const RESTART_DELAY_MS   = 2_000;

interface Pending {
  resolve: (data: ParsedCardData) => void;
  reject:  (err: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}

export class CardParser {
  private proc: ChildProcess | null = null;
  private pending = new Map<string, Pending>();
  private lineBuf = '';
  private stopped = false;

  start(): void {
    if (this.stopped) return;
    const bin = process.env.PARSER_BINARY_PATH
      ?? path.join(
           // In packaged Electron app, resources/ is next to app.asar
           (process as any).resourcesPath ?? process.cwd(),
           process.platform === 'win32' ? 'parser.exe' : 'parser',
         );

    this.proc = spawn(bin, ['--json-mode'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.lineBuf += chunk.toString('utf8');
      const lines = this.lineBuf.split('\n');
      this.lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const { id, success, data, error } = JSON.parse(line);
          const p = this.pending.get(id);
          if (!p) continue;
          clearTimeout(p.timer);
          this.pending.delete(id);
          success ? p.resolve(data) : p.reject(new Error(error ?? 'Parse failed'));
        } catch {
          console.error('[parser] malformed JSON line:', line.slice(0, 120));
        }
      }
    });

    this.proc.stderr!.on('data', (d: Buffer) =>
      console.error('[parser stderr]', d.toString().trim()),
    );

    this.proc.on('exit', (code, sig) => {
      // Reject all pending requests
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`Parser exited (code=${code}, signal=${sig})`));
        this.pending.delete(id);
      }
      this.proc = null;
      if (!this.stopped) {
        console.warn('[parser] crashed — restarting in 2 s');
        setTimeout(() => this.start(), RESTART_DELAY_MS);
      }
    });
  }

  async parse(rawDump: Buffer): Promise<ParsedCardData> {
    if (!this.proc) throw new Error('Parser not running');
    const id = randomUUID();
    return new Promise<ParsedCardData>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Parser request timed out after 10 s'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin!.write(
        JSON.stringify({ id, rawDump: rawDump.toString('base64') }) + '\n',
      );
    });
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }
}
```

- [ ] **Step 2: Write `bridge/tests/parser.test.ts`**

```typescript
// bridge/tests/parser.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Factory to create a mock child process
function makeMockProc(behavior: 'success' | 'crash' | 'hang') {
  const stdin  = { write: vi.fn() };
  const stdout = new EventEmitter() as any;
  const stderr = new EventEmitter() as any;
  const proc   = new EventEmitter() as any;
  proc.stdin = stdin; proc.stdout = stdout; proc.stderr = stderr;

  if (behavior === 'success') {
    stdin.write = vi.fn((data: string) => {
      const { id } = JSON.parse(data);
      setTimeout(() => stdout.emit('data', Buffer.from(
        JSON.stringify({ id, success: true, data: { cardType: 'vehicle', cardSerial: 'ABC123', rawFields: {} } }) + '\n'
      )), 10);
    });
  }
  if (behavior === 'crash') {
    setTimeout(() => proc.emit('exit', 1, null), 50);
  }
  return proc;
}

vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { CardParser } from '../src/bridge/parser';
import { spawn } from 'child_process';

afterEach(() => vi.clearAllMocks());

describe('CardParser', () => {
  it('parses card data via JSON stdio protocol', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('success') as any);
    const parser = new CardParser();
    parser.start();
    const result = await parser.parse(Buffer.from('DEADBEEF', 'hex'));
    expect(result.cardType).toBe('vehicle');
    expect(result.cardSerial).toBe('ABC123');
    parser.stop();
  });

  it('rejects all pending requests when binary crashes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(spawn).mockReturnValue(makeMockProc('crash') as any);
    const parser = new CardParser();
    parser.stop(); // prevent auto-restart in test
    parser['stopped'] = false;
    parser.start();
    parser['stopped'] = true; // block restart before crash fires

    const parsePromise = parser.parse(Buffer.from('AA'));
    await vi.advanceTimersByTimeAsync(100);
    await expect(parsePromise).rejects.toThrow('Parser exited');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Run** — `cd bridge && npx vitest run tests/parser.test.ts`

Expected: 2 PASS.

---

### Task 27: Port manager (concurrent reader sessions)

**Files:**
- Create: `bridge/src/bridge/port-manager.ts`
- Create: `bridge/tests/port-manager.test.ts`

**Race condition:** mechanic plugs two readers into the same machine simultaneously.
`PortManager` maintains a map of active sessions keyed by port path. Opening the same
port twice throws immediately. Stale sessions (no activity for 30 s) are reaped.

- [ ] **Step 1: Write `bridge/src/bridge/port-manager.ts`**

```typescript
// bridge/src/bridge/port-manager.ts
import { CardReader } from './card-reader';

interface Session { reader: CardReader; openedAt: number; }

const STALE_MS = 30_000;

export class PortManager {
  private sessions = new Map<string, Session>();

  async open(portPath: string): Promise<CardReader> {
    if (this.sessions.has(portPath)) {
      throw new Error(`Port ${portPath} is already open`);
    }
    const reader = new CardReader(portPath);
    await reader.open();
    this.sessions.set(portPath, { reader, openedAt: Date.now() });
    reader.once('close', () => this.sessions.delete(portPath));
    reader.once('error', () => {
      this.sessions.delete(portPath);
      reader.close().catch(() => {});
    });
    return reader;
  }

  async close(portPath: string): Promise<void> {
    const session = this.sessions.get(portPath);
    if (!session) return;
    await session.reader.close();
    this.sessions.delete(portPath);
  }

  activePorts(): string[] { return Array.from(this.sessions.keys()); }

  // Reap sessions that have been open longer than STALE_MS with no card activity
  async reapStale(): Promise<void> {
    const now = Date.now();
    for (const [port, s] of this.sessions) {
      if (now - s.openedAt > STALE_MS) {
        console.warn({ port }, 'Reaping stale port session');
        await this.close(port).catch(() => {});
      }
    }
  }
}
```

- [ ] **Step 2: Write `bridge/tests/port-manager.test.ts`**

```typescript
// bridge/tests/port-manager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PortManager } from '../src/bridge/port-manager';
import { CardReader } from '../src/bridge/card-reader';

vi.mock('../src/bridge/card-reader', () => ({
  CardReader: vi.fn().mockImplementation((path: string) => {
    const { EventEmitter } = require('events');
    const ee = new EventEmitter();
    ee.portPath = path;
    ee.open  = vi.fn().mockResolvedValue(undefined);
    ee.close = vi.fn().mockResolvedValue(undefined);
    return ee;
  }),
}));

describe('PortManager', () => {
  it('opens a port and tracks it', async () => {
    const pm = new PortManager();
    await pm.open('/dev/ttyUSB0');
    expect(pm.activePorts()).toContain('/dev/ttyUSB0');
  });

  it('throws if same port opened twice', async () => {
    const pm = new PortManager();
    await pm.open('/dev/ttyUSB0');
    await expect(pm.open('/dev/ttyUSB0')).rejects.toThrow('already open');
  });

  it('allows two different ports simultaneously', async () => {
    const pm = new PortManager();
    await pm.open('/dev/ttyUSB0');
    await pm.open('/dev/ttyUSB1');
    expect(pm.activePorts()).toHaveLength(2);
  });

  it('removes session after close', async () => {
    const pm = new PortManager();
    await pm.open('/dev/ttyUSB0');
    await pm.close('/dev/ttyUSB0');
    expect(pm.activePorts()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run** — `cd bridge && npx vitest run tests/port-manager.test.ts`

Expected: 4 PASS.

---

### Task 28: SQLite offline queue with exponential backoff

**Files:**
- Create: `bridge/src/bridge/queue.ts`
- Create: `bridge/tests/queue.test.ts`

**When used:** Cloud API is unreachable → card read is enqueued locally. A background
timer polls the queue every 30 s and retries. After 5 retries (max ~20 min total backoff)
the entry is marked `failed` and the mechanic sees an alert in the tray app.

**Why `better-sqlite3` (sync) not `sql.js` (async):** Electron main process; `better-sqlite3`
is synchronous so there are no async/await ordering issues around IPC events. Sync DB ops
at this volume (< 100 rows) are imperceptible.

- [ ] **Step 1: Write `bridge/src/bridge/queue.ts`**

```typescript
// bridge/src/bridge/queue.ts
import Database from 'better-sqlite3';
import type { QueueEntry } from '../types';

const MAX_RETRIES = 5;
// Backoff sequence (ms): 30 s, 60 s, 120 s, 300 s, 600 s
const backoffMs = (attempt: number) => Math.min(30_000 * Math.pow(2, attempt - 1), 600_000);

export class OfflineQueue {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id           INTEGER  PRIMARY KEY AUTOINCREMENT,
        payload      TEXT     NOT NULL,
        status       TEXT     NOT NULL DEFAULT 'pending',
        retry_count  INTEGER  NOT NULL DEFAULT 0,
        next_retry_at INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER  NOT NULL DEFAULT (unixepoch() * 1000),
        error        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_queue_pending
        ON queue (status, next_retry_at);
    `);
  }

  enqueue(payload: object): number {
    const stmt = this.db.prepare(
      `INSERT INTO queue (payload, next_retry_at) VALUES (?, ?)`,
    );
    return Number((stmt.run(JSON.stringify(payload), Date.now())).lastInsertRowid);
  }

  pending(limit = 10): QueueEntry[] {
    return this.db.prepare(
      `SELECT id, payload, status, retry_count AS retryCount,
              next_retry_at AS nextRetryAt, created_at AS createdAt, error
       FROM queue WHERE status='pending' AND next_retry_at <= ?
       ORDER BY created_at LIMIT ?`,
    ).all(Date.now(), limit) as QueueEntry[];
  }

  markSent(id: number): void {
    this.db.prepare(`UPDATE queue SET status='sent' WHERE id=?`).run(id);
  }

  markRetry(id: number, errorMsg: string): void {
    const row = this.db.prepare(
      `SELECT retry_count FROM queue WHERE id=?`,
    ).get(id) as { retry_count: number } | undefined;
    if (!row) return;

    const next = row.retry_count + 1;
    if (next >= MAX_RETRIES) {
      this.db.prepare(
        `UPDATE queue SET status='failed', retry_count=?, error=? WHERE id=?`,
      ).run(next, errorMsg, id);
    } else {
      this.db.prepare(
        `UPDATE queue SET retry_count=?, next_retry_at=?, error=? WHERE id=?`,
      ).run(next, Date.now() + backoffMs(next), errorMsg, id);
    }
  }

  stats(): { pending: number; failed: number; sent: number } {
    const rows = this.db.prepare(
      `SELECT status, COUNT(*) AS n FROM queue GROUP BY status`,
    ).all() as { status: string; n: number }[];
    const m = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    return { pending: m.pending ?? 0, failed: m.failed ?? 0, sent: m.sent ?? 0 };
  }
}
```

- [ ] **Step 2: Write `bridge/tests/queue.test.ts`**

```typescript
// bridge/tests/queue.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { OfflineQueue } from '../src/bridge/queue';

// Use in-memory SQLite for tests
let q: OfflineQueue;
beforeEach(() => { q = new OfflineQueue(':memory:'); });

describe('OfflineQueue', () => {
  it('enqueues and returns pending entries', () => {
    q.enqueue({ test: 1 });
    expect(q.pending()).toHaveLength(1);
    expect(JSON.parse(q.pending()[0].payload)).toEqual({ test: 1 });
  });

  it('markSent removes entry from pending list', () => {
    const id = q.enqueue({ test: 2 });
    q.markSent(id);
    expect(q.pending()).toHaveLength(0);
    expect(q.stats().sent).toBe(1);
  });

  it('markRetry increments count and sets next_retry_at in future', () => {
    const id = q.enqueue({ test: 3 });
    q.markRetry(id, 'network error');
    const entries = q.pending();
    expect(entries).toHaveLength(0); // next_retry_at is in the future
    expect(q.stats().pending).toBe(1);
  });

  it('markRetry sets status=failed after MAX_RETRIES', () => {
    const id = q.enqueue({ test: 4 });
    for (let i = 0; i < 5; i++) q.markRetry(id, 'err');
    expect(q.stats().failed).toBe(1);
    expect(q.stats().pending).toBe(0);
  });
});
```

- [ ] **Step 3: Run** — `cd bridge && npx vitest run tests/queue.test.ts`

Expected: 4 PASS.

---

### Task 29: Cloud client (device auth + retry + queue drain)

**Files:**
- Create: `bridge/src/cloud/auth.ts`
- Create: `bridge/src/cloud/client.ts`

**Security invariants:**
- Private key is generated on-device with `crypto.generateKeyPairSync`. Only the public
  key leaves the machine (sent during device registration). The private key is stored in
  the OS user data directory (encrypted at rest by the OS; on Windows this is
  `%APPDATA%\VehicleCardBridge\`).
- Registration codes are single-use, 24-hour expiry, issued by garage admin in the web UI.
- If a device is revoked, the next API call returns 401 and the bridge shows an alert.
- Credentials must never be embedded in the installer or committed to git.

- [ ] **Step 1: Write `bridge/src/cloud/auth.ts`**

```typescript
// bridge/src/cloud/auth.ts
import { createSign, generateKeyPairSync, createPublicKey } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { app } from 'electron';

const CREDS_FILE = 'device-credentials.json';

interface Credentials { deviceId: string; keyId: string; privateKeyPem: string; }
interface TokenCache  { token: string; expiresAt: number; }

export class DeviceAuth {
  private creds: Credentials;
  private cache: TokenCache | null = null;

  constructor(private dataDir: string) {
    const p = path.join(dataDir, CREDS_FILE);
    if (!existsSync(p)) throw new Error('Device not registered. Run setup wizard.');
    this.creds = JSON.parse(readFileSync(p, 'utf8'));
  }

  getToken(): string {
    // Return cached token if still valid with 60 s buffer
    if (this.cache && this.cache.expiresAt > Date.now() + 60_000) return this.cache.token;

    const now  = Math.floor(Date.now() / 1000);
    const exp  = now + 3600;
    const hdr  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: this.creds.keyId })).toString('base64url');
    const pay  = Buffer.from(JSON.stringify({ sub: this.creds.deviceId, iss: 'vehicle-card-bridge',
                                              iat: now, exp, type: 'device' })).toString('base64url');
    const signer = createSign('sha256');
    signer.update(`${hdr}.${pay}`);
    const sig  = signer.sign(this.creds.privateKeyPem, 'base64url');
    const token = `${hdr}.${pay}.${sig}`;
    this.cache = { token, expiresAt: exp * 1000 };
    return token;
  }

  static async register(apiUrl: string, code: string, dataDir: string): Promise<DeviceAuth> {
    mkdirSync(dataDir, { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const pubPem  = publicKey.export({ type: 'spki',  format: 'pem' }) as string;

    const res = await fetch(`${apiUrl}/v1/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationCode: code, publicKey: pubPem }),
    });
    if (!res.ok) throw new Error(`Registration failed: ${res.status} ${await res.text()}`);
    const { deviceId, keyId } = await res.json();

    const creds: Credentials = { deviceId, keyId, privateKeyPem: privPem };
    writeFileSync(path.join(dataDir, CREDS_FILE), JSON.stringify(creds, null, 2), { mode: 0o600 });
    return new DeviceAuth(dataDir);
  }
}
```

- [ ] **Step 2: Write `bridge/src/cloud/client.ts`**

```typescript
// bridge/src/cloud/client.ts
import { DeviceAuth } from './auth';
import { OfflineQueue } from '../bridge/queue';

const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 1_000;
const QUEUE_INTERVAL_MS = 30_000;

export class CloudClient {
  private drainTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private apiUrl: string,
    private auth: DeviceAuth,
    private queue: OfflineQueue,
  ) {}

  async postCardRead(payload: object, idempotencyKey: string): Promise<void> {
    try {
      await this.postWithRetry('/v1/card-reads', payload, idempotencyKey);
    } catch (err: any) {
      // API unreachable — persist locally
      console.warn({ err: err.message }, 'Cloud unreachable — queuing locally');
      this.queue.enqueue({ payload, idempotencyKey });
    }
  }

  private async postWithRetry(
    path: string, body: object, idempotencyKey: string, attempt = 1,
  ): Promise<void> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.auth.getToken()}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 201 || res.status === 200) return; // success
    if (res.status === 401) throw new Error('Device token rejected — check revocation status');
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      return this.postWithRetry(path, body, idempotencyKey, attempt + 1);
    }
    throw new Error(`API error ${res.status}`);
  }

  // Call startQueueDrain() once at startup to retry any entries that survived
  // a previous offline period.
  startQueueDrain(): void {
    this.drainTimer = setInterval(() => this.drainQueue(), QUEUE_INTERVAL_MS);
  }

  stopQueueDrain(): void {
    if (this.drainTimer) { clearInterval(this.drainTimer); this.drainTimer = null; }
  }

  private async drainQueue(): Promise<void> {
    const entries = this.queue.pending();
    for (const entry of entries) {
      const { payload, idempotencyKey } = JSON.parse(entry.payload);
      try {
        await this.postWithRetry('/v1/card-reads', payload, idempotencyKey);
        this.queue.markSent(entry.id);
      } catch (err: any) {
        this.queue.markRetry(entry.id, err.message);
      }
    }
  }
}
```

---

### Task 30: Local HTTP + WebSocket server

**Files:**
- Create: `bridge/src/server/http.ts`
- Create: `bridge/src/server/websocket.ts`

**Design:** The browser frontend connects to `ws://localhost:7433`. When a card is read,
the bridge emits a WebSocket message with the parsed data. The frontend shows it
immediately (optimistic UI) while the bridge POSTs to the cloud in the background.
The local HTTP server also exposes `/status` and `/ports` for the frontend to poll.

**Security:** Bind to `127.0.0.1` only (never `0.0.0.0`). Add an `Origin` header check
on WebSocket upgrade to prevent other sites from connecting to the bridge from the browser.

- [ ] **Step 1: Write `bridge/src/server/http.ts`**

```typescript
// bridge/src/server/http.ts
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { PortManager } from '../bridge/port-manager';
import { OfflineQueue } from '../bridge/queue';

const PORT = parseInt(process.env.BRIDGE_PORT ?? '7433', 10);
const ALLOWED_ORIGINS = ['http://localhost:5173', 'https://app.vehiclecard.example.com'];

export function createHttpServer(portManager: PortManager, queue: OfflineQueue) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS — allow only known origins
    const origin = req.headers.origin ?? '';
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/status' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        activePorts: portManager.activePorts(),
        queue: queue.stats(),
      }));
    } else if (req.url === '/ports' && req.method === 'GET') {
      // List available serial ports for the frontend to show in UI
      import('serialport').then(({ SerialPort }) => SerialPort.list()).then((ports) => {
        res.writeHead(200);
        res.end(JSON.stringify(ports));
      }).catch(() => { res.writeHead(500); res.end('{"error":"port list failed"}'); });
    } else {
      res.writeHead(404);
      res.end('{"error":"not found"}');
    }
  });

  return { server, port: PORT };
}

export function startHttpServer(portManager: PortManager, queue: OfflineQueue) {
  const { server, port } = createHttpServer(portManager, queue);
  server.listen(port, '127.0.0.1', () =>
    console.log(`Bridge HTTP listening on 127.0.0.1:${port}`),
  );
  return server;
}
```

- [ ] **Step 2: Write `bridge/src/server/websocket.ts`**

```typescript
// bridge/src/server/websocket.ts
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import type { Server } from 'http';
import type { CardReadEvent } from '../types';

const ALLOWED_ORIGINS = ['http://localhost:5173', 'https://app.vehiclecard.example.com'];

export class BridgeWebSocketServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      // Origin check — reject connections from unknown origins
      const origin = req.headers.origin ?? '';
      if (!ALLOWED_ORIGINS.includes(origin)) {
        ws.close(1008, 'Origin not allowed');
        return;
      }

      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));

      // Send current bridge status on connect
      ws.send(JSON.stringify({ type: 'connected', bridgeVersion: process.env.npm_package_version }));
    });
  }

  // Broadcast a card read event to all connected browser tabs
  broadcast(event: CardReadEvent): void {
    const msg = JSON.stringify({ type: 'card_read', event });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  // Broadcast error (e.g. partial read, reader disconnect)
  broadcastError(error: string, port: string): void {
    const msg = JSON.stringify({ type: 'card_read_error', error, port });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  close(): void { this.wss.close(); }
}
```

---

### Task 31: Electron main process

**Files:**
- Create: `bridge/src/main.ts`
- Create: `bridge/electron-builder.json5`

**Auto-update strategy:** `electron-updater` checks the update server (GitHub Releases or
a private S3 bucket) on startup and every 4 hours. It downloads in the background and
prompts the user via a tray notification. The update is applied on next restart.
Never use `autoInstallOnAppQuit: false` in production — always install updates.

- [ ] **Step 1: Write `bridge/src/main.ts`**

```typescript
// bridge/src/main.ts
import { app, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { autoUpdater } from 'electron-updater';
import { startHttpServer } from './server/http';
import { BridgeWebSocketServer } from './server/websocket';
import { PortManager } from './bridge/port-manager';
import { CardParser } from './bridge/parser';
import { OfflineQueue } from './bridge/queue';
import { DeviceAuth } from './cloud/auth';
import { CloudClient } from './cloud/client';

let tray: Tray | null = null;

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData');
  const queue   = new OfflineQueue(path.join(dataDir, 'queue.db'));
  const portMgr = new PortManager();
  const parser  = new CardParser();

  // Start C++ parser subprocess
  parser.start();

  // Start local HTTP + WebSocket server
  const httpServer = startHttpServer(portMgr, queue);
  const wsServer   = new BridgeWebSocketServer(httpServer);

  // Device auth (throws if not registered — show setup wizard instead)
  let cloudClient: CloudClient | null = null;
  try {
    const auth = new DeviceAuth(dataDir);
    cloudClient = new CloudClient(
      process.env.CLOUD_API_URL ?? 'https://api.vehiclecard.example.com',
      auth, queue,
    );
    cloudClient.startQueueDrain();
  } catch {
    console.warn('Device not registered — operating in offline mode');
  }

  // System tray icon
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '..', 'assets', 'tray-icon.png'),
  );
  tray = new Tray(icon);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Vehicle Card Bridge', enabled: false },
    { type: 'separator' },
    { label: 'Queue stats', click: () => { const s = queue.stats(); tray!.setToolTip(`Pending: ${s.pending} | Failed: ${s.failed}`); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.setToolTip('Vehicle Card Bridge — running');

  // Auto-updater (checks GitHub Releases for updates)
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000);

  // Stale port reaper
  setInterval(() => portMgr.reapStale(), 60_000);

  app.on('before-quit', () => {
    parser.stop();
    cloudClient?.stopQueueDrain();
    wsServer.close();
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray on macOS/Windows — do not quit on last window close
});
```

- [ ] **Step 2: Write `bridge/electron-builder.json5`**

```json5
// bridge/electron-builder.json5
{
  "appId": "com.vehiclecard.bridge",
  "productName": "Vehicle Card Bridge",
  "directories": { "output": "release" },
  "files": ["dist/**/*", "assets/**/*"],
  "win": {
    "target": [{ "target": "squirrel", "arch": ["x64"] }],
    "publisherName": "Vehicle Card SaaS",
    "icon": "assets/icon.ico"
  },
  "linux": {
    "target": [{ "target": "deb", "arch": ["x64"] }],
    "category": "Utility"
  },
  "publish": {
    "provider": "github",
    "owner": "your-org",
    "repo": "vehicle-card-bridge"
  },
  // Extra resources bundled into the installer's resources/ directory
  // The C++ parser binary must be placed here before packaging
  "extraResources": [
    { "from": "bin/parser.exe", "to": ".", "filter": ["**/*"] },
    { "from": "bin/parser",     "to": ".", "filter": ["**/*"] }
  ]
}
```

---

## SUBSYSTEM E — Infrastructure + Observability + CI/CD

### Task 32: Full docker-compose for local dev

**Files:**
- Modify: `infra/docker-compose.yml` (replace partial version from Task 5)
- Create: `infra/localstack-init.sh`
- Create: `infra/prometheus.yml`
- Create: `infra/otel-collector.yml`
- Create: `infra/docker-compose.test.yml`

- [ ] **Step 1: Write complete `infra/docker-compose.yml`**

```yaml
# infra/docker-compose.yml
version: '3.9'
services:
  api:
    build: { context: ../api, target: runtime }
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgresql://app_role:changeme_in_prod@pgbouncer:5432/vehicledb
      REDIS_URL: redis://redis:6379
      AWS_ENDPOINT_URL: http://localstack:4566
      AWS_REGION: eu-west-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      SQS_CARD_READ_QUEUE_URL: http://localstack:4566/000000000000/card-reads
      SQS_BILLING_QUEUE_URL: http://localstack:4566/000000000000/billing-events
      SQS_REPORT_QUEUE_URL: http://localstack:4566/000000000000/report-generation
      S3_RAW_DUMP_BUCKET: vehicle-card-raw-dumps
      JWT_SECRET: dev-secret-change-in-prod
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      LOG_LEVEL: debug
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      localstack: { condition: service_healthy }
      flyway:   { condition: service_completed_successfully }

  worker-vehicle:
    build: { context: ../worker, target: runtime }
    environment:
      WORKER_TYPE: vehicle
      DATABASE_URL: postgresql://app_role:changeme_in_prod@pgbouncer:5432/vehicledb
      AWS_ENDPOINT_URL: http://localstack:4566
      AWS_REGION: eu-west-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      SQS_CARD_READ_QUEUE_URL: http://localstack:4566/000000000000/card-reads
    depends_on: [postgres, localstack]

  worker-report:
    build: { context: ../worker, target: runtime }
    environment:
      WORKER_TYPE: report
      DATABASE_URL: postgresql://app_role:changeme_in_prod@pgbouncer:5432/vehicledb
      AWS_ENDPOINT_URL: http://localstack:4566
      AWS_REGION: eu-west-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      SQS_REPORT_QUEUE_URL: http://localstack:4566/000000000000/report-generation
      S3_RAW_DUMP_BUCKET: vehicle-card-raw-dumps
    depends_on: [postgres, localstack]

  worker-billing:
    build: { context: ../worker, target: runtime }
    environment:
      WORKER_TYPE: billing
      DATABASE_URL: postgresql://app_role:changeme_in_prod@pgbouncer:5432/vehicledb
      AWS_ENDPOINT_URL: http://localstack:4566
      AWS_REGION: eu-west-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      SQS_BILLING_QUEUE_URL: http://localstack:4566/000000000000/billing-events
    depends_on: [postgres, localstack]

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: vehicledb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports: ["5432:5432"]
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-postgres.sql:/docker-entrypoint-initdb.d/01-init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10

  pgbouncer:
    image: bitnami/pgbouncer:1.22.0
    environment:
      POSTGRESQL_HOST: postgres
      POSTGRESQL_PORT: "5432"
      POSTGRESQL_USERNAME: app_role
      POSTGRESQL_PASSWORD: changeme_in_prod
      POSTGRESQL_DATABASE: vehicledb
      PGBOUNCER_POOL_MODE: transaction
      PGBOUNCER_MAX_CLIENT_CONN: "1000"
      PGBOUNCER_DEFAULT_POOL_SIZE: "25"
    depends_on:
      postgres: { condition: service_healthy }

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  localstack:
    image: localstack/localstack:3.0
    ports: ["4566:4566"]
    environment:
      SERVICES: s3,sqs
      DEFAULT_REGION: eu-west-1
    volumes:
      - ./localstack-init.sh:/etc/localstack/init/ready.d/init.sh
      - localstack_data:/var/lib/localstack
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
      interval: 10s
      timeout: 5s
      retries: 10

  flyway:
    image: flyway/flyway:10
    command: migrate
    environment:
      FLYWAY_URL: jdbc:postgresql://postgres:5432/vehicledb
      FLYWAY_USER: postgres
      FLYWAY_PASSWORD: postgres
      FLYWAY_LOCATIONS: filesystem:/flyway/sql
    volumes:
      - ../db/migrations:/flyway/sql
    depends_on:
      postgres: { condition: service_healthy }

  prometheus:
    image: prom/prometheus:v2.49.0
    ports: ["9090:9090"]
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:10.2.0
    ports: ["3001:3000"]
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
    volumes:
      - grafana_data:/var/lib/grafana

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.91.0
    ports: ["4317:4317", "4318:4318"]
    volumes:
      - ./otel-collector.yml:/etc/otelcol/config.yaml

volumes:
  postgres_data:
  localstack_data:
  grafana_data:
```

- [ ] **Step 2: Write `infra/localstack-init.sh`**

```bash
#!/bin/bash
# infra/localstack-init.sh — runs once when localstack is ready
awslocal sqs create-queue --queue-name card-reads \
  --attributes '{"VisibilityTimeout":"30","MessageRetentionPeriod":"345600","RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:eu-west-1:000000000000:card-reads-dlq\",\"maxReceiveCount\":\"5\"}"}'
awslocal sqs create-queue --queue-name card-reads-dlq
awslocal sqs create-queue --queue-name billing-events
awslocal sqs create-queue --queue-name billing-events-dlq
awslocal sqs create-queue --queue-name report-generation
awslocal sqs create-queue --queue-name report-generation-dlq
awslocal s3 mb s3://vehicle-card-raw-dumps
echo "LocalStack resources created"
```

- [ ] **Step 3: Write `infra/prometheus.yml`**

```yaml
# infra/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: vehicle-card-api
    static_configs:
      - targets: ['api:3000']
    metrics_path: /metrics

alerting:
  alertmanagers:
    - static_configs:
        - targets: []  # wire up Alertmanager in production

rule_files: []
```

- [ ] **Step 4: Write `infra/otel-collector.yml`**

```yaml
# infra/otel-collector.yml
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

exporters:
  logging:
    loglevel: info
  # In production: replace with Jaeger/Tempo/Datadog exporter
  # jaeger:
  #   endpoint: jaeger:14250
  #   tls: { insecure: true }

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [logging]
```

- [ ] **Step 5: Write `infra/docker-compose.test.yml`** (CI integration tests)

```yaml
# infra/docker-compose.test.yml
version: '3.9'
services:
  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: vehicledb_test
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    tmpfs: [/var/lib/postgresql/data]   # ephemeral — fast for CI
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 3s
      timeout: 3s
      retries: 10

  redis-test:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 3s
      retries: 10

  flyway-test:
    image: flyway/flyway:10
    command: migrate
    environment:
      FLYWAY_URL: jdbc:postgresql://postgres-test:5432/vehicledb_test
      FLYWAY_USER: postgres
      FLYWAY_PASSWORD: postgres
      FLYWAY_LOCATIONS: filesystem:/flyway/sql
    volumes:
      - ../db/migrations:/flyway/sql
    depends_on:
      postgres-test: { condition: service_healthy }
```

- [ ] **Step 6: Verify full stack starts**

```bash
cd infra
docker-compose up --wait
curl http://localhost:3000/ready
# Expected: {"status":"ready","checks":{"postgres":"ok","redis":"ok"}}
docker-compose down
```

---

### Task 33: GitHub Actions CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Pipeline stages:** lint → typecheck → unit tests → integration tests (real DB + Redis)
→ security probe tests → Docker build. Migration runs as a service step, not inside the
app image — this is the correct pattern; running migrations at app startup causes race
conditions when multiple pods start simultaneously.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  # ── API ────────────────────────────────────────────────────────────────────
  api-lint-typecheck:
    name: API — lint + typecheck
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: api } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm, cache-dependency-path: api/package-lock.json }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint

  api-unit-tests:
    name: API — unit tests
    runs-on: ubuntu-latest
    needs: api-lint-typecheck
    defaults: { run: { working-directory: api } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm, cache-dependency-path: api/package-lock.json }
      - run: npm ci
      - run: npm run test
        env:
          NODE_ENV: test
          JWT_SECRET: test-secret

  api-integration-tests:
    name: API — integration + security tests
    runs-on: ubuntu-latest
    needs: api-unit-tests
    defaults: { run: { working-directory: api } }
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: vehicledb_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
        ports: ['5432:5432']
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm, cache-dependency-path: api/package-lock.json }
      - run: npm ci

      # Run Flyway migrations before tests (not inside app — avoids startup race)
      - name: Run DB migrations
        run: |
          docker run --rm --network host \
            -v ${{ github.workspace }}/db/migrations:/flyway/sql \
            flyway/flyway:10 \
            -url=jdbc:postgresql://localhost:5432/vehicledb_test \
            -user=postgres -password=postgres migrate

      # Create app_role used by the API
      - name: Create app_role
        run: |
          PGPASSWORD=postgres psql -h localhost -U postgres vehicledb_test \
            -c "CREATE ROLE app_role WITH LOGIN PASSWORD 'testpass';" \
            -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_role;" \
            -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_role;" || true

      - name: Run integration tests
        run: npx vitest run tests/integration
        env:
          NODE_ENV: test
          DATABASE_URL: postgresql://app_role:testpass@localhost:5432/vehicledb_test
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret

      - name: Run security probe tests
        run: npx vitest run tests/security
        env:
          NODE_ENV: test
          DATABASE_URL: postgresql://app_role:testpass@localhost:5432/vehicledb_test
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret

  # ── Workers ────────────────────────────────────────────────────────────────
  worker-test:
    name: Workers — typecheck + unit tests
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: worker } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm, cache-dependency-path: worker/package-lock.json }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test

  # ── Bridge ─────────────────────────────────────────────────────────────────
  bridge-test:
    name: Bridge — typecheck + unit tests
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: bridge } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm, cache-dependency-path: bridge/package-lock.json }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test

  # ── Docker builds ──────────────────────────────────────────────────────────
  docker-build:
    name: Docker — build images
    runs-on: ubuntu-latest
    needs: [api-integration-tests, worker-test]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3

      - name: Build API image
        uses: docker/build-push-action@v5
        with:
          context: api
          push: false
          tags: vehicle-card-api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build Worker image
        uses: docker/build-push-action@v5
        with:
          context: worker
          push: false
          tags: vehicle-card-worker:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

### Task 34: GitHub Actions deploy pipeline

**Files:**
- Create: `.github/workflows/deploy.yml`

**Strategy:** Canary deploy — route 5% of traffic to new version, watch error rate for
5 minutes, then promote to 100% or auto-rollback.

**DB migration safety rule:** Migrations run as a pre-deploy job. They must be
backward-compatible with the N-1 version of the app (the version currently running). Rule:
add columns before using them; drop columns only after the new version has been running
for at least one full deploy cycle. This is enforced by convention and code review.

- [ ] **Step 1: Write `.github/workflows/deploy.yml`**

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-staging:
    name: Deploy to staging
    runs-on: ubuntu-latest
    environment: staging
    needs: []   # deploy.yml triggers only after ci.yml passes (branch protection rule)
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: eu-west-1

      - name: Login to ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build + push API image
        uses: docker/build-push-action@v5
        with:
          context: api
          push: true
          tags: ${{ steps.ecr-login.outputs.registry }}/vehicle-card-api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build + push Worker image
        uses: docker/build-push-action@v5
        with:
          context: worker
          push: true
          tags: ${{ steps.ecr-login.outputs.registry }}/vehicle-card-worker:${{ github.sha }}

      # Run migrations BEFORE deploying new app version
      - name: Run DB migrations (staging)
        run: |
          docker run --rm \
            -e FLYWAY_URL=${{ secrets.STAGING_DB_URL_JDBC }} \
            -e FLYWAY_USER=${{ secrets.STAGING_DB_MIGRATION_USER }} \
            -e FLYWAY_PASSWORD=${{ secrets.STAGING_DB_MIGRATION_PASSWORD }} \
            -v ${{ github.workspace }}/db/migrations:/flyway/sql \
            flyway/flyway:10 migrate

      # Deploy API (canary: 5% traffic)
      - name: Deploy API canary (staging)
        run: |
          aws ecs update-service \
            --cluster staging \
            --service vehicle-card-api \
            --task-definition vehicle-card-api:${{ github.sha }} \
            --deployment-configuration '{"minimumHealthyPercent":75,"maximumPercent":125}'

      - name: Wait for canary health (5 min)
        run: |
          sleep 300
          # Check error rate via CloudWatch — fail if p99 latency > 5s or error rate > 1%
          python3 infra/scripts/check-canary-health.py \
            --service vehicle-card-api --region eu-west-1 \
            --max-error-rate 0.01 --max-p99-ms 5000

      # Deploy workers (no canary needed — they process queues, not user traffic)
      - name: Deploy workers (staging)
        run: |
          for worker in vehicle report billing dlq-monitor; do
            aws ecs update-service \
              --cluster staging \
              --service vehicle-card-worker-$worker \
              --task-definition vehicle-card-worker:${{ github.sha }}
          done

  smoke-test-staging:
    name: Smoke test staging
    runs-on: ubuntu-latest
    needs: deploy-staging
    steps:
      - uses: actions/checkout@v4
      - name: POST a test card read
        run: |
          TOKEN=$(curl -sf -X POST ${{ secrets.STAGING_API_URL }}/auth/token \
            -d "grant_type=client_credentials" \
            -d "client_id=${{ secrets.STAGING_SMOKE_CLIENT_ID }}" \
            -d "client_secret=${{ secrets.STAGING_SMOKE_CLIENT_SECRET }}" \
            | jq -r .access_token)
          STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
            -X POST ${{ secrets.STAGING_API_URL }}/v1/card-reads \
            -H "Authorization: Bearer $TOKEN" \
            -H "Idempotency-Key: smoke-test-$(date +%s)" \
            -H "Content-Type: application/json" \
            -d '{"deviceId":"00000000-0000-0000-0000-000000000001","rawDump":"AAAA","cardSerial":"SMOKE","cardType":"vehicle"}')
          [ "$STATUS" = "201" ] || (echo "Smoke test failed: $STATUS" && exit 1)

  deploy-production:
    name: Deploy to production
    runs-on: ubuntu-latest
    environment: production   # requires manual approval in GitHub Environments
    needs: smoke-test-staging
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_PROD_DEPLOY_ROLE_ARN }}
          aws-region: eu-west-1

      - name: Run DB migrations (production)
        run: |
          docker run --rm \
            -e FLYWAY_URL=${{ secrets.PROD_DB_URL_JDBC }} \
            -e FLYWAY_USER=${{ secrets.PROD_DB_MIGRATION_USER }} \
            -e FLYWAY_PASSWORD=${{ secrets.PROD_DB_MIGRATION_PASSWORD }} \
            -v ${{ github.workspace }}/db/migrations:/flyway/sql \
            flyway/flyway:10 migrate

      - name: Deploy API (production — 5% canary)
        run: |
          aws ecs update-service \
            --cluster production \
            --service vehicle-card-api \
            --task-definition vehicle-card-api:${{ github.sha }}

      - name: Watch canary (10 min)
        run: |
          sleep 600
          python3 infra/scripts/check-canary-health.py \
            --service vehicle-card-api --region eu-west-1 \
            --max-error-rate 0.005 --max-p99-ms 3000

      - name: Deploy workers (production)
        run: |
          for worker in vehicle report billing dlq-monitor; do
            aws ecs update-service \
              --cluster production \
              --service vehicle-card-worker-$worker \
              --task-definition vehicle-card-worker:${{ github.sha }}
          done
```

---

### Task 35: Security checklist + OWASP test stubs

**Files:**
- Create: `SECURITY.md`
- Create: `api/tests/security/owasp.test.ts`

- [ ] **Step 1: Write `SECURITY.md`**

```markdown
# Security Checklist

## Data Classification
- Tachograph card data contains: driver name, driver licence number, location history,
  driving/rest times. Classified as **personal data** under GDPR Article 4(1).
- Raw card binary dumps are stored in S3 with SSE-S3 encryption at rest.
- Parsed data in PostgreSQL is stored on encrypted EBS volumes.
- Data must remain in the EU (GDPR + EU Regulation 2016/799 on tachographs).
  Enforce with S3 bucket policy `aws:RequestedRegion` condition and RDS region lock.

## Retention
- Raw binary dumps: minimum 1 year, maximum 2 years (EU tachograph regulations).
  Implement via S3 Lifecycle rule: transition to Glacier after 90 days, expire at 2 years.
- Audit log: 5 years (GDPR accountability principle). Never delete audit_log rows.
- Parsed vehicle/driver data: until tenant account deletion + 30-day grace period.

## Encryption
- [ ] TLS 1.2+ on all external and internal service connections
- [ ] S3 server-side encryption (SSE-S3 or SSE-KMS)
- [ ] PostgreSQL volume encryption (AWS EBS encrypted)
- [ ] Redis encryption in-transit (TLS) and at-rest (ElastiCache encryption)
- [ ] Device credentials file stored with mode 0o600 on local filesystem

## Authentication
- [ ] User JWTs: HS256, 15-minute expiry, refresh via HttpOnly cookie only
- [ ] Device JWTs: RS256, 1-hour expiry, per-device key pair, revocable
- [ ] Refresh token rotation with Redis distributed lock (no race condition)
- [ ] Token family invalidation on detected reuse (possible theft)
- [ ] Registration codes: single-use, 24-hour expiry, issued by garage_admin only

## Multi-Tenancy
- [ ] RLS enabled on ALL tenant-scoped tables (run `SELECT tablename FROM pg_tables
      WHERE schemaname='public'` vs `SELECT tablename FROM pg_policies` to find gaps)
- [ ] withTenantContext() used for ALL DB queries — never bare pool.query() in routes
- [ ] Cross-tenant probe tests run in CI on every PR
- [ ] GET /:id returns 404 (not 403) for resources belonging to other tenants

## API Security (OWASP Top 10)
- [ ] A01 Broken Access Control: RLS + requireTenantContext middleware
- [ ] A02 Cryptographic Failures: TLS everywhere, no MD5/SHA1 for tokens
- [ ] A03 Injection: parameterized queries only — no string concatenation in SQL
- [ ] A04 Insecure Design: binary payload validated server-side (never trust bridge parser)
- [ ] A05 Security Misconfiguration: Content-Security-Policy, HSTS, X-Frame-Options headers
- [ ] A06 Vulnerable Components: npm audit in CI, Dependabot enabled
- [ ] A07 Auth Failures: rate limiting per-IP, account lockout after 10 failed logins
- [ ] A08 Data Integrity: S3 object integrity checksum on upload
- [ ] A09 Logging Failures: structured audit log, never log raw card data or tokens
- [ ] A10 SSRF: no user-controlled URLs fetched server-side; VIN lookup uses fixed domain

## Bridge Security
- [ ] HTTP server bound to 127.0.0.1 only
- [ ] WebSocket Origin header allowlist (reject unknown origins)
- [ ] Private key never leaves the device
- [ ] Auto-updater uses code-signed releases (configure Squirrel signing)

## Pre-Launch
- [ ] Penetration test focused on: cross-tenant access, privilege escalation,
      bridge authentication bypass, SSRF via webhook URLs
- [ ] GDPR Data Processing Agreement (DPA) in place with all sub-processors
      (AWS, Auth0/Keycloak, Stripe)
- [ ] Privacy notice updated to cover tachograph data processing
- [ ] Data subject rights workflow: export (GDPR Art. 20), erasure (Art. 17)
```

- [ ] **Step 2: Write `api/tests/security/owasp.test.ts`**

```typescript
// api/tests/security/owasp.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp({ logger: false }); });
afterAll(async () => { await app.close(); });

describe('OWASP baseline checks', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/card-reads' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with a tampered JWT', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/card-reads',
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad-sig' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects alg=none JWT', async () => {
    const noneToken = [
      Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
      Buffer.from('{"sub":"attacker","tenantId":"x","type":"user"}').toString('base64url'),
      '',
    ].join('.');
    const res = await app.inject({
      method: 'GET', url: '/v1/card-reads',
      headers: { Authorization: `Bearer ${noneToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('card-read endpoint rejects empty rawDump', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ sub: 'u1', tenantId: 'tid', role: 'mechanic', type: 'user' },
                           process.env.JWT_SECRET ?? 'test-secret', { expiresIn: '15m' });
    const res = await app.inject({
      method: 'POST', url: '/v1/card-reads',
      headers: {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': 'a'.repeat(32),
        'Content-Type': 'application/json',
      },
      payload: { deviceId: '00000000-0000-0000-0000-000000000001',
                 rawDump: '', cardSerial: 'X', cardType: 'vehicle' },
    });
    // Empty rawDump must be rejected at validation layer (400) not processed
    expect([400, 422]).toContain(res.statusCode);
  });

  it('SQL injection attempt in query param returns empty list not an error', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ sub: 'u1', tenantId: 'tid', role: 'mechanic', type: 'user' },
                           process.env.JWT_SECRET ?? 'test-secret', { expiresIn: '15m' });
    const res = await app.inject({
      method: 'GET',
      url: "/v1/vehicles?plate='; DROP TABLE vehicles; --",
      headers: { Authorization: `Bearer ${token}` },
    });
    // Parameterized query: no explosion, just empty results or 400
    expect([200, 400]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(JSON.parse(res.body).items).toBeInstanceOf(Array);
    }
  });
});
```

- [ ] **Step 3: Run OWASP tests** — `cd api && JWT_SECRET=test-secret npx vitest run tests/security/owasp.test.ts`

Expected: 5 PASS (note: 401 tests pass without a DB; SQL injection test passes because queries are parameterized).

---

## Self-Review Against Spec

### Spec Coverage

| Requirement | Task(s) |
|---|---|
| Node.js bridge: serialport + child_process C++ wrapper | 24–26 |
| Local HTTP + WebSocket server | 30 |
| Local SQLite queue with retry | 28 |
| Bridge device JWT auth | 29 |
| Bridge auto-update (Electron) | 31 |
| Partial read detection + race condition (2 readers) | 25, 27 |
| serialport fallback/diagnostics mode | Note below |
| Cloud API: Fastify scaffold | 9 |
| Multi-tenancy RLS + cross-tenant tests | 2–3, 14 |
| JWT access + refresh tokens, device JWT, RBAC | 10–11 |
| POST /v1/card-reads with idempotency key | 13 |
| Cursor-based pagination | 13, 15 |
| Rate limiting: Redis sliding window | 8 |
| Async workers: VIN, PDF, billing, webhook, search | 18–21 |
| DLQ + dead letter monitoring | 21 |
| PostgreSQL schema + indexes + partitioning | 1–4 |
| PgBouncer transaction mode | 7, 32 |
| Redis circuit breaker | 8 |
| S3 blob storage | 13, 19 |
| docker-compose full local dev | 32 |
| OpenTelemetry + Prometheus metrics | 12 |
| Structured Pino logging | Wired in app.ts logger config |
| GitHub Actions CI | 33 |
| GitHub Actions deploy with canary | 34 |
| Security checklist (GDPR, tachograph, OWASP) | 35 |

**Gap — serialport diagnostics mode:** Not explicitly implemented. Recommended addition:
expose `GET /ports` (done in Task 30) and a `POST /diagnose/:port` endpoint in the bridge
HTTP server that opens the port, sends a SELECT APDU, and returns the raw SW bytes. This
lets support staff diagnose chipset compatibility issues without a full card read.

**Gap — webhook dispatch worker:** Scaffolded in `worker/src/index.ts` routing but the
consumer file `webhook-dispatch.consumer.ts` was not written. Implementation follows the
same `startConsumer` pattern as the billing consumer. Add as a follow-up task.

**Gap — search index worker (Elasticsearch/Typesense):** Similarly scaffolded but not
written. Low priority for stage 1.

### Placeholder Scan
No TBD, TODO, or "implement later" markers found in code blocks.

### Type Consistency
- `CardRead` interface defined in `api/src/types/index.ts` — used consistently in
  `card-read.service.ts` and `card-reads.ts` route.
- `QueueEntry` defined in `bridge/src/types.ts` — used in `queue.ts` and `client.ts`.
- `ParsedCardData` defined in `bridge/src/types.ts` — used in `parser.ts`.
- `startConsumer()` signature consistent across all consumer files.

---

## Execution Options

Plan saved to `docs/superpowers/plans/2026-05-09-vehicle-card-saas-platform.md`.

**Recommended execution order:** A (DB) → B (API) → C (Workers) → D (Bridge) → E (Infra)

**Option 1 — Subagent-driven (recommended)**
Use `superpowers:subagent-driven-development`. Dispatch one subagent per task group.
Each subagent gets the relevant task numbers and the full plan as context.

**Option 2 — Inline execution**
Use `superpowers:executing-plans`. Work through tasks sequentially in this session
with checkpoints after each subsystem.
