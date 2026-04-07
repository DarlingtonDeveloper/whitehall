# API Reference

All routes are in `app/api/`. No authentication for POC — see [Security](security.md).

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
data: {"step":"scan","detail":"Running web search and forward scan...","timestamp":1712345678}
data: {"step":"gather_complete","detail":"247 items found","timestamp":1712345690}
...
data: {"step":"complete","detail":"<draft-uuid>","timestamp":1712345780}
```

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

## `POST /api/export`

Full report generation and DOCX export in one request (no draft persistence).

| | |
|---|---|
| **File** | `app/api/export/route.ts` |
| **Rate limit** | 5/hour per IP |
| **maxDuration** | 300s |

**Request:**
```json
{
  "clientId": "rwe",
  "dateRange": { "from": "2025-03-01", "to": "2025-03-07" },
  "skipEval": false
}
```

**Response:** Binary DOCX file. Pipeline: gather → group → enrich → evaluate → generate.

---

## `POST /api/scan`

Run web search and forward scan collectors for a client.

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
