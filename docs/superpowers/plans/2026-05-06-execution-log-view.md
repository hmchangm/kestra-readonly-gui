# Execution Log View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-task-run inline log expansion to the execution detail page, backed by a new `GET /api/executions/{id}/tasks/{taskRunId}/logs` endpoint that reads from Kestra's MySQL `logs` table.

**Architecture:** The backend adds a `findTaskLogs` method to `ExecutionRepository` querying Kestra's `logs` table directly (same pattern as `executions`), exposed via a new route on `ExecutionResource`. The frontend adds a `useTaskLogs` hook and modifies `ExecutionDetailPage` so each task run row has a toggle that injects an inline dark terminal panel below it.

**Tech Stack:** Kotlin/Quarkus (backend), React 19 + TypeScript + TanStack Query + Tailwind CSS (frontend), H2 (tests), Vitest + Testing Library (frontend tests)

---

## File Map

| File | Change |
|---|---|
| `backend/src/main/resources/db-setup.sql` | Add `logs` table for H2 tests |
| `backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt` | Add `DELETE FROM logs` in `setupSchema` |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt` | Add `LogEntry` data class |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt` | Add `findTaskLogs` |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt` | Add `GET /{id}/tasks/{taskRunId}/logs` endpoint |
| `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt` | Add log query tests |
| `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt` | Add endpoint tests |
| `frontend/src/types/execution.ts` | Add `LogEntry` interface |
| `frontend/src/hooks/useTaskLogs.ts` | New hook (create) |
| `frontend/src/pages/ExecutionDetailPage.tsx` | Add expand state + log panel |
| `frontend/src/pages/ExecutionDetailPage.test.tsx` | New test file (create) |

---

## Task 1: Logs table schema + LogEntry model

**Files:**
- Modify: `backend/src/main/resources/db-setup.sql`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt`

> ⚠️ **Before writing the repository method (Task 2):** Connect to the real Kestra MySQL DB and run `DESCRIBE logs;` to confirm the actual column names. The spec expects `execution_id`, `task_run_id`, `level`, `message`, `timestamp` — but Kestra may use `type` instead of `level`. Adjust the SQL in Task 2 to match the real schema. The H2 test table below uses `level`; if the real DB uses `type`, mirror that in db-setup.sql too.

- [ ] **Step 1: Add logs table to db-setup.sql**

Append to `backend/src/main/resources/db-setup.sql`:

```sql
CREATE TABLE IF NOT EXISTS logs (
    `key`        VARCHAR(250) NOT NULL PRIMARY KEY,
    execution_id VARCHAR(100) NOT NULL,
    task_run_id  VARCHAR(100),
    level        VARCHAR(20),
    message      TEXT,
    `timestamp`  TIMESTAMP
);
```

- [ ] **Step 2: Clear logs in DbTestBase**

In `backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt`, add after the existing DELETE statements:

```kotlin
conn.createStatement().use { it.execute("DELETE FROM logs") }
```

So `setupSchema` ends with:
```kotlin
conn.createStatement().use { it.execute("DELETE FROM executions") }
conn.createStatement().use { it.execute("DELETE FROM kestra_retrigger_audit") }
conn.createStatement().use { it.execute("DELETE FROM logs") }
```

- [ ] **Step 3: Add LogEntry to Models.kt**

In `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt`, add at the end of the file:

```kotlin
data class LogEntry(val timestamp: String, val level: String, val message: String)
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/resources/db-setup.sql \
        backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt \
        backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt
git commit -m "feat: add LogEntry model and logs table schema for tests"
```

---

## Task 2: Repository method (TDD)

**Files:**
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt`

- [ ] **Step 1: Write failing tests**

Add a private helper and three test cases to `ExecutionRepositoryTest`:

```kotlin
private fun insertLog(key: String, executionId: String, taskRunId: String, level: String, message: String) {
    ds.connection.use { conn ->
        conn.prepareStatement(
            "INSERT INTO logs (`key`, execution_id, task_run_id, level, message, `timestamp`) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)"
        ).use { ps ->
            ps.setString(1, key)
            ps.setString(2, executionId)
            ps.setString(3, taskRunId)
            ps.setString(4, level)
            ps.setString(5, message)
            ps.executeUpdate()
        }
    }
}

@Test
fun `findTaskLogs returns logs for matching executionId and taskRunId`() {
    insertLog("log-1", "exec-1", "tr-1", "INFO", "Starting task")
    insertLog("log-2", "exec-1", "tr-1", "ERROR", "Task failed")
    insertLog("log-3", "exec-1", "tr-2", "INFO", "Other task")  // different taskRunId

    val logs = repo.findTaskLogs("exec-1", "tr-1")

    assertEquals(2, logs.size)
    assertEquals("INFO", logs[0].level)
    assertEquals("Starting task", logs[0].message)
    assertEquals("ERROR", logs[1].level)
}

@Test
fun `findTaskLogs returns empty list when no logs match`() {
    val logs = repo.findTaskLogs("exec-nonexistent", "tr-nonexistent")
    assertEquals(emptyList<LogEntry>(), logs)
}

@Test
fun `findTaskLogs orders by timestamp ascending`() {
    // Insert out-of-order using explicit timestamps
    ds.connection.use { conn ->
        conn.prepareStatement(
            "INSERT INTO logs (`key`, execution_id, task_run_id, level, message, `timestamp`) VALUES (?,?,?,?,?,?)"
        ).use { ps ->
            // Second log first
            ps.setString(1, "log-b"); ps.setString(2, "exec-2"); ps.setString(3, "tr-1")
            ps.setString(4, "WARN"); ps.setString(5, "Second")
            ps.setTimestamp(6, java.sql.Timestamp.from(java.time.Instant.parse("2026-05-06T10:00:02Z")))
            ps.executeUpdate()
        }
        conn.prepareStatement(
            "INSERT INTO logs (`key`, execution_id, task_run_id, level, message, `timestamp`) VALUES (?,?,?,?,?,?)"
        ).use { ps ->
            // First log second
            ps.setString(1, "log-a"); ps.setString(2, "exec-2"); ps.setString(3, "tr-1")
            ps.setString(4, "INFO"); ps.setString(5, "First")
            ps.setTimestamp(6, java.sql.Timestamp.from(java.time.Instant.parse("2026-05-06T10:00:01Z")))
            ps.executeUpdate()
        }
    }

    val logs = repo.findTaskLogs("exec-2", "tr-1")

    assertEquals("First", logs[0].message)
    assertEquals("Second", logs[1].message)
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && ./mvnw test -Dtest=ExecutionRepositoryTest -pl . 2>&1 | tail -20
```

Expected: `FAILED` — `findTaskLogs` method not found.

- [ ] **Step 3: Implement findTaskLogs in ExecutionRepository**

Add to `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt` (after `listNamespaces`):

```kotlin
fun findTaskLogs(executionId: String, taskRunId: String): List<LogEntry> {
    val sql = """
        SELECT level, message, `timestamp`
        FROM logs
        WHERE execution_id = ? AND task_run_id = ?
        ORDER BY `timestamp` ASC
    """.trimIndent()
    return ds.connection.use { conn ->
        conn.prepareStatement(sql).use { ps ->
            ps.setString(1, executionId)
            ps.setString(2, taskRunId)
            ps.executeQuery().use { rs ->
                rs.toList { r ->
                    LogEntry(
                        timestamp = r.getTimestamp("timestamp")?.toInstant()?.toString() ?: "",
                        level = r.getString("level") ?: "",
                        message = r.getString("message") ?: ""
                    )
                }
            }
        }
    }
}
```

> If the real DB confirmed a different column name (e.g. `type` instead of `level`), replace `"level"` with the actual column name in the SQL and in `r.getString(...)`. Also update the INSERT in Step 1's helper.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && ./mvnw test -Dtest=ExecutionRepositoryTest -pl . 2>&1 | tail -20
```

Expected: `BUILD SUCCESS`, all three new tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt \
        backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt
git commit -m "feat: add ExecutionRepository.findTaskLogs querying Kestra logs table"
```

---

## Task 3: Backend endpoint (TDD)

**Files:**
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`

- [ ] **Step 1: Write failing tests**

Add to `ExecutionResourceTest` (the class already has `@InjectMock lateinit var executionRepository: ExecutionRepository`):

```kotlin
@Test
@TestSecurity(user = "john.doe", roles = [])
@OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
fun `GET task logs returns list for known execution`() {
    `when`(executionRepository.findById("exec-1"))
        .thenReturn(ExecutionDetailRow("exec-1", "ns", "flow", "SUCCESS", null, null, emptyMap(), emptyList()))
    `when`(executionRepository.findTaskLogs("exec-1", "tr-1"))
        .thenReturn(listOf(
            LogEntry("2026-05-06T10:00:00Z", "INFO", "Starting task"),
            LogEntry("2026-05-06T10:00:01Z", "ERROR", "Task failed")
        ))

    given().`when`().get("/api/executions/exec-1/tasks/tr-1/logs")
        .then().statusCode(200)
        .body("size()", equalTo(2))
        .body("[0].level", equalTo("INFO"))
        .body("[0].message", equalTo("Starting task"))
        .body("[1].level", equalTo("ERROR"))
}

@Test
@TestSecurity(user = "john.doe", roles = [])
@OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
fun `GET task logs returns empty list when execution exists but task has no logs`() {
    `when`(executionRepository.findById("exec-1"))
        .thenReturn(ExecutionDetailRow("exec-1", "ns", "flow", "SUCCESS", null, null, emptyMap(), emptyList()))
    `when`(executionRepository.findTaskLogs("exec-1", "tr-no-logs"))
        .thenReturn(emptyList())

    given().`when`().get("/api/executions/exec-1/tasks/tr-no-logs/logs")
        .then().statusCode(200)
        .body("size()", equalTo(0))
}

@Test
@TestSecurity(user = "john.doe", roles = [])
@OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
fun `GET task logs returns 404 when execution does not exist`() {
    `when`(executionRepository.findById("no-such-exec")).thenReturn(null)

    given().`when`().get("/api/executions/no-such-exec/tasks/tr-1/logs")
        .then().statusCode(404)
}

@Test
fun `GET task logs without token returns 401`() {
    given().`when`().get("/api/executions/exec-1/tasks/tr-1/logs")
        .then().statusCode(401)
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && ./mvnw test -Dtest=ExecutionResourceTest -pl . 2>&1 | tail -20
```

Expected: `FAILED` — endpoint not found (404 from the server).

- [ ] **Step 3: Add endpoint to ExecutionResource**

Add to `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt` (after `getById`):

```kotlin
@GET
@Path("/{id}/tasks/{taskRunId}/logs")
fun getTaskLogs(
    @PathParam("id") id: String,
    @PathParam("taskRunId") taskRunId: String
): List<LogEntry> {
    executionRepository.findById(id) ?: throw NotFoundException("Execution $id not found")
    return executionRepository.findTaskLogs(id, taskRunId)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && ./mvnw test -Dtest=ExecutionResourceTest -pl . 2>&1 | tail -20
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 5: Run all backend tests**

```bash
cd backend && ./mvnw test 2>&1 | tail -10
```

Expected: `BUILD SUCCESS` — no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt \
        backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt
git commit -m "feat: add GET /api/executions/{id}/tasks/{taskRunId}/logs endpoint"
```

---

## Task 4: Frontend type + hook

**Files:**
- Modify: `frontend/src/types/execution.ts`
- Create: `frontend/src/hooks/useTaskLogs.ts`

- [ ] **Step 1: Add LogEntry to execution.ts**

Append to `frontend/src/types/execution.ts`:

```ts
export interface LogEntry {
  timestamp: string
  level: string  // INFO | WARN | ERROR | DEBUG | TRACE
  message: string
}
```

- [ ] **Step 2: Create useTaskLogs.ts**

Create `frontend/src/hooks/useTaskLogs.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { LogEntry } from '../types/execution'

export function useTaskLogs(executionId: string, taskRunId: string | null) {
  return useQuery<LogEntry[]>({
    queryKey: ['taskLogs', executionId, taskRunId],
    queryFn: () =>
      api
        .get(`/api/executions/${executionId}/tasks/${taskRunId}/logs`)
        .then(r => r.data),
    enabled: !!taskRunId,
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/execution.ts frontend/src/hooks/useTaskLogs.ts
git commit -m "feat: add LogEntry type and useTaskLogs hook"
```

---

## Task 5: Frontend page — inline log expand (TDD)

**Files:**
- Create: `frontend/src/pages/ExecutionDetailPage.test.tsx`
- Modify: `frontend/src/pages/ExecutionDetailPage.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/pages/ExecutionDetailPage.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ExecutionDetailPage } from './ExecutionDetailPage'

vi.mock('../hooks/useExecution', () => ({
  useExecution: () => ({
    data: {
      id: 'exec-1',
      namespace: 'prod',
      flowId: 'my-flow',
      state: 'FAILED',
      startDate: null,
      endDate: null,
      inputs: {},
      taskRuns: [
        { id: 'tr-1', taskId: 'fetch-data', state: 'SUCCESS', startDate: null, endDate: null },
        { id: 'tr-2', taskId: 'send-report', state: 'FAILED', startDate: null, endDate: null },
      ],
    },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../hooks/useTaskLogs', () => ({
  useTaskLogs: () => ({
    data: [{ timestamp: '2026-05-06T10:00:00Z', level: 'ERROR', message: 'Connection refused' }],
    isLoading: false,
  }),
}))

vi.mock('../components/RetriggerModal', () => ({ RetriggerModal: () => null }))

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/executions/exec-1']}>
        <Routes>
          <Route path="/executions/:id" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ExecutionDetailPage log view', () => {
  it('renders a logs toggle button for each task run', () => {
    wrap(<ExecutionDetailPage />)
    const toggles = screen.getAllByText('▶ logs')
    expect(toggles).toHaveLength(2)
  })

  it('clicking a toggle expands the inline log panel', () => {
    wrap(<ExecutionDetailPage />)
    fireEvent.click(screen.getAllByText('▶ logs')[0])
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
  })

  it('clicking the same toggle again collapses the panel', () => {
    wrap(<ExecutionDetailPage />)
    fireEvent.click(screen.getAllByText('▶ logs')[0])
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
    fireEvent.click(screen.getByText('▼ logs'))
    expect(screen.queryByText('Connection refused')).not.toBeInTheDocument()
  })

  it('only one log panel is open at a time', () => {
    wrap(<ExecutionDetailPage />)
    fireEvent.click(screen.getAllByText('▶ logs')[0])
    expect(screen.getAllByTestId('log-panel')).toHaveLength(1)
    fireEvent.click(screen.getByText('▶ logs'))   // second row still shows ▶ logs
    expect(screen.getAllByTestId('log-panel')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx vitest run src/pages/ExecutionDetailPage.test.tsx 2>&1 | tail -20
```

Expected: `FAILED` — `▶ logs` buttons not found.

- [ ] **Step 3: Modify ExecutionDetailPage**

Replace `frontend/src/pages/ExecutionDetailPage.tsx` with the following. Key changes: add `expandedTaskRunId` state, call `useTaskLogs`, add a toggle column to the table, inject the inline log panel `<tr>`.

```tsx
import { useState, Fragment } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useExecution } from '../hooks/useExecution'
import { useTaskLogs } from '../hooks/useTaskLogs'
import { StatusBadge } from '../components/StatusBadge'
import { KpiCard } from '../components/KpiCard'
import { RetriggerModal } from '../components/RetriggerModal'

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function levelClass(level: string): string {
  if (level === 'ERROR') return 'text-red-400'
  if (level === 'WARN') return 'text-yellow-400'
  return 'text-gray-400'
}

export function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: execution, isLoading, error } = useExecution(id!)
  const [showRetrigger, setShowRetrigger] = useState(false)
  const [expandedTaskRunId, setExpandedTaskRunId] = useState<string | null>(null)
  const { data: logs, isLoading: logsLoading } = useTaskLogs(id!, expandedTaskRunId)

  if (isLoading) return <div className="p-6 text-gray-500">Loading…</div>
  if (error || !execution) return (
    <div className="p-6">
      <p className="text-red-600">Execution not found.</p>
      <Link to="/" className="text-blue-600 text-sm hover:underline mt-2 block">← Back</Link>
    </div>
  )

  const passed = execution.taskRuns.filter(t => t.state === 'SUCCESS').length
  const failed = execution.taskRuns.filter(t => ['FAILED', 'KILLED'].includes(t.state)).length

  function toggleLogs(taskRunId: string) {
    setExpandedTaskRunId(prev => prev === taskRunId ? null : taskRunId)
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-blue-600 text-sm hover:underline">← Executions</Link>
        <span className="text-gray-300">/</span>
        <span className="font-mono text-sm text-gray-600">{execution.id}</span>
      </div>

      {/* KPI cards */}
      <div className="flex gap-4 flex-wrap items-center">
        <KpiCard label="Duration" value={formatDuration(execution.startDate, execution.endDate)} />
        <KpiCard label="Tasks passed" value={`${passed} / ${execution.taskRuns.length}`} color="green" />
        <KpiCard label="Tasks failed" value={failed} color={failed > 0 ? 'red' : 'default'} />
        <div className="border rounded-lg p-4 text-center min-w-[120px]">
          <StatusBadge state={execution.state} />
          <div className="text-xs text-gray-500 mt-1">Final state</div>
        </div>
        <button
          onClick={() => setShowRetrigger(true)}
          className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
        >
          Retrigger
        </button>
      </div>

      {/* Metadata */}
      <div className="border rounded-lg p-5 space-y-2 text-sm">
        <h2 className="font-semibold text-base mb-3">Details</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          <div><span className="text-gray-500">Flow:</span> <span className="font-medium">{execution.flowId}</span></div>
          <div><span className="text-gray-500">Namespace:</span> {execution.namespace}</div>
          <div><span className="text-gray-500">Start:</span> {execution.startDate ? new Date(execution.startDate).toLocaleString() : '—'}</div>
          <div><span className="text-gray-500">End:</span> {execution.endDate ? new Date(execution.endDate).toLocaleString() : '—'}</div>
        </div>
        {Object.keys(execution.inputs).length > 0 && (
          <div className="mt-3">
            <div className="text-gray-500 mb-1">Inputs:</div>
            <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto border">
              {JSON.stringify(execution.inputs, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Task runs */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b">
          <h2 className="font-semibold text-sm">Task Runs ({execution.taskRuns.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase tracking-wide">
            <tr className="border-b">
              <th className="px-4 py-2 text-left">Task ID</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Start</th>
              <th className="px-4 py-2 text-left">End</th>
              <th className="px-4 py-2 text-left">Duration</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {execution.taskRuns.map(tr => {
              const isExpanded = expandedTaskRunId === tr.id
              return (
                <Fragment key={tr.id}>
                  <tr
                    className={`hover:bg-gray-50 ${isExpanded ? 'bg-yellow-50 border-l-2 border-yellow-300' : ''}`}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs">{tr.taskId}</td>
                    <td className="px-4 py-2.5"><StatusBadge state={tr.state} /></td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {tr.startDate ? new Date(tr.startDate).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {tr.endDate ? new Date(tr.endDate).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {formatDuration(tr.startDate, tr.endDate)}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => toggleLogs(tr.id)}
                        className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
                      >
                        {isExpanded ? '▼ logs' : '▶ logs'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr data-testid="log-panel">
                      <td colSpan={6} className="p-0">
                        <div className="bg-gray-900 text-gray-200 font-mono text-xs leading-relaxed p-3 max-h-64 overflow-y-auto">
                          {logsLoading && (
                            <div className="text-gray-500 text-center py-4">Loading…</div>
                          )}
                          {!logsLoading && (!logs || logs.length === 0) && (
                            <div className="text-gray-500 text-center py-4">No logs for this task run.</div>
                          )}
                          {!logsLoading && logs && logs.map((entry, i) => (
                            <div key={i}>
                              <span className="text-gray-600">{entry.timestamp}</span>
                              {' '}
                              <span className={`${levelClass(entry.level)} font-semibold`}>{entry.level.padEnd(5)}</span>
                              {' '}
                              {entry.message}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {showRetrigger && (
        <RetriggerModal execution={execution} onClose={() => setShowRetrigger(false)} />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run new tests to confirm they pass**

```bash
cd frontend && npx vitest run src/pages/ExecutionDetailPage.test.tsx 2>&1 | tail -20
```

Expected: `PASSED` — all 4 tests green.

- [ ] **Step 5: Run all frontend tests**

```bash
cd frontend && npm test -- --run 2>&1 | tail -20
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ExecutionDetailPage.tsx \
        frontend/src/pages/ExecutionDetailPage.test.tsx
git commit -m "feat: add inline per-task log expand on execution detail page"
```

---

## Done

All backend and frontend tests should pass. Verify end-to-end by starting both services (`./mvnw compile quarkus:dev` + `npm run dev`) and opening an execution with task runs — each row should have a ▶ logs toggle.
