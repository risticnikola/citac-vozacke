-- db/migrations/V15__service_reminder_intervals.sql
-- Adds repeat-interval columns to service_reminders.
-- Both nullable: null means no auto-renewal for that dimension.
-- At least one must be non-null for auto-renewal to fire.
ALTER TABLE service_reminders
  ADD COLUMN interval_km   INTEGER CHECK (interval_km > 0),
  ADD COLUMN interval_days INTEGER CHECK (interval_days > 0);
