# Architecture

## System Overview

Whitehall has three data layers:

1. **Static** — 764 UK government entities with powers, budgets, staff, and relationships. Loaded from `data/_extracted/*.json` at build time.
2. **Dynamic** — Feed items in Supabase PostgreSQL. Collected from 12 sources, scored algorithmically, used for chat tools and report generation.
3. **Config** — Client stakeholder maps, monitoring themes, and keywords. Defined in `data/clients/*.ts`.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Next.js 16 App (Vercel)                       │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  App Router   │  │  API Routes  │  │     Static Data Layer     │  │
│  │  (SSG + SSR)  │  │  8 endpoints │  │  data/_extracted/*.json   │  │
│  │               │  │              │  │  data/clients/*.ts        │  │
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

### Feed Collection (offline)

```
GOV.UK Atom (35 depts) ──────┐
GOV.UK Search API (26 orgs) ─┤
Hansard (spoken + written) ───┤
Parliament APIs (7 endpoints)─┤
legislation.gov.uk (9 feeds) ─┤──▶ normalise ──▶ entity tag ──▶ fingerprint ──▶ upsert
RSS / trade press (25 feeds) ─┤     to FeedItem    (keyword      (SHA-256)       feed_items
Direct sources (19 pages) ────┤                     matching)
Committees (13 committees) ───┤
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

### Report Generation (streaming SSE)

```
POST /api/reports/generate { clientId }
  │
  1. scan ────────── web search + forward scan
  2. enrich_content ─ fetch full page for thin items
  3. gather ──────── Supabase (entity overlap + keyword)
  4. score ────────── 6-component algorithm + learned signals
  5. dedup ────────── semantic clustering (Jaccard + entities + temporal)
  6. verify ──────── HEAD requests on URLs
  7. group ────────── deterministic theme classifier
  8. enrich ──────── Claude per theme + synthesis
  9. evaluate ────── template + factuality + specificity (LLM-as-judge)
 10. save ─────────── insert report_drafts
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

- **Next.js App Router** — API routes, streaming, layouts, `generateStaticParams` for 764 entity pages
- **Cytoscape.js** — Compound node support for department-to-body hierarchy, force-directed layout
- **Supabase** — Managed Postgres, array operations (`overlaps`, `contains`) for entity filtering, free tier
- **Claude Sonnet 4** — Tool use, 200K context, structured JSON output, LLM-as-judge evaluation
- **Vercel AI SDK** — `streamText` with `fullStream` for multi-step tool use, `onStepFinish` for mutation tracking

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
| `chatActions` | `lib/chatActions.ts` | "Why relevant?" / "Morning briefing" → chat |
| `graphCommands` | `lib/graphCommands.ts` | Chat graph_action → Cytoscape |
| `clientOverrides` | `lib/clientOverrides.ts` | User keyword/theme customisations (localStorage) |

All use `useSyncExternalStore` for React integration.
