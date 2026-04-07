# Feed Collectors

12 collectors pull from UK government and industry sources. All normalise to the `FeedItem` shape, tag with entity IDs via keyword matching, generate a SHA-256 fingerprint for dedup, and upsert to the `feed_items` table in batches of 25.

Run all collectors: `npx tsx scripts/collect-all.ts`

## Common Patterns

- **Fingerprint:** SHA-256 of `url||title` (unique constraint on `feed_items`)
- **Entity tagging:** Two-tier keyword matching via `enrichEntityIds()` in `lib/feeds/entity-enrichment.ts`:
  1. Regex patterns (57 rules) matching department abbreviations, regulator names, body names
  2. Content patterns matching broader topic terms (e.g. "energy" → `desnz`)
- **RAG assignment:** Deterministic keyword rules — RED (urgent, emergency, safety alert), AMBER (consultation, call for evidence, draft), GREEN (default)
- **Rate limiting:** 300-500ms between requests to respect server load
- **Timeout:** 15s per HTTP request
- **Error handling:** Try/catch per item, log warnings, continue collection
- **Lookback:** Most collectors use 365-day rolling window

---

## 1. GOV.UK Atom Feeds (`lib/feeds/govuk.ts`)

| | |
|---|---|
| **Source** | `https://www.gov.uk/government/organisations/{slug}.atom` |
| **Orgs** | 35 departments and regulators |
| **Feed types** | 3 per org: organisation, policy papers, news/communications |
| **Source type** | `govuk` |
| **Rate limit** | 300ms between requests |

Entity mapping via `GOVUK_TO_ENTITY` constant (slug → entity ID). Parses XML `<entry>` blocks with regex. Strips HTML from body, decodes XML entities.

## 2. GOV.UK Search API (`lib/feeds/govuk-search.ts`)

| | |
|---|---|
| **Source** | `https://www.gov.uk/api/search.json` |
| **Strategy** | Two-pass: org-based (26 orgs) + document-type (17 types) |
| **Lookback** | 365 days |
| **Source type** | `govuk` |
| **Rate limit** | 300ms between pages |

Document types: news_story, press_release, speech, written_statement, government_response, policy_paper, open_consultation, closed_consultation, consultation_outcome, guidance, regulation, corporate_report, transparency, foi_release, national_statistics, official_statistics, statistical_data_set, research.

Paginates at 200 items/page. Stops at date cutoff or empty response.

## 3. Hansard (`lib/feeds/hansard.ts`)

| | |
|---|---|
| **Source** | `https://hansard-api.parliament.uk/search/contributions/` |
| **Endpoints** | Spoken (Commons debates) + Written (parliamentary statements) |
| **Search terms** | 63 terms (department names, abbreviations, key policy topics) |
| **Source type** | `hansard` |
| **Rate limit** | 300ms between term requests |

Body assembled from `AttributedTo` + `ContributionText` (HTML-stripped, max 2000 chars). URL constructed from contribution metadata.

## 4. Parliament APIs (`lib/feeds/parliament.ts`)

| | |
|---|---|
| **Endpoints** | 7 REST APIs |
| **Source type** | `hansard` (debates), `committee` (questions) |
| **Lookback** | 12 months |
| **Rate limit** | 300ms between pages |

**Sub-collectors:**
1. Bills — `https://bills-api.parliament.uk/api/v1/Bills`
2. Written Questions — `https://questions-statements-api.parliament.uk/api/writtenquestions/questions`
3. Commons Divisions — `https://commonsvotes-api.parliament.uk/data/divisions.json/search`
4. Lords Divisions — `https://lordsvotes-api.parliament.uk/data/Divisions/search`
5. Written Statements — `https://questions-statements-api.parliament.uk/api/writtenstatements/statements`
6. Early Day Motions — `https://oralquestionsandmotions-api.parliament.uk/EarlyDayMotions/list`
7. Oral Questions — `https://questions-statements-api.parliament.uk/api/oralquestions/list`

Entity mapping via `ANSWERING_BODY_MAP` (22 answering body → entity ID mappings) + keyword enrichment.

## 5. Legislation.gov.uk (`lib/feeds/legislation.ts`)

| | |
|---|---|
| **Source** | 9 Atom feeds from legislation.gov.uk |
| **Feeds** | New legislation, UK Acts, SIs, Draft SIs, Impact Assessments, Wales SIs, Scotland Acts, Scotland SIs, NI Statutory Rules |
| **Source type** | `legislation` |
| **Rate limit** | 500ms between pages, 500ms between feeds |
| **Pagination** | `?page={n}`, safety cap at 200 pages per feed |

Default RAG is AMBER (new regulation warrants attention). RED for enforcement/prohibition/sanctions. GREEN for correction slips and commencement orders.

## 6. RSS / Trade Press (`lib/feeds/rss.ts`)

| | |
|---|---|
| **Sources** | 25 RSS/Atom feeds |
| **Source type** | `trade_press` |
| **Rate limit** | 300ms between feeds |

**Energy (14):** Recharge News, Windpower Monthly, Current±, Utility Week, New Power, RenewableUK, Energy UK, Ofgem Blog, Climate Change Committee, Offshore Wind Biz, 4C Offshore, Carbon Brief, Energy Voice, DESNZ Blog

**Health (6):** MHRA, NICE, HSJ, Pulse Today, PharmaTimes, The BMJ

**General (4):** Civil Service World, Institute for Government, Public Finance, NIHR News

Each feed has `defaultEntityIds` for base tagging, supplemented by keyword enrichment.

## 7. Direct Sources (`lib/feeds/direct-sources.ts`)

| | |
|---|---|
| **Sources** | 19 web pages (government bodies, regulators, industry orgs) |
| **Source type** | `stakeholder` |
| **Rate limit** | 400ms between sources |

Web scraping via `<a>` tag extraction. Multi-method date extraction (DD Month YYYY, Month DD YYYY, ISO 8601, UK DD/MM/YYYY, `<time>` elements, datetime attributes). Filters 50+ navigation junk patterns (terms, privacy, cookies, social media links, etc.).

## 8. Select Committees (`lib/feeds/committees.ts`)

| | |
|---|---|
| **Sources** | 13 key parliamentary committees |
| **Source type** | `committee` |
| **Rate limit** | 400ms between committees |

Energy (6): Energy Security & Net Zero, Environmental Audit, Business & Trade, Science/Innovation/Technology, Lords Industry & Regulators, Welsh/Scottish Affairs

Health (2): Health & Social Care, Lords Science & Technology

General (5): Public Accounts, Treasury, Public Admin & Constitutional Affairs

Each committee has keyword requirements — links must match at least one keyword to be collected.

## 9. Petitions (`lib/feeds/petitions.ts`)

| | |
|---|---|
| **Source** | `https://petition.parliament.uk/petitions.json` |
| **States** | with_response, debated, awaiting_response, awaiting_debate, open (1000+ sigs) |
| **Source type** | `petition` |
| **Rate limit** | 300ms between pages |

Body includes background, government response summary, debate overview, and signature count. Raw data stores `signature_count` and `state`.

## 10. Research Briefings (`lib/feeds/research-briefings.ts`)

| | |
|---|---|
| **Sources** | 2 RSS feeds (Commons + Lords Library) + 11 topic searches |
| **Search topics** | Energy, health, environment, transport, education, housing, defence, immigration, NHS, offshore wind, nuclear, pharmaceutical |
| **Source type** | `research` |
| **Rate limit** | 300ms between feeds |

## 11. Web Search (`lib/feeds/web-search.ts`) — AI-Powered

| | |
|---|---|
| **Model** | Claude Sonnet 4 |
| **Source type** | `web_search` |
| **Rate limit** | 1s between queries |

Generates search queries dynamically from client config: client name, project names (up to 5), primary stakeholders (up to 5), policy keywords (up to 8), competitors (up to 5), industry keywords (up to 3). Claude returns JSON with `{title, url, snippet, date, source_name}`.

## 12. Forward Scan (`lib/feeds/forward-scan.ts`) — AI-Powered

| | |
|---|---|
| **Model** | Claude Sonnet 4 |
| **Source type** | `forward_scan` |
| **Rate limit** | 1s between queries |

Uses client-configured `forwardScanQueries`. Claude finds upcoming events 2-8 weeks out. Returns `{title, url, snippet, date, event_date, source_name}`. Items have `is_forward_scan=true` and `event_date` populated.

---

## Post-Collection Processing

### Content Enrichment (`lib/feeds/enrich-content.ts`)

Fetches full page content for items with body < 500 chars. Extracts relevant HTML blocks (govspeak for GOV.UK, debate-item for Hansard, LegSnippet for legislation), strips HTML/scripts/nav, caps at 10,000 chars. Processes 50 items per batch, 300ms between fetches.

Run: `npx tsx scripts/enrich-content.ts`

### Entity Enrichment (`lib/feeds/entity-enrichment.ts`)

Centralised two-tier keyword-to-entity mapping:
1. **Regex rules** (57 patterns): Department abbreviations, regulator names, body names, topic triggers
2. **Content patterns** (30+ entity IDs): Broader semantic matches per entity

Also provides deterministic RAG assignment via keyword matching.

Run re-tagging: `npx tsx scripts/retag-all.ts`

### Semantic Deduplication (`lib/feeds/dedup-semantic.ts`)

Clusters items covering the same development:
- **Temporal proximity:** Published within 3 days
- **Shared entities:** At least 1 common entity_id
- **Title overlap:** Jaccard similarity of significant words > 0.3 (stop-word filtered)

Keeps best source per cluster by priority: govuk (10) > legislation (9) > committee/research (8) > hansard (7) > stakeholder (6) > trade_press (5) > forward_scan/web_search (4-5) > petition (4).

### Source Verification (`lib/feeds/verify-sources.ts`)

HEAD requests to validate URLs before report generation. 5s timeout, 200ms between checks. Partitions into valid (2xx or no URL) and broken (4xx/5xx/timeout). Redirects (common on GOV.UK) are considered valid.

See also: [Scoring](scoring.md) for how collected items are ranked.
