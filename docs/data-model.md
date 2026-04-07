# Data Model

## Entity Data (Static, Build-Time)

All entity data is loaded from `data/_extracted/*.json` at build time. It is not stored in the database.

### Entity (`types/entity.ts`)

```typescript
interface Entity {
  id: string;                      // e.g. "desnz", "ofgem", "pm"
  name: string;                    // e.g. "Department for Energy Security and Net Zero"
  category: "official" | "department" | "body" | "group";
  subtype: string;                 // e.g. "ministerial-department", "regulator", "ndpb"
  description: string;
  role?: string;                   // e.g. "Secretary of State for Energy Security and Net Zero"
  currentHolder?: string;          // e.g. "Ed Miliband"
  infoUrl?: string;
  parentIds: string[];             // Primary parent entities
  secondaryParentIds?: string[];   // Secondary relationships (e.g. cross-cutting)
  tags?: string[];                 // Classification tags (sector-energy, regulator, etc.)
  jurisdictions?: string[];        // uk, england, scotland, wales, northern-ireland
}
```

764 entities across 4 categories: ministerial departments, ministers, NDPBs/executive agencies/regulators, select committees, and cross-government groups.

### Relationships (`data/relationships.ts`)

Derived from `parentIds` and `secondaryParentIds`:
- `getChildren(entityId)` — direct children
- `getParents(entityId)` — direct parents
- `getSecondaryChildren/Parents(entityId)` — secondary relationships
- `getRelationships(entityId)` — all directions in one call

### Powers (`types/entity.ts`)

```typescript
interface PowerRecord {
  elementId: string;
  lastReviewed: string;
  powers: Power[];
}

interface Power {
  id: string;
  title: string;
  description: string;
  powerType: "power" | "duty" | "function" | "responsibility";
  inForceFrom: string;
  sources: PowerSource[];          // Legislation references
}

interface PowerSource {
  type: "act" | "statutory-instrument" | "prerogative" | "case-law" | "convention";
  title: string;
  year?: number;
  section?: string;
  legislationUrl?: string;
}
```

### Budget (`types/entity.ts`)

```typescript
interface BudgetProfile {
  elementId: string;
  oscarDeptGroupCode: string;
  budgets: Budget[];               // Multiple financial years
}

interface Budget {
  financialYear: string;
  totalNetExpenditure: number;
  totalGrossExpenditure: number;
  totalIncome: number;
  unit: "thousands";
  delAdmin: number;                // Departmental Expenditure Limit (admin)
  delProg: number;                 // DEL (programme)
  deptAme: number;                 // Annually Managed Expenditure (dept)
  nonDeptAme: number;              // AME (non-dept)
  expenditureLines: { label: string; amount: number }[];
  bodyLines: { label: string; amount: number; elementId?: string }[];
  // ... income, programme, body income lines
}
```

### Staff (`types/entity.ts`)

```typescript
interface StaffProfile {
  elementId: string;
  year: string;
  grades: GradeBreakdown;         // SCS, G6/7, SEO/HEO, EO, AA/AO, other, total
  orgs: OrgBreakdown[];           // Per-agency breakdown
  professions: Record<string, number>;
}
```

### Tags (`data/tags.ts`)

19 type tags (regulator, research-council, tribunal, etc.) and 26 sector tags (sector-energy, sector-health, etc.). Each has an ID, label, category, and hex colour.

---

## Database Schema (Supabase)

Defined in `supabase/schema.sql`.

### `feed_items` — Core feed table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `source_type` | TEXT | `govuk`, `hansard`, `committee`, `legislation`, `trade_press`, `stakeholder`, `petition`, `research`, `web_search`, `forward_scan` |
| `source_name` | TEXT | Human-readable source label |
| `title` | TEXT | Cleaned title |
| `url` | TEXT | Canonical URL |
| `published_at` | TIMESTAMPTZ | Publication date |
| `body` | TEXT | Content (up to ~10,000 chars after enrichment) |
| `raw_data` | JSONB | Source-specific fields (e.g. petition signature count) |
| `entity_ids` | TEXT[] | Tagged Whitehall entity IDs |
| `monitoring_theme` | TEXT | Optional pre-assigned theme |
| `rag_status` | TEXT | `RED`, `AMBER`, `GREEN` |
| `relevance_score` | FLOAT | Initial source-type score (0.0-0.4) |
| `fingerprint` | TEXT (UNIQUE) | SHA-256 of `url||title` for dedup |
| `created_at` | TIMESTAMPTZ | Insert timestamp |
| `event_date` | TIMESTAMPTZ | Future event date (forward scan items) |
| `is_forward_scan` | BOOLEAN | Whether item is a forward scan result |

**Indexes:** `published_at DESC`, `source_type`, `entity_ids` (GIN), `fingerprint`, `monitoring_theme`

### `report_drafts` — Report workflow

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | |
| `client_id` | TEXT | Client slug |
| `status` | TEXT | `generating`, `draft`, `in_review`, `approved`, `exported` |
| `date_range_from` | TIMESTAMPTZ | Report period start |
| `date_range_to` | TIMESTAMPTZ | Report period end |
| `sections` | JSONB | Current `AnalysisJSON` (editable) |
| `original_sections` | JSONB | Original `AnalysisJSON` (for diff) |
| `feed_item_ids` | UUID[] | Source items used |
| `review_token` | TEXT (UNIQUE) | Generated on `in_review` status |
| `review_requested_at`, `approved_at`, `exported_at` | TIMESTAMPTZ | Status timestamps |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `report_chat_messages` — Report editing chat

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | |
| `report_draft_id` | UUID (FK) | Links to report_drafts |
| `role` | TEXT | `user` or `assistant` |
| `content` | TEXT | Message text |
| `user_role` | TEXT | Optional role context |
| `active_section` | TEXT | Section being viewed |
| `active_item_ref` | TEXT | Item being viewed (e.g. "2.1") |
| `mutations` | JSONB | Structured mutations applied |
| `tool_calls` | JSONB | Raw tool call data |
| `created_at` | TIMESTAMPTZ | |

### `client_learned_signals` — Feedback loop

| Column | Type | Description |
|--------|------|-------------|
| `client_id` | TEXT (PK) | |
| `source_boosts` | JSONB | `{source_type: boost_delta}` |
| `keyword_boosts` | JSONB | `{keyword: boost_delta}` |
| `rag_adjustments` | JSONB | `{source_type: {red_threshold, amber_threshold}}` |
| `computed_at` | TIMESTAMPTZ | |

### `pipeline_traces` — Observability

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | |
| `client_id` | TEXT | |
| `report_id` | TEXT | |
| `theme_id` | TEXT | |
| `step` | TEXT | `theme_analysis`, `synthesis`, `factuality_eval`, `specificity_eval`, `web_search`, `forward_scan` |
| `model` | TEXT | Claude model used |
| `input_tokens`, `output_tokens` | INT | |
| `duration_ms` | INT | |
| `scores` | JSONB | Evaluation scores |
| `created_at` | TIMESTAMPTZ | |

### Other tables

- **`client_feed_scores`** — Per-client relevance scores (feed_item_id + client_id unique)
- **`client_scans`** — Scan run tracking (client_id, scan_type, status, items_found)
- **`chat_conversations`** — Chat session metadata (client_id, context_entity, context_type)
- **`chat_messages`** — Chat message history with tool_calls JSONB
- **`enriched_items`** — Cached enrichment results per client (summary, client_relevance, recommended_action)

---

## Client Configuration (`types/client.ts`)

```typescript
interface ClientConfig {
  id: string;                      // Slug: "rwe", "sanofi"
  name: string;                    // Display name
  sector: string;                  // "energy", "pharmaceuticals"
  description: string;
  stakeholders: Stakeholder[];
  projects: string[];              // e.g. ["Sofia offshore wind", "Norfolk Vanguard"]
  competitors: string[];           // e.g. ["Orsted", "SSE Renewables"]
  policyKeywords: string[];        // e.g. ["CfD", "offshore wind", "Clean Power 2030"]
  industryKeywords: string[];      // e.g. ["RenewableUK", "Energy UK"]
  forwardScanQueries: string[];    // Prompts for Claude forward scan
  monitoringThemes: MonitoringTheme[];
  allKeywords: string[];           // Computed union of all keywords
}

interface Stakeholder {
  entityId: string;                // Whitehall entity ID
  priority: 'primary' | 'secondary' | 'tertiary';
  role: string;                    // Why this entity matters to the client
  notes?: string;
}

interface MonitoringTheme {
  id: string;                      // e.g. "policy-regulatory"
  name: string;                    // e.g. "Policy & Regulatory"
  entityIds: string[];             // Entities that route to this theme
  keywords: string[];              // Keywords that route to this theme
}
```

### RWE (energy sector)
28 stakeholders (DESNZ, Ofgem, NSTA, Defra, Treasury, etc.), 4 projects (Sofia, Norfolk Vanguard, Norfolk Boreas, Triton Knoll), 10 competitors, 35+ policy keywords, 6 monitoring themes.

### Sanofi (pharmaceuticals)
17 stakeholders (DHSC, MHRA, NICE, NHS England, etc.), 5 projects, 10 competitors, 30+ policy keywords, 7 monitoring themes.
