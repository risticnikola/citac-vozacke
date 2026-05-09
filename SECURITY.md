# Security Checklist

## Authentication & Authorization
- [x] Device tokens use RS256 with on-device private key; only public key sent to cloud
- [x] User tokens use HS256 with per-environment `JWT_SECRET` (rotate via env var, not code)
- [x] `requireTenantContext` middleware enforces tenantId on every protected route
- [x] Device public keys fetched from DB + cached 5 min in Redis; `revoked_at` checked on every request
- [x] Refresh token rotation: Redis distributed lock (SET NX) prevents race-condition token reuse
- [ ] Implement token family invalidation on suspicious reuse (revoke all tokens for user)
- [ ] Add MFA for admin users

## Multi-Tenant Isolation
- [x] PostgreSQL RLS enabled on all 7 tenant-scoped tables
- [x] `withTenantContext()` wraps every query in `BEGIN → SET LOCAL app.current_tenant_id → COMMIT`
- [x] PgBouncer in transaction mode — `SET LOCAL` is scoped to the transaction only
- [x] `migration_role` has `BYPASSRLS`; `app_role` does not
- [x] Cross-tenant probe test: `/api/tests/security/cross-tenant.test.ts`
- [ ] Penetration test: verify RLS holds under PgBouncer connection reuse

## Input Validation
- [x] TypeBox schema validation on all request bodies and querystrings (Fastify ajv integration)
- [x] VIN max 17 chars, plate max 20 chars enforced at schema + DB level
- [x] Idempotency key: 32–128 chars, enforced in schema
- [x] `rawDump` accepted as base64 string; decoded to Buffer before DB/S3 operations
- [ ] Add content-type enforcement for all POST/PATCH routes

## Injection Prevention
- [x] All DB queries use parameterized `$1,$2,...` placeholders — no string interpolation
- [x] Cursor decoded via `JSON.parse(Buffer.from(..., 'base64url'))` — not `eval`
- [x] S3 keys constructed from tenantId + idempotencyKey — no user-controlled path components

## Rate Limiting
- [x] Sliding window rate limiter in Redis via atomic Lua script (ZREMRANGEBYSCORE + ZADD + PEXPIRE)
- [x] Circuit breaker on Redis client: 5 failures → open 30 s → half-open
- [ ] Apply rate limiting to `/v1/card-reads` POST (high-volume endpoint)
- [ ] Add per-device rate limiting (deviceId dimension)

## Transport Security
- [x] API served behind TLS-terminating load balancer (ECS → ALB with ACM cert)
- [x] Bridge WebSocket bound to 127.0.0.1; Origin allowlist enforced
- [x] Bridge HTTP bound to 127.0.0.1; only Electron renderer can access
- [ ] Enforce HSTS header in production load balancer config
- [ ] Add `Content-Security-Policy` header to any browser-facing responses

## Data Protection (GDPR / EU Regulation 2016/799)
- [x] Raw card dumps stored in S3 with tenant-scoped key prefix
- [x] `parsed_data` stored as JSONB — avoid storing PIN data in parsed_data
- [x] `audit_log` table records actor, action, resource for compliance trail
- [x] `deleted_at` soft-delete on vehicles preserves referential integrity for audit
- [ ] Implement S3 object lifecycle policy: delete raw dumps after retention period (check national law)
- [ ] Add GDPR data subject export endpoint (right of access)
- [ ] Add GDPR erasure endpoint (right to be forgotten — anonymize, not delete, audit records)
- [ ] Document data retention policy in Privacy Policy

## Infrastructure
- [x] Docker images run as `USER node` (non-root)
- [x] `dumb-init` as PID 1 — proper signal forwarding + zombie reaping
- [x] HEALTHCHECK defined in both Dockerfiles
- [x] Trivy CVE scan in CI — fails on CRITICAL severity
- [x] SBOM + provenance attestation on published images (docker/build-push-action)
- [ ] Enable AWS GuardDuty on S3 buckets
- [ ] Enable S3 server-side encryption (SSE-S3 or SSE-KMS)
- [ ] Restrict SQS queue policies to ECS task roles only
- [ ] Enable VPC endpoint for S3/SQS to avoid public internet traffic

## Secrets Management
- [ ] Rotate JWT_SECRET via environment variable (no hardcoded fallbacks in production)
- [ ] Store DB passwords in AWS Secrets Manager; inject via ECS secrets
- [ ] Device private keys generated on-device; never transmitted to cloud
- [ ] CI secrets: DATABASE_URL_JDBC, MIGRATION_ROLE_PASSWORD, AWS_DEPLOY_ROLE_ARN stored in GitHub Environments (production only)

## Dependency Security
- [x] `npm ci --ignore-scripts` in Dockerfiles — prevents postinstall script attacks
- [x] `npm ci --omit=dev` in production image — reduces attack surface
- [ ] Enable Dependabot for automated dependency updates
- [ ] Enable npm audit in CI (add `npm audit --production` step)

## OWASP Top 10 Test Coverage
- [ ] A01 Broken Access Control → `cross-tenant.test.ts` (partial)
- [ ] A02 Cryptographic Failures → test that raw dumps are not returned in API response
- [ ] A03 Injection → parameterized queries; add SQLi probe test
- [ ] A05 Security Misconfiguration → test /metrics is not publicly accessible
- [ ] A07 Authentication Failures → test expired token rejection, tampered token rejection
- [ ] A09 Security Logging → test that audit_log entries are created for sensitive operations
