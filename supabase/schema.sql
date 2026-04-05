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
