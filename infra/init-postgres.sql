-- infra/init-postgres.sql
-- Runs once at DB creation via docker-entrypoint-initdb.d/
-- Creates application roles with appropriate privileges.

-- app_role: used by the API and workers at runtime; RLS applies
CREATE ROLE app_role WITH LOGIN PASSWORD 'changeme_in_prod';
GRANT CONNECT ON DATABASE vehicledb TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_role;

-- migration_role: used by Flyway; bypasses RLS so migrations can ALTER any table
CREATE ROLE migration_role WITH LOGIN PASSWORD 'changeme_in_prod' BYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE vehicledb TO migration_role;
