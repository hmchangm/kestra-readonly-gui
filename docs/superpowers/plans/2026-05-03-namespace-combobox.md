# Namespace Filter Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text namespace input on the Execution List page with a custom combobox that fetches distinct namespaces from the local DB and shows matching suggestions as the user types.

**Architecture:** A new `GET /api/namespaces` backend endpoint queries `SELECT DISTINCT namespace FROM executions ORDER BY namespace`. A `useNamespaces` React Query hook fetches it (5-minute stale time). A self-contained `NamespaceCombobox` component replaces the existing `<input>` in `ExecutionListPage`.

**Tech Stack:** Kotlin / Quarkus (backend), React + TypeScript + Tailwind + React Query (frontend), Vitest + Testing Library (frontend tests), JUnit 5 + QuarkusTest (backend tests).

---

## File Map

| Action | Path |
|---|---|
| Modify | `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt` |
| Modify | `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt` |
| Modify | `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt` |
| Modify | `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt` |
| Create | `frontend/src/hooks/useNamespaces.ts` |
| Create | `frontend/src/components/NamespaceCombobox.tsx` |
| Create | `frontend/src/components/NamespaceCombobox.test.tsx` |
| Modify | `frontend/src/pages/ExecutionListPage.tsx` |

---

## Task 1: Repository — `listNamespaces()`

**Files:**
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt`

- [ ] **Step 1: Write the failing test**

Add to `ExecutionRepositoryTest` (after the existing tests, inside the class):

```kotlin
@Test
fun `listNamespaces returns distinct namespaces sorted alphabetically`() {
    insertExecution("e1", "company.ops",     "flow", "SUCCESS")
    insertExecution("e2", "company.finance", "flow", "SUCCESS")
    insertExecution("e3", "company.ops",     "flow", "FAILED")   // duplicate namespace

    val result = repo.listNamespaces()

    assertEquals(listOf("company.finance", "company.ops"), result)
}

@Test
fun `listNamespaces returns empty list when table is empty`() {
    assertEquals(emptyList<String>(), repo.listNamespaces())
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && ./mvnw test -Dtest=ExecutionRepositoryTest#listNamespaces* -q 2>&1 | tail -10
```

Expected: compilation error — `listNamespaces` does not exist yet.

- [ ] **Step 3: Implement `listNamespaces()`**

Add this method to `ExecutionRepository`, after `getSummary()`:

```kotlin
fun listNamespaces(): List<String> =
    ds.connection.use { conn ->
        conn.createStatement().use { st ->
            st.executeQuery("SELECT DISTINCT namespace FROM executions ORDER BY namespace").use { rs ->
                rs.toList { it.getString("namespace") }
            }
        }
    }
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend && ./mvnw test -Dtest=ExecutionRepositoryTest -q 2>&1 | tail -5
```

Expected: `BUILD SUCCESS`, all `ExecutionRepositoryTest` tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt \
        backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt
git commit -m "feat: add listNamespaces query to ExecutionRepository"
```

---

## Task 2: Backend endpoint — `GET /api/namespaces`

**Files:**
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt`

- [ ] **Step 1: Write the failing test**

Add to `ExecutionResourceTest` (inside the class). The existing mock for `executionRepository` will cover the new method:

```kotlin
@Test
@TestSecurity(user = "john.doe", roles = [])
@OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
fun `GET namespaces returns sorted list`() {
    `when`(executionRepository.listNamespaces())
        .thenReturn(listOf("company.finance", "company.ops", "company.team"))

    given().`when`().get("/api/namespaces")
        .then().statusCode(200)
        .body("size()", equalTo(3))
        .body("[0]", equalTo("company.finance"))
        .body("[2]", equalTo("company.team"))
}

@Test
fun `GET namespaces without token returns 401`() {
    given().`when`().get("/api/namespaces")
        .then().statusCode(401)
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && ./mvnw test -Dtest=ExecutionResourceTest#GET*namespaces* -q 2>&1 | tail -10
```

Expected: 404 (route doesn't exist yet).

- [ ] **Step 3: Add the endpoint to `ExecutionResource`**

Add this method to `ExecutionResource`, after `getById()`:

```kotlin
@GET
@Path("/namespaces")
fun listNamespaces(): List<String> = executionRepository.listNamespaces()
```

The class path is `/api/executions` — this will resolve to `/api/executions/namespaces`, which conflicts. The endpoint must be on a **separate top-level path**. Add a new resource class instead:

Create `backend/src/main/kotlin/tw/brandy/kestra/execution/NamespaceResource.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.security.Authenticated
import jakarta.ws.rs.GET
import jakarta.ws.rs.Path
import jakarta.ws.rs.Produces
import jakarta.ws.rs.core.MediaType

@Path("/api/namespaces")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
class NamespaceResource(
    private val executionRepository: ExecutionRepository
) {
    @GET
    fun list(): List<String> = executionRepository.listNamespaces()
}
```

> **Note:** The test mock in `ExecutionResourceTest` is already wired to mock `executionRepository` via `@InjectMock`. The new `NamespaceResource` will pick up the same mock because Quarkus CDI shares the mock across the test context. No changes to `ExecutionResourceTest`'s setup are needed.

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend && ./mvnw test -Dtest=ExecutionResourceTest -q 2>&1 | tail -5
```

Expected: `BUILD SUCCESS`, all `ExecutionResourceTest` tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/kotlin/tw/brandy/kestra/execution/NamespaceResource.kt \
        backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt
git commit -m "feat: add GET /api/namespaces endpoint"
```

---

## Task 3: Frontend hook — `useNamespaces`

**Files:**
- Create: `frontend/src/hooks/useNamespaces.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

export function useNamespaces() {
  return useQuery<string[]>({
    queryKey: ['namespaces'],
    queryFn: () => api.get('/api/namespaces').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "error|warning" | head -10
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useNamespaces.ts
git commit -m "feat: add useNamespaces hook with 5-minute cache"
```

---

## Task 4: Frontend component — `NamespaceCombobox`

**Files:**
- Create: `frontend/src/components/NamespaceCombobox.tsx`
- Create: `frontend/src/components/NamespaceCombobox.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/NamespaceCombobox.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NamespaceCombobox } from './NamespaceCombobox'

vi.mock('../hooks/useNamespaces', () => ({
  useNamespaces: () => ({ data: ['company.finance', 'company.ops', 'company.team'] }),
}))

describe('NamespaceCombobox', () => {
  it('renders the text input', () => {
    render(<NamespaceCombobox value="" onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('Filter by namespace…')).toBeInTheDocument()
  })

  it('shows all suggestions on focus when value is empty', () => {
    render(<NamespaceCombobox value="" onChange={vi.fn()} />)
    fireEvent.focus(screen.getByPlaceholderText('Filter by namespace…'))
    expect(screen.getByText('company.finance')).toBeInTheDocument()
    expect(screen.getByText('company.ops')).toBeInTheDocument()
    expect(screen.getByText('company.team')).toBeInTheDocument()
  })

  it('filters suggestions by substring match (case-insensitive)', () => {
    render(<NamespaceCombobox value="OPS" onChange={vi.fn()} />)
    fireEvent.focus(screen.getByPlaceholderText('Filter by namespace…'))
    expect(screen.getByText('company.ops')).toBeInTheDocument()
    expect(screen.queryByText('company.finance')).not.toBeInTheDocument()
    expect(screen.queryByText('company.team')).not.toBeInTheDocument()
  })

  it('calls onChange on every keystroke', () => {
    const onChange = vi.fn()
    render(<NamespaceCombobox value="" onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Filter by namespace…'), {
      target: { value: 'comp' },
    })
    expect(onChange).toHaveBeenCalledWith('comp')
  })

  it('selects suggestion on mousedown and closes dropdown', () => {
    const onChange = vi.fn()
    render(<NamespaceCombobox value="comp" onChange={onChange} />)
    fireEvent.focus(screen.getByPlaceholderText('Filter by namespace…'))
    fireEvent.mouseDown(screen.getByText('company.ops'))
    expect(onChange).toHaveBeenCalledWith('company.ops')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes dropdown on Escape, keeps current text', () => {
    render(<NamespaceCombobox value="comp" onChange={vi.fn()} />)
    const input = screen.getByPlaceholderText('Filter by namespace…')
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('moves highlight down with ArrowDown', () => {
    render(<NamespaceCombobox value="company" onChange={vi.fn()} />)
    const input = screen.getByPlaceholderText('Filter by namespace…')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('selects highlighted suggestion on Enter', () => {
    const onChange = vi.fn()
    render(<NamespaceCombobox value="company" onChange={onChange} />)
    const input = screen.getByPlaceholderText('Filter by namespace…')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('company.finance')
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd frontend && npx vitest run src/components/NamespaceCombobox.test.tsx 2>&1 | tail -15
```

Expected: error — `NamespaceCombobox` module not found.

- [ ] **Step 3: Implement `NamespaceCombobox.tsx`**

Create `frontend/src/components/NamespaceCombobox.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react'
import { useNamespaces } from '../hooks/useNamespaces'

interface Props {
  value: string
  onChange: (v: string) => void
}

export function NamespaceCombobox({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const { data: namespaces = [] } = useNamespaces()

  const filtered = value
    ? namespaces.filter(ns => ns.toLowerCase().includes(value.toLowerCase()))
    : namespaces

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function select(ns: string) {
    onChange(ns)
    setOpen(false)
    setHighlighted(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!open || filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      select(filtered[highlighted])
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <input
        placeholder="Filter by namespace…"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(-1) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="border rounded-md px-3 py-1.5 text-sm w-56"
      />
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-10 overflow-hidden"
        >
          {filtered.map((ns, i) => (
            <li
              key={ns}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={() => select(ns)}
              onMouseEnter={() => setHighlighted(i)}
              className={`px-3 py-1.5 text-sm cursor-pointer ${
                i === highlighted ? 'bg-indigo-50 font-medium text-gray-900' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {ns}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify tests pass**

```bash
cd frontend && npx vitest run src/components/NamespaceCombobox.test.tsx 2>&1 | tail -15
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/NamespaceCombobox.tsx \
        frontend/src/components/NamespaceCombobox.test.tsx
git commit -m "feat: add NamespaceCombobox component"
```

---

## Task 5: Wire combobox into `ExecutionListPage`

**Files:**
- Modify: `frontend/src/pages/ExecutionListPage.tsx`

- [ ] **Step 1: Replace the namespace input**

In `ExecutionListPage.tsx`, add the import at the top of the imports block:

```tsx
import { NamespaceCombobox } from '../components/NamespaceCombobox'
```

Then replace the existing namespace `<input>` (lines 53–58):

```tsx
// REMOVE this:
<input
  placeholder="Filter by namespace…"
  value={namespace}
  onChange={e => { setNamespace(e.target.value); setPage(0) }}
  className="border rounded-md px-3 py-1.5 text-sm w-56"
/>

// ADD this:
<NamespaceCombobox
  value={namespace}
  onChange={v => { setNamespace(v); setPage(0) }}
/>
```

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "error" | head -10
```

Expected: no output.

- [ ] **Step 3: Run full frontend test suite**

```bash
cd frontend && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Manual smoke test**

The frontend dev server should already be running at `http://localhost:5173`. Open it, click the namespace field, verify:
- All namespaces appear in the dropdown on focus
- Typing filters the list and the table updates
- Clicking a suggestion fills the input and closes the dropdown
- Escape closes the dropdown
- Clearing the input resets the table to all executions

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ExecutionListPage.tsx
git commit -m "feat: wire NamespaceCombobox into ExecutionListPage"
```
