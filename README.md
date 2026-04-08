# Whitehall

AI-powered political intelligence platform built for [WA Communications](https://www.wacomms.co.uk/), a UK public affairs consultancy. Whitehall maps the structure of UK government — departments, ministers, regulators, public bodies, and their statutory powers — and layers real-time parliamentary activity on top, giving analysts a live picture of who matters, what's changing, and what it means for their clients.

**What it replaces:** 3-4 hours of manual monitoring per client per week — scanning GOV.UK, Hansard, legislation feeds, select committee pages, trade press, and petitions — automated into a scored, themed, report-ready feed with AI-generated weekly monitoring reports.

![Next.js](https://img.shields.io/badge/Next.js_16-black?logo=next.js) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white) ![Claude](https://img.shields.io/badge/Claude_Sonnet-D97706?logo=anthropic&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?logo=tailwindcss&logoColor=white) ![Vercel](https://img.shields.io/badge/Vercel-000?logo=vercel)

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, SSR, streaming) |
| Language | TypeScript 5, React 19 |
| Styling | Tailwind CSS 4, CSS custom properties |
| Database | Supabase (PostgreSQL) |
| AI | Vercel AI SDK + `@ai-sdk/anthropic`, Claude Sonnet 4 |
| Graph | Cytoscape.js (compound nodes, force-directed layout) |
| Reports | `docx` (OOXML generation) |
| Analytics | Vercel Analytics + Speed Insights |

## Quick Start

```bash
git clone https://github.com/DarlingtonDeveloper/whitehall.git
cd whitehall
npm install
cp .env.example .env.local
# Fill in your API keys (see Environment Variables below)
npm run dev
```

### Database Setup

Apply the schema to your Supabase project:

```bash
# Via Supabase SQL editor, paste contents of:
cat supabase/schema.sql
```

### Populate Feed Data

```bash
# Run all 12 collectors (GOV.UK, Hansard, Parliament, legislation, RSS, committees, petitions, research)
npx tsx scripts/collect-all.ts

# Or seed with demo data
npx tsx scripts/seed-feeds.ts
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Yes | Supabase anon/public key (safe for client-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Server-side Supabase key (bypasses RLS). Falls back to publishable key |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for chat, report enrichment, web search, forward scan |
| `OPIK_API_KEY` | No | Opik observability (forwards traces alongside Supabase logging) |
| `OPIK_API_URL` | No | Opik endpoint (defaults to `http://localhost:5173`, cloud: `https://www.comet.com/opik`) |
| `NEXT_PUBLIC_APP_URL` | No | App base URL for OG images (defaults to `https://whitehall.vercel.app`) |
| `CRON_SECRET` | Yes (prod) | Bearer token for `/api/cron/collect` authentication |

See [`.env.example`](.env.example) for a template.

## Available Scripts

### npm scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |

### Collection scripts (`scripts/`)

| Script | Command | Description |
|--------|---------|-------------|
| `collect-all.ts` | `npx tsx scripts/collect-all.ts` | Run all 10 collectors in sequence |
| `collect-govuk.ts` | `npx tsx scripts/collect-govuk.ts` | GOV.UK Atom feeds (35 departments) |
| `collect-govuk-search.ts` | `npx tsx scripts/collect-govuk-search.ts` | GOV.UK Search API (26 orgs, 17 doc types, 365-day lookback) |
| `collect-hansard.ts` | `npx tsx scripts/collect-hansard.ts` | Hansard debates and statements |
| `collect-parliament.ts` | `npx tsx scripts/collect-parliament.ts` | Bills, questions, divisions, statements, EDMs, oral questions |
| `collect-legislation.ts` | `npx tsx scripts/collect-legislation.ts` | legislation.gov.uk (9 Atom feeds) |
| `collect-rss.ts` | `npx tsx scripts/collect-rss.ts` | Trade press RSS feeds (25 sources) |
| `collect-direct-sources.ts` | `npx tsx scripts/collect-direct-sources.ts` | Web scraping (19 government/regulator pages) |
| `collect-committees.ts` | `npx tsx scripts/collect-committees.ts` | Select committee pages (13 committees) |
| `collect-petitions.ts` | `npx tsx scripts/collect-petitions.ts` | Parliament petitions API |
| `collect-research-briefings.ts` | `npx tsx scripts/collect-research-briefings.ts` | Commons & Lords Library briefings |

### Utility scripts

| Script | Command | Description |
|--------|---------|-------------|
| `enrich-content.ts` | `npx tsx scripts/enrich-content.ts` | Fetch full page content for thin items (<500 chars) |
| `retag-all.ts` | `npx tsx scripts/retag-all.ts` | Re-tag all items with content-aware entity enrichment |
| `clean-titles.ts` | `npx tsx scripts/clean-titles.ts` | Backfill clean titles on existing items |
| `seed-feeds.ts` | `npx tsx scripts/seed-feeds.ts` | Insert ~50 demo items |
| `delete-seed.ts` | `npx tsx scripts/delete-seed.ts` | Remove demo items |
| `debug-scoring.ts` | `npx tsx scripts/debug-scoring.ts ["query"] [--client id]` | Score breakdown for items matching a query |
| `verify-monitoring-agent-items.ts` | `npx tsx scripts/verify-monitoring-agent-items.ts` | Check coverage against monitoring agent items |
| `eval-against-ground-truth.ts` | `npx tsx scripts/eval-against-ground-truth.ts --report-id <id> --ground-truth <path>` | Compare report against human selections |

## Project Structure

```
whitehall/
├── app/
│   ├── api/
│   │   ├── chat/route.ts              # Streaming AI chat with tool use
│   │   ├── cron/collect/route.ts      # Scheduled feed collection (8 groups, every 4h)
│   │   ├── export/route.ts            # Full DOCX report generation
│   │   ├── scan/route.ts              # Web search + forward scan (manual)
│   │   └── reports/
│   │       ├── generate/route.ts      # Streaming report generation with SSE progress
│   │       └── [id]/
│   │           ├── route.ts           # GET/PATCH report draft
│   │           ├── chat/route.ts      # Report editing chat with mutation tools
│   │           └── export/route.ts    # Export approved report as DOCX
│   ├── client/[slug]/
│   │   ├── page.tsx                   # Client dashboard (stakeholders, graph, feed)
│   │   ├── opengraph-image.tsx        # Dynamic OG image (edge runtime)
│   │   └── report/[id]/page.tsx       # Report builder
│   ├── entity/[id]/
│   │   ├── page.tsx                   # Entity detail (panel, feed)
│   │   └── opengraph-image.tsx        # Dynamic OG image (edge runtime)
│   ├── layout.tsx                     # Root layout (theme, fonts, analytics)
│   └── page.tsx                       # Pulse view (home)
│
├── components/
│   ├── chat/                          # ChatDrawer, ChatMessage, SuggestedQuestions
│   ├── client/                        # ClientPanel, ClientHealthDashboard, ClientSwitcher
│   ├── entity/                        # EntityPanel, BudgetTab, PowersTab, RelationshipsTab, StaffTab
│   ├── feed/                          # FeedPanel, FeedItem, FeedDataLoader (server component)
│   ├── graph/                         # EntityGraph, ConstellationView, PulseView, GraphTooltip
│   ├── intelligence/                  # IntelligencePanel
│   ├── layout/                        # Shell, NavBar, ThemeToggle
│   ├── report/                        # ReportBuilder, ReportChat, ReportContent, ReportOutline, ReportItemCard
│   └── sidebar/                       # PulseSidebar, FilterPanel, GraphLegend
│
├── lib/
│   ├── chat/                          # systemPrompt.ts, tools.ts
│   ├── export/                        # gather, enrich, evaluate, docx-generator, prompts, types
│   ├── feed/                          # scoring.ts (relevance algorithm)
│   ├── feeds/                         # 12 collectors + enrichment + dedup + verification
│   ├── report/                        # generate.ts, tools.ts, mutations.ts, diff.ts, feedback.ts
│   ├── security/                      # sanitise.ts, validateInput.ts, rateLimit.ts
│   ├── observability/                 # opik.ts (tracing)
│   ├── db.ts                          # Supabase client (public + service)
│   ├── audit.ts                       # Audit logging
│   └── ...                            # Stores: panelStore, feedFilterStore, feedViewStore, chatActions, graphCommands, clientOverrides
│
├── data/
│   ├── _extracted/                    # Source JSON (entities, powers, budgets, staff)
│   ├── clients/                       # Client configs (rwe.ts, sanofi.ts)
│   ├── entities.ts                    # 764 UK government entities
│   ├── powers.ts, relationships.ts    # Statutory powers and entity relationships
│   └── budgets.ts, staff.ts, tags.ts  # Financial, personnel, and classification data
│
├── types/                             # TypeScript interfaces (entity, client, feed, report, chat)
├── scripts/                           # 20 collection, enrichment, and debugging scripts
├── supabase/                          # Database schema (schema.sql)
├── docs/                              # Detailed documentation
├── vercel.json                        # Cron jobs (8 collection groups, every 4h)
└── middleware.ts                       # Edge middleware (client routing hint)
```

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System overview, data flow, rendering strategy, tech decisions |
| [Data Model](docs/data-model.md) | Entity types, database schema, client configuration |
| [Collectors](docs/collectors.md) | All 12 feed sources with APIs, entity tagging, dedup |
| [Scoring](docs/scoring.md) | Feed relevance algorithm (6 components, learned signals) |
| [Chat](docs/chat.md) | Intelligence and report chat: tools, prompts, graph commands |
| [Reports](docs/reports.md) | Generation pipeline, builder UI, review workflow, DOCX format |
| [API Reference](docs/api.md) | All 9 API routes with request/response schemas |
| [Security](docs/security.md) | Prompt injection defence, rate limiting, input validation |

## Deployment

Deploy to Vercel (Pro plan required for 300s function timeout and cron jobs).

Set environment variables in the Vercel dashboard — at minimum `ANTHROPIC_API_KEY`, `CRON_SECRET`, and the Supabase keys.

### Cron Jobs

Configured in `vercel.json`. Eight parallel cron jobs run every 4 hours to collect from all structured API sources (GOV.UK, Hansard, Parliament, legislation, RSS, committees, petitions, research briefings). Each uses a 4.5-hour lookback window.

Report generation (`/api/reports/generate`) is decoupled from collection — it only reads from Supabase and completes in ~60-100 seconds.

### Observability

All Claude calls (report generation, chat, report editing) are traced to Opik and the `pipeline_traces` Supabase table. Set `OPIK_API_KEY` and `OPIK_API_URL` for Opik cloud forwarding.

## License

Proprietary. Built for WA Communications.
