# Retrigger Input Overrides — Design Spec

**Date:** 2026-05-02
**Status:** Approved

## Overview

Allow users to edit execution inputs before retriggering, directly inside the existing `RetriggerModal`. A Simple/Advanced toggle supports both casual edits (individual fields) and power-user edits (raw JSON). All overrides are recorded in the audit log.

---

## Architecture

Three layers change; everything else is untouched.

| Layer | Change |
|---|---|
| **Backend API** | `POST /api/executions/{id}/retrigger` accepts an optional JSON body `{ "overrides": { … } }` |
| **Backend audit** | `kestra_retrigger_audit` gains a nullable `input_overrides TEXT` column |
| **Frontend modal** | `RetriggerModal` inputs block becomes an editable form with Simple/Advanced toggle |

Unchanged: `KestraClient`, `ExecutionListPage`, `ExecutionDetailPage`, list/detail hooks. `useRetrigger` gains a new argument shape (see Frontend section).

---

## Frontend

### RetriggerModal changes

A `mode` state (`'simple' | 'advanced'`, default `'simple'`) controls which editor is shown. A **Simple | Advanced** pill toggle sits above the inputs area.

**Simple mode** — one row per top-level input key. Key name is a read-only label; value is an editable input whose type is inferred from the original value:

| Original value | Input type |
|---|---|
| ISO date string (`2026-05-01`) | `<input type="date">` |
| ISO datetime string (`…T…Z`) | `<input type="datetime-local">` |
| `true` / `false` | `<input type="checkbox">` |
| number | `<input type="number">` |
| anything else | `<input type="text">` |

Values are pre-filled from the original execution inputs. Key names are not editable. When building the overrides map, values are cast back to their inferred type: checkbox → `boolean`, number input → `number`, all other inputs → `string`.

**Advanced mode** — a `<textarea>` pre-populated with `JSON.stringify(inputs, null, 2)`. Submission is blocked with an inline error if the content is not valid JSON.

**Mode switching:**
- Simple → Advanced: serialise current field values into the textarea.
- Advanced → Simple: parse textarea JSON back into fields. If JSON is invalid, stay in Advanced with an inline error.

**On confirm** — in simple mode, compute overrides as entries whose value differs from the original; in advanced mode, use the full parsed object. Pass `{ id, overrides }` to `retrigger.mutateAsync()`.

### `useRetrigger` hook change

`mutationFn` changes from `(id: string)` to `(req: { id: string; overrides: Record<string, unknown> })` and sends `overrides` as the POST body.

---

## Backend

### New request body type

```kotlin
data class RetriggerRequest(
    val overrides: Map<String, Any?> = emptyMap()
)
```

`ExecutionResource.retrigger()` accepts an optional `@Body` of this type. Absent body = empty overrides. Backward-compatible.

### Merge logic (`RetriggerService`)

```kotlin
fun retrigger(
    executionId: String,
    triggeredBy: String,
    overrides: Map<String, Any?> = emptyMap()
): RetriggerResponse
```

Merged inputs sent to Kestra:
```kotlin
val mergedInputs = original.inputs + overrides  // overrides win on conflict
```

### Audit changes

**Schema** — add nullable column to `kestra_retrigger_audit`:
```sql
ALTER TABLE kestra_retrigger_audit ADD COLUMN input_overrides TEXT NULL;
```

**`AuditRepository.writeAudit()` signature:**
```kotlin
fun writeAudit(
    triggeredBy: String,
    originalExecutionId: String,
    newExecutionId: String,
    inputOverrides: Map<String, Any?>? = null
)
```

When `inputOverrides` is non-null and non-empty, serialise to JSON and write to the column. Records only the **delta** (overrides), not the full merged input set.

---

## Error Handling

| Scenario | Backend | Frontend |
|---|---|---|
| Invalid JSON in advanced mode | Not reached (FE validates before send) | Inline red error, submit blocked |
| Override key rejected by Kestra | 409 forwarded from Kestra | Modal shows Kestra's error (existing path) |
| `input_overrides` column missing | 500 | Existing 5xx toast |
| Empty overrides | Identical to today | No change |

---

## Testing

### Backend (additions)

- `RetriggerServiceTest` — merged inputs sent to Kestra with overrides winning; empty overrides sends originals unchanged
- `AuditRepositoryTest` — `writeAudit` with non-null overrides stores correct JSON in `input_overrides`; null overrides stores NULL
- `ExecutionResourceTest` — POST body with overrides is parsed and forwarded to service

### Frontend (additions)

- `RetriggerModal.test.tsx` — simple mode pre-fills fields from inputs; advanced mode shows JSON textarea; switching Simple→Advanced preserves values

---

## Migration

```sql
-- Run once against production MySQL
ALTER TABLE kestra_retrigger_audit ADD COLUMN input_overrides TEXT NULL;
```

Also update `backend/src/test/resources/db-setup.sql` to include the column so H2 tests match production schema.
