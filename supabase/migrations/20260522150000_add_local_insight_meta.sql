-- Provenance metadata for AI-generated local_insight text.
-- Stores review count, source, model version, timestamp, and confidence
-- so insights can be audited and selectively re-generated.
ALTER TABLE places ADD COLUMN IF NOT EXISTS local_insight_meta jsonb;
