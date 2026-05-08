# Chat System

Two chat interfaces: intelligence chat (general queries) and report chat (report editing).

## Intelligence Chat

### System Prompt (`lib/chat/systemPrompt.ts`)

The prompt is assembled from sections based on context:

1. **Base role** — Political intelligence assistant, guidelines for precision, formatting, tool usage
2. **Client context** (if `clientId`) — Client name, sector, description, stakeholder map with priorities, policy/industry keywords, competitors, projects
3. **Entity context** (if `entityId`) — Entity details, relationships, powers (first 10)
4. **View state** (if `viewState`) — Current feed date range, sort mode, search text, active filter, disabled sources, top visible items, last clicked item, top pulse entities
5. **Briefing mode** (if `isBriefing`) — Strict formatting rules: call `feed_top_items` first, structured briefing with priority developments, deadlines, watching brief
6. **Security rules** — Always appended. Treats feed content as untrusted, prevents prompt exfiltration, restricts to defined tools

### Tools (`lib/chat/tools.ts`)

6 tools using Vercel AI SDK `tool()` with Zod input schemas:

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `entity_lookup` | Search entities by name/ID/holder | `query: string` |
| `feed_search` | Search feed items by keyword + entity IDs | `query, entityIds?, limit?, daysBack?` |
| `feed_top_items` | Highest-relevance items for a client | `clientId, daysBack?, limit?, sourceType?, minScore?` |
| `feed_deadlines` | Upcoming consultations and deadlines | `clientId, daysAhead?` |
| `stakeholder_map` | Client stakeholder map by priority | `clientId?` |
| `graph_action` | Manipulate the graph visualisation | `action, entityId?, query?, enabled?` |

`feed_top_items` uses the full [scoring algorithm](scoring.md) with client-name and project-name boosting. Items mentioning the client or its projects sort above equal-score items.

`feed_deadlines` searches title and body for deadline keywords (consultation, call for evidence, deadline, respond by, closes, selection process, expression of interest, closing date) across high-value source types only.

All feed content in tool outputs is sanitised via `sanitiseFeedContent()` before re-entering the conversation.

### Graph Commands

The `graph_action` tool returns success metadata. The API route embeds it as `<!--GRAPH_CMD:{json}-->` in the text stream. Client-side parsing dispatches via `graphCommands.ts`:

```typescript
type GraphCommand =
  | { type: 'select_entity'; entityId: string }
  | { type: 'search'; query: string }
  | { type: 'reset' }
  | { type: 'focus_mode'; enabled: boolean }
  | { type: 'highlight_entities'; entityIds: string[] }
  | { type: 'clear_highlight' }
```

`highlight_entities` and `clear_highlight` are part of the dispatch protocol but are not currently emitted by the chat route — only `select_entity`, `search`, `reset`, and `focus_mode` come out of `graph_action` tool results today.

### Message Flow

1. User types message in `IntelligencePanel`
2. `POST /api/chat` with message, history, clientId, entityId, viewState, isBriefing
3. `streamText` with `claude-opus-4-6`, `stopWhen: stepCountIs(5)`
4. `fullStream` iterated — text-delta chunks streamed, tool-results trigger graph command embedding
5. Client reads stream, parses `<!--GRAPH_CMD:-->` markers, dispatches to Cytoscape
6. `ChatMessage.tsx` renders with markdown formatting, entity highlighting, and clickable links

### Entity Highlighting (`components/chat/ChatMessage.tsx`)

Entity names in assistant messages are detected and rendered as interactive buttons:
- Sorted longest-first to prevent partial matches ("Home Office" before "Home")
- Word boundary checks to avoid "tate" matching inside "Estate"
- Short names (< 4 chars) require exact case match
- Hover highlights the entity on the graph, click selects it

---

## Report Chat

### System Prompt

Includes current report state (sections, items, executive summary), client context, and instructions for using mutation tools. Security rules appended.

### Report Mutation Tools (`lib/report/tools.ts`)

4 tools for in-place report editing:

| Tool | Description |
|------|-------------|
| `edit_report_item` | Change headline, summary, client_relevance, recommended_action, rag, escalation, date, source |
| `add_report_item` | Insert new item into a theme section |
| `remove_report_item` | Delete item and renumber section |
| `move_report_item` | Relocate item between sections |

Plus general tools: `entity_lookup`, `feed_search`, `stakeholder_map`.

### Mutation Persistence

Each mutation produces a `ReportMutation` (`types/report.ts`) with:
```typescript
{
  type:
    | 'edit_field' | 'add_item' | 'remove_item' | 'move_item'
    | 'change_rag' | 'change_escalation' | 'reorder';
  section_id: string;
  item_ref?: string;
  field?: string;
  old_value?: string;
  new_value?: string;
  reasoning?: string;
}
```

Mutations flow through `lib/report/mutations.ts`, which:

1. Applies the mutation to a deep-cloned `AnalysisJSON` via `applyEditField` / `applyRemoveItem` / `applyMoveItem` / `applyAddItem`.
2. Calls `saveReportContent(reportId, content, opts)`. This **always snapshots the prior `sections` blob into `report_revisions`** with `edit_source: 'chat_mutation'`, an optional `mutation_summary`, and the linking `chat_message_id` before the `report_drafts` row is updated.
3. Embeds the mutation as `<!--MUTATION:{json}-->` in the response stream for live UI updates.
4. Persists the assistant message to `report_chat_messages` with the mutations and tool-call metadata after the stream completes.

The revision history is exposed via `GET /api/reports/[id]/revisions` and `POST /api/reports/[id]/revisions` (rollback). See [API Reference](api.md#get-apireportsidrevisions).

### Streaming

Report chat uses `textStream` (not `fullStream`). The `onStepFinish` callback collects mutations from tool results. After the stream ends, both user and assistant messages are persisted to `report_chat_messages` with mutations and tool call metadata.

---

## Chat Stores

### `chatActions.ts`

Pub/sub for triggering chat from other components:
- "Why is this relevant?" (FeedItem) → opens intelligence panel with pre-formed question
- "Morning briefing" (ClientPanel) → opens intelligence panel with `isBriefing: true`

### `feedViewStore.ts`

The feed panel publishes its current state (date range, sort mode, search text, visible items, last clicked item) so the chat system prompt can include what the user is looking at.

### Conversation Persistence

Intelligence chat history is passed as `history` in the request body (client-side array). Report chat history is persisted to `report_chat_messages` table in Supabase and loaded on each request.

### Suggestions (`lib/chat/suggestions.ts`)

`generateSuggestions(context)` produces 1–4 chat starter prompts based on the active client, recent feed items (last 7 days, by source type), and pulse-score "hot" entities. Falls back to generic prompts when there's no client/entity context.

### Observability (`lib/observability/opik.ts`)

Both chat routes log traces to Opik (when `OPIK_API_KEY` is configured) and to the `pipeline_traces` Supabase table after each stream completes. Traces include model, input/output tokens, and duration. Full set of step types: `theme_analysis`, `synthesis`, `factuality_eval`, `specificity_eval`, `web_search`, `forward_scan`, `chat`, `report_chat`.
