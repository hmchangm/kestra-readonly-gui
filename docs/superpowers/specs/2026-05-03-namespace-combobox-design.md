# Namespace Filter Combobox

**Date:** 2026-05-03  
**Status:** Approved

## Overview

Replace the free-text namespace input on the Execution List page with a custom combobox that fetches distinct namespace values from the local database and shows matching suggestions as the user types. Typing a partial value still filters the table immediately; the dropdown only helps with discovery.

## Backend

**New query** in `ExecutionRepository`:

```sql
SELECT DISTINCT namespace FROM executions ORDER BY namespace
```

Returns `List<String>`.

**New endpoint** in `ExecutionResource`:

```
GET /api/namespaces → List<String>
```

No new service class required — the repository method is called directly from the resource.

## Frontend

### `useNamespaces.ts`

React Query hook that fetches `GET /api/namespaces`. Configured with `staleTime: 5 * 60 * 1000` (5 minutes) so the list is not refetched on every mount or navigation.

### `NamespaceCombobox.tsx`

Self-contained component. Props:

| Prop | Type | Description |
|---|---|---|
| `value` | `string` | Controlled input value |
| `onChange` | `(v: string) => void` | Called on every keystroke and on suggestion selection |

**Behaviour:**

- Dropdown opens when the user types; closes on selection, Escape, or click outside.
- Suggestion list is filtered by case-insensitive substring match against `value`.
- Selecting a suggestion sets `value` to the full namespace string and closes the dropdown.
- If the user clears the input, the table resets to all namespaces (existing behaviour).
- Click-outside handled via `useRef` + `useEffect` document listener, cleaned up on unmount.

**Keyboard:**

| Key | Action |
|---|---|
| ↓ / ↑ | Move highlight through visible suggestions |
| Enter | Select highlighted suggestion |
| Escape | Close dropdown, keep current text |

### `ExecutionListPage.tsx`

Replace the existing `<input placeholder="Filter by namespace…" …>` with `<NamespaceCombobox value={namespace} onChange={v => { setNamespace(v); setPage(0) }} />`. No other changes to the page.

## Out of Scope

- Server-side namespace search (list is small enough to filter client-side).
- Ability to select multiple namespaces at once.
- Debouncing the table query (existing on-change behaviour is preserved as-is).
