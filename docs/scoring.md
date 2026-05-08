# Feed Relevance Scoring

Implemented in `lib/feed/scoring.ts`. The `computeFeedRelevance()` function scores each feed item on a 0-1 scale using 6 weighted components.

## Scoring Components

| Component | Max Weight | Description |
|-----------|-----------|-------------|
| Entity overlap | 0.30 | Matches item `entity_ids` against client stakeholder map |
| Keyword matches | 0.25 | Counts client keyword hits in title/body |
| Source type quality | 0.10 | Weight by source authority |
| Recency decay | 0.15 | Time-based decay from publication |
| Actionable content | 0.10 | Consultation/statement detection |
| Learned signals | 0.10 | Feedback from editorial decisions |

### 1. Entity Overlap (up to 0.30)

Each matched entity contributes based on stakeholder priority:
- **Primary** stakeholder: +0.15
- **Secondary**: +0.08
- **Tertiary**: +0.03

Contributions cap at 0.30 total.

### 2. Keyword Matches (up to 0.25)

+0.04 per keyword match in title or body, capped at 0.25. Keywords come from `policyKeywords`, `industryKeywords`, `competitors`, and `projects` in the client config.

### 3. Source Type Quality (up to 0.10)

| Source | Weight |
|--------|--------|
| `govuk`, `hansard` | 0.10 |
| `committee`, `legislation`, `research` | 0.08 |
| `stakeholder` | 0.07 |
| `trade_press`, `forward_scan` | 0.06 |
| `petition`, `web_search` | 0.05 |
| anything else | 0.03 (default fallback) |

### 4. Recency Decay (up to 0.15)

| Age | Score |
|-----|-------|
| < 6 hours | 0.15 |
| < 24 hours | 0.12 |
| < 72 hours | 0.08 |
| < 1 week | 0.04 |
| Older | 0.01 |

### 5. Actionable Content (up to 0.10)

- Consultation / call for evidence: +0.10
- Statement / announcement: +0.05

### 6. Learned Signals (up to 0.10)

From the feedback loop (`client_learned_signals` table). Each individual contribution is capped at 0.05, and the combined component is capped at 0.10:

- **Source boosts:** `source_boosts[item.source_name]` added to score (note: keyed by the human-readable `source_name`, **not** `source_type`)
- **Keyword boosts:** `keyword_boosts[keyword]` added per match found in title or body

## Floor Thresholds

Minimum scores for certain matches, regardless of component scores:

| Condition | Floor |
|-----------|-------|
| Client name or core project term found in title or body | 0.60 |
| Primary stakeholder entity matched | 0.30 |
| Secondary stakeholder entity matched (and no primary match) | 0.20 |

The client/project term check uses `extractClientTerms()`, which pulls proper-noun fragments from the client name and project list (e.g. "Sofia" from "Sofia offshore wind"), drops generic words (`offshore`, `onshore`, `wind farm`, `wind`, `renewables`, `energy`, `power`, `plant`, `project`, `farm`, `UK`), and keeps tokens of 4+ characters.

## Scoring Examples

**High-relevance item for RWE:**
An Ofgem consultation on offshore wind connection charges, published 2 hours ago:
- Entity overlap: 0.15 (Ofgem is primary stakeholder)
- Keywords: 0.12 (3 matches: "offshore wind", "connection", "Ofgem")
- Source quality: 0.10 (govuk)
- Recency: 0.15 (< 6 hours)
- Actionable: 0.10 (consultation)
- **Total: 0.62**

**Low-relevance item:**
A Lords division on an unrelated topic from 5 days ago:
- Entity overlap: 0.00
- Keywords: 0.00
- Source quality: 0.10 (hansard)
- Recency: 0.04 (< 1 week)
- Actionable: 0.00
- **Total: 0.14** (below 0.25 threshold — excluded from reports)

## Learned Signals Feedback Loop

Implemented in `lib/report/feedback.ts`. When an analyst approves a report, `computeReportDiff()` compares original vs edited versions and `updateLearnedSignals()` writes:

- **Items removed by analyst:** `source_boosts[item.source_name] -= 0.01` (keyed by human-readable source name).
- **Items added by analyst:** `keyword_boosts[keyword] += 0.01` for **every** keyword in `client.allKeywords` for each added item — note this is broader than just keywords parsed from the new item's title.
- **RAG upgraded to RED:** `rag_adjustments[item.ref] = { red_threshold: 0.6, amber_threshold: 0.3 }` (keyed by report `item_ref`).

These signals are loaded via `getLearnedSignals()` and applied during report generation scoring.

## Report Generation Threshold

`RELEVANCE_THRESHOLD = 0.25` — items below this score are excluded from report generation. The pipeline scores all gathered items, takes the top 60, runs semantic dedup, then takes `MAX_ITEMS = 40` for theme grouping and Claude enrichment.

See also: [Collectors](collectors.md) for how items enter the system, [Reports](reports.md) for the full generation pipeline.
