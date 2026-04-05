# Whitehall

AI-powered political intelligence platform built for [WA Communications](https://www.wacomms.co.uk/), a UK public affairs consultancy. Whitehall maps the structure of UK government — departments, ministers, regulators, public bodies, and their statutory powers — and layers real-time parliamentary activity on top, giving analysts a live picture of who matters, what's changing, and what it means for their clients.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5, React 19 |
| Styling | Tailwind CSS 4, CSS custom properties |
| Database | Supabase (PostgreSQL) |
| AI | Vercel AI SDK (`ai` + `@ai-sdk/anthropic`), Claude Sonnet |
| Graph | Cytoscape.js |
| Reports | docx (OOXML generation) |

## Features

### Interactive Entity Graph
Visualises 300+ UK government entities — ministerial departments, NDPBs, executive agencies, regulators, select committees — as an interactive network. Three view modes: hierarchical entity graph, constellation layout, and pulse view (recency-weighted activity heatmap).

### AI Chat (Intelligence Panel)
Streaming chat powered by the Vercel AI SDK with four tools the model can invoke mid-conversation:

- **entity_lookup** — search entities by name, ID, or current holder
- **feed_search** — query recent parliamentary activity, consultations, and press releases from Supabase
- **stakeholder_map** — retrieve a client's full stakeholder map with priority tiers
- **graph_action** — manipulate the graph visualisation (select entity, search, filter, focus mode)

Graph commands are embedded as `<!--GRAPH_CMD:{json}-->` HTML comment markers in the text stream and dispatched client-side via a pub/sub bus. See `lib/graphCommands.ts`.

### Feed Aggregation
Collectors pull from five UK government data sources and deduplicate into the `feed_items` table:

| Source | Module | Data |
|--------|--------|------|
| GOV.UK Atom | `lib/feeds/govuk.ts` | Department publications |
| GOV.UK Search API | `lib/feeds/govuk-search.ts` | 12-month historical archive |
| Hansard | `lib/feeds/hansard.ts` | Parliamentary speeches and debates |
| Parliament APIs | `lib/feeds/parliament.ts` | Bills, questions, divisions, statements |
| legislation.gov.uk | `lib/feeds/legislation.ts` | New and amended legislation |

Run all collectors: `npx tsx scripts/collect-all.ts`

### Weekly Monitoring Reports (DOCX)
End-to-end report generation pipeline matching the output of the standalone [wa-monitoring-agent](https://github.com/DarlingtonDeveloper/wa-monitoring-agent):

1. **Gather** — two-query Supabase merge (entity overlap + keyword match) with client-side dedup
2. **Group** — deterministic theme classifier routes items to monitoring themes
3. **Enrich** — parallel Claude calls per theme, then cross-cutting synthesis
4. **Evaluate** — template validation (30 structural checks) + LLM-as-judge factuality/specificity
5. **Generate** — branded DOCX with cover page, executive summary, RAG-rated item cards, theme sections, forward look, actions tracker

Triggered via the "Generate briefing" button on any client view, or `POST /api/export`.

### Multi-Client Support
Each client configuration defines stakeholders (with priority tiers), monitoring themes, policy/industry keywords, competitors, and projects. The system prompt, feed filtering, and report generation all adapt to the active client context.

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project
- An Anthropic API key

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Then fill in:
#   ANTHROPIC_API_KEY=sk-ant-...
#   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=eyJ...
```

### Database

Apply the schema to your Supabase project:

```bash
# Via Supabase SQL editor, run:
cat supabase/schema.sql
```

This creates the `feed_items`, `client_feed_scores`, `client_scans`, `chat_conversations`, `chat_messages`, and `enriched_items` tables.

### Run

```bash
# Development
npm run dev

# Populate feed data (optional — runs all 5 collectors)
npx tsx scripts/collect-all.ts

# Production build
npm run build && npm start
```

## Project Structure

```
whitehall/
├── app/
│   ├── api/
│   │   ├── chat/route.ts          # POST /api/chat — streaming AI chat
│   │   └── export/route.ts        # POST /api/export — DOCX report generation
│   ├── client/[slug]/page.tsx     # Client dashboard
│   ├── entity/[id]/page.tsx       # Entity detail page
│   ├── layout.tsx                 # Root layout (theme, fonts)
│   ├── page.tsx                   # Home — renders Shell + PulseContent
│   └── globals.css                # Tailwind + CSS custom properties
│
├── components/
│   ├── chat/                      # ChatDrawer, ChatMessage, SuggestedQuestions
│   ├── client/                    # ClientPanel, ClientSwitcher
│   ├── entity/                    # EntityPanel, BudgetTab, PowersTab, etc.
│   ├── export/                    # ExportButton
│   ├── feed/                      # FeedItem, FeedPanel
│   ├── graph/                     # EntityGraph, ConstellationView, PulseView
│   ├── intelligence/              # IntelligencePanel
│   ├── layout/                    # Shell, NavBar, PanelContext, ThemeToggle
│   ├── pulse/                     # PulseContent
│   └── sidebar/                   # FilterPanel, GraphLegend, PulseSidebar
│
├── lib/
│   ├── chat/                      # systemPrompt.ts, tools.ts (AI SDK tool defs)
│   ├── export/                    # gather, enrich, evaluate, docx-generator, prompts
│   ├── feeds/                     # govuk, hansard, parliament, legislation collectors
│   ├── graph/                     # layout, pulse scoring, shapes, tiers
│   ├── graphCommands.ts           # Pub/sub bus for chat → graph commands
│   └── db.ts                      # Supabase client
│
├── data/
│   ├── _extracted/                # Source JSON (entities, powers, budgets, etc.)
│   ├── clients/                   # Client configs (rwe.ts, sanofi.ts)
│   ├── entities.ts                # Entity lookup + search
│   ├── powers.ts                  # Statutory powers
│   ├── relationships.ts           # Parent/child entity relationships
│   └── ...                        # budgets, tags, jurisdictions, staff, colours
│
├── types/                         # TypeScript interfaces (entity, client, feed, chat)
├── scripts/                       # Feed collection and seeding scripts
├── supabase/                      # Database schema (schema.sql)
└── public/                        # Static assets
```

## API Routes

### `POST /api/chat`

Streaming AI chat endpoint.

**Request:**
```json
{
  "message": "Who is the Secretary of State for Energy?",
  "clientId": "rwe",
  "entityId": "desnz",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Response:** `text/plain` stream with optional `<!--GRAPH_CMD:{...}-->` markers.

### `POST /api/export`

Generates a branded DOCX weekly monitoring report.

**Request:**
```json
{
  "clientId": "rwe",
  "dateRange": { "from": "2025-03-01", "to": "2025-03-07" },
  "skipEval": false
}
```

**Response:** Binary DOCX file (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`).

## Evaluation

The report pipeline includes a three-stage evaluation layer ported from the monitoring agent:

| Check | Method | Threshold | What it catches |
|-------|--------|-----------|-----------------|
| Template validation | Deterministic (30 checks) | 0 errors | Missing fields, invalid RAG/escalation values, uncalibrated confidence |
| Factuality | LLM-as-judge | > 0.7 | Summaries not grounded in source material |
| Specificity | LLM-as-judge | > 0.5 | Generic client_relevance that doesn't reference specific projects |

Items flagged by either LLM judge get their confidence capped at 0.5, which triggers `[UNVERIFIED]` markers in the DOCX output.

## Architecture Decisions

Key design decisions are documented inline. The notable ones:

- **Graph command side-channel** (`app/api/chat/route.ts`): `streamText` returns a single text stream with no built-in sideband. Graph commands are embedded as HTML comment markers — invisible if accidentally rendered, trivially parseable, and emittable mid-stream.

- **Two-query merge** (`lib/export/gather.ts`): Supabase PostgREST cannot combine array-overlap with OR'd ilike patterns in a single query. Two separate queries (entity overlap + keyword match) are merged and deduplicated client-side.

- **Inverse-recency pulse scoring** (`lib/graph/pulse.ts`): `1/max(hoursAgo, 1)` weights recent items exponentially higher. A single item from 1 hour ago (score: 1.0) outweighs 25 items from 24 hours ago (score: ~0.04 each ≈ 1.0 total).

- **Longest-first entity matching** (`components/chat/ChatMessage.tsx`): Entity names are sorted by length descending before regex matching to prevent "Department for Energy" from matching before "Department for Energy Security and Net Zero".

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for chat and report enrichment |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Yes | Supabase anon/public key |

## Deployment

Deploy to Vercel:

```bash
vercel
```

Set environment variables in the Vercel dashboard. The export endpoint uses `maxDuration = 300` (5 minutes) for report generation — this requires a Pro plan or higher.

## License

Proprietary. Built for WA Communications.
