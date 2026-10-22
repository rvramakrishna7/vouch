-- Migration 004: add AI execution metadata and disclosure columns to reviews
ALTER TABLE reviews
    ADD COLUMN IF NOT EXISTS ai_status TEXT CHECK (ai_status IN ('ok', 'unavailable', 'invalid_output', 'skipped')),
    ADD COLUMN IF NOT EXISTS ai_provider TEXT,
    ADD COLUMN IF NOT EXISTS ai_model TEXT,
    ADD COLUMN IF NOT EXISTS ai_latency_ms INTEGER;
