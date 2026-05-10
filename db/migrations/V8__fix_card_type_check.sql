-- db/migrations/V8__fix_card_type_check.sql
-- V4 changed card_type CHECK to ('driver','vehicle','workshop','control') but the
-- API and bridge use ('vehicle_registration','id_card','other'). Fix it back.
-- On a partitioned table the constraint lives on the parent; children inherit it.
ALTER TABLE card_reads DROP CONSTRAINT IF EXISTS card_reads_card_type_check;
ALTER TABLE card_reads ADD CONSTRAINT card_reads_card_type_check
  CHECK (card_type IN ('vehicle_registration', 'id_card', 'other'));
