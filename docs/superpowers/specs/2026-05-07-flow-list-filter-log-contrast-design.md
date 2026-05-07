# Flow List Filter and Log Contrast — Design Spec

**Date:** 2026-05-07
**Scope:** Two frontend UI enhancements: namespace filtering on the flow list and readable timestamps in the execution log panel.

---

## Overview

This change improves two existing UI surfaces without changing backend API behavior:

1. Add a namespace filter to the Flows page using the same combobox pattern already used on the Executions page.
2. Improve task log timestamp contrast in the dark log panel.

Deleted-flow API behavior is intentionally out of scope for this spec. The current report is that rows from the `flows` table with `deleted = true` may appear in the list, but the backend SQL already attempts to filter them. That should be investigated separately against the real Kestra MySQL schema and stored values.

---

## Flow List Namespace Filter

`FlowListPage` will reuse the existing `NamespaceCombobox` component from the execution page.

The filter is client-side only:

- `useFlows()` continues to call `GET /api/flows` with no query parameters.
- `FlowListPage` stores a local `namespace` filter string in component state.
- The rendered table uses `flows.filter(flow => flow.namespace.toLowerCase().includes(namespace.toLowerCase()))` when the filter is non-empty.
- The combobox suggestion list continues to come from the existing `useNamespaces()` hook through `NamespaceCombobox`.

This keeps the change small and avoids changing the flow API contract. It also matches the interaction style users already have on the execution page.

### Empty State

If flows load successfully but the namespace filter removes every row, the table area should show a small empty-state row such as `No flows match this namespace.` This prevents the page from looking broken when the filter is valid but no rows match.

---

## Log Timestamp Contrast

The expanded task log panel in `ExecutionDetailPage` uses a dark background (`bg-gray-900`) with light log text (`text-gray-200`). Timestamps are currently rendered with `text-gray-600`, which is too dim against the dark background.

Change the timestamp class to a lighter muted color, such as `text-gray-400`. Existing log level colors remain unchanged:

- `ERROR` stays red.
- `WARN` stays yellow.
- Other levels stay muted gray through `levelClass`.

This is a narrow contrast fix. It does not redesign the log viewer, alter log content, or change backend log APIs.

---

## Testing

### Frontend Tests

Update `FlowListPage.test.tsx`:

- Mock `useFlows()` with at least two flows in different namespaces.
- Mock `NamespaceCombobox` or interact with the real component in a focused way.
- Verify applying a namespace filter hides non-matching rows and keeps matching rows visible.
- Verify an empty-state message appears when the filter matches no flow rows.

Update `ExecutionDetailPage.test.tsx`:

- Keep the existing log expansion test.
- Add an assertion that the rendered log timestamp has the readable timestamp class (`text-gray-400`).

### Type Check

Run `npx tsc --noEmit` after the UI changes.

---

## Out of Scope

- Changing `GET /api/flows` or `FlowRepository`.
- Adding server-side namespace filtering to flow APIs.
- Investigating the real Kestra `flows.deleted` storage representation.
- URL query parameters for flow filters.
- Pagination or sorting changes on the flow list.
- Log viewer redesign beyond timestamp contrast.
