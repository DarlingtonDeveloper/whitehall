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
| `trade_press` | 0.06 |
| `stakeholder` | 0.04 |
| `petition`, `web_search`, `forward_scan` | 0.02-0.04 |

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

From the feedback loop (`client_learned_signals` table):
- **Source boosts:** `source_boosts[source_type]` added to score
- **Keyword boosts:** `keyword_boosts[keyword]` added per match

## Floor Thresholds

Minimum scores for certain matches, regardless of component scores:

| Condition | Floor |
|-----------|-------|
| Client name mentioned in title | 0.60 |
| Primary stakeholder entity matched | 0.30 |
| Secondary stakeholder entity matched | 0.20 |

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

Implemented in `lib/report/feedback.ts`. When an analyst approves a report, `computeReportDiff()` compares original vs edited versions:

- **Items removed by analyst:** Source type gets -0.01 to `source_boosts`
- **Items added by analyst:** Keywords from title get +0.01 to `keyword_boosts`
- **RAG upgraded to RED:** Records adjusted thresholds in `rag_adjustments`

These signals are loaded via `getLearnedSignals()` and applied during report generation scoring.

## Report Generation Threshold

`RELEVANCE_THRESHOLD = 0.25` — items below this score are excluded from report generation. Top 40 items (after dedup and verification) proceed to theme grouping and Claude enrichment.

See also: [Collectors](collectors.md) for how items enter the system, [Reports](reports.md) for the full generation pipeline.
