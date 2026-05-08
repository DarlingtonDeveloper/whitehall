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

-- Report edit revisions — snapshot of sections before each edit
CREATE TABLE IF NOT EXISTS report_revisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_draft_id     UUID NOT NULL REFERENCES report_drafts(id) ON DELETE CASCADE,
  sections_snapshot   JSONB NOT NULL,
  edit_source         TEXT NOT NULL,
  mutation_summary    JSONB,
  chat_message_id     UUID REFERENCES report_chat_messages(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_revisions_draft ON report_revisions (report_draft_id, created_at DESC);

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

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- Enable RLS on every table. Only the service_role key bypasses these
-- policies, so the anon/publishable key has zero access by default.
-- Add granular user-facing policies here once authentication is in place.

ALTER TABLE feed_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_feed_scores     ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_scans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE enriched_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_drafts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_chat_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_revisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_learned_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_traces        ENABLE ROW LEVEL SECURITY;

-- The service_role key bypasses RLS entirely, so no explicit policies are
-- needed for server-side code.
--
-- Anon (publishable key) gets read-only access to feed tables so the UI
-- can load the feed panel. Everything else is blocked for anon.
CREATE POLICY anon_read_feed       ON feed_items         FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_scores     ON client_feed_scores FOR SELECT TO anon USING (true);

-- ============================================================================
-- Politician data layer
-- ============================================================================

-- Person-level record. Stable across role changes, reshuffles, elections.
CREATE TABLE IF NOT EXISTS politicians (
  id                    TEXT PRIMARY KEY,
  parliament_member_id  INTEGER UNIQUE,
  full_name             TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  party                 TEXT,
  party_history         JSONB DEFAULT '[]',
  house                 TEXT NOT NULL CHECK (house IN ('commons','lords','both','former')),
  constituency          TEXT,
  constituency_history  JSONB DEFAULT '[]',
  first_elected         DATE,
  peerage_date          DATE,
  portrait_url          TEXT,
  bio                   TEXT,
  gender                TEXT,
  date_of_birth         DATE,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','deceased','defeated')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_politicians_member_id ON politicians(parliament_member_id);
CREATE INDEX IF NOT EXISTS idx_politicians_party ON politicians(party);
CREATE INDEX IF NOT EXISTS idx_politicians_status ON politicians(status);

-- Many-to-many over time — links politicians to existing entity model.
CREATE TABLE IF NOT EXISTS politician_roles (
  id              BIGSERIAL PRIMARY KEY,
  politician_id   TEXT NOT NULL REFERENCES politicians(id) ON DELETE CASCADE,
  role_entity_id  TEXT NOT NULL,
  role_type       TEXT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE,
  source          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_politician_roles_politician ON politician_roles(politician_id);
CREATE INDEX IF NOT EXISTS idx_politician_roles_role ON politician_roles(role_entity_id);
CREATE INDEX IF NOT EXISTS idx_politician_roles_active ON politician_roles(politician_id) WHERE end_date IS NULL;

-- Unified evidence stream. Every Hansard contribution, division vote, WQ,
-- committee appearance, register entry becomes a row here.
CREATE TABLE IF NOT EXISTS politician_evidence (
  id              BIGSERIAL PRIMARY KEY,
  politician_id   TEXT NOT NULL REFERENCES politicians(id) ON DELETE CASCADE,
  evidence_type   TEXT NOT NULL CHECK (evidence_type IN (
    'division_vote',
    'chamber_speech',
    'committee_speech',
    'committee_question',
    'written_question_asked',
    'written_question_answered',
    'oral_question_asked',
    'oral_question_answered',
    'edm_signature',
    'edm_proposed',
    'amendment_tabled',
    'op_ed',
    'press_release',
    'interview',
    'register_of_interests',
    'appg_membership',
    'committee_membership',
    'social_post'
  )),
  source          TEXT NOT NULL,
  source_id       TEXT,
  source_url      TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_content     TEXT,
  parsed          JSONB NOT NULL DEFAULT '{}',
  topic_tags      TEXT[] DEFAULT '{}',
  entity_ids      TEXT[] DEFAULT '{}',
  fingerprint     TEXT NOT NULL,
  UNIQUE(fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_evidence_politician ON politician_evidence(politician_id);
CREATE INDEX IF NOT EXISTS idx_evidence_type ON politician_evidence(evidence_type);
CREATE INDEX IF NOT EXISTS idx_evidence_occurred ON politician_evidence(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_topics ON politician_evidence USING GIN(topic_tags);
CREATE INDEX IF NOT EXISTS idx_evidence_entities ON politician_evidence USING GIN(entity_ids);
CREATE INDEX IF NOT EXISTS idx_evidence_politician_type_date ON politician_evidence(politician_id, evidence_type, occurred_at DESC);

-- Indicator catalogue — defines what we measure.
CREATE TABLE IF NOT EXISTS indicator_definitions (
  id              TEXT PRIMARY KEY,
  radar           TEXT NOT NULL CHECK (radar IN ('policy','ideology','faction','behaviour','career','network')),
  policy_area     TEXT,
  label_low       TEXT NOT NULL,
  label_high      TEXT NOT NULL,
  description     TEXT NOT NULL,
  half_life_years NUMERIC NOT NULL DEFAULT 3.0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Beta state per politician × indicator. Stub — populated by math layer later.
CREATE TABLE IF NOT EXISTS politician_indicators (
  politician_id   TEXT NOT NULL REFERENCES politicians(id) ON DELETE CASCADE,
  indicator_id    TEXT NOT NULL REFERENCES indicator_definitions(id) ON DELETE CASCADE,
  alpha           NUMERIC NOT NULL DEFAULT 1.0,
  beta            NUMERIC NOT NULL DEFAULT 1.0,
  evidence_count  INTEGER NOT NULL DEFAULT 0,
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (politician_id, indicator_id)
);

CREATE INDEX IF NOT EXISTS idx_pol_ind_politician ON politician_indicators(politician_id);

-- Audit trail — which evidence rows updated which indicators.
CREATE TABLE IF NOT EXISTS politician_indicator_evidence (
  id                  BIGSERIAL PRIMARY KEY,
  politician_id       TEXT NOT NULL,
  indicator_id        TEXT NOT NULL,
  evidence_id         BIGINT NOT NULL REFERENCES politician_evidence(id) ON DELETE CASCADE,
  anchor              NUMERIC NOT NULL,
  raw_weight          NUMERIC NOT NULL,
  effective_weight    NUMERIC NOT NULL,
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  classifier_version  TEXT NOT NULL,
  classifier_reasoning TEXT,
  FOREIGN KEY (politician_id, indicator_id) REFERENCES politician_indicators(politician_id, indicator_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pie_evidence ON politician_indicator_evidence(evidence_id);
CREATE INDEX IF NOT EXISTS idx_pie_indicator ON politician_indicator_evidence(politician_id, indicator_id);

-- Manual review queue for ambiguous entity → politician matches during migration.
CREATE TABLE IF NOT EXISTS politician_match_review (
  id              BIGSERIAL PRIMARY KEY,
  entity_id       TEXT NOT NULL,
  entity_name     TEXT NOT NULL,
  current_holder  TEXT NOT NULL,
  candidate_ids   JSONB NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','skipped')),
  resolved_politician_id TEXT REFERENCES politicians(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for politician tables
ALTER TABLE politicians                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE politician_roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE politician_evidence          ENABLE ROW LEVEL SECURITY;
ALTER TABLE indicator_definitions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE politician_indicators        ENABLE ROW LEVEL SECURITY;
ALTER TABLE politician_indicator_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE politician_match_review      ENABLE ROW LEVEL SECURITY;

-- Anon read access for politician data (UI needs to display it)
CREATE POLICY anon_read_politicians      ON politicians          FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_pol_roles        ON politician_roles     FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_pol_evidence     ON politician_evidence  FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_indicators       ON indicator_definitions FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_pol_indicators   ON politician_indicators FOR SELECT TO anon USING (true);

-- ============================================================================
-- Classifier mapping tables
-- ============================================================================

-- Bill/amendment → indicator mapping for deterministic division vote classification.
-- Populated by LLM proposals (reviewed via UI) and manual curation.
CREATE TABLE IF NOT EXISTS bill_policy_mappings (
  id                    BIGSERIAL PRIMARY KEY,
  bill_id               TEXT NOT NULL,
  amendment_id          TEXT,
  stage                 TEXT,
  indicator_id          TEXT NOT NULL REFERENCES indicator_definitions(id) ON DELETE CASCADE,
  aye_anchor            NUMERIC NOT NULL CHECK (aye_anchor BETWEEN 0 AND 1),
  no_anchor             NUMERIC NOT NULL CHECK (no_anchor BETWEEN 0 AND 1),
  diagnostic_strength   NUMERIC NOT NULL DEFAULT 1.0 CHECK (diagnostic_strength BETWEEN 0 AND 1),
  created_by            TEXT NOT NULL CHECK (created_by IN ('auto-llm','manual','imported')),
  reviewed              BOOLEAN NOT NULL DEFAULT false,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(bill_id, amendment_id, indicator_id)
);

CREATE INDEX IF NOT EXISTS idx_bpm_bill ON bill_policy_mappings(bill_id);

-- Organisation → indicator mapping for register of interests classification.
CREATE TABLE IF NOT EXISTS org_indicator_map (
  org_name              TEXT NOT NULL,
  org_aliases           TEXT[] DEFAULT '{}',
  indicator_id          TEXT NOT NULL REFERENCES indicator_definitions(id) ON DELETE CASCADE,
  anchor                NUMERIC NOT NULL CHECK (anchor BETWEEN 0 AND 1),
  weight_multiplier     NUMERIC NOT NULL DEFAULT 1.0,
  rationale             TEXT NOT NULL,
  PRIMARY KEY (org_name, indicator_id)
);

-- APPG → indicator mapping.
CREATE TABLE IF NOT EXISTS appg_indicator_map (
  appg_id               TEXT PRIMARY KEY,
  indicator_id          TEXT NOT NULL REFERENCES indicator_definitions(id) ON DELETE CASCADE,
  anchor                NUMERIC NOT NULL CHECK (anchor BETWEEN 0 AND 1),
  weight_multiplier     NUMERIC NOT NULL DEFAULT 0.5
);

-- Committee → indicator mapping.
CREATE TABLE IF NOT EXISTS committee_indicator_map (
  committee_id          TEXT NOT NULL,
  indicator_id          TEXT NOT NULL REFERENCES indicator_definitions(id) ON DELETE CASCADE,
  membership_anchor     NUMERIC NOT NULL CHECK (membership_anchor BETWEEN 0 AND 1),
  chair_anchor          NUMERIC CHECK (chair_anchor BETWEEN 0 AND 1),
  weight_multiplier     NUMERIC NOT NULL DEFAULT 0.6,
  PRIMARY KEY (committee_id, indicator_id)
);

-- Dead-letter queue for classifier failures requiring manual review.
CREATE TABLE IF NOT EXISTS classifier_failures (
  id                    BIGSERIAL PRIMARY KEY,
  evidence_id           BIGINT NOT NULL REFERENCES politician_evidence(id) ON DELETE CASCADE,
  classifier_version    TEXT NOT NULL,
  error_type            TEXT NOT NULL,
  error_message         TEXT,
  retry_count           INTEGER NOT NULL DEFAULT 0,
  resolved              BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clf_failures_unresolved ON classifier_failures(resolved) WHERE resolved = false;

-- RLS for classifier tables
ALTER TABLE bill_policy_mappings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_indicator_map      ENABLE ROW LEVEL SECURITY;
ALTER TABLE appg_indicator_map     ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee_indicator_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE classifier_failures    ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_bpm        ON bill_policy_mappings    FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_org_map    ON org_indicator_map       FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_appg_map   ON appg_indicator_map      FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_comm_map   ON committee_indicator_map FOR SELECT TO anon USING (true);
