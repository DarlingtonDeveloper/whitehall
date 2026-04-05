// ---------------------------------------------------------------------------
// Analysis JSON schema — matches the monitoring agent's analysis.schema.json
// exactly. This is the contract between LLM enrichment and DOCX generation.
// ---------------------------------------------------------------------------

export interface AnalysisJSON {
  metadata: {
    client_name: string;
    reporting_period: string;       // e.g. "w/c 24 March 2026"
    report_date: string;            // e.g. "27 March 2026"
    generated_at: string;           // ISO 8601
    items_collected: number;
    items_analysed: number;
    sources_unavailable: string[];
  };

  executive_summary: {
    top_line: string;               // 3-5 sentences
    key_developments: KeyDevelopment[];
  };

  sections: Record<string, ThemeSection>;

  forward_look: ForwardLookItem[];
  emerging_themes: string[];        // 2-4 paragraphs
  actions_tracker: ActionItem[];
  coverage_summary: CoverageMetric[];
}

export interface KeyDevelopment {
  rag: 'RED' | 'AMBER' | 'GREEN';
  development: string;
  relevance: string;
  recommended_action: string;
  section_ref: string;              // e.g. "2.1.1"
  confidence: number;               // 0-1
}

export interface AnalysedItem {
  ref: string;                      // e.g. "2.1.1"
  headline: string;
  date: string;                     // DD/MM/YYYY
  source: string;                   // e.g. "GOV.UK press release, DESNZ"
  summary: string;                  // 2-4 sentences
  client_relevance: string;         // 2-3 sentences
  recommended_action: string;
  escalation: 'IMMEDIATE' | 'HIGH' | 'STANDARD';
  rag: 'RED' | 'AMBER' | 'GREEN';
  confidence: number;               // 0-1
  source_items: string[];           // fingerprints
}

export interface ThemeSection {
  items: AnalysedItem[];
  no_developments?: boolean;
  // Parliamentary-specific
  routine_mentions?: RoutineMention[];
  // Media-specific
  coverage_table?: MediaRow[];
  significant_items?: AnalysedItem[];
  // Competitor-specific
  table?: CompetitorRow[];
  // Social media-specific
  summary?: string;
  metrics?: SocialMetrics;
  notable_posts?: AnalysedItem[];
}

export interface RoutineMention {
  date: string;
  type: string;                     // "WQ", "OQ", "Debate", "EDM", "Cttee", "WS"
  detail: string;
  members: string;
  significance: 'Low' | 'Medium' | 'High';
}

export interface MediaRow {
  date: string;
  outlet: string;
  angle: string;                    // own words, never verbatim headline
  client_named: string;             // e.g. "Yes — positive"
  action: 'Monitor' | 'Amplify' | 'Respond' | 'Correct';
}

export interface CompetitorRow {
  organisation: string;
  development: string;
  relevance: string;
  action: string;
}

export interface SocialMetrics {
  total_mentions: string;
  sentiment_breakdown: string;
  top_engagement_post: string;
  trend_vs_previous: string;
}

export interface ForwardLookItem {
  date: string;
  event: string;
  relevance: string;
  preparation: string;
}

export interface ActionItem {
  ref: string;                      // "001", "002"
  action: string;
  owner: string;                    // default "[Name]"
  deadline: string;
  origin: string;                   // "Report w/c 24 March 2026"
  status: 'Open' | 'DONE';
}

export interface CoverageMetric {
  metric: string;
  this_week: string;
  previous_week: string;            // "[Baseline TBC]" for first run
  trend: string;
}
