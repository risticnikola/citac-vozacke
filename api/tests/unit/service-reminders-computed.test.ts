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
  await exec(`INSERT INTO tenants(id, name, slug, plan) VALUES ($1, 'T', $2, 'starter') ON CONFLICT DO NOTHING`, [TENANT_ID, `test-cm-${TENANT_ID}`]);
  const v = await exec(
    `INSERT INTO vehicles(tenant_id, plate, current_mileage_km)
     VALUES ($1, $2, 90000) RETURNING id`,
    [TENANT_ID, 'TEST-CM-01'],
  );
  vehicleId = v.rows[0].id;

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
  it('returns km_remaining=10000, days_remaining=60, urgency=ok for a far-away reminder', async () => {
    const { rows } = await pool.query(
      `SELECT
         CASE
           WHEN sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
           THEN sr.due_mileage_km - v.current_mileage_km
           ELSE NULL
         END AS km_remaining,
         (sr.due_date - CURRENT_DATE)::int AS days_remaining,
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
    expect(rows[0].km_remaining).toBe(10000);
    expect(rows[0].days_remaining).toBeGreaterThanOrEqual(59);
    expect(rows[0].days_remaining).toBeLessThanOrEqual(61);
    expect(rows[0].urgency).toBe('ok');
  });

  it('returns urgency=due_soon when mileage gap <= 1000 km', async () => {
    await exec(`UPDATE vehicles SET current_mileage_km=99200 WHERE id=$1`, [vehicleId]);
    const { rows } = await pool.query(
      `SELECT
         CASE
           WHEN (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                 AND (sr.due_mileage_km - v.current_mileage_km) BETWEEN 0 AND 1000)
             OR (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) BETWEEN 0 AND 30)
           THEN 'due_soon' ELSE 'ok'
         END AS urgency
       FROM service_reminders sr JOIN vehicles v ON v.id = sr.vehicle_id WHERE sr.id=$1`,
      [reminderId],
    );
    expect(rows[0].urgency).toBe('due_soon');
    await exec(`UPDATE vehicles SET current_mileage_km=90000 WHERE id=$1`, [vehicleId]);
  });

  it('returns urgency=overdue when mileage exceeded', async () => {
    await exec(`UPDATE vehicles SET current_mileage_km=101000 WHERE id=$1`, [vehicleId]);
    const { rows } = await pool.query(
      `SELECT
         CASE
           WHEN sr.completed_at IS NOT NULL THEN 'ok'
           WHEN (sr.due_date IS NOT NULL AND sr.due_date < CURRENT_DATE)
             OR (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                 AND v.current_mileage_km >= sr.due_mileage_km)
           THEN 'overdue'
           WHEN (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                 AND (sr.due_mileage_km - v.current_mileage_km) BETWEEN 0 AND 1000)
             OR (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) BETWEEN 0 AND 30)
           THEN 'due_soon'
           ELSE 'ok'
         END AS urgency
       FROM service_reminders sr JOIN vehicles v ON v.id = sr.vehicle_id WHERE sr.id=$1`,
      [reminderId],
    );
    expect(rows[0].urgency).toBe('overdue');
    await exec(`UPDATE vehicles SET current_mileage_km=90000 WHERE id=$1`, [vehicleId]);
  });

  it('dueSoon filter returns reminder within 1000 km and excludes far-away', async () => {
    await exec(`UPDATE vehicles SET current_mileage_km=99500 WHERE id=$1`, [vehicleId]);
    const { rows } = await pool.query(
      `SELECT sr.id FROM service_reminders sr
       JOIN vehicles v ON v.id = sr.vehicle_id
       WHERE sr.completed_at IS NULL
         AND (
           (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) BETWEEN 0 AND 30)
           OR
           (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
            AND (sr.due_mileage_km - v.current_mileage_km) BETWEEN 0 AND 1000)
         )
         AND sr.id = $1`,
      [reminderId],
    );
    expect(rows.length).toBe(1);
    await exec(`UPDATE vehicles SET current_mileage_km=90000 WHERE id=$1`, [vehicleId]);
  });
});
