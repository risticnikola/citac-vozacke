# VIN Uniqueness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent two active vehicles in the same tenant from sharing a VIN; deleted vehicles free their VIN slot.

**Architecture:** Postgres unique partial index is the authoritative enforcer (no TOCTOU race). The API catches error code `23505` and returns 409. The frontend already renders an error banner — only the field name it reads needs fixing.

**Tech Stack:** Postgres 16 (Flyway migration), Fastify 4 TypeScript ESM (API), React 19 / Next.js 16 (frontend), Vitest (tests).

---

## Files

| Action | Path |
|--------|------|
| Create | `db/migrations/V14__vin_unique.sql` |
| Create | `api/tests/unit/vehicles-vin-unique.test.ts` |
| Modify | `api/src/routes/v1/vehicles.ts` |
| Modify | `web/components/forms/VehicleForm.tsx` |

---

## Task 1: Migration V14

**Files:**
- Create: `db/migrations/V14__vin_unique.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- db/migrations/V14__vin_unique.sql
-- Replace the non-unique VIN index with a unique partial one.
-- Deleted vehicles (deleted_at IS NOT NULL) do not occupy a VIN slot.
DROP INDEX IF EXISTS idx_vehicles_vin;
CREATE UNIQUE INDEX idx_vehicles_vin_unique
  ON vehicles(tenant_id, vin)
  WHERE vin IS NOT NULL AND deleted_at IS NULL;
```

- [ ] **Step 2: Apply the migration**

Bring up the full dev stack (Flyway runs automatically):
```bash
cd infra && docker compose up -d flyway
```

Expected: Flyway logs `Successfully applied 1 migration to schema "public"` and exits 0. If the DB is already up, `docker compose restart flyway` is enough.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/V14__vin_unique.sql
git commit -m "db: add unique partial index for VIN per tenant (V14)"
```

---

## Task 2: API — enforce 409 on duplicate VIN

**Files:**
- Modify: `api/src/routes/v1/vehicles.ts` (POST and PATCH handlers)
- Create: `api/tests/unit/vehicles-vin-unique.test.ts`

- [ ] **Step 1: Start the test database**

```bash
cd infra && docker compose -f docker-compose.test.yml up -d
```

Wait until `docker compose -f docker-compose.test.yml ps` shows all services healthy.

- [ ] **Step 2: Write the failing tests**

Create `api/tests/unit/vehicles-vin-unique.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { buildTestApp, makeUserToken } from '../helpers.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
const tenantId = randomUUID();
const token = makeUserToken(tenantId);

const inject = (method: string, url: string, body?: unknown) =>
  app.inject({
    method: method as any,
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('VIN uniqueness', () => {
  it('rejects a second vehicle with the same VIN in the same tenant', async () => {
    const vin = 'WBA' + randomUUID().replace(/-/g, '').slice(0, 14);

    const first = await inject('POST', '/v1/vehicles', { vin, plate: 'BG 001-AA' });
    expect(first.statusCode).toBe(201);

    const second = await inject('POST', '/v1/vehicles', { vin, plate: 'BG 002-BB' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatch(/VIN already exists/i);
  });

  it('allows the same VIN after the first vehicle is deleted', async () => {
    const vin = 'WBA' + randomUUID().replace(/-/g, '').slice(0, 14);

    const created = await inject('POST', '/v1/vehicles', { vin, plate: 'NS 100-CC' });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/vehicles/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(204);

    const reuse = await inject('POST', '/v1/vehicles', { vin, plate: 'NS 200-DD' });
    expect(reuse.statusCode).toBe(201);
  });

  it('allows multiple vehicles without a VIN', async () => {
    const first  = await inject('POST', '/v1/vehicles', { plate: 'KG 001-EE' });
    const second = await inject('POST', '/v1/vehicles', { plate: 'KG 002-FF' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });

  it('rejects PATCH that would create a VIN collision', async () => {
    const vin = 'WBA' + randomUUID().replace(/-/g, '').slice(0, 14);

    await inject('POST', '/v1/vehicles', { vin, plate: 'ZR 001-GG' });

    const other = await inject('POST', '/v1/vehicles', { plate: 'ZR 002-HH' });
    expect(other.statusCode).toBe(201);
    const { id: otherId } = other.json();

    const patch = await inject('PATCH', `/v1/vehicles/${otherId}`, { vin });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error).toMatch(/VIN already exists/i);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
cd api && npm run test -- tests/unit/vehicles-vin-unique.test.ts
```

Expected: 4 tests, 3 fail (the 409 cases get 201 or 500 instead of 409).

- [ ] **Step 4: Wrap POST and PATCH handlers in try/catch**

In `api/src/routes/v1/vehicles.ts`, replace the POST handler body:

```ts
  fastify.post<{ Body: VehicleBodyType }>('/', {
    schema: { body: VehicleBody },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const b = req.body;
    try {
      const rows = await withTenantContext(pool, req.tenantId, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO vehicles (tenant_id,vin,plate,make,model,year,owner_name,owner_phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [req.tenantId, b.vin, b.plate, b.make, b.model, b.year, b.ownerName, b.ownerPhone],
        );
        return rows;
      });
      return reply.code(201).send(rows[0]);
    } catch (err: any) {
      if (err.code === '23505') return reply.code(409).send({ error: 'A vehicle with this VIN already exists.' });
      throw err;
    }
  });
```

Replace the PATCH handler body:

```ts
  fastify.patch<{ Body: VehicleBodyType }>('/:id', {
    schema: { body: VehicleBody },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body;
    try {
      const rows = await withTenantContext(pool, req.tenantId, async (c) => {
        const { rows } = await c.query(
          `UPDATE vehicles SET vin=$2,plate=$3,make=$4,model=$5,year=$6,
             owner_name=$7,owner_phone=$8,updated_at=NOW()
           WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
          [id, b.vin, b.plate, b.make, b.model, b.year, b.ownerName, b.ownerPhone],
        );
        return rows;
      });
      if (!rows.length) return reply.code(404).send({ error: 'Not found' });
      return reply.send(rows[0]);
    } catch (err: any) {
      if (err.code === '23505') return reply.code(409).send({ error: 'A vehicle with this VIN already exists.' });
      throw err;
    }
  });
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
cd api && npm run test -- tests/unit/vehicles-vin-unique.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Run the full test suite to check for regressions**

```bash
cd api && npm run test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/v1/vehicles.ts api/tests/unit/vehicles-vin-unique.test.ts
git commit -m "feat: return 409 on duplicate VIN (POST and PATCH)"
```

---

## Task 3: Frontend — read correct error field

**Files:**
- Modify: `web/components/forms/VehicleForm.tsx` (line 67)

- [ ] **Step 1: Fix the error field name**

In `web/components/forms/VehicleForm.tsx`, find the catch block (around line 66-68) and replace:

```ts
      setError(err?.response?.data?.message ?? 'Failed to save. Try again.');
```

with:

```ts
      setError(err?.response?.data?.error ?? err?.response?.data?.message ?? 'Failed to save. Try again.');
```

- [ ] **Step 2: Verify manually**

Start the full dev stack and the web app:
```bash
cd infra && docker compose up -d
cd api && npm run dev
cd web && npm run dev
```

1. Navigate to `/vehicles/new`
2. Enter any VIN and create the vehicle
3. Navigate to `/vehicles/new` again
4. Enter the same VIN and submit
5. Expected: red banner reads "A vehicle with this VIN already exists."

- [ ] **Step 3: Commit**

```bash
git add web/components/forms/VehicleForm.tsx
git commit -m "fix: read .error field from API response in VehicleForm"
```
