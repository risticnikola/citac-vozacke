-- Seeds the initial tenant and garage_admin user.
-- ON CONFLICT DO NOTHING makes this idempotent — safe to re-run on fresh DB.
-- Password is hashed by pgcrypto at migration time (bcrypt cost 10).
-- Login: admin@demo.com / Admin1234!  ← change before running if desired

INSERT INTO tenants (id, name, slug, plan, max_devices)
VALUES (
  'c7cfe9eb-b42a-4847-bc8a-1621a19e2ef7',
  'Demo Garage',
  'demo-garage',
  'professional',
  10
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (tenant_id, email, role, password_hash, auth_provider)
VALUES (
  'c7cfe9eb-b42a-4847-bc8a-1621a19e2ef7',
  'admin@demo.com',
  'garage_admin',
  crypt('Admin1234!', gen_salt('bf', 10)),
  'local'
)
ON CONFLICT (tenant_id, email) DO NOTHING;
