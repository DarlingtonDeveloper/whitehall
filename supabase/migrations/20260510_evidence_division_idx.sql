-- Index on parsed->>division_id for fast whip detection and backtest queries
CREATE INDEX IF NOT EXISTS idx_evidence_division_id
  ON politician_evidence ((parsed->>'division_id'))
  WHERE evidence_type = 'division_vote';

-- Index on parsed->>bill_ref for bill-based lookups
CREATE INDEX IF NOT EXISTS idx_evidence_bill_ref
  ON politician_evidence ((parsed->>'bill_ref'))
  WHERE evidence_type = 'division_vote';
