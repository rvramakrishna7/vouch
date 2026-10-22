-- 003_terms_rules.sql: Add rule_id and note to terms table
ALTER TABLE terms
  ADD COLUMN IF NOT EXISTS rule_id UUID REFERENCES rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS note TEXT;

CREATE INDEX IF NOT EXISTS idx_terms_rule ON terms(rule_id);
