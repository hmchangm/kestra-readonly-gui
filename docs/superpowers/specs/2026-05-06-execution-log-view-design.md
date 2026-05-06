# Execution Log View — Design Spec

**Date:** 2026-05-06
**Scope:** Add per-task-run log viewing to the execution detail page.

---

## Overview

Users on the execution detail page can now expand any task run row inline to see its logs. Logs are fetched on demand from Kestra's MySQL `logs` table via a new backend endpoint. No streaming — one-time fetch per task.

---

## Backend

### New model (`Models.kt`)

```kotlin
data class LogEntry(val timestamp: String, val level: String, val message: String)
```

### New repository method (`ExecutionRepository`)

```kotlin
fun findTaskLogs(executionId: String, taskRunId: String): List<LogEntry>
```

Queries Kestra's `logs` table filtered by `execution_id = ?` AND `task_run_id = ?`, ordered by `timestamp ASC`. Returns an empty list if no rows match. Exact column names (`execution_id`, `task_run_id`, `level`, `message`, `timestamp`) to be confirmed against the live DB schema at implementation time.

### New endpoint (`ExecutionResource`)

```
GET /api/executions/{id}/tasks/{taskRunId}/logs
```

- Auth: `@Authenticated` (same as all other endpoints)
- Returns: `List<LogEntry>` (empty array if task has no logs)
- Errors: 404 if the parent execution does not exist; 200 with `[]` if execution exists but task has no logs

---

## Frontend

### New type (`types/execution.ts`)

```ts
export interface LogEntry {
  timestamp: string
  level: string   // INFO | WARN | ERROR | DEBUG | TRACE
  message: string
}
```

### New hook (`hooks/useTaskLogs.ts`)

```ts
useTaskLogs(executionId: string, taskRunId: string | null): UseQueryResult<LogEntry[]>
```

- Enabled only when `taskRunId` is non-null
- Query key: `['taskLogs', executionId, taskRunId]`
- Fetches `GET /api/executions/{executionId}/tasks/{taskRunId}/logs`
- `staleTime`: inherits the global default (30 s); logs are static once a task has finished

### Modified page (`ExecutionDetailPage`)

**New state:**
```ts
const [expandedTaskRunId, setExpandedTaskRunId] = useState<string | null>(null)
```

**Task runs table changes:**
- Add a final column header (empty label)
- Each data row gets a "▶ logs" / "▼ logs" toggle button in the last column
- Clicking the button sets `expandedTaskRunId` to that task's `id` (or clears it if already expanded — only one row open at a time)
- The expanded row is lightly highlighted (`bg-yellow-50`, left border `border-yellow-300`)
- Immediately after the expanded `<tr>`, inject a second `<tr>` with `colspan` spanning all columns containing the log panel

**Inline log panel (`<tr>` injected after expanded row):**
- Dark terminal background (`bg-gray-900`)
- Fixed max-height (`max-h-64`), scrollable (`overflow-y-auto`)
- Each line: `timestamp · LEVEL · message` where level is color-coded:
  - `INFO` / `DEBUG` — muted gray
  - `WARN` — yellow
  - `ERROR` — red
- Loading state: spinner centered in the panel while the query is in-flight
- Empty state: "No logs for this task run." in muted text
- `useTaskLogs` is called once at page level with `expandedTaskRunId` as the `taskRunId` argument; `enabled: !!expandedTaskRunId`. TanStack Query caches results by `(executionId, taskRunId)` key, so switching between already-fetched tasks is instant.

---

## Data flow

```
user clicks "▶ logs" on a task row
  → setExpandedTaskRunId(tr.id)
  → useTaskLogs enabled for that taskRunId
  → GET /api/executions/{id}/tasks/{taskRunId}/logs
  → backend queries Kestra logs table
  → returns List<LogEntry>
  → inline panel renders log lines
```

---

## Testing

**Backend (`ExecutionResourceTest` or new `LogResourceTest`):**
- Insert a fake log row into H2 via `DbTestBase`; `GET /api/executions/{id}/tasks/{taskRunId}/logs` returns it
- Empty result returns `[]`, not 404
- Unknown execution returns 404

**Frontend:**
- Render `ExecutionDetailPage` with mocked `useExecution` and `useTaskLogs`
- Clicking "▶ logs" button shows the log panel; clicking again hides it
- Only one panel is open at a time

---

## Out of scope

- Log streaming / live refresh for running tasks
- Log level filtering controls
- Log download / copy-to-clipboard
