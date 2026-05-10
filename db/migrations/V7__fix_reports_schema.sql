-- db/migrations/V7__fix_reports_schema.sql
-- reports table was missing updated_at (used by report-generate consumer).
-- Also rename pdf_s3_key alias so worker UPDATE matches the column.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
