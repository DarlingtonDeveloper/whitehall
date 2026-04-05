# Architecture

Technical architecture reference for Whitehall. This document covers data flow, key modules, and design rationale.

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Next.js App (Vercel)                      │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  App Router  │  │  API Routes  │  │     Static Data Layer   │ │
│  │  (pages)     │  │  /api/chat   │  │  data/_extracted/*.json │ │
│  │             │  │  /api/export  │  │  data/clients/*.ts      │ │
│  └──────┬──────┘  └──────┬───────┘  └────────────┬────────────┘ │
│         │                │                        │              │
│  ┌──────┴──────────────────────────────────────────┘              │
│  │                                                               │
│  │  ┌────────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐ │
│  │  │ Cytoscape  │  │ AI SDK    │  │ Supabase │  │ docx      │ │
│  │  │ (graph)    │  │ (Claude)  │  │ (feeds)  │  │ (reports) │ │
│  │  └────────────┘  └───────────┘  └──────────┘  └───────────┘ │
│  │                                                               │
└──────────────────────────────────────────────────────────────────┘
         │                │                │
         │                ▼                ▼
         │          Anthropic API    Supabase (PostgreSQL)
         ▼
    Browser (React 19)
```

## Data Flow

### 1. Feed Collection (offline)

```
GOV.UK Atom ─────────┐
GOV.UK Search API ───┤
Hansard ─────────────┤──▶ scripts/collect-all.ts ──▶ Supabase feed_items
Parliament APIs ─────┤     (dedup by fingerprint)
legislation.gov.uk ──┘
```

Each collector normalises source data into a common `FeedItem` shape and upserts with a unique fingerprint to prevent duplicates. Entity tagging happens during collection — each item's `entity_ids` array is populated by matching entity names against the item's title and body.

### 2. Chat (real-time streaming)

```
User message
    │
    ▼
POST /api/chat
    │
    ├── buildSystemPrompt(clientId, entityId)
    │   └── Injects client context, entity context, stakeholder map
    │
    ├── streamText({ model, system, messages, tools })
    │   │
    │   ├── Tool: entity_lookup ──▶ data/entities.ts (in-memory search)
    │   ├── Tool: feed_search ──▶ Supabase query
    │   ├── Tool: stakeholder_map ──▶ data/clients/ (in-memory)
    │   └── Tool: graph_action ──▶ Returns command, emitted as <!--GRAPH_CMD-->
    │
    └── ReadableStream ──▶ text/plain response
                              │
                              ▼
                         ChatDrawer.tsx
                              │
                              ├── Parse <!--GRAPH_CMD:{json}--> markers
                              │   └── dispatchGraphCommand() ──▶ pub/sub bus
                              │                                     │
                              │                                     ▼
                              │                              EntityGraph.tsx
                              │                              (select, search, filter)
                              │
                              └── Display cleaned text as markdown
```

**Why HTML comment markers for graph commands?**

`streamText` produces a single text stream — there is no structured sideband for out-of-band metadata. HTML comments are invisible if accidentally rendered as markdown, trivially parseable with a regex, and can be emitted mid-stream as soon as a tool resolves.

### 3. Report Generation (batch)

```
POST /api/export { clientId }
    │
    ├── 1. GATHER ── gatherItems(client, from, to)
    │   │   Query 1: entity_ids overlap with stakeholder IDs
    │   │   Query 2: title keyword match (top 30 keywords)
    │   │   Merge + deduplicate by id
    │   │
    │   └── FeedItem[]
    │
    ├── 2. GROUP ── groupByTheme(items, client)
    │   │   Route each item to one theme:
    │   │   entity overlap → keyword match → 'other'
    │   │
    │   └── Record<themeId, FeedItem[]>
    │
    ├── 3. ENRICH ── enrichItems(grouped, client, dateRange)
    │   │   Parallel Claude calls per theme (generateText)
    │   │   Then synthesis pass (exec summary, forward look, etc.)
    │   │
    │   └── AnalysisJSON
    │
    ├── 4. EVALUATE ── evaluateReport(analysis, items, client)
    │   │   Template validation (30 deterministic checks)
    │   │   Factuality check (LLM-as-judge, threshold > 0.7)
    │   │   Specificity check (LLM-as-judge, threshold > 0.5)
    │   │   Flag items → cap confidence at 0.5
    │   │
    │   └── EvaluationResult
    │
    └── 5. GENERATE ── generateReport(analysis, client)
        │   docx-js: cover page, exec summary, theme sections,
        │   item cards with RAG dots, forward look, actions tracker
        │
        └── Buffer ──▶ DOCX response
```

## Module Reference

### AI Chat (`lib/chat/`)

| File | Purpose |
|------|---------|
| `systemPrompt.ts` | Builds the system prompt with client/entity context, stakeholder maps, and policy keywords |
| `tools.ts` | Four AI SDK `tool()` definitions with Zod input schemas and execute functions |

The chat uses `streamText` with `stopWhen: stepCountIs(5)` to allow multi-step tool use (the model can call tools and reason about results up to 5 times per request).

### Export Pipeline (`lib/export/`)

| File | Purpose |
|------|---------|
| `gather.ts` | Two-query Supabase merge + `groupByTheme` classifier |
| `enrich.ts` | Parallel theme analysis + synthesis via `generateText` |
| `evaluate.ts` | Template validator + factuality/specificity LLM-as-judge |
| `docx-generator.ts` | 650+ line DOCX builder matching WA branding spec |
| `prompts.ts` | Theme-specific and synthesis prompts for Claude |
| `types.ts` | `AnalysisJSON` schema (contract between enrichment and DOCX) |

### Feed Collectors (`lib/feeds/`)

| File | Source | Method |
|------|--------|--------|
| `govuk.ts` | GOV.UK Atom feeds | RSS/Atom parsing per department |
| `govuk-search.ts` | GOV.UK Search API | REST API, 12-month lookback |
| `hansard.ts` | Hansard | REST API, debate/speech text |
| `parliament.ts` | Parliament APIs | Bills, questions, divisions, statements |
| `legislation.ts` | legislation.gov.uk | Atom feed for new/amended legislation |

### Graph Visualisation (`lib/graph/`)

| File | Purpose |
|------|---------|
| `layout.ts` | Cytoscape layout algorithms (hierarchical, force-directed) |
| `pulse.ts` | Inverse-recency pulse scoring: `1/max(hoursAgo, 1)` |
| `shapes.ts` | Node shapes by entity category |
| `tiers.ts` | Priority ring layout for stakeholder graphs |

### Static Data (`data/`)

All reference data lives in `data/_extracted/*.json` and is exposed through TypeScript modules with search/lookup functions:

| Module | Content |
|--------|---------|
| `entities.ts` | 300+ UK government entities with `getEntity()`, `searchEntities()` |
| `powers.ts` | Statutory powers by entity, with legislation sources |
| `relationships.ts` | Parent/child and secondary relationships |
| `budgets.ts` | Departmental budget data |
| `staff.ts` | Key personnel |
| `tags.ts` | Category and sector tags with colours |
| `jurisdictions.ts` | Jurisdiction hierarchy (UK, England, Scotland, Wales, NI) |
| `clients/` | Client configs with stakeholders, themes, keywords |

## Database Schema

Single Supabase project with these tables:

```sql
feed_items           -- Core table: all collected feed items
  ├── entity_ids[]   -- Tagged government entities
  ├── fingerprint    -- Deduplication key (unique)
  └── published_at   -- Used for time-range queries

client_feed_scores   -- Per-client relevance scores
client_scans         -- Collection run tracking
chat_conversations   -- Chat session metadata
chat_messages        -- Chat message history with tool calls
enriched_items       -- Cached enrichment results per client
```

Key indexes: `published_at DESC`, `source_type`, `entity_ids` (GIN), `fingerprint`, `monitoring_theme`.

## Theming

CSS custom properties defined in `app/globals.css`:

```css
/* Dark mode (default) */
:root { --wh-bg: #0a0a0f; --wh-accent-teal: #2dd4bf; ... }

/* Light mode */
.light { --wh-bg: #f8f9fa; --wh-accent-teal: #0d9488; ... }
```

Components reference these as Tailwind utilities: `bg-wh-bg`, `text-wh-accent-teal`, `border-wh-border`, etc. Theme persistence is handled via `localStorage` in the root layout.

## Evaluation Design

The evaluation layer is a direct port of the monitoring agent's `evaluate/` module. Key design choices:

**Factuality vs Specificity split:** The factuality check evaluates only the `summary` field against source material. `client_relevance` is evaluated separately for specificity because it is *expected* to add context not present in sources (project names, commercial positions). Evaluating it for factuality would penalise correct behaviour.

**Thresholds:**
- Factuality > 0.7: summaries must be well-grounded in source material
- Specificity > 0.5: client_relevance must reference specific projects, not just generic sector commentary
- Template validation: 0 errors (warnings are logged but don't fail)

**Confidence reduction:** Items flagged by either LLM judge get `confidence = min(confidence, 0.5)`. The DOCX generator renders items with confidence < 0.6 with an `[UNVERIFIED]` prefix, giving analysts a visual cue to double-check.
