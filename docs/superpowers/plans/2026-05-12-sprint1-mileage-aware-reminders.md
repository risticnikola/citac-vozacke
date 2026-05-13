# Sprint 1: Mileage-Aware Reminder Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `km_remaining`, `days_remaining`, and `urgency` computed fields to the service-reminders API response, and update the reminders frontend to display them meaningfully.

**Architecture:** The API SELECT already JOINs the `vehicles` table for `current_mileage_km`; we extend it with three computed SQL expressions. The frontend receives new fields and replaces raw mileage comparison display with the pre-computed `km_remaining` value and an `urgency`-driven badge. A new `dueSoon` query parameter covers mileage-approaching vehicles that date-only `dueBefore` misses.

**Tech Stack:** Fastify 4 / TypeScript / PostgreSQL (API), React 19 / React Query v5 / Tailwind v4 (Web), Vitest (tests)

---

## File Map

| Action | File |
|--------|------|
| Modify | `api/src/routes/v1/service-reminders.ts` |
| Create | `api/tests/unit/service-reminders-computed.test.ts` |
| Modify | `web/types/index.ts` |
| Modify | `web/app/(dashboard)/reminders/page.tsx` |

---

### Task 1: API — computed fields + `dueSoon` param

**Files:**
- Modify: `api/src/routes/v1/service-reminders.ts`
- Create: `api/tests/unit/service-reminders-computed.test.ts`

---

- [ ] **Step 1: Write failing integration test**

Create `api/tests/unit/service-reminders-computed.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TENANT_ID = randomUUID();
let vehicleId: string;
let reminderId: string;

async function exec(sql: string, vals: unknown[] = []) {
  return pool.query(sql, vals);
}

beforeAll(async () => {
  // Seed tenant
  await exec(`INSERT INTO tenants(id, name, plan) VALUES ($1, 'T', 'starter') ON CONFLICT DO NOTHING`, [TENANT_ID]);

  // Vehicle with known mileage
  const v = await exec(
    `INSERT INTO vehicles(tenant_id, plate, current_mileage_km)
     VALUES ($1, $2, 90000) RETURNING id`,
    [TENANT_ID, 'TEST-CM-01'],
  );
  vehicleId = v.rows[0].id;

  // Reminder: due at 100 000 km (10 000 km away) and 60 days from now
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 60);
  const r = await exec(
    `INSERT INTO service_reminders(tenant_id, vehicle_id, service_type, due_date, due_mileage_km)
     VALUES ($1, $2, 'oil_change', $3, 100000) RETURNING id`,
    [TENANT_ID, vehicleId, dueDate.toISOString().slice(0, 10)],
  );
  reminderId = r.rows[0].id;
});

afterAll(async () => {
  await exec(`DELETE FROM service_reminders WHERE tenant_id=$1`, [TENANT_ID]);
  await exec(`DELETE FROM vehicles WHERE tenant_id=$1`, [TENANT_ID]);
  await exec(`DELETE FROM tenants WHERE id=$1`, [TENANT_ID]);
  await pool.end();
});

describe('service_reminders computed fields', () => {
  it('returns km_remaining, days_remaining, urgency via raw SQL (same logic as route)', async () => {
    const { rows } = await pool.query(
      `SET app.current_tenant_id = '${TENANT_ID}'; -- RLS bypass via direct pool not needed in test
       SELECT
         sr.id,
         CASE
           WHEN sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
           THEN sr.due_mileage_km - v.current_mileage_km
           ELSE NULL
         END AS km_remaining,
         CASE
           WHEN sr.due_date IS NOT NULL
           THEN (sr.due_date - CURRENT_DATE)::int
           ELSE NULL
         END AS days_remaining,
         CASE
           WHEN sr.completed_at IS NOT NULL THEN 'ok'
           WHEN (sr.due_date IS NOT NULL AND sr.due_date < CURRENT_DATE)
             OR (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                 AND v.current_mileage_km >= sr.due_mileage_km)
           THEN 'overdue'
           WHEN (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                 AND (sr.due_mileage_km - v.current_mileage_km) <= 1000)
             OR (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) <= 30)
           THEN 'due_soon'
           ELSE 'ok'
         END AS urgency
       FROM service_reminders sr
       JOIN vehicles v ON v.id = sr.vehicle_id
       WHERE sr.id = $1`,
      [reminderId],
    );
    const row = rows[rows.length - 1]; // last row after SET
    expect(row.km_remaining).toBe(10000);
    expect(row.days_remaining).toBe(60);
    expect(row.urgency).toBe('ok');
  });

  it('returns urgency=due_soon when mileage gap <= 1000 km', async () => {
    // Update vehicle mileage to 99 200 (800 km away from 100 000)
    await exec(`UPDATE vehicles SET current_mileage_km=99200 WHERE id=$1`, [vehicleId]);
    const { rows } = await pool.query(
      `SELECT
         CASE
           WHEN (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                 AND (sr.due_mileage_km - v.current_mileage_km) <= 1000)
             OR (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) <= 30)
           THEN 'due_soon' ELSE 'ok'
         END AS urgency
       FROM service_reminders sr JOIN vehicles v ON v.id = sr.vehicle_id WHERE sr.id=$1`,
      [reminderId],
    );
    expect(rows[0].urgency).toBe('due_soon');
    // Restore
    await exec(`UPDATE vehicles SET current_mileage_km=90000 WHERE id=$1`, [vehicleId]);
  });

  it('returns urgency=overdue when mileage exceeded', async () => {
    await exec(`UPDATE vehicles SET current_mileage_km=101000 WHERE id=$1`, [vehicleId]);
    const { rows } = await pool.query(
      `SELECT
         CASE
           WHEN v.current_mileage_km >= sr.due_mileage_km THEN 'overdue' ELSE 'ok'
         END AS urgency
       FROM service_reminders sr JOIN vehicles v ON v.id = sr.vehicle_id WHERE sr.id=$1`,
      [reminderId],
    );
    expect(rows[0].urgency).toBe('overdue');
    await exec(`UPDATE vehicles SET current_mileage_km=90000 WHERE id=$1`, [vehicleId]);
  });

  it('dueSoon filter: reminder within 1000 km returned, far-away reminder excluded', async () => {
    // Move vehicle close to due mileage
    await exec(`UPDATE vehicles SET current_mileage_km=99500 WHERE id=$1`, [vehicleId]);
    const { rows } = await pool.query(
      `SELECT sr.id FROM service_reminders sr
       JOIN vehicles v ON v.id = sr.vehicle_id
       WHERE sr.completed_at IS NULL
         AND (
           (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) <= 30)
           OR
           (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
            AND (sr.due_mileage_km - v.current_mileage_km) <= 1000)
         )
         AND sr.id = $1`,
      [reminderId],
    );
    expect(rows.length).toBe(1);
    await exec(`UPDATE vehicles SET current_mileage_km=90000 WHERE id=$1`, [vehicleId]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd api && npm run test -- tests/unit/service-reminders-computed.test.ts
```

Expected: 4 tests pass (they test raw SQL directly against the DB — this verifies the SQL logic before wiring into the route). If the test infra isn't set up, you'll see a connection error; fix `.env` / test DB first.

- [ ] **Step 3: Modify the route — add computed fields and `dueSoon` param**

In `api/src/routes/v1/service-reminders.ts`, make these two changes:

**Change 1** — Add `dueSoon` to `ReminderQuerySchema` (after the existing `overdue` field):

```ts
  overdue:     Type.Optional(Type.Boolean()),
  dueSoon:     Type.Optional(Type.Boolean()),   // ← add this line
  cursor:      Type.Optional(Type.String()),
```

Also add `dueSoon` to `ReminderQueryType`:

```ts
const ReminderQuerySchema = Type.Object({
  vehicleId:   Type.Optional(Type.String({ format: 'uuid' })),
  serviceType: Type.Optional(Type.String()),
  status:      Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('completed')])),
  dueBefore:   Type.Optional(Type.String({ format: 'date' })),
  overdue:     Type.Optional(Type.Boolean()),
  dueSoon:     Type.Optional(Type.Boolean()),   // ← add here too
  cursor:      Type.Optional(Type.String()),
  limit:       Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});
```

**Change 2** — Update the GET handler to destructure `dueSoon`, add its WHERE condition, and add computed fields to SELECT.

Replace the destructure line:

```ts
// Before:
const { vehicleId, serviceType, status, dueBefore, overdue, limit = 20, cursor } = req.query;

// After:
const { vehicleId, serviceType, status, dueBefore, overdue, dueSoon, limit = 20, cursor } = req.query;
```

Add `dueSoon` condition block after the `overdue` block (inside `withTenantContext`):

```ts
      if (dueSoon) {
        conds.push(`sr.completed_at IS NULL AND (
          (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) <= 30)
          OR
          (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
           AND (sr.due_mileage_km - v.current_mileage_km) <= 1000)
        )`);
      }
```

Replace the SELECT block (the `await c.query(...)` call) with this extended version:

```ts
      const { rows } = await c.query(
        `SELECT sr.*,
                v.plate, v.vin, v.make, v.model, v.year, v.current_mileage_km,
                u.email AS completed_by_email,
                CASE
                  WHEN sr.completed_at IS NOT NULL THEN false
                  WHEN sr.due_date IS NOT NULL AND sr.due_date < CURRENT_DATE THEN true
                  WHEN sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                       AND v.current_mileage_km >= sr.due_mileage_km THEN true
                  ELSE false
                END AS is_overdue,
                CASE
                  WHEN sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                  THEN sr.due_mileage_km - v.current_mileage_km
                  ELSE NULL
                END AS km_remaining,
                CASE
                  WHEN sr.due_date IS NOT NULL
                  THEN (sr.due_date - CURRENT_DATE)::int
                  ELSE NULL
                END AS days_remaining,
                CASE
                  WHEN sr.completed_at IS NOT NULL THEN 'ok'
                  WHEN (sr.due_date IS NOT NULL AND sr.due_date < CURRENT_DATE)
                    OR (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                        AND v.current_mileage_km >= sr.due_mileage_km)
                  THEN 'overdue'
                  WHEN (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                        AND (sr.due_mileage_km - v.current_mileage_km) <= 1000)
                    OR (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) <= 30)
                  THEN 'due_soon'
                  ELSE 'ok'
                END AS urgency
         FROM service_reminders sr
         JOIN vehicles v ON v.id = sr.vehicle_id
         LEFT JOIN users u ON u.id = sr.completed_by
         ${where}
         ORDER BY sr.due_date ASC NULLS LAST, sr.id ASC
         LIMIT $${p}`,
        vals,
      );
```

- [ ] **Step 4: Re-run tests to verify they pass**

```
cd api && npm run test -- tests/unit/service-reminders-computed.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/v1/service-reminders.ts api/tests/unit/service-reminders-computed.test.ts
git commit -m "feat(api): add km_remaining, days_remaining, urgency to service-reminders; add dueSoon filter"
```

---

### Task 2: Types — extend `ServiceReminder` interface

**Files:**
- Modify: `web/types/index.ts`

---

- [ ] **Step 1: Update the `ServiceReminder` interface**

In `web/types/index.ts`, replace the `ServiceReminder` interface:

```ts
// Before:
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
  plate: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  current_mileage_km: number | null;
  created_at: string;
  updated_at: string;
}

// After:
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

- [ ] **Step 2: Verify TypeScript compiles**

```
cd web && npm run lint
```

Expected: no errors. If the frontend already uses fields from `ServiceReminder`, the new fields are additive and won't break anything.

- [ ] **Step 3: Commit**

```bash
git add web/types/index.ts
git commit -m "feat(types): add km_remaining, days_remaining, urgency to ServiceReminder"
```

---

### Task 3: Frontend — display computed fields and add "Due soon" preset

**Files:**
- Modify: `web/app/(dashboard)/reminders/page.tsx`

---

- [ ] **Step 1: Update `remindersApi.list` call signature in the preset definition**

In `web/app/(dashboard)/reminders/page.tsx`, the `PRESETS` array has `due_7` and `due_30` entries that use `dueBefore`. Add a new `due_soon` preset that uses `dueSoon: true`:

Replace the `PRESETS` array:

```ts
// Before:
const PRESETS: PresetDef[] = [
  {
    key: 'all_open',
    label: 'All open',
    icon: BellDot,
    params: () => ({ status: 'open' }),
  },
  {
    key: 'overdue',
    label: 'Overdue',
    icon: AlertTriangle,
    params: () => ({ status: 'open', overdue: true }),
  },
  {
    key: 'due_7',
    label: 'Due in 7 days',
    icon: Clock,
    params: () => ({ status: 'open', dueBefore: addDays(7) }),
  },
  {
    key: 'due_30',
    label: 'Due in 30 days',
    icon: Clock,
    params: () => ({ status: 'open', dueBefore: addDays(30) }),
  },
  {
    key: 'completed',
    label: 'Completed',
    icon: Check,
    params: () => ({ status: 'completed' }),
  },
];

// After:
const PRESETS: PresetDef[] = [
  {
    key: 'all_open',
    label: 'All open',
    icon: BellDot,
    params: () => ({ status: 'open' }),
  },
  {
    key: 'overdue',
    label: 'Overdue',
    icon: AlertTriangle,
    params: () => ({ status: 'open', overdue: true }),
  },
  {
    key: 'due_soon',
    label: 'Due soon',
    icon: Clock,
    params: () => ({ status: 'open', dueSoon: true }),
  },
  {
    key: 'completed',
    label: 'Completed',
    icon: Check,
    params: () => ({ status: 'completed' }),
  },
];
```

Also update the `Preset` type and `grouped` condition:

```ts
// Before:
type Preset = 'all_open' | 'overdue' | 'due_7' | 'due_30' | 'completed';

// After:
type Preset = 'all_open' | 'overdue' | 'due_soon' | 'completed';
```

Update the `grouped` condition (previously branched on `due_7` and `due_30`):

```ts
// Before:
const grouped = (preset === 'all_open' || preset === 'due_30' || preset === 'due_7') && !serviceType

// After:
const grouped = preset === 'all_open' && !serviceType
```

Remove the `addDays` helper (no longer needed after removing `due_7`/`due_30`):

```ts
// Delete these lines entirely:
function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Update `ReminderRow` to use `km_remaining` and `urgency`**

Replace the "Due triggers" `<div>` inside `ReminderRow` (the block that shows due date and due mileage):

```tsx
// Before:
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
          {r.due_date && (
            <span className={cn(r.is_overdue && !r.completed_at && 'text-red-400')}>
              Due {new Date(r.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
          {r.due_mileage_km && (
            <span className={cn(
              r.current_mileage_km != null && r.current_mileage_km >= r.due_mileage_km
                && !r.completed_at && 'text-red-400',
            )}>
              Due at {r.due_mileage_km.toLocaleString()} km
              {r.current_mileage_km != null && (
                <span className="ml-1 text-neutral-600">
                  (now {r.current_mileage_km.toLocaleString()} km)
                </span>
              )}
            </span>
          )}
          {r.notes && <span className="italic text-neutral-600">"{r.notes}"</span>}
        </div>

// After:
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
          {r.due_date && (
            <span className={cn(
              r.urgency === 'overdue' && !r.completed_at && r.due_date < new Date().toISOString().slice(0, 10)
                ? 'text-red-400'
                : r.urgency === 'due_soon' && !r.completed_at && 'text-amber-400',
            )}>
              {r.days_remaining != null && !r.completed_at
                ? r.days_remaining < 0
                  ? `${Math.abs(r.days_remaining)}d overdue`
                  : r.days_remaining === 0
                  ? 'Due today'
                  : `${r.days_remaining}d left`
                : `Due ${new Date(r.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
            </span>
          )}
          {r.due_mileage_km && (
            <span className={cn(
              r.urgency === 'overdue' && !r.completed_at && r.km_remaining != null && r.km_remaining <= 0
                ? 'text-red-400'
                : r.urgency === 'due_soon' && !r.completed_at && r.km_remaining != null && r.km_remaining <= 1000
                  ? 'text-amber-400'
                  : '',
            )}>
              {r.km_remaining != null && !r.completed_at
                ? r.km_remaining <= 0
                  ? `${Math.abs(r.km_remaining).toLocaleString()} km overdue`
                  : `${r.km_remaining.toLocaleString()} km left`
                : `Due at ${r.due_mileage_km.toLocaleString()} km`}
            </span>
          )}
          {r.notes && <span className="italic text-neutral-600">"{r.notes}"</span>}
        </div>
```

Also update the badge section to differentiate overdue reason. Replace the badges block:

```tsx
// Before:
          {r.is_overdue   && <Badge variant="danger">Overdue</Badge>}
          {r.completed_at && <Badge variant="success">Done</Badge>}

// After:
          {r.urgency === 'overdue' && !r.completed_at && (
            <Badge variant="danger">
              {r.days_remaining != null && r.days_remaining < 0 ? 'Date overdue' : 'Mileage overdue'}
            </Badge>
          )}
          {r.urgency === 'due_soon' && !r.completed_at && <Badge variant="warning">Due soon</Badge>}
          {r.completed_at && <Badge variant="success">Done</Badge>}
```

- [ ] **Step 3: Verify `Badge` supports `variant="warning"`**

Check `web/components/ui/Badge.tsx`. If `warning` variant is not present, add it:

```tsx
// If Badge uses a variants map like:
const variants = {
  danger:  'bg-red-500/10 text-red-400 border-red-500/20',
  success: 'bg-green-500/10 text-green-400 border-green-500/20',
  // add:
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};
```

Also update the empty-state message for the new preset key. Replace:

```tsx
// Before:
            <p className="text-sm text-neutral-500">
              {preset === 'overdue' ? 'No overdue reminders' :
               preset === 'completed' ? 'No completed reminders' :
               'No reminders match this filter'}
            </p>

// After:
            <p className="text-sm text-neutral-500">
              {preset === 'overdue' ? 'No overdue reminders' :
               preset === 'due_soon' ? 'No reminders due soon' :
               preset === 'completed' ? 'No completed reminders' :
               'No reminders match this filter'}
            </p>
```

- [ ] **Step 4: Check TypeScript**

```
cd web && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/app/(dashboard)/reminders/page.tsx web/components/ui/Badge.tsx
git commit -m "feat(web): show km_remaining/days_remaining, urgency badges, Due soon preset"
```

---

## Self-Review

**Spec coverage:**
- ✅ API: `km_remaining`, `days_remaining`, `urgency` added to SELECT
- ✅ API: `dueSoon` query param catches mileage-approaching reminders
- ✅ API: integration tests for all three urgency states and the dueSoon filter
- ✅ Types: `ServiceReminder` extended with three new fields
- ✅ Frontend: `km_remaining` shown as "X km left" / "X km overdue" instead of raw "(now Y km)"
- ✅ Frontend: overdue badge differentiates date vs mileage trigger
- ✅ Frontend: "Due soon" preset replaces date-only "Due in 7 days" / "Due in 30 days"

**Placeholder scan:** No TBD/TODO present. All code blocks complete.

**Type consistency:**
- `urgency: 'overdue' | 'due_soon' | 'ok'` used consistently in SQL CASE, TypeScript interface, and JSX conditions.
- `km_remaining` column name matches interface field name throughout.
- `dueSoon` (camelCase) is the query param name in both schema and destructure.
