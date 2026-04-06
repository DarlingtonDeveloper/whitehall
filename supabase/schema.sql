-- Feed items from all sources
CREATE TABLE IF NOT EXISTS feed_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type     TEXT NOT NULL,
  source_name     TEXT NOT NULL,
  title           TEXT NOT NULL,
  url             TEXT,
  published_at    TIMESTAMPTZ,
  body            TEXT,
  raw_data        JSONB,
  entity_ids      TEXT[] DEFAULT '{}',
  monitoring_theme TEXT,
  rag_status      TEXT,
  relevance_score REAL DEFAULT 0,
  fingerprint     TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  event_date      TIMESTAMPTZ,
  is_forward_scan BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_feed_items_published ON feed_items (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_source ON feed_items (source_type);
CREATE INDEX IF NOT EXISTS idx_feed_items_entities ON feed_items USING GIN (entity_ids);
CREATE INDEX IF NOT EXISTS idx_feed_items_fingerprint ON feed_items (fingerprint);
CREATE INDEX IF NOT EXISTS idx_feed_items_theme ON feed_items (monitoring_theme);

-- Client-specific relevance scores
CREATE TABLE IF NOT EXISTS client_feed_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_item_id    UUID REFERENCES feed_items(id) ON DELETE CASCADE,
  client_id       TEXT NOT NULL,
  relevance_score REAL DEFAULT 0,
  is_actionable   BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(feed_item_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_scores_client ON client_feed_scores (client_id, relevance_score DESC);

-- Client scan tracking
CREATE TABLE IF NOT EXISTS client_scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       TEXT NOT NULL,
  scan_type       TEXT NOT NULL,
  status          TEXT DEFAULT 'pending',
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  items_found     INTEGER DEFAULT 0,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Chat conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       TEXT,
  context_entity  TEXT,
  context_type    TEXT DEFAULT 'intelligence',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  tool_calls      JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Enriched items for DOCX generation
CREATE TABLE IF NOT EXISTS enriched_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_item_id    UUID REFERENCES feed_items(id) ON DELETE CASCADE,
  client_id       TEXT NOT NULL,
  summary         TEXT,
  client_relevance TEXT,
  recommended_action TEXT,
  significance    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(feed_item_id, client_id)
);

-- ============================================================================
-- Report workflow tables
-- ============================================================================

-- Report drafts — mutable analysis JSON with workflow status
CREATE TABLE IF NOT EXISTS report_drafts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft',

  date_range_from     TIMESTAMPTZ NOT NULL,
  date_range_to       TIMESTAMPTZ NOT NULL,

  sections            JSONB NOT NULL,
  original_sections   JSONB NOT NULL,

  feed_item_ids       UUID[] DEFAULT '{}',

  created_by          TEXT,
  reviewed_by         TEXT,
  review_requested_at TIMESTAMPTZ,
  reviewed_at         TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  exported_at         TIMESTAMPTZ,

  review_token        TEXT UNIQUE,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_drafts_client ON report_drafts (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_drafts_status ON report_drafts (status);
CREATE INDEX IF NOT EXISTS idx_report_drafts_token ON report_drafts (review_token);

-- Report chat messages
CREATE TABLE IF NOT EXISTS report_chat_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_draft_id     UUID REFERENCES report_drafts(id) ON DELETE CASCADE,

  role                TEXT NOT NULL,
  content             TEXT NOT NULL,

  user_role           TEXT,
  user_name           TEXT,

  active_section      TEXT,
  active_item_ref     TEXT,

  mutations           JSONB DEFAULT '[]',
  tool_calls          JSONB,

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_chat_draft ON report_chat_messages (report_draft_id, created_at);

-- Client learned signals (feedback loop)
CREATE TABLE IF NOT EXISTS client_learned_signals (
  client_id           TEXT PRIMARY KEY,
  source_boosts       JSONB DEFAULT '{}',
  keyword_boosts      JSONB DEFAULT '{}',
  rag_adjustments     JSONB DEFAULT '{}',
  computed_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Pipeline observability
-- ============================================================================

-- Structured traces for every Claude call in the report pipeline.
-- Replaces the monitoring agent's Opik @track decorators with a Supabase-
-- native approach. Optionally forwarded to Opik REST API when configured.
CREATE TABLE IF NOT EXISTS pipeline_traces (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           TEXT NOT NULL,
  report_id           TEXT,
  theme_id            TEXT,
  step                TEXT NOT NULL,
  model               TEXT NOT NULL,
  items_count         INTEGER,
  input_preview       TEXT,
  output_preview      TEXT,
  scores              JSONB,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  duration_ms         INTEGER,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_traces_client ON pipeline_traces (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_traces_step ON pipeline_traces (step);
