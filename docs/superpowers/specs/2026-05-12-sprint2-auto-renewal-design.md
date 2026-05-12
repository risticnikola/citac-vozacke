# Sprint 2: Interval-Based Auto-Renewal Design

## Goal

When a mechanic marks a service reminder complete, automatically create the next reminder based on an interval stored on the reminder itself. Auto-renewal is on by default; a UI checkbox lets the mechanic skip it for any given completion.

## Architecture

Two nullable columns (`interval_km`, `interval_days`) are added to `service_reminders`. On `PATCH completed=true`, the API reads the vehicle's current mileage, computes the next due values, and inserts the next reminder in the same DB transaction. No new tables. No async workers. The client invalidates its query cache and the new reminder appears automatically.

## Data Model

**Migration V15** — add to `service_reminders`:

```sql
ALTER TABLE service_reminders
  ADD COLUMN interval_km   INTEGER CHECK (interval_km > 0),
  ADD COLUMN interval_days INTEGER CHECK (interval_days > 0);
```

Both nullable. Null means no renewal for that dimension. If both are null, no renewal happens regardless of `skipRenewal`.

## API

### POST /v1/service-reminders

New optional body fields:
- `intervalKm: integer (≥ 1)` — km between services
- `intervalDays: integer (≥ 1)` — days between services

These are passed through to `interval_km` / `interval_days` on insert.

### PATCH /v1/service-reminders/:id

New optional body field:
- `skipRenewal: boolean` — if true, suppress auto-renewal for this completion (default: false)

**Renewal logic** (runs inside the same transaction as the UPDATE, only when `completed=true` and `skipRenewal` is not true):

1. Fetch the completed reminder (including `interval_km`, `interval_days`, `vehicle_id`)
2. Fetch `current_mileage_km` from `vehicles` for that vehicle
3. Compute:
   - `next_due_mileage_km = current_mileage_km + interval_km` — only if both are non-null
   - `next_due_date = CURRENT_DATE + interval_days` — only if `interval_days` is non-null
4. If neither next value could be computed (both intervals null, or mileage unknown and date interval null), skip renewal
5. INSERT new reminder with: same `tenant_id`, `vehicle_id`, `service_type`, `notes`, `interval_km`, `interval_days`; the computed `due_date` and `due_mileage_km`

The completed reminder is returned in the PATCH response (same as today). The new reminder is not included in the response — the client invalidates queries and the list refreshes.

**Edge case: vehicle mileage unknown, only `interval_km` set** — skip renewal (cannot compute next mileage without a baseline). The mechanic sees the service marked complete with no new reminder; they can add one manually.

### Response

No change — PATCH still returns the completed `ServiceReminder` row. The client's `onSuccess` already invalidates `['reminders-dash']` and `['reminders']`, so the new reminder appears on the next render without any additional client changes.

## Types (`web/types/index.ts`)

Add to `ServiceReminder`:
```ts
interval_km:   number | null;
interval_days: number | null;
```

Update `remindersApi`:
- `create` body: add `intervalKm?: number`, `intervalDays?: number`
- `update` body: add `skipRenewal?: boolean`

## Frontend

### `ReminderForm` — interval fields

Add two optional number inputs below the due date / due mileage row:

- **Repeat every (km)** — maps to `intervalKm`
- **Repeat every (days)** — maps to `intervalDays`

Pre-fill defaults when service type changes:

| Service type | interval_km | interval_days |
|---|---|---|
| oil_change | 10 000 | 365 |
| small_service | 10 000 | 365 |
| big_service | 20 000 | 730 |
| tire_rotation | 15 000 | 365 |
| technical_inspection | — | 365 |
| registration_renewal | — | 365 |
| brake_check | 30 000 | — |
| other | — | — |

Mechanic can clear or override any pre-fill. Empty field = null (no renewal for that dimension).

### `reminders/page.tsx` — inline confirmation on "Mark complete"

Current behaviour: clicking ✓ calls `complete.mutate(r.id)` immediately.

New behaviour:
1. Clicking ✓ sets a `confirmingId` state to the reminder's id (no mutation yet)
2. The row renders a small inline confirmation area:
   - Checkbox: **Create next reminder** (checked by default, only shown if the reminder has at least one interval set)
   - [Complete] button — calls `update(id, { completed: true, skipRenewal: !checked })`
   - [Cancel] button — clears `confirmingId`
3. If the reminder has no interval (`interval_km` and `interval_days` both null), clicking ✓ completes immediately with no confirmation step (no renewal to offer)

## Testing

Integration test `api/tests/unit/service-reminders-renewal.test.ts`:

1. `POST` reminder with `intervalKm=10000`, `intervalDays=365` → verify columns stored
2. `PATCH completed=true` → verify new reminder created with correct `due_mileage_km` and `due_date`
3. `PATCH completed=true` with `skipRenewal=true` → verify no new reminder created
4. `PATCH completed=true` on reminder with no interval → verify no new reminder created
5. `PATCH completed=true` when vehicle has no mileage and only `intervalKm` set → verify no new reminder created (mileage unknown)
