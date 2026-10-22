-- Migration 005: Add replacement_text to findings
ALTER TABLE findings
ADD COLUMN IF NOT EXISTS replacement_text TEXT;
