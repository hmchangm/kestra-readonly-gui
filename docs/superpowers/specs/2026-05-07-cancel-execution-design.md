# Cancel Execution — Design Spec

Date: 2026-05-07

## Overview

Add a Cancel button that lets users send a kill signal to a running Kestra execution. The button appears on both the execution list page (per row) and the execution detail page, is gated to cancellable states, requires a confirmation modal, and is audited via a unified `kestra_execution_audit` table whose writing can be toggled with a config flag.

---

## Architecture

The feature follows the existing retrigger pattern end-to-end:

- Backend: `CancelService` → `KestraClient.killExecution` → `AuditRepository.writeAudit`
- Frontend: `useCancel` hook → `CancelModal` component → both pages

The primary structural change is replacing `kestra_retrigger_audit` with a unified `kestra_execution_audit` table that carries an `action` column (`RETRIGGER` | `CANCEL`). Audit writes are gated by a single `app.audit.enabled` config flag checked inside `AuditRepository`.

---

## Backend

### Schema (`db-setup.sql`)

Replace `kestra_retrigger_audit` with:

```sql
CREATE TABLE IF NOT EXISTS kestra_execution_audit (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    acted_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acted_by         VARCHAR(255) NOT NULL,
    action           VARCHAR(20)  NOT NULL,   -- RETRIGGER | CANCEL
    execution_id     VARCHAR(255) NOT NULL,
    new_execution_id VARCHAR(255) NULL,        -- RETRIGGER only
    input_overrides  TEXT NULL                 -- RETRIGGER only
);
```

### `AuditRepository`

- Inject `@ConfigProperty(name = "app.audit.enabled", defaultValue = "true") val auditEnabled: Boolean`
- Replace `writeAudit(triggeredBy, originalExecutionId, newExecutionId, inputOverrides?)` with:
  ```
  writeAudit(action, actedBy, executionId, newExecutionId?, inputOverrides?)
  ```
- Returns immediately (no-op) when `auditEnabled = false`
- Writes to `kestra_execution_audit`

### `RetriggerService`

Updated to call the new `writeAudit` signature with `action = "RETRIGGER"`, `executionId = original.id`, `newExecutionId = kestraResponse.id`.

### `KestraClient`

Add kill method:

```kotlin
@DELETE
@Path("/api/v1/main/executions/{executionId}")
fun killExecution(@PathParam("executionId") executionId: String)
```

### `CancelService`

New `@ApplicationScoped` bean:

- Accepts `(executionId, cancelledBy)`
- Looks up execution; throws `NotFoundException` if missing
- Throws `BadRequestException` if state is not cancellable
- Calls `kestraClient.killExecution(executionId)`; wraps Kestra errors as 502
- Calls `auditRepository.writeAudit("CANCEL", cancelledBy, executionId)`; failure is logged but not re-thrown

**Cancellable states:** `CREATED`, `RUNNING`, `PAUSED`, `RESTARTED`, `KILLING`

### `ExecutionResource`

Add endpoint:

```kotlin
@POST
@Path("/{id}/cancel")
fun cancel(@PathParam("id") id: String)
```

Delegates to `CancelService`, resolves username the same way as retrigger.

### `application.properties`

```
app.audit.enabled=true
```

### Models

Add `CancelResponse`:

```kotlin
data class CancelResponse(
    val executionId: String,
    val cancelledBy: String,
    val cancelledAt: String
)
```

---

## Frontend

### `useCancel` hook (`hooks/useCancel.ts`)

`useMutation` posting to `POST /api/executions/{id}/cancel`. On success, invalidates `['executions']` and `['execution', id]` so both list and detail pages refetch automatically.

### `CancelModal` component (`components/CancelModal.tsx`)

Confirmation modal (no input fields). Shows:

- Execution ID, flow, namespace
- Warning: "This sends a kill signal to Kestra. The execution will transition to KILLED."
- Inline error if the API call fails
- Buttons: "Back" (dismiss) and "Confirm Cancel" (red, disabled while pending)

### Cancellable states

Cancel button renders only when `state` is one of `CREATED`, `RUNNING`, `PAUSED`, `RESTARTED`. All terminal states (`SUCCESS`, `WARNING`, `FAILED`, `KILLED`) and `KILLING` show no button.

### `ExecutionDetailPage`

Cancel button added next to the Retrigger button in the KPI card row, rendered conditionally based on state. Clicking opens `CancelModal`. On success, query invalidation causes the page to refetch.

### `ExecutionListPage`

Cancel button added to the actions column alongside Retrigger in each row, rendered conditionally based on state. Clicking opens `CancelModal` with that row's execution data. On success, the list refetches.

---

## Error handling

| Scenario | Behaviour |
|---|---|
| Execution not found | 404 from backend; modal shows error |
| State not cancellable | 400 from backend; modal shows error |
| Kestra API unreachable | 502 from backend; modal shows error |
| Audit write fails | Logged server-side; cancel still succeeds (same pattern as retrigger) |

---

## Testing

- **Backend unit tests**: `CancelService` — not found, bad state, Kestra 502, audit disabled (no write), audit failure non-fatal
- **Backend resource test**: `POST /api/executions/{id}/cancel` happy path and error cases
- **Frontend component test**: `CancelModal` renders, Back dismisses, Confirm calls hook, error surfaces
- **Frontend page test**: Cancel button visible for cancellable states, hidden for terminal states
