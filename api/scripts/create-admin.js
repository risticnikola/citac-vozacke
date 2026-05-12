// scripts/create-admin.js

import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const email = process.argv[2];
const password = process.argv[3];
const tenantName = process.argv[4] ?? 'Default Tenant';

if (!email || !password) {
  console.error(`
Usage:

node scripts/create-admin.js admin@mygarage.com password123 "My Garage"
`);

  process.exit(1);
}

const createAdmin = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Prevent duplicate users
    const existingUser = await client.query(
      `
      SELECT id
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new Error(`User already exists: ${email}`);
    }

    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    // Create tenant
    const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + tenantId.slice(0, 8);
    await client.query(
      `
      INSERT INTO tenants (
        id,
        name,
        slug,
        plan
      )
      VALUES ($1, $2, $3, $4)
      `,
      [tenantId, tenantName, slug, 'professional']
    );

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create admin user
    await client.query(
      `
      INSERT INTO users (
        id,
        tenant_id,
        email,
        role,
        auth_provider,
        password_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        userId,
        tenantId,
        email,
        'garage_admin',
        'local',
        passwordHash,
      ]
    );

    await client.query('COMMIT');

    console.log(`
========================================
Admin user created successfully
========================================

Tenant:
  ${tenantName}

Tenant ID:
  ${tenantId}

Admin Email:
  ${email}

Role:
  garage_admin
`);
  } catch (err) {
    await client.query('ROLLBACK');

    console.error(`
Failed to create admin user:

${err.message}
`);

    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

createAdmin();