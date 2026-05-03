# Kestra Read-Only GUI — Design Spec

**Date:** 2026-05-01  
**Status:** Approved

## Overview

A read-only GUI for Kestra Open Source that restricts end users (internal ops/support team, ~5–20 people) to viewing execution history/status and retriggering jobs. Kestra's own admin UI is not exposed to these users. Authentication is handled by a self-hosted Keycloak instance using OIDC PKCE flow. All retrigger actions are audit-logged.

**Tech stack:** React (Vite + TypeScript) — Frontend · Quarkus Kotlin (RESTEasy Reactive) — Backend

---

## Architecture

### Components

| Component | Role |
|---|---|
| **React SPA** | Vite + TypeScript. Handles Keycloak PKCE login via `oidc-client-ts`. Displays execution list and detail. Triggers retrigger with confirmation. |
| **Quarkus Kotlin BE** | Validates Keycloak JWT on every request (`quarkus-oidc` bearer mode). Reads execution data from MySQL directly. Calls Kestra REST API for retrigger. Writes audit log to MySQL. |
| **Keycloak** | Self-hosted OIDC provider. Issues JWTs, exposes JWKS endpoint for Quarkus validation. PKCE flow for SPA. |
| **MySQL** | Shared DB. Quarkus reads Kestra's `executions` and `task_runs` tables (read-only). Quarkus owns and writes the `kestra_retrigger_audit` table. |
| **Kestra** | Existing workflow engine. Quarkus calls `POST /api/v1/{namespace}/executions/{flowId}` to create new executions. Kestra's DB is not written to directly. |

### Data Flow

```
Browser → Keycloak          OIDC PKCE login
Browser ← access_token      JWT stored in memory

Browser → Quarkus BE        Bearer JWT on every request
Quarkus BE → MySQL          Read executions / task_runs
Quarkus BE → MySQL          Write kestra_retrigger_audit
Quarkus BE → Kestra API     POST /executions (retrigger only)
```

### Key Constraints

- React SPA has no direct access to Kestra — all calls go through Quarkus BE.
- Quarkus only reads Kestra's DB tables — no writes to Kestra's schema.
- `kestra_retrigger_audit` is the only table owned by this service.

---

## Frontend

### Stack

- Vite + React + TypeScript
- `oidc-client-ts` — OIDC PKCE flow
- React Query — server state / caching
- React Router — navigation
- shadcn/ui — component library (Tailwind-based, Vite-compatible)
- Recharts — charting library (KPI cards + timeline bar chart)

### Routes

| Path | Description |
|---|---|
| `/login` | Redirects to Keycloak |
| `/callback` | OIDC callback handler — stores token, redirects to `/` |
| `/` | Execution list page |
| `/executions/:id` | Execution detail page |

### Execution List Page

**Summary section (top of page):**
- 4 KPI cards: Total today, Success rate %, Running now, Failed today
- Stacked bar chart (Recharts): execution count per hour over the last 24h, stacked by status (SUCCESS / FAILED / RUNNING / KILLED)
- Both cards and chart are driven by a `GET /api/executions/summary` endpoint (see Backend)

**Table section (below charts):**
- Paginated table: Execution ID, Flow ID, Namespace, Status (badge), Start time, End time, Duration
- Filters: Status (multi-select), Namespace, date range (server-side filtering)
- Each row has a **Retrigger** button
- Retrigger opens a confirmation modal showing: Flow ID, Namespace, original inputs → on confirm → `POST /api/executions/{id}/retrigger`

### Execution Detail Page

**KPI cards (top of page):**
- Total duration, Tasks passed (x / total), Tasks failed, Final state badge
- Same card style as the list page for visual consistency

**Detail section (below cards):**
- Full execution metadata (namespace, flow ID, inputs, labels, trigger)
- Task runs list with status badge + start time + end time + duration per task
- Retrigger button (same confirmation modal flow)

### Auth Behaviour

- On app load, `oidc-client-ts` silently checks for a valid token via Keycloak SSO session
- If no valid token → redirect to Keycloak login
- Token stored in **memory only** (not localStorage) — silently renewed via Keycloak session on page refresh
- All fetch/Axios calls attach `Authorization: Bearer <token>` via an interceptor
- On `401` response → trigger re-login

---

## Backend

### Stack

- Quarkus 3.x + Kotlin
- RESTEasy Reactive
- `quarkus-oidc` — JWT bearer token validation
- `quarkus-agroal` + `quarkus-jdbc-mysql` — connection pool, native SQL
- `quarkus-rest-client-reactive` — Kestra API client

### API Endpoints

All endpoints require a valid Keycloak JWT.

#### `GET /api/executions/summary`

Returns KPI counts and hourly breakdown for the last 24h (used by the dashboard charts).

```json
{
  "totalToday": 142,
  "successRate": 87,
  "runningNow": 12,
  "failedToday": 18,
  "hourly": [
    { "hour": "2026-05-01T08:00:00Z", "SUCCESS": 12, "FAILED": 3, "RUNNING": 2, "KILLED": 0 },
    { "hour": "2026-05-01T09:00:00Z", "SUCCESS": 18, "FAILED": 1, "RUNNING": 4, "KILLED": 1 }
  ]
}
```

#### `GET /api/executions`

Query params: `namespace`, `status`, `from`, `to`, `page` (default 0), `size` (default 20)

```json
{
  "total": 412,
  "page": 0,
  "size": 20,
  "results": [
    {
      "id": "6XmNpQ3...",
      "namespace": "prod.etl",
      "flowId": "daily-report",
      "state": "FAILED",
      "startDate": "2026-05-01T08:00:00Z",
      "endDate": "2026-05-01T08:03:21Z"
    }
  ]
}
```

#### `GET /api/executions/{id}`

```json
{
  "id": "6XmNpQ3...",
  "namespace": "prod.etl",
  "flowId": "daily-report",
  "state": "FAILED",
  "startDate": "2026-05-01T08:00:00Z",
  "endDate": "2026-05-01T08:03:21Z",
  "inputs": { "date": "2026-05-01" },
  "taskRuns": [
    { "id": "tr1", "taskId": "extract", "state": "SUCCESS", "startDate": "...", "endDate": "..." },
    { "id": "tr2", "taskId": "transform", "state": "FAILED", "startDate": "...", "endDate": "..." }
  ]
}
```

#### `POST /api/executions/{id}/retrigger`

Request body: empty — inputs are read from the original execution.

```json
{
  "newExecutionId": "7AbCdE4...",
  "originalExecutionId": "6XmNpQ3...",
  "triggeredBy": "john.doe",
  "triggeredAt": "2026-05-01T09:15:00Z"
}
```

Errors: `404` (execution not found), `409` (Kestra rejected), `502` (Kestra unreachable)

### Retrigger Flow

1. Load original execution from MySQL (namespace, flowId, inputs)
2. `POST` to Kestra: `http://kestra-host/api/v1/{namespace}/executions/{flowId}` with same inputs
3. On Kestra success → insert into `kestra_retrigger_audit`
4. Return new execution ID to FE

If the audit write fails, log the error server-side and still return success — the retrigger already happened in Kestra.

### Data Access (Native SQL)

No ORM. Inject `DataSource` via `quarkus-agroal`, use `PreparedStatement` and map `ResultSet` manually into Kotlin data classes.

```kotlin
@ApplicationScoped
class ExecutionRepository(@DataSource("default") private val ds: DataSource) {

    fun listExecutions(namespace: String?, status: String?, page: Int, size: Int): List<ExecutionRow> {
        val sql = """
            SELECT id, namespace, flow_id, state_current, start_date, end_date
            FROM executions
            WHERE (? IS NULL OR namespace = ?)
              AND (? IS NULL OR state_current = ?)
            ORDER BY start_date DESC
            LIMIT ? OFFSET ?
        """.trimIndent()
        ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, namespace); ps.setString(2, namespace)
                ps.setString(3, status);    ps.setString(4, status)
                ps.setInt(5, size);         ps.setInt(6, page * size)
                return ps.executeQuery().use { rs -> rs.toList { it.toExecutionRow() } }
            }
        }
    }
}

fun <T> ResultSet.toList(mapper: (ResultSet) -> T): List<T> =
    generateSequence { if (next()) mapper(this) else null }.toList()
```

### Audit Log Table

```sql
CREATE TABLE kestra_retrigger_audit (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  triggered_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  triggered_by          VARCHAR(255) NOT NULL,
  original_execution_id VARCHAR(255) NOT NULL,
  new_execution_id      VARCHAR(255) NOT NULL
);
```

`triggered_by` is populated from the `preferred_username` claim of the Keycloak JWT.

### Quarkus OIDC Config

```properties
quarkus.oidc.auth-server-url=https://keycloak-host/realms/<realm>
quarkus.oidc.application-type=service
quarkus.oidc.token.issuer=any
```

### CORS Config

The React SPA runs on a different origin (e.g. `http://localhost:5173` in dev, `https://kestra-gui.internal` in prod). Quarkus must allow cross-origin requests from the FE origin:

```properties
quarkus.http.cors=true
quarkus.http.cors.origins=https://kestra-gui.internal
quarkus.http.cors.methods=GET,POST
quarkus.http.cors.headers=Authorization,Content-Type
```

---

## Error Handling

| Scenario | BE Response | FE Behaviour |
|---|---|---|
| JWT expired / invalid | `401 Unauthorized` | Redirect to Keycloak login |
| Execution not found | `404 Not Found` | Inline error on page |
| Kestra API unreachable | `502 Bad Gateway` | Toast: "Kestra unavailable, try again" |
| Kestra rejects retrigger | `409 Conflict` (Kestra error forwarded) | Toast with Kestra's message |
| MySQL connection failure | `503 Service Unavailable` | Toast: "Database unavailable" |
| Audit write fails | Log error, return success | No UI impact |

---

## Testing

| Layer | What | How |
|---|---|---|
| BE unit | Repository SQL queries | H2 in-memory + `@QuarkusTest` |
| BE integration | Retrigger endpoint end-to-end | `@QuarkusTest` + WireMock (Kestra API) + test MySQL |
| BE auth | JWT validation + `@Authenticated` | `@QuarkusTest` + `quarkus-test-security` |
| FE unit | Confirmation modal, status badges | Vitest + React Testing Library |
| FE E2E | Login → list → retrigger flow | Playwright + Keycloak test realm |

---

## Out of Scope

- Flow/namespace-level access control (all users see all executions)
- Editing or cancelling executions
- Log streaming / real-time updates (polling is sufficient for v1)
- User management (handled entirely by Keycloak)
