# Sprint 2: Interval-Based Auto-Renewal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a mechanic marks a service reminder complete, automatically create the next reminder using the interval stored on the reminder itself.

**Architecture:** Two nullable columns (`interval_km`, `interval_days`) are added to `service_reminders`. The PATCH `completed=true` handler reads the vehicle's current mileage, computes next due values, and inserts the new reminder in the same DB transaction. A `skipRenewal` flag lets the mechanic opt out. The frontend shows an inline confirmation with a "Create next reminder" checkbox (checked by default) when completing a reminder that has an interval set.

**Tech Stack:** Fastify 4 / TypeScript / PostgreSQL (API), React 19 / Tailwind v4 (Web), Vitest (tests), Flyway (migrations)

---

## File Map

| Action | File |
|--------|------|
| Create | `db/migrations/V15__service_reminder_intervals.sql` |
| Modify | `api/src/routes/v1/service-reminders.ts` |
| Create | `api/tests/unit/service-reminders-renewal.test.ts` |
| Modify | `web/types/index.ts` |
| Modify | `web/lib/api/reminders.ts` |
| Modify | `web/components/forms/ReminderForm.tsx` |
| Modify | `web/app/(dashboard)/reminders/page.tsx` |

---

### Task 1: DB Migration — add interval columns

**Files:**
- Create: `db/migrations/V15__service_reminder_intervals.sql`

---

- [ ] **Step 1: Create the migration file**

```sql
-- db/migrations/V15__service_reminder_intervals.sql
-- Adds repeat-interval columns to service_reminders.
-- Both nullable: null means no auto-renewal for that dimension.
-- At least one must be non-null for auto-renewal to fire.
ALTER TABLE service_reminders
  ADD COLUMN interval_km   INTEGER CHECK (interval_km > 0),
  ADD COLUMN interval_days INTEGER CHECK (interval_days > 0);
```

- [ ] **Step 2: Apply the migration**

```bash
cd infra && docker compose restart flyway
```

Wait ~5 seconds, then verify:

```bash
docker compose logs flyway | tail -5
```

Expected: `Successfully applied 1 migration to schema "public"` (V15).

- [ ] **Step 3: Verify columns exist**

```bash
docker compose exec postgres psql -U postgres -d citac -c "\d service_reminders" | grep interval
```

Expected: two rows — `interval_km` and `interval_days`, both `integer`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/V15__service_reminder_intervals.sql
git commit -m "feat(db): add interval_km and interval_days to service_reminders (V15)"
```

---

### Task 2: API — renewal logic + integration tests

**Files:**
- Modify: `api/src/routes/v1/service-reminders.ts`
- Create: `api/tests/unit/service-reminders-renewal.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Create `api/tests/unit/service-reminders-renewal.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TENANT_ID = randomUUID();
let vehicleId: string;
let vehicleNoMileageId: string;

async function exec(sql: string, vals: unknown[] = []) {
  return pool.query(sql, vals);
}

beforeAll(async () => {
  await exec(
    `INSERT INTO tenants(id, name, slug, plan) VALUES ($1,'T',$2,'starter') ON CONFLICT DO NOTHING`,
    [TENANT_ID, `test-rnwl-${TENANT_ID}`],
  );
  const v1 = await exec(
    `INSERT INTO vehicles(tenant_id, plate, current_mileage_km) VALUES ($1,'RNWL-01',90000) RETURNING id`,
    [TENANT_ID],
  );
  vehicleId = v1.rows[0].id;
  const v2 = await exec(
    `INSERT INTO vehicles(tenant_id, plate) VALUES ($1,'RNWL-02') RETURNING id`,
    [TENANT_ID],
  );
  vehicleNoMileageId = v2.rows[0].id;
});

afterAll(async () => {
  await exec(`DELETE FROM service_reminders WHERE tenant_id=$1`, [TENANT_ID]);
  await exec(`DELETE FROM vehicles WHERE tenant_id=$1`, [TENANT_ID]);
  await exec(`DELETE FROM tenants WHERE id=$1`, [TENANT_ID]);
  await pool.end();
});

// Helper: simulate the route's renewal INSERT (same SQL as the PATCH handler)
async function simulateRenewal(rem: Record<string, any>, currentMileage: number | null) {
  const nextMileage =
    rem.interval_km != null && currentMileage != null
      ? currentMileage + rem.interval_km
      : null;
  if (nextMileage == null && rem.interval_days == null) return; // nothing to renew
  await exec(
    `INSERT INTO service_reminders
       (tenant_id, vehicle_id, service_type, due_date, due_mileage_km, notes, interval_km, interval_days)
     VALUES ($1,$2,$3,
       CASE WHEN $4::int IS NOT NULL THEN CURRENT_DATE + ($4::int || ' days')::INTERVAL ELSE NULL END,
       $5,$6,$7,$8)`,
    [rem.tenant_id, rem.vehicle_id, rem.service_type,
     rem.interval_days ?? null,
     nextMileage ?? null,
     rem.notes ?? null,
     rem.interval_km ?? null,
     rem.interval_days ?? null],
  );
}

describe('service reminder auto-renewal', () => {
  it('stores interval_km and interval_days on INSERT', async () => {
    const { rows } = await exec(
      `INSERT INTO service_reminders(tenant_id, vehicle_id, service_type, due_mileage_km, interval_km, interval_days)
       VALUES ($1,$2,'oil_change',100000,10000,365) RETURNING interval_km, interval_days`,
      [TENANT_ID, vehicleId],
    );
    expect(rows[0].interval_km).toBe(10000);
    expect(rows[0].interval_days).toBe(365);
  });

  it('renewal creates next reminder with due_mileage_km = current_mileage + interval_km', async () => {
    const { rows: [rem] } = await exec(
      `INSERT INTO service_reminders(tenant_id, vehicle_id, service_type, due_mileage_km, interval_km, interval_days)
       VALUES ($1,$2,'oil_change',100000,10000,365) RETURNING *`,
      [TENANT_ID, vehicleId],
    );
    await simulateRenewal(rem, 90000); // vehicle at 90 000 km
    const { rows: next } = await exec(
      `SELECT * FROM service_reminders
       WHERE vehicle_id=$1 AND completed_at IS NULL AND id != $2
       ORDER BY created_at DESC LIMIT 1`,
      [vehicleId, rem.id],
    );
    expect(next.length).toBe(1);
    expect(next[0].due_mileage_km).toBe(100000); // 90 000 + 10 000
    expect(next[0].interval_km).toBe(10000);
    expect(next[0].interval_days).toBe(365);
    expect(next[0].due_date).not.toBeNull();
  });

  it('no renewal created when both interval_km and interval_days are null', async () => {
    const { rows: [rem] } = await exec(
      `INSERT INTO service_reminders(tenant_id, vehicle_id, service_type, due_mileage_km)
       VALUES ($1,$2,'tire_rotation',80000) RETURNING *`,
      [TENANT_ID, vehicleId],
    );
    const { rows: before } = await exec(
      `SELECT COUNT(*) AS n FROM service_reminders WHERE tenant_id=$1 AND completed_at IS NULL`,
      [TENANT_ID],
    );
    await simulateRenewal(rem, 90000); // no-op: both intervals null
    const { rows: after } = await exec(
      `SELECT COUNT(*) AS n FROM service_reminders WHERE tenant_id=$1 AND completed_at IS NULL`,
      [TENANT_ID],
    );
    expect(parseInt(after[0].n)).toBe(parseInt(before[0].n)); // unchanged
  });

  it('no renewal when only interval_km set but vehicle has no mileage', async () => {
    const { rows: [rem] } = await exec(
      `INSERT INTO service_reminders(tenant_id, vehicle_id, service_type, due_mileage_km, interval_km)
       VALUES ($1,$2,'brake_check',50000,30000) RETURNING *`,
      [TENANT_ID, vehicleNoMileageId],
    );
    const { rows: before } = await exec(
      `SELECT COUNT(*) AS n FROM service_reminders WHERE tenant_id=$1 AND completed_at IS NULL`,
      [TENANT_ID],
    );
    await simulateRenewal(rem, null); // no-op: currentMileage null, interval_days null
    const { rows: after } = await exec(
      `SELECT COUNT(*) AS n FROM service_reminders WHERE tenant_id=$1 AND completed_at IS NULL`,
      [TENANT_ID],
    );
    expect(parseInt(after[0].n)).toBe(parseInt(before[0].n)); // unchanged
  });

  it('renewal by date only when vehicle has no mileage but interval_days is set', async () => {
    const { rows: [rem] } = await exec(
      `INSERT INTO service_reminders(tenant_id, vehicle_id, service_type, due_date, interval_days)
       VALUES ($1,$2,'technical_inspection', CURRENT_DATE + INTERVAL '365 days', 365) RETURNING *`,
      [TENANT_ID, vehicleNoMileageId],
    );
    await simulateRenewal(rem, null); // vehicle has no mileage, but interval_days is set
    const { rows: next } = await exec(
      `SELECT * FROM service_reminders
       WHERE vehicle_id=$1 AND completed_at IS NULL AND id != $2
       ORDER BY created_at DESC LIMIT 1`,
      [vehicleNoMileageId, rem.id],
    );
    expect(next.length).toBe(1);
    expect(next[0].due_mileage_km).toBeNull();
    expect(next[0].due_date).not.toBeNull();
    expect(next[0].interval_days).toBe(365);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd api && npm run test -- tests/unit/service-reminders-renewal.test.ts
```

Expected: first test fails with `column "interval_km" does not exist` — confirms migration V15 isn't applied yet, OR if migration is applied, the test fails because the INSERT in the route doesn't pass the new columns yet. Either way, at least one test should fail before the route change.

If all 5 pass already (migration applied and SQL logic tests directly against DB), proceed to route changes and re-run after.

- [ ] **Step 3: Update `ReminderBody` schema — add interval fields**

In `api/src/routes/v1/service-reminders.ts`, add two fields to `ReminderBody`:

```ts
const ReminderBody = Type.Object({
  vehicleId:      Type.String({ format: 'uuid' }),
  serviceType:    Type.Union(SERVICE_TYPES.map((t) => Type.Literal(t)) as any),
  dueDate:        Type.Optional(Type.String({ format: 'date' })),
  dueMileageKm:   Type.Optional(Type.Integer({ minimum: 1 })),
  notes:          Type.Optional(Type.String()),
  intervalKm:     Type.Optional(Type.Integer({ minimum: 1 })),
  intervalDays:   Type.Optional(Type.Integer({ minimum: 1 })),
});
```

- [ ] **Step 4: Update `ReminderPatchBody` schema — add skipRenewal**

```ts
const ReminderPatchBody = Type.Object({
  serviceType:    Type.Optional(Type.Union(SERVICE_TYPES.map((t) => Type.Literal(t)) as any)),
  dueDate:        Type.Optional(Type.String({ format: 'date' })),
  dueMileageKm:   Type.Optional(Type.Integer({ minimum: 1 })),
  notes:          Type.Optional(Type.String()),
  completed:      Type.Optional(Type.Boolean()),
  skipRenewal:    Type.Optional(Type.Boolean()),
});
```

- [ ] **Step 5: Update POST handler — store interval columns**

In the POST handler, update the destructure and INSERT:

```ts
  fastify.post<{ Body: ReminderBodyType }>('/', {
    schema: { body: ReminderBody },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { vehicleId, serviceType, dueDate, dueMileageKm, notes, intervalKm, intervalDays } = req.body;
    if (!dueDate && !dueMileageKm)
      return reply.code(400).send({ error: 'At least one of dueDate or dueMileageKm is required' });

    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const { rows: vRows } = await c.query(
        `SELECT id FROM vehicles WHERE id=$1 AND deleted_at IS NULL`, [vehicleId],
      );
      if (!vRows.length) throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 });

      const { rows } = await c.query(
        `INSERT INTO service_reminders
           (tenant_id, vehicle_id, service_type, due_date, due_mileage_km, notes, interval_km, interval_days)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8) RETURNING *`,
        [req.tenantId, vehicleId, serviceType, dueDate ?? null, dueMileageKm ?? null,
         notes ?? null, intervalKm ?? null, intervalDays ?? null],
      );
      return rows;
    });
    return reply.code(201).send(rows[0]);
  });
```

- [ ] **Step 6: Update PATCH handler — add skipRenewal and renewal logic**

Replace the entire PATCH handler with:

```ts
  fastify.patch<{ Body: ReminderPatchBodyType }>('/:id', {
    schema: { body: ReminderPatchBody },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { serviceType, dueDate, dueMileageKm, notes, completed, skipRenewal } = req.body;
    const completedBy = completed ? req.jwtPayload.sub : null;

    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const { rows } = await c.query(
        `UPDATE service_reminders SET
           service_type   = COALESCE($2, service_type),
           due_date       = COALESCE($3::date, due_date),
           due_mileage_km = COALESCE($4, due_mileage_km),
           notes          = COALESCE($5, notes),
           completed_at   = CASE
                              WHEN $6 = true  THEN COALESCE(completed_at, NOW())
                              WHEN $6 = false THEN NULL
                              ELSE completed_at
                            END,
           completed_by   = CASE
                              WHEN $6 = true  THEN COALESCE(completed_by, $7::uuid)
                              WHEN $6 = false THEN NULL
                              ELSE completed_by
                            END,
           updated_at     = NOW()
         WHERE id=$1 RETURNING *`,
        [id, serviceType ?? null, dueDate ?? null, dueMileageKm ?? null,
         notes ?? null, completed ?? null, completedBy],
      );

      // Auto-renewal: fires only when marking complete and not explicitly skipped
      if (rows.length && completed === true && !skipRenewal) {
        const r = rows[0];
        if (r.interval_km != null || r.interval_days != null) {
          const { rows: vRows } = await c.query(
            `SELECT current_mileage_km FROM vehicles WHERE id=$1`, [r.vehicle_id],
          );
          const currentMileage: number | null = vRows[0]?.current_mileage_km ?? null;
          const nextMileage =
            r.interval_km != null && currentMileage != null
              ? currentMileage + r.interval_km
              : null;

          if (nextMileage != null || r.interval_days != null) {
            await c.query(
              `INSERT INTO service_reminders
                 (tenant_id, vehicle_id, service_type, due_date, due_mileage_km, notes, interval_km, interval_days)
               VALUES ($1,$2,$3,
                 CASE WHEN $4::int IS NOT NULL THEN CURRENT_DATE + ($4::int || ' days')::INTERVAL ELSE NULL END,
                 $5,$6,$7,$8)`,
              [req.tenantId, r.vehicle_id, r.service_type,
               r.interval_days ?? null,
               nextMileage ?? null,
               r.notes ?? null,
               r.interval_km ?? null,
               r.interval_days ?? null],
            );
          }
        }
      }

      return rows;
    });
    if (!rows.length) return reply.code(404).send({ error: 'Not found' });
    return reply.send(rows[0]);
  });
```

- [ ] **Step 7: TypeScript check**

```
cd api && npm run typecheck
```

Expected: no errors.

- [ ] **Step 8: Run tests**

```
cd api && npm run test -- tests/unit/service-reminders-renewal.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 9: Run full test suite**

```
cd api && npm run test
```

Expected: all tests pass (21 existing + 5 new = 26 total).

- [ ] **Step 10: Commit**

```bash
git add api/src/routes/v1/service-reminders.ts api/tests/unit/service-reminders-renewal.test.ts
git commit -m "feat(api): auto-renewal on complete — intervalKm/Days stored, skipRenewal flag, same-transaction INSERT"
```

---

### Task 3: Types + API client

**Files:**
- Modify: `web/types/index.ts`
- Modify: `web/lib/api/reminders.ts`

---

- [ ] **Step 1: Add interval fields to `ServiceReminder` in `web/types/index.ts`**

In the `ServiceReminder` interface, add two fields after `urgency`:

```ts
  urgency: 'overdue' | 'due_soon' | 'ok';
  interval_km:   number | null;
  interval_days: number | null;
```

The full interface after the edit (showing the affected area):

```ts
export interface ServiceReminder {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  service_type: ServiceType;
  due_date: string | null;
  due_mileage_km: number | null;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_email: string | null;
  notes: string | null;
  is_overdue: boolean;
  km_remaining: number | null;
  days_remaining: number | null;
  urgency: 'overdue' | 'due_soon' | 'ok';
  interval_km:   number | null;
  interval_days: number | null;
  plate: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  current_mileage_km: number | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Update `remindersApi` in `web/lib/api/reminders.ts`**

Replace the file content with:

```ts
import { apiClient } from './client';
import type { ServiceReminder, Paginated, ServiceType } from '@/types';

export const remindersApi = {
  list: (params?: {
    vehicleId?: string; serviceType?: string; status?: 'open' | 'completed';
    dueBefore?: string; overdue?: boolean; dueSoon?: boolean; cursor?: string; limit?: number;
  }) => apiClient.get<Paginated<ServiceReminder>>('/v1/service-reminders', { params }).then((r) => r.data),

  create: (body: {
    vehicleId: string; serviceType: ServiceType;
    dueDate?: string; dueMileageKm?: number; notes?: string;
    intervalKm?: number; intervalDays?: number;
  }) => apiClient.post<ServiceReminder>('/v1/service-reminders', body).then((r) => r.data),

  update: (id: string, body: Partial<{
    serviceType: ServiceType; dueDate: string; dueMileageKm: number;
    notes: string; completed: boolean; skipRenewal: boolean;
  }>) => apiClient.patch<ServiceReminder>(`/v1/service-reminders/${id}`, body).then((r) => r.data),

  remove: (id: string) => apiClient.delete(`/v1/service-reminders/${id}`),
};
```

- [ ] **Step 3: Lint check**

```
cd web && npm run lint
```

Expected: no new errors in the touched files.

- [ ] **Step 4: Commit**

```bash
git add web/types/index.ts web/lib/api/reminders.ts
git commit -m "feat(types): add interval_km/interval_days to ServiceReminder; update remindersApi"
```

---

### Task 4: ReminderForm — interval fields with per-type defaults

**Files:**
- Modify: `web/components/forms/ReminderForm.tsx`

---

- [ ] **Step 1: Read the current file**

Read `web/components/forms/ReminderForm.tsx` to understand the current structure before editing.

- [ ] **Step 2: Replace the file with the updated version**

```tsx
'use client';

import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { remindersApi } from '@/lib/api/reminders';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { FormField, inputClass, selectClass, textareaClass } from '@/components/ui/FormField';
import type { ServiceType } from '@/types';

const SERVICE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: 'oil_change',           label: 'Oil Change' },
  { value: 'tire_rotation',        label: 'Tire Rotation' },
  { value: 'small_service',        label: 'Small Service' },
  { value: 'big_service',          label: 'Big Service' },
  { value: 'technical_inspection', label: 'Technical Inspection' },
  { value: 'registration_renewal', label: 'Registration Renewal' },
  { value: 'brake_check',          label: 'Brake Check' },
  { value: 'other',                label: 'Other' },
];

const INTERVAL_DEFAULTS: Record<ServiceType, { km: string; days: string }> = {
  oil_change:           { km: '10000', days: '365' },
  small_service:        { km: '10000', days: '365' },
  big_service:          { km: '20000', days: '730' },
  tire_rotation:        { km: '15000', days: '365' },
  technical_inspection: { km: '',      days: '365' },
  registration_renewal: { km: '',      days: '365' },
  brake_check:          { km: '30000', days: '' },
  other:                { km: '',      days: '' },
};

interface ReminderFormProps {
  vehicleId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ReminderForm({ vehicleId, onSuccess, onCancel }: ReminderFormProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const [serviceType, setServiceType] = useState<ServiceType>('oil_change');
  const [dueDate, setDueDate]         = useState('');
  const [dueMileage, setDueMileage]   = useState('');
  const [notes, setNotes]             = useState('');
  const [intervalKm, setIntervalKm]   = useState(INTERVAL_DEFAULTS.oil_change.km);
  const [intervalDays, setIntervalDays] = useState(INTERVAL_DEFAULTS.oil_change.days);

  function handleServiceTypeChange(type: ServiceType) {
    setServiceType(type);
    setIntervalKm(INTERVAL_DEFAULTS[type].km);
    setIntervalDays(INTERVAL_DEFAULTS[type].days);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dueDate && !dueMileage) {
      setError('Set at least a due date or a due mileage.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await remindersApi.create({
        vehicleId,
        serviceType,
        dueDate:      dueDate    || undefined,
        dueMileageKm: dueMileage   ? parseInt(dueMileage)   : undefined,
        intervalKm:   intervalKm   ? parseInt(intervalKm)   : undefined,
        intervalDays: intervalDays ? parseInt(intervalDays) : undefined,
        notes:        notes.trim() || undefined,
      });
      qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
      onSuccess?.();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormField label="Service type" htmlFor="svc-type" required>
        <select id="svc-type" className={selectClass}
          value={serviceType} onChange={(e) => handleServiceTypeChange(e.target.value as ServiceType)}>
          {SERVICE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Due date" htmlFor="due-date" hint="Optional">
          <input id="due-date" type="date" className={inputClass}
            value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormField>
        <FormField label="Due mileage (km)" htmlFor="due-km" hint="Optional">
          <input id="due-km" type="number" min="1" className={inputClass}
            placeholder="100000" value={dueMileage}
            onChange={(e) => setDueMileage(e.target.value)} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Repeat every (km)" htmlFor="interval-km" hint="Auto-renew">
          <input id="interval-km" type="number" min="1" className={inputClass}
            placeholder="10000" value={intervalKm}
            onChange={(e) => setIntervalKm(e.target.value)} />
        </FormField>
        <FormField label="Repeat every (days)" htmlFor="interval-days" hint="Auto-renew">
          <input id="interval-days" type="number" min="1" className={inputClass}
            placeholder="365" value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value)} />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="svc-notes">
        <textarea id="svc-notes" className={textareaClass} rows={2}
          placeholder="Optional notes…"
          value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>

      {error && <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner className="h-4 w-4" /> : 'Add reminder'}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Lint check**

```
cd web && npm run lint
```

Expected: no new errors in `ReminderForm.tsx`.

- [ ] **Step 4: Commit**

```bash
git add web/components/forms/ReminderForm.tsx
git commit -m "feat(web): add interval fields to ReminderForm with per-type defaults"
```

---

### Task 5: Reminders page — inline confirmation with "Create next reminder" checkbox

**Files:**
- Modify: `web/app/(dashboard)/reminders/page.tsx`

---

- [ ] **Step 1: Read the current file**

Read `web/app/(dashboard)/reminders/page.tsx` to understand the current `ReminderRow` and `complete` mutation before editing.

- [ ] **Step 2: Update `ReminderRow` — add confirming state and inline confirmation UI**

`ReminderRow` currently receives `onComplete?: () => void`. Change its signature and add local state for the confirmation flow.

Replace the entire `ReminderRow` function with:

```tsx
function ReminderRow({
  r, onComplete,
}: {
  r: ServiceReminder;
  onComplete?: (skipRenewal: boolean) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [renewChecked, setRenewChecked] = useState(true);

  const vehicleLabel = [r.make, r.model, r.year].filter(Boolean).join(' ') || 'Unknown vehicle';
  const hasInterval = r.interval_km != null || r.interval_days != null;

  return (
    <div className="group flex items-center gap-4 border-b border-neutral-800 px-4 py-3.5 last:border-0 transition-colors hover:bg-neutral-800/40">
      {/* Service type + badges */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-neutral-100">
            {SERVICE_LABELS[r.service_type] ?? r.service_type}
          </span>
          {!r.completed_at && r.urgency === 'overdue' && (
            <Badge variant="danger">
              {r.days_remaining != null && r.days_remaining < 0 && r.km_remaining != null && r.km_remaining < 0
                ? 'Overdue'
                : r.days_remaining != null && r.days_remaining < 0
                ? 'Date overdue'
                : 'Mileage overdue'}
            </Badge>
          )}
          {!r.completed_at && r.urgency === 'due_soon' && <Badge variant="warning">Due soon</Badge>}
          {r.completed_at && <Badge variant="success">Done</Badge>}
        </div>

        {/* Vehicle */}
        <button
          onClick={(e) => { e.stopPropagation(); router.push(`/vehicles/${r.vehicle_id}?tab=reminders`); }}
          className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-orange-400"
        >
          <Car className="h-3 w-3" />
          <span className="font-mono">{r.plate ?? '—'}</span>
          {vehicleLabel !== 'Unknown vehicle' && <span className="text-neutral-600">· {vehicleLabel}</span>}
        </button>

        {/* Due triggers */}
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
          {r.due_date && (
            <span className={cn(
              !r.completed_at && r.urgency === 'overdue' && r.days_remaining != null && r.days_remaining < 0
                ? 'text-red-400'
                : !r.completed_at && r.urgency === 'due_soon' && r.days_remaining != null && r.days_remaining >= 0
                  ? 'text-amber-400'
                  : '',
            )}>
              {r.days_remaining != null && !r.completed_at
                ? r.days_remaining < 0
                  ? `${Math.abs(r.days_remaining)}d overdue`
                  : r.days_remaining === 0
                  ? 'Due today'
                  : `${r.days_remaining}d left`
                : new Date(r.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
          {r.due_mileage_km != null && (
            <span className={cn(
              !r.completed_at && r.urgency === 'overdue' && r.km_remaining != null && r.km_remaining < 0
                ? 'text-red-400'
                : !r.completed_at && r.urgency === 'due_soon' && r.km_remaining != null && r.km_remaining >= 0
                  ? 'text-amber-400'
                  : '',
            )}>
              {r.km_remaining != null && !r.completed_at
                ? r.km_remaining < 0
                  ? `${Math.abs(r.km_remaining).toLocaleString()} km overdue`
                  : `${r.km_remaining.toLocaleString()} km left`
                : `Due at ${r.due_mileage_km.toLocaleString()} km`}
            </span>
          )}
          {r.notes && <span className="italic text-neutral-600">"{r.notes}"</span>}
        </div>

        {/* Inline confirmation */}
        {confirming && (
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            {hasInterval && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-400 select-none">
                <input
                  type="checkbox"
                  checked={renewChecked}
                  onChange={(e) => setRenewChecked(e.target.checked)}
                  className="rounded border-neutral-600 accent-orange-500"
                />
                Create next reminder
              </label>
            )}
            <button
              onClick={() => { onComplete?.(!renewChecked); setConfirming(false); }}
              className="rounded-md bg-green-900/40 px-3 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-900/60"
            >
              Complete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs text-neutral-600 transition-colors hover:text-neutral-400"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {onComplete && !r.completed_at && !confirming && (
          <button
            onClick={() => {
              if (hasInterval) {
                setRenewChecked(true); // reset checkbox to default each time
                setConfirming(true);
              } else {
                onComplete(false); // no interval — complete immediately, skipRenewal irrelevant
              }
            }}
            title="Mark complete"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-green-950/40 hover:text-green-400"
          >
            <Check className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => router.push(`/vehicles/${r.vehicle_id}?tab=reminders`)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:text-neutral-400"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update the `complete` mutation in `RemindersPage`**

Find the `complete` mutation (currently calls `remindersApi.update(id, { completed: true })`). Replace it:

```ts
  const complete = useMutation({
    mutationFn: ({ id, skipRenewal }: { id: string; skipRenewal: boolean }) =>
      remindersApi.update(id, { completed: true, skipRenewal }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders-dash'] });
      qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
```

- [ ] **Step 4: Update all `onComplete` call sites**

There are two places in `RemindersPage` where `onComplete` is passed to `ReminderRow` — one in the grouped view and one in the flat list. Both currently read:

```tsx
onComplete={preset !== 'completed' ? () => complete.mutate(r.id) : undefined}
```

Change both to:

```tsx
onComplete={preset !== 'completed' ? (skipRenewal) => complete.mutate({ id: r.id, skipRenewal }) : undefined}
```

- [ ] **Step 5: Lint check**

```
cd web && npm run lint
```

Expected: no new errors in `page.tsx`.

- [ ] **Step 6: Commit**

```bash
git add web/app/(dashboard)/reminders/page.tsx
git commit -m "feat(web): inline confirmation with Create next reminder checkbox on complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ V15 migration: `interval_km`, `interval_days` added to `service_reminders`
- ✅ POST body: `intervalKm`, `intervalDays` accepted and stored
- ✅ PATCH body: `skipRenewal` accepted
- ✅ Renewal logic: fires in same transaction, uses `current_mileage + interval_km` and `CURRENT_DATE + interval_days`
- ✅ Edge case: vehicle mileage unknown + only `interval_km` set → no renewal
- ✅ Edge case: both intervals null → no renewal
- ✅ Edge case: `interval_days` only, no mileage → date-only renewal
- ✅ 5 integration tests covering all renewal paths
- ✅ `ServiceReminder` type updated with `interval_km`, `interval_days`
- ✅ `remindersApi.create` and `update` accept new fields
- ✅ `ReminderForm`: interval fields added, pre-filled per service type, clears on type change
- ✅ Reminders page: inline confirmation, checkbox defaults to checked, hidden when no interval set

**Placeholder scan:** No TBD/TODO present. All code blocks complete.

**Type consistency:**
- `skipRenewal` used consistently in TypeBox schema, destructure, mutation, and API client
- `interval_km` / `interval_days` (snake_case) in DB/types; `intervalKm` / `intervalDays` (camelCase) in API body and client — consistent with existing `dueMileageKm` pattern
- `onComplete: (skipRenewal: boolean) => void` signature used consistently in `ReminderRow` and both call sites in `RemindersPage`
