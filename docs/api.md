# API Reference

All routes are in `app/api/`. No user authentication for POC except the cron route (Bearer token) — see [Security](security.md).

| Route | File |
|---|---|
| `POST /api/chat` | `app/api/chat/route.ts` |
| `POST /api/reports/generate` | `app/api/reports/generate/route.ts` |
| `GET / PATCH /api/reports/[id]` | `app/api/reports/[id]/route.ts` |
| `POST /api/reports/[id]/chat` | `app/api/reports/[id]/chat/route.ts` |
| `POST /api/reports/[id]/export` | `app/api/reports/[id]/export/route.ts` |
| `GET / POST /api/reports/[id]/revisions` | `app/api/reports/[id]/revisions/route.ts` |
| `GET /api/cron/collect` | `app/api/cron/collect/route.ts` |
| `POST /api/scan` | `app/api/scan/route.ts` |

---

## `POST /api/chat`

Streaming intelligence chat with tool use.

| | |
|---|---|
| **File** | `app/api/chat/route.ts` |
| **Rate limit** | 30 requests/min per IP |
| **Max message** | 5,000 chars |
| **Max history** | 100 messages |

**Request:**
```json
{
  "message": "What consultations are open for energy?",
  "clientId": "rwe",
  "entityId": "desnz",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "viewState": { "feedDateRange": "7d", "feedSortMode": "relevance", ... },
  "isBriefing": false
}
```

**Response:** `text/plain` stream. May contain `<!--GRAPH_CMD:{json}-->` markers for graph manipulation.

---

## `POST /api/reports/generate`

Generate a report draft with streaming SSE progress events.

| | |
|---|---|
| **File** | `app/api/reports/generate/route.ts` |
| **Rate limit** | 5/hour per IP |
| **maxDuration** | 300s |

**Request (single client — streaming):**
```json
{
  "clientId": "rwe",
  "from": "2025-03-01T00:00:00Z",
  "to": "2025-03-07T00:00:00Z"
}
```

**Response:** `text/event-stream` with progress events:
```
data: {"step":"gather","detail":"Querying feed items...","timestamp":1712345678}
data: {"step":"gather_complete","detail":"247 items found","timestamp":1712345690}
data: {"step":"score","detail":"Scoring items by relevance...","timestamp":1712345691}
...
data: {"step":"complete","detail":"<draft-uuid>","timestamp":1712345780}
```

Progress steps: `gather` → `score` → `dedup` → `group` → `enrich` → `evaluate` → `save` → `complete`.

No collection runs during report generation — data must already be in Supabase via `/api/cron/collect` or `/api/scan`.

**Request (all clients — cron mode):**
```json
{}
```

**Response (cron):** `application/json`
```json
{ "results": [{ "clientId": "rwe", "draftId": "..." }, { "clientId": "sanofi", "draftId": "..." }] }
```

---

## `GET /api/reports/[id]`

Fetch a report draft.

| | |
|---|---|
| **File** | `app/api/reports/[id]/route.ts` |

**Query params:** `?include=messages` to include chat messages.

**Response:**
```json
{
  "id": "...",
  "client_id": "rwe",
  "status": "draft",
  "sections": { ... },
  "original_sections": { ... },
  "feed_item_ids": ["..."],
  "created_at": "...",
  "messages": [...]
}
```

---

## `PATCH /api/reports/[id]`

Update report sections or status.

| | |
|---|---|
| **File** | `app/api/reports/[id]/route.ts` |

**Request:**
```json
{
  "sections": { ... },
  "status": "in_review"
}
```

Status values: `draft`, `in_review`, `approved`, `exported`. Setting `in_review` auto-generates a `review_token`. Setting `approved` or `exported` records timestamps.

Whenever `sections` is present in the request, the previous `sections` blob is snapshotted into `report_revisions` with `edit_source: 'manual_patch'` before the update is applied.

---

## `GET /api/reports/[id]/revisions`

List revision history for a report draft.

| | |
|---|---|
| **File** | `app/api/reports/[id]/revisions/route.ts` |

Returns the most recent 50 revisions, newest first.

**Response:**
```json
[
  {
    "id": "...",
    "edit_source": "manual_patch" | "chat_mutation" | "rollback",
    "mutation_summary": { ... } | null,
    "chat_message_id": "..." | null,
    "created_at": "..."
  }
]
```

---

## `POST /api/reports/[id]/revisions`

Roll back a report to a specific revision. The current state is snapshotted as a new revision (with `edit_source: 'rollback'`) before the rollback is applied.

| | |
|---|---|
| **File** | `app/api/reports/[id]/revisions/route.ts` |

**Request:**
```json
{ "revisionId": "..." }
```

**Response:** the updated `report_drafts` row.

Returns 404 if the revision doesn't belong to this report.

---

## `POST /api/reports/[id]/chat`

Report editing chat with mutation tools.

| | |
|---|---|
| **File** | `app/api/reports/[id]/chat/route.ts` |
| **Rate limit** | 30 requests/min per IP |
| **Max message** | 5,000 chars |

**Request:**
```json
{
  "message": "Make item 2.1 more specific to Norfolk Vanguard",
  "userRole": "senior",
  "activeSection": "policy-regulatory",
  "activeItemRef": "2.1"
}
```

**Response:** `text/plain` stream. May contain `<!--MUTATION:{json}-->` markers.

Both user and assistant messages are persisted to `report_chat_messages` after the stream completes.

---

## `POST /api/reports/[id]/export`

Export an approved report as DOCX.

| | |
|---|---|
| **File** | `app/api/reports/[id]/export/route.ts` |
| **Rate limit** | 10/hour per IP |

**Requires** report status `approved` or `exported`.

**Response:** Binary DOCX file with `Content-Disposition: attachment; filename="..."`.

Marks draft status as `exported` with `exported_at` timestamp.

---

## `GET /api/cron/collect`

Scheduled collection of structured API feeds. Runs as 8 parallel Vercel crons every 12 hours, plus a nightly `politician_sync` group.

| | |
|---|---|
| **File** | `app/api/cron/collect/route.ts` |
| **Auth** | `Authorization: Bearer $CRON_SECRET` |
| **maxDuration** | 300s |
| **Schedule** | `0 */12 * * *` for feed groups, `0 3 * * *` for `politician_sync` (configured in `vercel.json`) |

**Query params:** `?group=<name>` (required)

| Group | Collectors | Typical time |
|-------|-----------|-------------|
| `govuk` | GOV.UK Atom, GOV.UK By Org | ~60s |
| `govuk_search` | GOV.UK Search (by doc type) | ~20s |
| `hansard` | Hansard spoken + written | ~110s |
| `parliament_bills` | Bills, Written Questions, Written Statements | ~6s |
| `parliament_activity` | Divisions, Lords Divisions, EDMs, Oral Questions | ~35s |
| `legislation` | legislation.gov.uk | ~7s |
| `media` | RSS, Direct Sources | ~40s |
| `research` | Committees, Petitions, Research Briefings | ~5s |
| `politician_sync` | Members + roles, division votes, EDM signatures (nightly) | varies |

Feed groups use a 12.5-hour lookback (30 min overlap with the 12-hour schedule). The full 12-month lookback is only used by `scripts/collect-all.ts`. `politician_sync` writes to `politicians`, `politician_roles`, and `politician_evidence` rather than `feed_items`.

**Response:**
```json
{
  "ok": true,
  "group": "govuk",
  "since": "2026-04-08T05:00:00.000Z",
  "timestamp": "2026-04-08T09:45:00.000Z",
  "elapsed_seconds": 62.1,
  "results": {
    "govukAtom": { "inserted": 2, "skipped": 1278 },
    "govukByOrg": { "inserted": 0, "skipped": 21 }
  }
}
```

---

## `POST /api/scan`

Run web search and forward scan collectors for a client (Claude-powered, manual trigger).

| | |
|---|---|
| **File** | `app/api/scan/route.ts` |
| **Rate limit** | 3/hour per client |
| **maxDuration** | 120s |

**Request:**
```json
{ "clientId": "rwe" }
```

**Response:**
```json
{
  "web_search": { "items_found": 12, "items_inserted": 8 },
  "forward_scan": { "items_found": 5, "items_inserted": 3 }
}
```

---

## Error Responses

All routes return JSON errors:

```json
{ "error": "Description", "detail": "Optional detail" }
```

| Status | Meaning |
|--------|---------|
| 400 | Invalid request (bad JSON, missing fields, unknown client) |
| 429 | Rate limit exceeded |
| 503 | ANTHROPIC_API_KEY not configured |
| 404 | Report not found |
| 500 | Server error |
