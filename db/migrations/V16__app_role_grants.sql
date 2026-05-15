-- Grants for app_role on all tables created by Flyway (migration_role).
-- init-postgres.sql's ALTER DEFAULT PRIVILEGES only covers tables created by
-- the postgres superuser, not by migration_role, so grants must be explicit.
-- Idempotent: GRANT is a no-op if privilege already exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;
