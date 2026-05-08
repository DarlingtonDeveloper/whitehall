# Reports

## Generation Pipeline

Implemented in `lib/report/generate.ts`. The streaming API route (`/api/reports/generate`) exposes each step as an SSE progress event.

Collection is fully decoupled from report generation — the pipeline only reads from Supabase, never fetches from external sources. Collection runs via `/api/cron/collect` (every 12 hours), manual `/api/scan`, and `scripts/collect-all.ts`.

```
1. GATHER ─────── gatherItems (Supabase: entity overlap + keyword match, max 500)
2. SCORE ──────── computeFeedRelevance (6-component algorithm + learned signals)
                   Filter: score >= 0.25, take top 60
3. DEDUP ──────── deduplicateSemantic (Jaccard + entity overlap + temporal proximity)
4. SELECT ─────── Top 40 items post-dedup (MAX_ITEMS)
5. GROUP ──────── groupByTheme (deterministic: entity overlap → keyword match → 'other')
6. ENRICH ─────── enrichItems (claude-sonnet-4-20250514 per theme @ concurrency 2,
                   then claude-opus-4-6 synthesis pass with extended thinking)
6b. CITATION ──── Items whose source_items[0] fingerprint isn't in the gathered set
                   have confidence reduced by 0.2 (floor 0.3)
7. EVALUATE ───── evaluateReport (template + factuality + specificity LLM-as-judge)
8. SAVE ───────── Insert report_drafts with sections + original_sections
```

Expected timing on Vercel Pro (300s limit): ~60-100 seconds total.

### Step Details

**Gather** (`lib/export/gather.ts`): Two Supabase queries — entity_ids overlap with stakeholder IDs, then title keyword match (top 30 keywords). Merge and deduplicate by ID.

**Group** (`lib/export/gather.ts`): Routes each item to one monitoring theme. Priority: entity overlap match → keyword match → 'other' bucket.

**Enrich** (`lib/export/enrich.ts`): One `claude-sonnet-4-20250514` call per theme with `buildThemePrompt()`, run with bounded concurrency 2 via `mapWithConcurrency`. Produces `AnalysedItem` objects with headline, summary, client_relevance, recommended_action, rag, escalation, confidence. Then a synthesis pass on `claude-opus-4-6` (with extended thinking) produces executive_summary, forward_look, emerging_themes, actions_tracker, coverage_summary.

**Evaluate** (`lib/export/evaluate.ts`): Three layers:
1. Template validation (~30 deterministic checks): required fields, valid RAG/escalation values, section structure
2. Factuality (LLM-as-judge): summaries grounded in source material, threshold > 0.7
3. Specificity (LLM-as-judge): client_relevance references specific projects, threshold > 0.5

Items flagged by either LLM judge get `confidence = min(confidence, 0.5)`.

---

## Report Builder UI

Three-panel layout in `components/report/`:

| Panel | Component | Width |
|-------|-----------|-------|
| Left | `ReportOutline` | 280px |
| Center | `ReportContent` | flex-1 |
| Right | `ReportChat` | 360px |

### ReportOutline

Navigable table of contents. Sections numbered (1 for executive summary, 2+ for themes). Shows RAG indicator (derived from items), item count per section. Click scrolls to section.

### ReportContent

Renders the full report with inline editing:

1. **Executive Summary** — top line + key developments
2. **Theme Sections** — numbered 2+, each with AnalysedItem cards
3. **Forward Look** — calendar table (event/date/relevance/preparation)
4. **Emerging Themes** — paragraph text
5. **Actions Tracker** — ref/action/owner/deadline/origin/status table
6. **Coverage Summary** — metrics

### ReportItemCard

Each item card supports:
- Inline editing of headline, summary, client_relevance, recommended_action
- Click-to-cycle RAG (RED → AMBER → GREEN) and escalation (STANDARD → HIGH → IMMEDIATE)
- Delete button
- Confidence warning for items < 0.7

Edits persist via `PATCH /api/reports/[id]` with updated `sections` JSON.

### ReportChat

AI assistant for editing. Streaming response with mutation markers:
- Parses `<!--MUTATION:{json}-->` from response stream
- Applies mutations to local state immediately
- Context-aware quick actions based on active section/item

Mutations from chat tools and `PATCH /api/reports/[id]` flow through `lib/report/mutations.ts` (`applyEditField`, `applyRemoveItem`, `applyMoveItem`, `applyAddItem`). `saveReportContent()` always snapshots the prior `sections` blob into `report_revisions` before updating `report_drafts`, recording `edit_source` (`manual_patch`, `chat_mutation`, or `rollback`), an optional `mutation_summary`, and the linking `chat_message_id`. The history is exposed via `GET /api/reports/[id]/revisions` and rolled back via `POST /api/reports/[id]/revisions`.

---

## Review Workflow

```
generating → draft → in_review → approved → exported
```

| Status | Meaning | Transitions |
|--------|---------|-------------|
| `generating` | Pipeline running | → `draft` on completion |
| `draft` | Editable, analyst working | → `in_review` (generates review_token) |
| `in_review` | Pending senior review | → `approved` or back to `draft` |
| `approved` | Cleared for export | → `exported` (on DOCX download) |
| `exported` | DOCX generated and downloaded | Terminal |

Status changes via `PATCH /api/reports/[id]` with `{ status: "..." }`. Timestamps auto-set: `review_requested_at`, `approved_at`, `exported_at`.

---

## DOCX Generation (`lib/export/docx-generator.ts`)

Uses the `docx` library (OOXML). ~1168 lines.

### AnalysisJSON Schema (`lib/export/types.ts`)

```typescript
interface AnalysisJSON {
  metadata: {
    client_name: string;
    reporting_period: string;
    report_date: string;
    generated_at: string;
    items_collected: number;
    items_analysed: number;
    sources_unavailable?: string[];
  };
  executive_summary: {
    top_line: string;
    key_developments: string[];
  };
  sections: Record<string, ThemeSection>;
  forward_look: ForwardLookItem[];
  emerging_themes: string[];
  actions_tracker: ActionItem[];
  coverage_summary: CoverageMetric[];
}
```

### Document Structure

1. **Cover page** — Client name, reporting period, metadata table
2. **Executive summary** — Top line paragraph + key developments table
3. **Theme sections** — Item cards with RAG colour dots, escalation badges, confidence markers
4. **Forward look** — Event/date/relevance/preparation table
5. **Emerging themes** — Paragraph text
6. **Actions tracker** — Ref/action/owner/deadline/origin/status table
7. **Coverage summary** — Metrics comparison table

### Design Constants

- Colours: NAVY=#1B3A5C, DARK_GREY=#333333, RED_BG=#FFE6E6, AMBER_BG=#FFF3E0, GREEN_BG=#E6FFE6
- Page: A4 (11906x16838 DXA), 1" margins, Arial font
- Tables: Grey label column (2000 DXA) + content column

Items with `confidence < 0.7` get `[UNVERIFIED]` prefix in amber.

---

## Feedback Loop

### Diff Computation (`lib/report/diff.ts`)

`computeReportDiff()` compares `original_sections` with edited `sections` matching items by `source_items[0]` fingerprint, falling back to `item.ref`:

```typescript
interface ReportDiff {
  items_removed: Array<{ section_id, item_ref, reason? }>;
  items_added: Array<{ section_id, item_ref, feed_item_id?, reason? }>;
  rag_changes: Array<{ item_ref, old_rag, new_rag, reason? }>;
  field_edits: Array<{ item_ref, field, old_value, new_value, reason? }>;
}
```

`field_edits` only tracks four fields: `headline`, `summary`, `client_relevance`, and `recommended_action`.

### Signal Updates (`lib/report/feedback.ts`)

`updateLearnedSignals()` converts editorial diffs into scoring adjustments. Note the keying — these don't all bucket by `source_type`:

- **Items removed** → `source_boosts[item.source_name] -= 0.01` (keyed by human-readable source name)
- **Items added** → for every keyword in `client.allKeywords`, `keyword_boosts[keyword] += 0.01` (broader than just keywords parsed from the new item's title)
- **RAG upgraded to RED** → `rag_adjustments[item.ref] = { red_threshold: 0.6, amber_threshold: 0.3 }`

Upserted to `client_learned_signals`. Applied in future [scoring](scoring.md) via `getLearnedSignals()`.
