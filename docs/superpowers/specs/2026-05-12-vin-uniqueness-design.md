# VIN Uniqueness Design

**Date:** 2026-05-12  
**Status:** Approved

## Goal

Prevent two vehicles in the same tenant from sharing a VIN (chassis number). Soft-deleted vehicles free their VIN — a deleted vehicle's VIN can be reused.

## Approach

DB unique partial index + catch Postgres error code `23505` in the API. The database enforces integrity atomically (no TOCTOU race under concurrent inserts). The API catches the known error code and returns a clean 409.

---

## Components

### 1. Migration V14 (`db/migrations/V14__vin_unique.sql`)

Drop the existing non-unique `idx_vehicles_vin` index (from V3), which is superseded. Add a unique partial index scoped to active vehicles:

```sql
DROP INDEX IF EXISTS idx_vehicles_vin;
CREATE UNIQUE INDEX idx_vehicles_vin_unique
  ON vehicles(tenant_id, vin)
  WHERE vin IS NOT NULL AND deleted_at IS NULL;
```

- `WHERE vin IS NOT NULL` — vehicles with no VIN are unaffected.
- `WHERE deleted_at IS NULL` — soft-deleted rows do not occupy a VIN slot.

### 2. API (`api/src/routes/v1/vehicles.ts`)

Wrap the `INSERT` body (POST `/v1/vehicles`) and the `UPDATE` body (PATCH `/v1/vehicles/:id`) in `try/catch`. On `err.code === '23505'` (Postgres `unique_violation`), return:

```
HTTP 409  { error: 'A vehicle with this VIN already exists.' }
```

All other errors re-throw so Fastify's default error handler handles them.

### 3. Frontend (`web/components/forms/VehicleForm.tsx`)

The form already has an `error` state that renders a red banner. One fix:

- The catch block currently reads `err?.response?.data?.message`, but the API sends `{ error: '...' }`. Change to: `err?.response?.data?.error ?? err?.response?.data?.message ?? 'Failed to save. Try again.'`

No other frontend changes required.

---

## Error Flow

```
User submits form with duplicate VIN
  → POST /v1/vehicles
  → Postgres raises unique_violation (23505)
  → API catches → 409 { error: 'A vehicle with this VIN already exists.' }
  → Axios throws → VehicleForm catch block reads .error field
  → Red banner: "A vehicle with this VIN already exists."
```

## Out of Scope

- Global (cross-tenant) VIN uniqueness — not required.
- Frontend pre-validation (client-side duplicate check) — unnecessary; server response is fast and authoritative.
- Hard-deleted vehicles — the system uses soft delete only.
