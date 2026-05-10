# Production Readiness Audit — citacVozacke SaaS Platform

> Scanned: 2026-05-10. Last updated: 2026-05-10 (fixes applied).  
> Severity: **CRITICAL** = will crash/fail at runtime | **HIGH** = security or data loss risk | **MEDIUM** = incorrect behavior | **LOW** = quality/improvement  
> Status: ✅ FIXED | ⚠️ OPEN

---

## 1. RUNTIME BUGS

### 1.1 ✅ `vehicles` table missing `deleted_at` column — ALL vehicle queries were failing
- **Fixed by:** `db/migrations/V6__fix_vehicles_soft_delete.sql`
- **Was:** `db/migrations/V1__initial_schema.sql` — no `deleted_at` column; every vehicle query crashed

### 1.2 ✅ `billing_events` column name mismatch — billing INSERT was failing
- **Fixed by:** `worker/src/consumers/billing-event.consumer.ts` — `amount_cents` → `amount_units`
- **Was:** Code used `amount_cents`, schema column is `amount_units`

### 1.3 ✅ `audit_log` INSERT used wrong column names — anomaly logging was failing
- **Fixed by:** `worker/src/consumers/vehicle-enrich.consumer.ts` — `actor_id`/`metadata` → `user_id`/`device_id`
- **Was:** Code referenced `actor_id` and `metadata` columns that don't exist in schema

### 1.4 ✅ `reports` UPDATE used wrong column names — reports were never marked ready
- **Fixed by:** `worker/src/consumers/report-generate.consumer.ts` — `s3_key` → `pdf_s3_key`; `db/migrations/V7__fix_reports_schema.sql` — adds `updated_at` column
- **Was:** `s3_key` doesn't exist (schema has `pdf_s3_key`); `updated_at` column didn't exist

### 1.5 ✅ Device JWT field mismatch — all device card uploads rejected with 401
- **Fixed by:** `bridge/src/cloud/auth.ts` — JWT field changed from `tid` to `tenantId`
- **Was:** Bridge signed JWT with `tid: tenantId`; API destructured `tenantId` → always undefined → "Device token incomplete"

### 1.6 ✅ C++ binary path missing `.exe` on Windows — reader never started
- **Fixed by:** `bridge/src/bridge/cpp-wrapper.ts` — binary name now appends `.exe` on `win32`
- **Was:** `spawn()` on Windows does not auto-append `.exe`; binary was never found

### 1.7 ✅ V4 migration changed `card_type` CHECK constraint — all new card reads were rejected
- **Fixed by:** `db/migrations/V8__fix_card_type_check.sql` — restores `('vehicle_registration','id_card','other')`
- **Was:** V4 set CHECK to `('driver','vehicle','workshop','control')` while API accepts `vehicle_registration/id_card/other`

### 1.8 ⚠️ V4 migration weakens idempotency guarantee
- **Severity:** HIGH
- **File:** `db/migrations/V4__partition_card_reads.sql:51-53`
- **Detail:** V1 had `idempotency_key UNIQUE` globally; V4 changed to `UNIQUE (idempotency_key, created_at)` — only unique per partition timestamp
- **Risk:** Same card scan could be inserted twice across a partition boundary
- **Fix needed:** Separate global idempotency table keyed by `idempotency_key` alone, or use UUID-based keys that are inherently unique

### 1.9 ✅ `parsed_data` always stored as empty `{}` — card data was silently dropped
- **Fixed by:**
  - `api/src/routes/v1/card-reads.ts` — added `parsedData` field to POST body schema
  - `api/src/services/card-read.service.ts` — stores `input.parsedData` instead of hardcoded `'{}'`
  - `bridge/src/cloud/client.ts` — sends `parsedData` in the upload body
  - `bridge/src/types.ts` — added `parsedData` field to `QueuedRead`
  - `bridge/src/bridge/queue.ts` — added `parsed_data` column to SQLite schema; serializes/deserializes JSON
  - `bridge/src/main.ts` — includes `parsedData` in the enqueued item
- **Was:** Full vehicle data from C++ binary (VIN, plate, owner, etc.) was discarded after S3 upload

### 1.10 ⚠️ Rate limiter implemented but never called
- **Severity:** MEDIUM
- **File:** `api/src/cache/redis.ts:58-68` — `checkRateLimit()` fully implemented but dead code
- **Fix needed:** Wire into `POST /v1/card-reads` preHandler: `checkRateLimit('rl:cardread:' + tenantId, 60_000, 60)`

### 1.11 ✅ Worker `package-lock.json` missing — `npm ci` was failing in CI and Docker build
- **Fixed by:** Ran `npm install` in `worker/`; `package-lock.json` now present

### 1.12 ✅ Test helpers used wrong JWT field — security tests had undefined tenantId
- **Fixed by:** `api/tests/helpers.ts` — `tid: tenantId` → `tenantId`
- **Was:** All test JWTs had `tid` field; auth plugin reads `tenantId`; tenant context was always undefined in tests

### 1.13 ⚠️ `card-reader.ts` listens for `card_inserted` event that C++ never sends
- **Severity:** MEDIUM
- **File:** `bridge/src/bridge/card-reader.ts:17-19`
- **Detail:** Auto-read on card insert silently never fires; user must always click Scan
- **Fix needed:** Either add card polling loop to C++ binary that emits `card_inserted`, or document manual-scan-only mode and remove the dead listener

---

## 2. SECURITY ISSUES

### 2.1 ⚠️ JWT_SECRET is a plaintext dev value
- **Severity:** HIGH
- **File:** `infra/docker-compose.yml:83` — `JWT_SECRET: dev-secret-change-in-prod`
- **Fix needed:** `openssl rand -hex 32`, store in AWS Secrets Manager / Vault; inject at runtime

### 2.2 ⚠️ AWS credentials are fake LocalStack values
- **Severity:** HIGH (production blocker)
- **File:** `infra/docker-compose.yml:86-87` — `AWS_ACCESS_KEY_ID: test`, `AWS_SECRET_ACCESS_KEY: test`
- **Note:** Correct for local dev. Must use ECS task IAM roles in production — never hardcode.

### 2.3 ⚠️ PostgreSQL uses default weak credentials
- **Severity:** HIGH
- **File:** `infra/docker-compose.yml:10-11`, `infra/init-postgres.sql:6,17`
- **Detail:** `postgres/postgres`, `app_role_password`, `migration_role_password` all plaintext in repo
- **Fix needed:** Secrets manager injection; rotate before production

### 2.4 ⚠️ Grafana anonymous admin access enabled
- **Severity:** HIGH
- **File:** `infra/docker-compose.yml` Grafana env block
- **Detail:** `GF_AUTH_ANONYMOUS_ENABLED: true` + `GF_AUTH_ANONYMOUS_ORG_ROLE: Admin`
- **Fix needed:** Disable anonymous access; add Grafana admin user via secrets

### 2.5 ⚠️ `/metrics` endpoint has no authentication
- **Severity:** MEDIUM
- **File:** `api/src/routes/health.ts`
- **Fix needed:** IP allowlist (scraper only) or bearer token in production nginx/ALB config

### 2.6 ⚠️ Device private key defaults to empty string — bridge crashes on first upload
- **Severity:** HIGH
- **File:** `bridge/src/main.ts:14` — `DEVICE_PRIVATE_KEY ?? ''`
- **Fix needed:** Fail fast at startup: show error dialog and quit if env var is missing

### 2.7 ⚠️ No device provisioning flow
- **Severity:** HIGH
- **Detail:** No API endpoint to register a device. Every device requires a manual DB INSERT with RSA public key.
- **Fix needed:** `POST /v1/admin/devices` — accepts public key PEM, returns device credentials

### 2.8 ⚠️ No user login endpoint — JWT issuance completely missing
- **Severity:** HIGH
- **Detail:** API verifies JWTs but no endpoint issues them. Browser users cannot authenticate at all.
- **Fix needed:** `POST /v1/auth/login` with bcrypt + JWT response, or integrate Keycloak/Auth0

### 2.9 ⚠️ Flyway CI job uses postgres superuser instead of migration_role
- **Severity:** LOW
- **File:** `.github/workflows/ci.yml:119-121`
- **Fix needed:** Use `migration_role` in CI to match production deploy workflow

---

## 3. DUMMY / PLACEHOLDER DATA — must replace before production

| # | File | Status | Value | Notes |
|---|------|--------|-------|-------|
| 1 | `infra/docker-compose.yml:83` | ⚠️ | `JWT_SECRET: dev-secret-change-in-prod` | Replace with 256-bit random secret |
| 2 | `infra/docker-compose.yml:86-87` | ⚠️ | `AWS_ACCESS_KEY_ID/SECRET: test` | Use IAM task roles in prod |
| 3 | `infra/docker-compose.yml:10-11` | ⚠️ | `POSTGRES_PASSWORD: postgres` | Rotate before production |
| 4 | `infra/init-postgres.sql:6,17` | ⚠️ | `app_role_password`, `migration_role_password` | Move to secrets manager |
| 5 | `bridge/src/main.ts:13` | ⚠️ | `DEVICE_ID ?? 'local-device'` | Must be valid UUID from `devices` table |
| 6 | `bridge/src/main.ts:14` | ⚠️ | `DEVICE_PRIVATE_KEY ?? ''` | Empty = crash on first upload |
| 7 | `bridge/src/main.ts:37` | ⚠️ | `TENANT_ID ?? ''` | Must be valid UUID from `tenants` table |
| 8 | `bridge/src/main.ts:12` | ⚠️ | `CLOUD_API_URL ?? 'http://localhost:3000'` | Replace with production URL |
| 9 | `worker/src/services/vin-lookup.service.ts:15` | ⚠️ | `vpic.nhtsa.dot.gov` | US-only; Serbian VINs return nothing |
| 10 | `api/src/services/card-read.service.ts` | ✅ | `parsed_data = '{}'` | Fixed — now stores real card data |
| 11 | `.github/workflows/deploy.yml` | ⚠️ | All `secrets.*` references | GitHub Secrets not yet created |
| 12 | `infra/docker-compose.yml` Grafana | ⚠️ | `GF_AUTH_ANONYMOUS_ORG_ROLE: Admin` | Dev-only; disables all auth |
| 13 | `db/migrations/V4__partition_card_reads.sql:33-34` | ⚠️ | `FOR y IN 2026..2027` | Only 2 years of partitions; needs pg_partman |

---

## 4. MISSING FEATURES — not implemented, required for production

### 4.1 ⚠️ No user authentication (login) endpoint
No `POST /auth/login`. Users cannot get a JWT. The entire authenticated API surface is inaccessible from a browser.

### 4.2 ⚠️ No device provisioning API
Devices must be manually inserted into `devices` table with RSA public key. No tooling or endpoint exists.

### 4.3 ⚠️ No tenant management API
No endpoint to create tenants or manage plans (`starter/professional/enterprise`). `max_devices`/`max_reads_per_month` limits exist in schema but are never enforced.

### 4.4 ⚠️ Usage limit enforcement missing
`tenants.max_reads_per_month` and `tenants.max_devices` columns exist but no code checks them before allowing card reads or device registration.

### 4.5 ⚠️ VIN lookup returns nothing for non-US vehicles
`vin-lookup.service.ts` calls NHTSA (US DOT). Serbian VINs return empty results. Need a European VIN decoder (VINDecoderZ, carMD EU, or local dataset).

### 4.6 ✅ `parsed_data` roundtrip was broken — now fixed
Card data from C++ binary now flows: C++ → bridge SQLite queue → REST upload body → PostgreSQL `parsed_data` column.

### 4.7 ⚠️ Card auto-detection not implemented
C++ binary only responds to explicit `read_card` commands. The `card_inserted` unsolicited event is never emitted. Auto-scan on card insert does not work — user must always click Scan.

### 4.8 ⚠️ Electron auto-updater not configured
`autoUpdater.checkForUpdatesAndNotify()` is called but no `electron-builder` publish config exists. Updates silently fail every 4 hours.

### 4.9 ⚠️ Partition maintenance not automated
V4 creates partitions for 2026-2027 only. After 2027-12, all card read inserts will fail. Needs `pg_partman` + `pg_cron`.

### 4.10 ⚠️ No `DELETE /v1/vehicles/:id` endpoint
`vehicles.ts` has GET, POST, PATCH — no DELETE. Soft-delete column is now present (V6 migration), but the endpoint still needs to be added.

### 4.11 ⚠️ No report request endpoint
No `POST /v1/reports` to trigger PDF generation. The consumer works but there's no way to enqueue a report from the API.

### 4.12 ⚠️ No WebSocket auth on bridge WS server
`bridge/src/server/websocket.ts` only checks Origin header. Any local process can connect and receive all card data in real time.

---

## 5. IMPROVEMENT OPPORTUNITIES

### 5.1 Use `pg_partman` for partition automation
Replace the static 2026-2027 loop in V4 with `pg_partman` + `pg_cron`. Required before end of 2027.

### 5.2 Implement rate limiting at the route level
`checkRateLimit()` in `api/src/cache/redis.ts` is fully working but never called. Wire into `POST /v1/card-reads`.

### 5.3 Replace NHTSA VIN decoder with EU-compatible service
NHTSA returns data only for USDOT-registered vehicles. Serbian/EU VINs need a European decoder.

### 5.4 Encrypt PII before storing in `parsed_data`
`parser.ts` notes `personalNo` (JMBG), owner name, and address are PII. Use per-tenant KMS envelope encryption before storing in DB.

### 5.5 Add audit logging for user-initiated mutations
`audit_log` table exists with RLS but no API route writes to it. Should log vehicle create/patch, device registration, etc.

### 5.6 Remove `apdu.ts` dead code
`bridge/src/bridge/apdu.ts` is imported nowhere. Remove or wire up for diagnostics.

### 5.7 Add RLS policy to `tenants` table
`tenants` table has no RLS policy. A bug or compromised token could expose all tenant rows.

### 5.8 Fix idempotency key collision risk
`bridge/src/main.ts`: `${deviceId}-${cardSerial}-${Date.now()}` — millisecond collision possible. Use `randomUUID()` instead.

### 5.9 Add shared-secret auth to bridge HTTP server
`bridge/src/server/http.ts` accepts any local request. Add a `X-Bridge-Secret` header check matching a startup-generated secret.

### 5.10 Flyway CI should use migration_role
`.github/workflows/ci.yml:119` uses postgres superuser. Switch to `migration_role` to catch permission regressions before they reach production.

### 5.11 V4 migration is a full table copy — needs runbook
V4 `INSERT INTO card_reads SELECT * FROM card_reads_v1` blocks the table. Document maintenance window requirements or rewrite with `pg_repack`.

### 5.12 Fail fast in bridge if required env vars are missing
`DEVICE_PRIVATE_KEY`, `DEVICE_ID`, `TENANT_ID` currently fall back to empty strings. Bridge should show an `electron.dialog.showErrorBox` and quit on startup if any are missing.

---

## 6. ENVIRONMENT VARIABLES CHECKLIST

| Component | Variable | Status | Notes |
|-----------|----------|--------|-------|
| API | `JWT_SECRET` | ⚠️ | Min 256-bit random, from secrets manager |
| API | `DATABASE_URL` | ⚠️ | Use `app_role` credentials |
| API | `REDIS_URL` | ⚠️ | Production Redis with TLS |
| API | `AWS_REGION` | ⚠️ | Real region |
| API | `S3_RAW_DUMP_BUCKET` | ⚠️ | Real S3 bucket name |
| Worker | `DATABASE_URL` | ⚠️ | Use `app_role` credentials |
| Worker | `AWS_REGION` | ⚠️ | Real region |
| Worker | `S3_REPORTS_BUCKET` | ⚠️ | Real S3 bucket name |
| Worker | `SQS_CARD_READ_QUEUE_URL` | ⚠️ | Real SQS queue URL |
| Worker | `SQS_REPORT_QUEUE_URL` | ⚠️ | Real SQS queue URL |
| Worker | `SQS_BILLING_QUEUE_URL` | ⚠️ | Real SQS queue URL |
| Worker | `SQS_DLQ_URL` | ⚠️ | Real SQS DLQ URL |
| Bridge | `DEVICE_ID` | ⚠️ | Valid UUID from `devices` table |
| Bridge | `DEVICE_PRIVATE_KEY` | ⚠️ | PEM private key matching registered public key |
| Bridge | `TENANT_ID` | ⚠️ | Valid UUID from `tenants` table |
| Bridge | `CLOUD_API_URL` | ⚠️ | Production API URL |
| Bridge | `CPP_BINARY_PATH` | ⚠️ | Path to `citacVozacke.exe` (auto-detected if in `native/`) |

---

## 7. REMAINING PRIORITY ORDER FOR AGENTS

Items still open, ordered by impact:

1. **Security 2.8** — Implement `POST /v1/auth/login` (no user can authenticate at all)
2. **Security 2.7** — Implement `POST /v1/admin/devices` device provisioning
3. **Missing 4.10** — Add `DELETE /v1/vehicles/:id` soft-delete endpoint
4. **Missing 4.11** — Add `POST /v1/reports` to enqueue PDF generation
5. **Bug 1.8** — Fix idempotency guarantee weakened by V4 partition migration
6. **Bug 1.10** — Wire `checkRateLimit()` into card-reads POST route
7. **Bug 1.13** — Fix or document card auto-detection (`card_inserted` event never fires)
8. **Missing 4.3/4.4** — Tenant management API + usage limit enforcement
9. **Missing 4.5** — Replace NHTSA with EU VIN decoder for Serbian market
10. **Security 2.6** — Bridge startup fail-fast when `DEVICE_PRIVATE_KEY` is missing
11. **Security 2.1-2.4** — Replace all dev secrets with secrets manager references before any production deploy
12. **Missing 4.9** — Set up `pg_partman` before 2027-12 or add partitions for 2028+
