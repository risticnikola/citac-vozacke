-- db/migrations/V5__billing_events_unique.sql
-- Required for idempotent upsert in the billing worker.
ALTER TABLE billing_events
  ADD CONSTRAINT billing_events_card_read_id_unique UNIQUE (card_read_id);
