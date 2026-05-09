CREATE TABLE IF NOT EXISTS predictions_log (
  id              TEXT PRIMARY KEY,
  prediction_type TEXT NOT NULL CHECK (prediction_type IN ('vote','position','coalition','swing','eig','backtest')),
  input           JSONB NOT NULL,
  output          JSONB NOT NULL,
  outcome         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predictions_log_type ON predictions_log(prediction_type);
CREATE INDEX IF NOT EXISTS idx_predictions_log_created ON predictions_log(created_at DESC);

ALTER TABLE predictions_log ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for logging predictions)
CREATE POLICY service_write_predictions ON predictions_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon to read predictions (for audit lookup)
CREATE POLICY anon_read_predictions ON predictions_log FOR SELECT TO anon USING (true);
