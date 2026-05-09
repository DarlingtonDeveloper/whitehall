-- Fix bill_policy_mappings unique constraint to handle NULL amendment_id.
-- The old UNIQUE(bill_id, amendment_id, indicator_id) allowed duplicates
-- when amendment_id IS NULL because PostgreSQL treats NULL != NULL.

-- Drop the old constraint
ALTER TABLE bill_policy_mappings
  DROP CONSTRAINT IF EXISTS bill_policy_mappings_bill_id_amendment_id_indicator_id_key;

-- Add a unique index that treats NULL as equal using COALESCE
CREATE UNIQUE INDEX IF NOT EXISTS idx_bpm_unique
  ON bill_policy_mappings(bill_id, COALESCE(amendment_id, ''), indicator_id);
