# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Repository Overview

This is a multi-component SaaS platform for reading Serbian vehicle registration smart cards. It migrates a legacy standalone Qt5 desktop app into a cloud-connected service.

**Components:**

| Dir | Stack | Role |
|-----|-------|------|
| `src/` + `citacVozacke/` | C++ / Qt5 / MinGW 32-bit | Legacy desktop app (standalone, no cloud). Also contains `citacVozacke.exe` + `eVehicleRegistrationAPI.dll` — the SDK used by the bridge. |
| `bridge/` | Electron 30, TypeScript | Windows tray app. Runs `citacVozacke.exe` as a child process, exposes HTTP (port 4000) and WebSocket (port 4001) for the local web UI, queues card reads to SQLite and drains them to the cloud API. |
| `api/` | Fastify 4, TypeScript, ESM | Cloud REST API. Multi-tenant, JWT auth, PostgreSQL, Redis, S3, SQS. |
| `worker/` | Node.js, TypeScript, ESM | SQS consumer. Enriches card reads (VIN lookup), generates PDF reports, handles billing events. |
| `web/` | Next.js 16, React 19 | Browser frontend. Next.js App Router, React Query v5, Tailwind v4, Axios. |
| `db/migrations/` | Flyway SQL | V1–V13 migrations (Flyway versioned naming). |
| `infra/` | Docker Compose | Local dev stack: Postgres 16, Redis 7, LocalStack (S3+SQS), Flyway, Prometheus, Grafana, OTel Collector. |

---

## Commands

### Local infrastructure
```bash
cd infra && docker compose up -d          # start all services (Postgres, Redis, LocalStack, Flyway auto-migrates)
cd infra && docker compose -f docker-compose.test.yml up -d   # test DB only
```

### API (`api/`)
```bash
npm run dev          # tsx watch --env-file=.env src/server.ts  (hot reload)
npm run build        # tsc
npm run typecheck    # tsc --noEmit
npm run test         # vitest run (all tests)
npm run test:security  # vitest run tests/security
```

### Worker (`worker/`)
```bash
npm run dev    # tsx watch src/index.ts
npm run build  # tsc
npm run test   # vitest run
```

### Web (`web/`)
```bash
npm run dev    # next dev -p 3060 -H 0.0.0.0
npm run build  # next build
npm run lint   # eslint
```

### Bridge (`bridge/`)
```bash
npm run dev            # tsc && electron dist/main.js
npm run build          # tsc  (outputs to dist/)
npm run electron:build # electron-builder → dist-electron/ installer
npm run test           # vitest run
```
After `electron:build`, re-run `node scripts/generate-icons.js` before packaging if icon files are placeholders (ask the user to provide real PNG icons at the required size instead of generating them).

### C++ legacy app (`src/`)
Uses CMake + Qt5 15.2 MinGW 32-bit. `build.bat` wraps the CMake workflow. Not deployed to cloud.

---

## Architecture

### Authentication — two token types on one endpoint

`fastify.authenticate` (in `api/src/plugins/auth.ts`) branches on the JWT algorithm header:

- **HS256** → user token issued by `POST /v1/auth/login`, verified by `@fastify/jwt` using `JWT_SECRET`.
- **RS256** → device token signed by the bridge with the device's RSA private key, verified against the public key stored in the `devices` table (cached in Redis for 300 s).

User token payload: `{ sub, tenantId, role, type: 'user' }`.  
Device token payload: `{ sub: deviceId, tenantId, kid, type: 'device' }`.

### Multi-tenancy

Every route that touches tenant-scoped data uses two preHandlers: `[fastify.authenticate, fastify.requireTenantContext]`. `requireTenantContext` copies `req.jwtPayload.tenantId` → `req.tenantId`.

All DB queries for tenant data go through `withTenantContext(pool, tenantId, fn)` in `api/src/db/tenant-context.ts`. It opens a transaction and calls `SET LOCAL app.current_tenant_id = $1` before executing, which activates Postgres RLS policies scoped to that tenant. Never run a tenant query outside this wrapper.

### Card read pipeline

```
citacVozacke.exe (C++)
  ↕ JSON stdio (read_card / card_data)
bridge CppWrapper
  → bridge SQLite queue (better-sqlite3, offline buffer)
  → CloudClient.drainQueue() every 30 s
  → POST /v1/card-reads  (RS256 JWT)
  → card-read.service.ts
      → S3 (raw binary dump)
      → Postgres card_reads (partitioned by month, V4 migration)
      → card_read_idempotency table (global unique, V9 — works around partition uniqueness limit)
      → SQS card.read.completed → worker handleVehicleEnrich (VIN lookup, vehicle upsert)
      → SQS billing.event → worker handleBillingEvent
```

The web UI triggers a scan via `POST http://localhost:4000/reader/scan`. The result arrives via WebSocket on port 4001 → `BridgeProvider` → `CardToast`.

### Pagination pattern

All list endpoints use keyset (cursor) pagination. The cursor is `base64url(JSON.stringify({ id, createdAt }))`. `hasNextPage` is determined by fetching `limit + 1` rows and checking if the result exceeds `limit`. This pattern is uniform across `vehicles`, `card-reads`, `jobs`, `mileage`, `service-reminders`.

### Redis usage

All Redis access goes through `safeGet`/`safeSet`/`checkRateLimit` in `api/src/cache/redis.ts`, which has an in-process circuit breaker (opens after 5 failures, resets after 30 s). Redis is non-critical — its absence degrades performance but does not break the API.

Uses:
- Device public key cache (`dev-pubkey:<deviceId>`, TTL 300 s)
- Idempotency response cache (`idem:<key>`, TTL 24 h)
- Sliding-window rate limiter (Lua EVALSHA, used on `POST /v1/card-reads`)

### Web frontend

- `app/providers.tsx` wraps the tree with `QueryClientProvider` (staleTime 30 s, retry 1).
- `app/(dashboard)/layout.tsx` wraps all dashboard pages in `AuthGuard` + `BridgeProvider`.
- Auth token is stored in `sessionStorage` (per-tab), attached to every Axios request via interceptor in `web/lib/api/client.ts`. 401 responses redirect to `/login`.
- `BridgeProvider` maintains a WebSocket connection to the bridge on `ws://localhost:4001`. Card events propagate via React context; `CardToast` renders them.
- The web app runs on port **3060**; the API defaults to **3050** in dev (see `api/.env`).

### SQS event types

| Event | Producer | Consumer |
|-------|----------|----------|
| `card.read.completed` | card-read.service | `handleVehicleEnrich` — VIN lookup + vehicle enrichment |
| `billing.event` | card-read.service | `handleBillingEvent` — billing_events INSERT |
| `report.requested` | reports route | `handleReportGenerate` — PDF generation + S3 upload |

### DB migrations

Managed by Flyway (`db/migrations/V*.sql`). Run automatically in Docker Compose via the `flyway` service. In CI, applied before tests against a test Postgres instance. Key structural notes:
- `card_reads` is partitioned by month (`created_at`). Partitions currently exist for 2026–2027 only (see open item below).
- `card_read_idempotency` (V9) is an unpartitioned table that provides global uniqueness for `idempotency_key` because partitioned tables can't enforce cross-partition uniqueness.
- RLS policies live in V2; indexes in V3.

---

## Known Open Issues (from `nikolaNotes.md`)

Critical items to be aware of when making changes:

- **`card_reads` partitions expire 2027-12** — all inserts after that date will fail. Needs `pg_partman` or manual partition additions.
- **VIN lookup is US-only** — `vin-lookup.service.ts` calls NHTSA (US DOT); returns nothing for Serbian/EU VINs.
- **Bridge WebSocket has no auth** — only checks `Origin` header. Any local process can receive all card data.
- **Electron auto-updater is unconfigured** — `publish: null` in `electron-builder.json5`; update checks fail silently every 4 h.
- **Tenant usage limits not enforced** — `max_reads_per_month` and `max_devices` columns exist but no code checks them.
- **Grafana anonymous admin** — `GF_AUTH_ANONYMOUS_ORG_ROLE: Admin` in docker-compose; dev only.
- **`/metrics` endpoint is unauthenticated** — restrict in production nginx/ALB.

---

## Environment Variables

The API reads from `api/.env`. Key variables:

| Variable | Component | Notes |
|----------|-----------|-------|
| `JWT_SECRET` | api | HS256 signing secret |
| `DATABASE_URL` | api, worker | Postgres connection string |
| `REDIS_URL` | api | Defaults to `redis://localhost:6379` |
| `AWS_ENDPOINT_URL` | api, worker | Set to LocalStack URL in dev |
| `S3_RAW_DUMP_BUCKET` | api | S3 bucket for raw card dumps |
| `SQS_CARD_READ_QUEUE_URL` | api, worker | |
| `SQS_REPORT_QUEUE_URL` | api, worker | |
| `SQS_BILLING_QUEUE_URL` | api, worker | |
| `NEXT_PUBLIC_API_URL` | web | API base URL |
| `NEXT_PUBLIC_BRIDGE_URL` | web | Bridge HTTP base, default `http://localhost:4000` |

Bridge reads config from `%APPDATA%/vehicle-card-bridge/config.json` (written by the setup wizard). Fields: `deviceId`, `devicePrivateKey`, `tenantId`, `cloudApiUrl`.
