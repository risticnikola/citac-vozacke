-- V8 added the correct card_type check on the parent but left the old
-- card_reads_card_type_check1 ('driver','vehicle','workshop','control') behind.
-- Drop it from the parent — Postgres cascades the removal to all 24 partitions.
ALTER TABLE card_reads DROP CONSTRAINT IF EXISTS card_reads_card_type_check1;
