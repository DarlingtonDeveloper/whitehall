-- Increase statement timeout for the materialized view refresh function
-- The view joins 140K+ evidence rows with decay calculations
CREATE OR REPLACE FUNCTION refresh_indicators_decayed()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  SET LOCAL statement_timeout = '120s';
  REFRESH MATERIALIZED VIEW CONCURRENTLY politician_indicators_decayed;
END;
$$;

-- Add index on politician_indicator_evidence to speed up the view refresh
CREATE INDEX IF NOT EXISTS idx_pie_pol_ind
  ON politician_indicator_evidence (politician_id, indicator_id);
