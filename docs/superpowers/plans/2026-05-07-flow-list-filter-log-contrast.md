# Flow List Filter and Log Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side namespace filtering to the Flows page and make execution log timestamps readable on the dark log background.

**Architecture:** This is a frontend-only change. `FlowListPage` will reuse the existing `NamespaceCombobox` and filter the already-loaded `FlowRow[]` locally; `ExecutionDetailPage` will keep its existing log structure and only adjust the timestamp text color.

**Tech Stack:** React, TypeScript, Vite, TanStack Query, Vitest, Testing Library, Tailwind utility classes.

---

## File Map

**Modified:**
- `frontend/src/pages/FlowListPage.tsx` — add namespace filter state, `NamespaceCombobox`, filtered row rendering, and empty-state row.
- `frontend/src/pages/FlowListPage.test.tsx` — add tests for namespace filtering and empty state.
- `frontend/src/pages/ExecutionDetailPage.tsx` — change log timestamp class from `text-gray-600` to `text-gray-400`.
- `frontend/src/pages/ExecutionDetailPage.test.tsx` — assert the timestamp is rendered with `text-gray-400`.

**Not modified:**
- `frontend/src/hooks/useFlows.ts` — keep `GET /api/flows` unchanged.
- Backend files — no API or repository changes in this plan.

---

## Task 1: Add Client-Side Namespace Filter to FlowListPage

**Files:**
- Modify: `frontend/src/pages/FlowListPage.test.tsx`
- Modify: `frontend/src/pages/FlowListPage.tsx`

- [ ] **Step 1: Replace FlowListPage tests with filter coverage**

Replace the entire content of `frontend/src/pages/FlowListPage.test.tsx` with:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FlowListPage } from './FlowListPage'

vi.mock('../hooks/useFlows', () => ({
  useFlows: () => ({
    data: [
      { namespace: 'prod', flowId: 'daily', lastRunDate: '2026-05-06T10:00:00Z', executionCount: 2 },
      { namespace: 'dev', flowId: 'hourly', lastRunDate: null, executionCount: 0 },
    ],
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../components/NamespaceCombobox', () => ({
  NamespaceCombobox: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input
      aria-label="Namespace filter"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

describe('FlowListPage', () => {
  it('renders flow rows as links to flow detail', () => {
    render(<MemoryRouter><FlowListPage /></MemoryRouter>)

    expect(screen.getByText('prod')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'daily' })
    expect(link).toHaveAttribute('href', '/flows/prod/daily')
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('filters flow rows by namespace text', () => {
    render(<MemoryRouter><FlowListPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Namespace filter'), { target: { value: 'prod' } })

    expect(screen.getByRole('link', { name: 'daily' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'hourly' })).not.toBeInTheDocument()
  })

  it('shows an empty state when no flows match the namespace filter', () => {
    render(<MemoryRouter><FlowListPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Namespace filter'), { target: { value: 'qa' } })

    expect(screen.getByText('No flows match this namespace.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'daily' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'hourly' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run FlowListPage test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/FlowListPage.test.tsx
```

Expected: FAIL because `FlowListPage` does not render a namespace filter or empty state yet.

- [ ] **Step 3: Update FlowListPage implementation**

Edit `frontend/src/pages/FlowListPage.tsx`.

Add `useState` and `NamespaceCombobox` imports:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { NamespaceCombobox } from '../components/NamespaceCombobox'
import { useFlows } from '../hooks/useFlows'
```

At the start of `FlowListPage`, add local namespace state before calling `useFlows()`:

```tsx
export function FlowListPage() {
  const [namespace, setNamespace] = useState('')
  const { data: flows, isLoading, error } = useFlows()
```

After the loading/error branches and before `return`, add the filtered rows:

```tsx
  const filteredFlows = namespace
    ? (flows ?? []).filter(flow => flow.namespace.toLowerCase().includes(namespace.toLowerCase()))
    : (flows ?? [])
```

Inside the main page content, immediately after the `<h1>` line, add the filter control:

```tsx
        <div className="flex gap-3 flex-wrap">
          <NamespaceCombobox value={namespace} onChange={setNamespace} />
        </div>
```

Replace the `<tbody>` map block:

```tsx
            <tbody className="divide-y divide-gray-100">
              {(flows ?? []).map(flow => (
                <tr key={`${flow.namespace}/${flow.flowId}`} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">{flow.namespace}</td>
                  <td className="px-4 py-2.5">
                    <Link to={`/flows/${flow.namespace}/${flow.flowId}`} className="text-blue-600 hover:underline font-medium">
                      {flow.flowId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{flow.lastRunDate ? new Date(flow.lastRunDate).toLocaleString() : '-'}</td>
                  <td className="px-4 py-2.5">{flow.executionCount}</td>
                </tr>
              ))}
            </tbody>
```

with:

```tsx
            <tbody className="divide-y divide-gray-100">
              {filteredFlows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">
                    No flows match this namespace.
                  </td>
                </tr>
              ) : (
                filteredFlows.map(flow => (
                  <tr key={`${flow.namespace}/${flow.flowId}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">{flow.namespace}</td>
                    <td className="px-4 py-2.5">
                      <Link to={`/flows/${flow.namespace}/${flow.flowId}`} className="text-blue-600 hover:underline font-medium">
                        {flow.flowId}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{flow.lastRunDate ? new Date(flow.lastRunDate).toLocaleString() : '-'}</td>
                    <td className="px-4 py-2.5">{flow.executionCount}</td>
                  </tr>
                ))
              )}
            </tbody>
```

- [ ] **Step 4: Run FlowListPage test to verify it passes**

```bash
cd frontend && npx vitest run src/pages/FlowListPage.test.tsx
```

Expected: PASS, 3 tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add frontend/src/pages/FlowListPage.tsx frontend/src/pages/FlowListPage.test.tsx
git commit -m "feat: filter flows by namespace"
```

---

## Task 2: Improve Log Timestamp Contrast

**Files:**
- Modify: `frontend/src/pages/ExecutionDetailPage.test.tsx`
- Modify: `frontend/src/pages/ExecutionDetailPage.tsx`

- [ ] **Step 1: Add timestamp contrast assertion**

In `frontend/src/pages/ExecutionDetailPage.test.tsx`, add this test inside `describe('ExecutionDetailPage log view', () => { ... })`, after the `clicking a toggle expands the inline log panel` test:

```tsx
  it('renders log timestamps with readable contrast on the dark panel', () => {
    wrap(<ExecutionDetailPage />)
    fireEvent.click(screen.getAllByText('▶ logs')[0])

    expect(screen.getByText('2026-05-06T10:00:00Z')).toHaveClass('text-gray-400')
  })
```

- [ ] **Step 2: Run ExecutionDetailPage test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/ExecutionDetailPage.test.tsx
```

Expected: FAIL because the timestamp still uses `text-gray-600`.

- [ ] **Step 3: Update timestamp color class**

In `frontend/src/pages/ExecutionDetailPage.tsx`, replace:

```tsx
                              <span className="text-gray-600">{entry.timestamp}</span>
```

with:

```tsx
                              <span className="text-gray-400">{entry.timestamp}</span>
```

- [ ] **Step 4: Run ExecutionDetailPage test to verify it passes**

```bash
cd frontend && npx vitest run src/pages/ExecutionDetailPage.test.tsx
```

Expected: PASS, including the timestamp contrast assertion.

- [ ] **Step 5: Commit Task 2**

```bash
git add frontend/src/pages/ExecutionDetailPage.tsx frontend/src/pages/ExecutionDetailPage.test.tsx
git commit -m "fix: improve log timestamp contrast"
```

---

## Task 3: Final Frontend Verification

**Files:**
- No code edits expected.

- [ ] **Step 1: Run all frontend tests**

```bash
cd frontend && npx vitest run
```

Expected: PASS, all frontend tests pass.

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS, no TypeScript errors.

- [ ] **Step 3: Confirm no backend files changed**

```bash
git diff --name-only HEAD~2..HEAD
```

Expected output includes only:

```text
frontend/src/pages/ExecutionDetailPage.test.tsx
frontend/src/pages/ExecutionDetailPage.tsx
frontend/src/pages/FlowListPage.test.tsx
frontend/src/pages/FlowListPage.tsx
```

---

## Self-Review

**Spec coverage:**
- Flow list namespace filter: Task 1.
- Client-side filtering only, no `/api/flows` changes: Task 1 and Task 3.
- Empty state when filter matches no rows: Task 1.
- Log timestamp contrast from `text-gray-600` to `text-gray-400`: Task 2.
- Type check: Task 3.

**Out of scope preserved:**
- No backend API changes.
- No `FlowRepository` changes.
- No deleted-flow investigation.
- No URL query params, pagination, sorting, or log viewer redesign.
