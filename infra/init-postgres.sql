-- infra/init-postgres.sql
-- Runs once at DB creation via docker-entrypoint-initdb.d/
-- Creates application roles with appropriate privileges.

-- app_role: used by the API and workers at runtime; RLS applies
CREATE ROLE app_role WITH LOGIN PASSWORD 'app_role_password';
GRANT CONNECT ON DATABASE vehicleapp TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_role;

-- migration_role: used by Flyway; bypasses RLS so migrations can ALTER any table
CREATE ROLE migration_role WITH LOGIN PASSWORD 'migration_role_password' BYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE vehicleapp TO migration_role;
-- PG15+ removed implicit CREATE on public schema — Flyway needs it to write flyway_schema_history
GRANT CREATE ON SCHEMA public TO migration_role;
