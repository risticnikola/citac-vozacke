-- db/migrations/V9__global_idempotency_table.sql
-- Restores global idempotency guarantee lost when card_reads was partitioned in V4.
-- V4 weakened idempotency_key uniqueness to (idempotency_key, created_at),
-- meaning the same key could be inserted twice across a partition boundary.
-- This unpartitioned table is the single authoritative dedup gate.

CREATE TABLE card_read_idempotency (
  idempotency_key TEXT        PRIMARY KEY,
  card_read_id    UUID        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
