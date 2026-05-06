# Flows / Jobs Page — Design Spec

**Date:** 2026-05-06
**Scope:** New flows listing page + flow detail page with trigger. Two new routes, four new backend endpoints.

---

## Overview

A dedicated Flows section lets users browse all defined Kestra flows, view their recent execution history, and trigger new executions with a per-input form. Flow data is read directly from Kestra's MySQL `flows` table (consistent with the existing execution pattern). Input definitions are parsed from the flow's JSON `value` column lazily — only when the trigger modal opens.

---

## Backend

### New models (`Models.kt`)

```kotlin
data class FlowRow(
    val namespace: String,
    val flowId: String,
    val lastRunDate: String?,
    val executionCount: Long
)

data class FlowDetail(val namespace: String, val flowId: String)

data class FlowInput(val id: String, val type: String)

data class TriggerResponse(
    val newExecutionId: String,
    val triggeredBy: String,
    val triggeredAt: String
)
```

### New `FlowRepository`

Three methods, all using raw JDBC via Agroal `DataSource` (same pattern as `ExecutionRepository`).

> ⚠️ **Before implementation:** Run `DESCRIBE flows;` on the real Kestra MySQL DB to confirm column names. The plan assumes `id`, `namespace`, `deleted`, and `value` (JSON CLOB). Adjust SQL if the real schema differs.

**`listFlows(): List<FlowRow>`**

One query with a `LEFT JOIN` aggregate — no JSON parsing, no per-row subquery:

```sql
SELECT f.namespace, f.id AS flow_id,
       MAX(e.start_date) AS last_run_date,
       COUNT(e.id)        AS execution_count
FROM flows f
LEFT JOIN executions e
       ON e.namespace = f.namespace
      AND e.flow_id   = f.id
      AND e.deleted   = false
WHERE f.deleted = false
GROUP BY f.namespace, f.id
ORDER BY f.namespace, f.id
```

Returns `List<FlowRow>`.

**`findFlow(namespace: String, flowId: String): FlowDetail?`**

```sql
SELECT namespace, id FROM flows
WHERE namespace = ? AND id = ? AND deleted = false
```

Returns `FlowDetail?` (null if not found).

**`findFlowInputs(namespace: String, flowId: String): List<FlowInput>`**

Fetches the `value` column for the given flow, parses it with Jackson to extract the `inputs` array. Returns `List<FlowInput>` (empty list if the flow has no inputs or the field is absent). The JSON structure expected:

```json
{
  "inputs": [
    { "id": "date",  "type": "STRING"  },
    { "id": "count", "type": "INT"     },
    { "id": "flag",  "type": "BOOLEAN" }
  ]
}
```

Jackson models for parsing (internal, not exposed in API):

```kotlin
@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraFlowValue(
    val inputs: List<KestraFlowInput> = emptyList()
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraFlowInput(val id: String = "", val type: String = "")
```

`KestraFlowInput` is mapped to `FlowInput` after parsing. Both need `@JsonIgnoreProperties(ignoreUnknown = true)` because Kestra's input objects contain additional fields (`required`, `description`, `defaults`, etc.) that we don't need.

### New `FlowResource`

```
GET  /api/flows                              → List<FlowRow>
GET  /api/flows/{namespace}/{flowId}         → FlowDetail  (404 if not found)
GET  /api/flows/{namespace}/{flowId}/inputs  → List<FlowInput>  ([] if no inputs)
POST /api/flows/{namespace}/{flowId}/trigger → TriggerResponse
```

All endpoints require `@Authenticated`. `namespace` and `flowId` are `@PathParam`s.

**Trigger endpoint** — resolves the caller's username from the JWT `preferred_username` claim (same pattern as `ExecutionResource.resolveUsername()`), calls `KestraClient.createExecution(namespace, flowId, parts)` with the submitted inputs as multipart form data (via `KestraPartBuilder`), then writes an audit row via `AuditRepository`. Returns `TriggerResponse`. On Kestra API failure, throws `WebApplicationException` with 502 (same pattern as `RetriggerService`).

---

## Frontend

### New types (`types/execution.ts`)

```ts
export interface FlowRow {
  namespace: string
  flowId: string
  lastRunDate: string | null
  executionCount: number
}

export interface FlowInput {
  id: string
  type: string  // STRING | INT | BOOLEAN | FLOAT | DURATION | DATE | DATETIME | TIME | JSON | URI | FILE | SECRET | ARRAY | MULTISELECT
}

export interface TriggerResponse {
  newExecutionId: string
  triggeredBy: string
  triggeredAt: string
}
```

### New hooks

| File | Hook | Fetches |
|---|---|---|
| `hooks/useFlows.ts` | `useFlows()` | `GET /api/flows` |
| `hooks/useFlow.ts` | `useFlow(namespace, flowId)` | `GET /api/flows/{ns}/{id}` |
| `hooks/useFlowInputs.ts` | `useFlowInputs(namespace, flowId, enabled)` | `GET /api/flows/{ns}/{id}/inputs` — enabled only when modal opens |
| `hooks/useTrigger.ts` | `useTrigger(namespace, flowId)` | `POST /api/flows/{ns}/{id}/trigger` via `useMutation` |

### New component: `NavBar`

Dark top bar (`bg-gray-900`) with "Kestra GUI" label and two nav links: **Executions** (`/`) and **Flows** (`/flows`). Active link highlighted with a blue bottom border. Used at the top of both `ExecutionListPage` and `FlowListPage` (and their detail pages).

### New component: `TriggerModal`

Identical in structure to `RetriggerModal` but receives `FlowInput[]` instead of a prior execution's inputs. Renders one field per input based on `type`:
- `STRING` / `URI` / `DURATION` / `DATE` / `DATETIME` / `TIME` / `JSON` / `FILE` / `SECRET` → `<input type="text">`
- `INT` / `FLOAT` → `<input type="number">`
- `BOOLEAN` → `<input type="checkbox">`
- All other types → `<input type="text">` (safe fallback)

All fields start empty. No "Advanced" mode (no prior JSON to serialize from).

Calls `useTrigger` on submit. Shows spinner while pending, error message on failure, closes on success.

### New page: `FlowListPage` (`/flows`)

Table with columns: **Namespace**, **Flow**, **Last run**, **Executions**. Each row is a link to `/flows/:namespace/:flowId`. No filters needed for MVP — flows list is typically short.

### New page: `FlowDetailPage` (`/flows/:namespace/:flowId`)

- Breadcrumb: `← Flows / {namespace} / {flowId}`
- **▶ Trigger** button (top right) → opens `TriggerModal`
- Recent executions table (last 20): reuses `useExecutions` hook with `namespace` + `flowId` filter, columns: ID (link to `/executions/:id`), Status, Start, Duration. No pagination for MVP.

### Routing (`App.tsx`)

```tsx
<Route path="/flows" element={<ProtectedRoute><FlowListPage /></ProtectedRoute>} />
<Route path="/flows/:namespace/:flowId" element={<ProtectedRoute><FlowDetailPage /></ProtectedRoute>} />
```

`NavBar` rendered inside each page component (not at the router level, to keep the existing page structure).

---

## Data flow — trigger

```
user opens TriggerModal on FlowDetailPage
  → useFlowInputs enabled → GET /api/flows/{ns}/{id}/inputs
  → backend fetches value column, parses JSON inputs array
  → modal renders one field per FlowInput
user fills fields + clicks Trigger
  → useTrigger.mutate({ inputs: { date: "2026-05-06", count: 3 } })
  → POST /api/flows/{ns}/{id}/trigger
  → backend builds multipart form via KestraPartBuilder
  → KestraClient.createExecution(namespace, flowId, parts)
  → audit row written
  → TriggerResponse returned → modal closes
```

---

## Testing

**Backend:**
- `FlowRepositoryTest` (extends `DbTestBase`): insert fake `flows` rows + `executions`, assert `listFlows` aggregates correctly; `findFlow` returns 404 for unknown; `findFlowInputs` parses inputs correctly and returns `[]` when absent
- `FlowResourceTest` (mocked repository): 200 for list/detail/inputs; 404 for unknown flow; 401 without token; trigger 200 on success

**Frontend:**
- `FlowListPage.test.tsx`: renders flow rows, clicking row navigates to detail
- `FlowDetailPage.test.tsx`: shows flow id + namespace, trigger button opens modal
- `TriggerModal.test.tsx`: renders STRING as text input, INT as number input, BOOLEAN as checkbox; submit calls useTrigger

---

## Out of scope

- Flow definition YAML viewer
- Pagination on the flow list (flows are typically few)
- Namespace filter on the flow list
- Editing or disabling flows
