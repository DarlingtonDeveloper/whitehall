# Architecture

## System Overview

Whitehall has four data layers:

1. **Static** — 764 UK government entities (199 departments, 421 bodies, 143 officials, 1 group) with powers, budgets, staff, and relationships. Loaded from `data/_extracted/*.json` at build time.
2. **Dynamic feeds** — Feed items in Supabase PostgreSQL. Collected from 12 source modules, scored algorithmically, used for chat tools and report generation.
3. **Politician evidence** — Per-politician evidence rows (Hansard contributions, division votes, EDM signatures, register entries) classified into stance indicators with Beta-distribution scoring. Lives in `politicians`, `politician_evidence`, `politician_indicators`, etc.
4. **Config** — Client stakeholder maps, monitoring themes, and keywords. Defined in `data/clients/*.ts`.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Next.js 16 App (Vercel)                       │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  App Router   │  │  API Routes  │  │     Static Data Layer     │  │
│  │  (SSG + SSR)  │  │  8 endpoints │  │  data/_extracted/*.json   │  │
│  │               │  │  + revisions │  │  data/clients/*.ts        │  │
│  └──────┬───────┘  └──────┬──────┘  └──────────┬────────────────┘  │
│         │                 │                     │                    │
│  ┌──────┴─────────────────┴─────────────────────┘                    │
│  │  ┌────────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐    │
│  │  │ Cytoscape  │  │ AI SDK    │  │ Supabase │  │ docx      │    │
│  │  │ (graph)    │  │ (Claude)  │  │ (feeds)  │  │ (reports) │    │
│  │  └────────────┘  └───────────┘  └──────────┘  └───────────┘    │
│  │                                                                   │
└──────────────────────────────────────────────────────────────────────┘
         │                │                │
         ▼                ▼                ▼
    Browser          Anthropic API    Supabase PostgreSQL
```

## Data Flow

### Feed Collection (continuous)

```
GOV.UK Atom (34 depts) ──────┐
GOV.UK Search API (25 orgs) ─┤
Hansard (spoken + written) ───┤
Parliament APIs (7 endpoints)─┤
legislation.gov.uk (9 feeds) ─┤──▶ normalise ──▶ entity tag ──▶ fingerprint ──▶ upsert
RSS / trade press (24 feeds) ─┤     to FeedItem    (keyword      (SHA-256)       feed_items
Direct sources (18 pages) ────┤                     matching)
Committees (12 committees) ───┤
Petitions (API) ──────────────┤
Research Briefings (RSS) ─────┘
```

### Chat (real-time streaming)

```
User message ──▶ buildSystemPrompt(client, entity, viewState)
                 + streamText(model, tools, messages)
                     │
                     ├─ entity_lookup ──▶ in-memory (data/entities.ts)
                     ├─ feed_search ──▶ Supabase query
                     ├─ feed_top_items ──▶ Supabase + scoring
                     ├─ feed_deadlines ──▶ Supabase keyword search
                     ├─ stakeholder_map ──▶ in-memory (data/clients/)
                     └─ graph_action ──▶ <!--GRAPH_CMD:{json}--> in stream
                                              ▼
                                    dispatchGraphCommand() ──▶ Cytoscape
```

### Feed Collection (automated)

Collection is decoupled from report generation. Data flows into Supabase continuously:

```
EVERY 12 HOURS (Vercel cron — 8 parallel feed groups):
  /api/cron/collect?group=govuk           GOV.UK Atom + Search (by org)
  /api/cron/collect?group=govuk_search    GOV.UK Search (by doc type)
  /api/cron/collect?group=hansard         Hansard spoken + written
  /api/cron/collect?group=parliament_bills Bills, written Qs, written statements
  /api/cron/collect?group=parliament_activity Divisions, Lords divisions, EDMs, oral Qs
  /api/cron/collect?group=legislation     legislation.gov.uk
  /api/cron/collect?group=media           RSS + direct sources
  /api/cron/collect?group=research        Committees, petitions, briefings

  Each group uses a 12.5h lookback (30 min overlap). Auth: Bearer CRON_SECRET.

NIGHTLY at 03:00 (Vercel cron — politician layer):
  /api/cron/collect?group=politician_sync Members, division votes, EDM signatures

ON-DEMAND (manual):
  POST /api/scan { clientId }             Web search + forward scan (Claude-powered)

LONG-RUNNING (scripts):
  npx tsx scripts/collect-all.ts          All collectors, 12-month lookback
  npx tsx scripts/enrich-content.ts       Fetch full pages for thin items
  npx tsx scripts/run-classifier.ts       Classify pending politician evidence
  npx tsx scripts/run-math-layer.ts       Update politician_indicators (Beta) + propagate
```

### Report Generation (streaming SSE)

Report generation only reads from Supabase — no collection, no external fetches.

```
POST /api/reports/generate { clientId }
  │
  1. gather ──────── Supabase (entity overlap + keyword)
  2. score ────────── 6-component algorithm + learned signals
  3. dedup ────────── semantic clustering (Jaccard + entities + temporal)
  4. group ────────── deterministic theme classifier
  5. enrich ──────── Claude per theme + synthesis
  6. evaluate ────── template + factuality + specificity (LLM-as-judge)
  7. save ─────────── insert report_drafts

  ~60-100 seconds on Vercel Pro (300s limit)
```

## Rendering Strategy

| Page | Strategy | Details |
|------|----------|---------|
| `/` | SSG | Static shell, client-side PulseContent |
| `/client/[slug]` | SSG + Suspense | Pre-rendered. Feed streams via `FeedDataLoader` server component |
| `/entity/[id]` | SSG + Suspense | 764 entities via `generateStaticParams`. Feed streams in |
| `/client/[slug]/report/[id]` | SSR | Report loaded from Supabase at request time |
| OG images | Edge | `@vercel/og` ImageResponse |
| API routes | Dynamic | Serverless functions |

## Tech Decisions

- **Next.js 16.2.2 + React 19.2.4** — App Router, API routes, streaming, layouts, `generateStaticParams` for 764 entity pages
- **Cytoscape.js** — Compound node support for department-to-body hierarchy, force-directed layout
- **Supabase** — Managed Postgres, array operations (`overlaps`, `contains`) for entity filtering, RLS enabled on every table (anon `SELECT` only on public-facing tables; writes go through the service-role client)
- **Claude models** — `claude-opus-4-6` for chat, report chat, synthesis, and LLM-as-judge evaluation; `claude-sonnet-4-20250514` for theme enrichment, web/forward scan, and the politician evidence classifier
- **Vercel AI SDK (`ai` v6)** — `streamText` with `fullStream` for multi-step tool use, `onStepFinish` for mutation tracking; `lib/ai/retry.ts` wraps generation with bounded retries

## Key Design Decisions

**Graph command side-channel:** `streamText` has no sideband for metadata. Graph commands embedded as `<!--GRAPH_CMD:{json}-->` HTML comments — invisible if rendered, parseable mid-stream.

**Two-query merge** (`gather.ts`): Supabase PostgREST can't combine array-overlap with OR'd ilike in one query. Two queries merged and deduped client-side.

**Factuality vs specificity split:** `summary` is checked for factuality (grounded in sources). `client_relevance` is checked for specificity (references projects). Separate because `client_relevance` is *expected* to add context not in sources.

**Longest-first entity matching** (`ChatMessage.tsx`): Entity names sorted by length descending to prevent "Home" matching before "Home Office".

## Cross-Component Communication

| Store | File | Purpose |
|-------|------|---------|
| `panelStore` | `lib/panelStore.ts` | Panel open/close, entity/client selection |
| `feedFilterStore` | `lib/feedFilterStore.ts` | Health dashboard metric → feed filter |
| `feedViewStore` | `lib/feedViewStore.ts` | Feed state → chat system prompt |
| `chatStore` | `lib/chatStore.ts` | Conversation state for the intelligence panel |
| `chatActions` | `lib/chatActions.ts` | "Why relevant?" / "Morning briefing" → chat |
| `graphCommands` | `lib/graphCommands.ts` | Chat graph_action → Cytoscape |
| `clientOverrides` | `lib/clientOverrides.ts` | User keyword/theme customisations (localStorage) |

Stores use `useSyncExternalStore` for React integration; `chatActions` and `graphCommands` are simple pub/sub modules.

## Politician Evidence Pipeline

A separate pipeline runs nightly to track UK politicians' policy stances.

```
parliament-members.ts ──▶ politicians, politician_roles
parliament-divisions.ts ─▶ politician_evidence (division_vote)
parliament-edms.ts ──────▶ politician_evidence (edm_signature, edm_proposed)
hansard contributions ───▶ politician_evidence (hansard_*)
register of interests ───▶ politician_evidence (register_*)

      ▼
lib/classifier/  (deterministic for division/register/APPG/committee,
                  LLM-classified via claude-sonnet-4-20250514 otherwise)
  → politician_indicator_evidence (anchor + effective_weight + reasoning)
  → classifier_failures (dead-letter)

      ▼
lib/math/pipeline.ts
  → politician_indicators  (Beta(α,β) updates per classification)
  → propagate via indicator_correlations (single-hop)
  → refresh materialized view politician_indicators_decayed
```

Run on demand via `scripts/run-classifier.ts` and `scripts/run-math-layer.ts`. See [Data Model](data-model.md#politician-tables) for table definitions.
