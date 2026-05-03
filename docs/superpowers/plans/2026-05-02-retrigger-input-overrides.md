# Retrigger Input Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to edit execution inputs before retriggering via a Simple/Advanced toggle inside the existing `RetriggerModal`, with all overrides recorded in the audit log.

**Architecture:** The BE `POST /api/executions/{id}/retrigger` gains an optional `{ overrides }` request body; `RetriggerService` merges overrides on top of original inputs before calling Kestra; `AuditRepository` records the delta in a new `input_overrides TEXT` column. The FE `RetriggerModal` becomes an editable form with a Simple/Advanced toggle; `useRetrigger` sends the overrides as the POST body.

**Tech Stack:** Quarkus 3.35.1 · Kotlin · Jackson · RESTEasy Reactive · React 19 · TypeScript · @tanstack/react-query v5 · Vitest · React Testing Library

---

## File Structure

### Backend — modified files
| File | Change |
|---|---|
| `backend/src/test/resources/db-setup.sql` | Add `input_overrides TEXT NULL` column |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt` | Add `RetriggerRequest` data class |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/AuditRepository.kt` | Add `inputOverrides` param + SQL |
| `backend/src/test/kotlin/tw/brandy/kestra/execution/AuditRepositoryTest.kt` | 2 new tests + update existing `doThrow` matcher |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/RetriggerService.kt` | Add `overrides` param + merge logic |
| `backend/src/test/kotlin/tw/brandy/kestra/retrigger/RetriggerServiceTest.kt` | 2 new tests + update existing `verify` and `doThrow` calls |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt` | Accept optional `RetriggerRequest` body |
| `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt` | 1 new test + update existing retrigger mock |

### Frontend — modified files
| File | Change |
|---|---|
| `frontend/src/hooks/useRetrigger.ts` | Change variable type from `string` to `{ id, overrides }` |
| `frontend/src/components/RetriggerModal.tsx` | Full rewrite with editable inputs + Simple/Advanced toggle |
| `frontend/src/components/RetriggerModal.test.tsx` | 3 new tests |

---

## Task 1: Update H2 test schema

**Files:**
- Modify: `backend/src/test/resources/db-setup.sql`

- [ ] **Step 1: Add `input_overrides` column to the H2 schema**

In `backend/src/test/resources/db-setup.sql`, replace the `kestra_retrigger_audit` table definition:

```sql
CREATE TABLE IF NOT EXISTS kestra_retrigger_audit (
    id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    triggered_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    triggered_by          VARCHAR(255) NOT NULL,
    original_execution_id VARCHAR(255) NOT NULL,
    new_execution_id      VARCHAR(255) NOT NULL,
    input_overrides       TEXT NULL
);
```

- [ ] **Step 2: Verify the backend still compiles and all existing tests pass**

```bash
cd backend && ./mvnw test -q 2>&1 | grep -E "Tests run:|BUILD"
```

Expected: `Tests run: 14, Failures: 0, Errors: 0` · `BUILD SUCCESS`

- [ ] **Step 3: Commit**

```bash
cd /home/iron/projects/kestra-readonly-gui
git add backend/src/test/resources/db-setup.sql
git commit -m "test: add input_overrides column to H2 audit schema"
```

---

## Task 2: Add `RetriggerRequest` model

**Files:**
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt`

- [ ] **Step 1: Add `RetriggerRequest` at the end of `Models.kt`**

Append to `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt` (after the last data class):

```kotlin
data class RetriggerRequest(
    val overrides: Map<String, Any?> = emptyMap()
)
```

- [ ] **Step 2: Verify compilation**

```bash
cd backend && ./mvnw compile -q && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /home/iron/projects/kestra-readonly-gui
git add backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt
git commit -m "feat: add RetriggerRequest model"
```

---

## Task 3: Update `AuditRepository` with `inputOverrides` support (TDD)

**Files:**
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/AuditRepository.kt`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/AuditRepositoryTest.kt`

- [ ] **Step 1: Write failing tests**

Replace the entire content of `backend/src/test/kotlin/tw/brandy/kestra/execution/AuditRepositoryTest.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.test.junit.QuarkusTest
import jakarta.inject.Inject
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tw.brandy.kestra.DbTestBase

@QuarkusTest
class AuditRepositoryTest : DbTestBase() {

    @Inject
    lateinit var repo: AuditRepository

    @Test
    fun `writeAudit inserts a row`() {
        repo.writeAudit("john.doe", "orig-123", "new-456")

        ds.connection.use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery("SELECT COUNT(*) FROM kestra_retrigger_audit WHERE triggered_by='john.doe'")
                rs.next()
                assertEquals(1, rs.getInt(1))
            }
        }
    }

    @Test
    fun `writeAudit stores correct execution IDs`() {
        repo.writeAudit("jane", "orig-aaa", "new-bbb")

        ds.connection.use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery(
                    "SELECT original_execution_id, new_execution_id FROM kestra_retrigger_audit WHERE triggered_by='jane'"
                )
                rs.next()
                assertEquals("orig-aaa", rs.getString("original_execution_id"))
                assertEquals("new-bbb", rs.getString("new_execution_id"))
            }
        }
    }

    @Test
    fun `writeAudit with overrides stores JSON in input_overrides column`() {
        repo.writeAudit("alice", "orig-x", "new-y", mapOf("date" to "2026-05-02"))

        ds.connection.use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery(
                    "SELECT input_overrides FROM kestra_retrigger_audit WHERE triggered_by='alice'"
                )
                rs.next()
                val json = rs.getString("input_overrides")
                assertNotNull(json)
                assertTrue(json!!.contains("2026-05-02"))
            }
        }
    }

    @Test
    fun `writeAudit with null overrides stores NULL in input_overrides column`() {
        repo.writeAudit("bob", "orig-z", "new-w", null)

        ds.connection.use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery(
                    "SELECT input_overrides FROM kestra_retrigger_audit WHERE triggered_by='bob'"
                )
                rs.next()
                assertNull(rs.getString("input_overrides"))
            }
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && ./mvnw test -Dtest=AuditRepositoryTest -q 2>&1 | tail -5
```

Expected: FAIL — `writeAudit` not found with 4 parameters.

- [ ] **Step 3: Implement updated `AuditRepository`**

Replace the entire content of `backend/src/main/kotlin/tw/brandy/kestra/execution/AuditRepository.kt`:

```kotlin
package tw.brandy.kestra.execution

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import javax.sql.DataSource

@ApplicationScoped
class AuditRepository {

    @Inject
    lateinit var ds: DataSource

    @Inject
    lateinit var mapper: ObjectMapper

    fun writeAudit(
        triggeredBy: String,
        originalExecutionId: String,
        newExecutionId: String,
        inputOverrides: Map<String, Any?>? = null
    ) {
        val sql = """
            INSERT INTO kestra_retrigger_audit (triggered_by, original_execution_id, new_execution_id, input_overrides)
            VALUES (?, ?, ?, ?)
        """.trimIndent()
        ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, triggeredBy)
                ps.setString(2, originalExecutionId)
                ps.setString(3, newExecutionId)
                if (inputOverrides.isNullOrEmpty()) {
                    ps.setNull(4, java.sql.Types.VARCHAR)
                } else {
                    ps.setString(4, mapper.writeValueAsString(inputOverrides))
                }
                ps.executeUpdate()
            }
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && ./mvnw test -Dtest=AuditRepositoryTest -q 2>&1 | tail -3
```

Expected: `Tests run: 4, Failures: 0, Errors: 0`

- [ ] **Step 5: Commit**

```bash
cd /home/iron/projects/kestra-readonly-gui
git add backend/src/
git commit -m "feat: add inputOverrides param to AuditRepository"
```

---

## Task 4: Update `RetriggerService` with overrides merge (TDD)

**Files:**
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/RetriggerService.kt`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/retrigger/RetriggerServiceTest.kt`

- [ ] **Step 1: Write failing tests**

Replace the entire content of `backend/src/test/kotlin/tw/brandy/kestra/retrigger/RetriggerServiceTest.kt`:

```kotlin
package tw.brandy.kestra.retrigger

import io.quarkus.test.InjectMock
import io.quarkus.test.junit.QuarkusTest
import io.quarkus.test.junit.mockito.MockitoConfig
import jakarta.inject.Inject
import jakarta.ws.rs.NotFoundException
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.*
import tw.brandy.kestra.execution.*

@QuarkusTest
class RetriggerServiceTest {

    @Inject
    lateinit var service: RetriggerService

    @InjectMock
    lateinit var executionRepo: ExecutionRepository

    @InjectMock
    lateinit var auditRepo: AuditRepository

    @InjectMock
    @RestClient
    @MockitoConfig(convertScopes = true)
    lateinit var kestraClient: KestraClient

    @Test
    fun `retrigger returns new execution id`() {
        val detail = ExecutionDetailRow("orig-1", "ns", "flow", "FAILED", null, null, mapOf("date" to "2026-05-01"), emptyList())
        `when`(executionRepo.findById("orig-1")).thenReturn(detail)
        `when`(kestraClient.createExecution("ns", "flow", mapOf("date" to "2026-05-01")))
            .thenReturn(KestraExecutionResponse("new-99"))

        val result = service.retrigger("orig-1", "john.doe")

        assertEquals("new-99", result.newExecutionId)
        assertEquals("orig-1", result.originalExecutionId)
        assertEquals("john.doe", result.triggeredBy)
        verify(auditRepo).writeAudit("john.doe", "orig-1", "new-99", null)
    }

    @Test
    fun `retrigger throws NotFoundException when execution missing`() {
        `when`(executionRepo.findById("missing")).thenReturn(null)

        assertThrows(NotFoundException::class.java) {
            service.retrigger("missing", "user")
        }
        verifyNoInteractions(kestraClient)
        verifyNoInteractions(auditRepo)
    }

    @Test
    fun `retrigger still returns success when audit write fails`() {
        val detail = ExecutionDetailRow("orig-2", "ns", "flow", "SUCCESS", null, null, emptyMap(), emptyList())
        `when`(executionRepo.findById("orig-2")).thenReturn(detail)
        `when`(kestraClient.createExecution("ns", "flow", emptyMap()))
            .thenReturn(KestraExecutionResponse("new-77"))
        doThrow(RuntimeException("DB down")).`when`(auditRepo)
            .writeAudit(anyString(), anyString(), anyString(), org.mockito.ArgumentMatchers.any())

        val result = service.retrigger("orig-2", "user")

        assertEquals("new-77", result.newExecutionId)
    }

    @Test
    fun `retrigger with overrides merges inputs and records delta in audit`() {
        val detail = ExecutionDetailRow("orig-3", "ns", "flow", "FAILED", null, null,
            mapOf("date" to "2026-05-01", "count" to 5), emptyList())
        `when`(executionRepo.findById("orig-3")).thenReturn(detail)
        val mergedInputs = mapOf("date" to "2026-05-02", "count" to 5)
        `when`(kestraClient.createExecution("ns", "flow", mergedInputs))
            .thenReturn(KestraExecutionResponse("new-100"))

        val overrides = mapOf<String, Any?>("date" to "2026-05-02")
        val result = service.retrigger("orig-3", "john.doe", overrides)

        assertEquals("new-100", result.newExecutionId)
        verify(kestraClient).createExecution("ns", "flow", mergedInputs)
        verify(auditRepo).writeAudit("john.doe", "orig-3", "new-100", overrides)
    }

    @Test
    fun `retrigger with empty overrides sends original inputs and records null in audit`() {
        val detail = ExecutionDetailRow("orig-4", "ns", "flow", "FAILED", null, null,
            mapOf("date" to "2026-05-01"), emptyList())
        `when`(executionRepo.findById("orig-4")).thenReturn(detail)
        `when`(kestraClient.createExecution("ns", "flow", mapOf("date" to "2026-05-01")))
            .thenReturn(KestraExecutionResponse("new-101"))

        service.retrigger("orig-4", "john.doe", emptyMap())

        verify(kestraClient).createExecution("ns", "flow", mapOf("date" to "2026-05-01"))
        verify(auditRepo).writeAudit("john.doe", "orig-4", "new-101", null)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && ./mvnw test -Dtest=RetriggerServiceTest -q 2>&1 | tail -5
```

Expected: FAIL — `retrigger` not found with 3 parameters.

- [ ] **Step 3: Implement updated `RetriggerService`**

Replace the entire content of `backend/src/main/kotlin/tw/brandy/kestra/execution/RetriggerService.kt`:

```kotlin
package tw.brandy.kestra.execution

import jakarta.enterprise.context.ApplicationScoped
import jakarta.ws.rs.NotFoundException
import jakarta.ws.rs.WebApplicationException
import jakarta.ws.rs.core.Response
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.jboss.logging.Logger
import java.time.Instant

@ApplicationScoped
class RetriggerService(
    private val executionRepository: ExecutionRepository,
    private val auditRepository: AuditRepository,
    @RestClient private val kestraClient: KestraClient
) {
    companion object {
        private val log = Logger.getLogger(RetriggerService::class.java)
    }

    fun retrigger(
        executionId: String,
        triggeredBy: String,
        overrides: Map<String, Any?> = emptyMap()
    ): RetriggerResponse {
        val original = executionRepository.findById(executionId)
            ?: throw NotFoundException("Execution $executionId not found")

        val mergedInputs = original.inputs + overrides

        val kestraResponse = try {
            kestraClient.createExecution(original.namespace, original.flowId, mergedInputs)
        } catch (e: WebApplicationException) {
            val status = e.response.status
            val body = runCatching { e.response.readEntity(String::class.java) }.getOrDefault("Kestra error")
            throw WebApplicationException(
                Response.status(if (status == 409) 409 else 502).entity(body).build()
            )
        } catch (e: Exception) {
            throw WebApplicationException(
                Response.status(502).entity("Kestra API unreachable: ${e.message}").build()
            )
        }

        val auditOverrides = overrides.ifEmpty { null }
        try {
            auditRepository.writeAudit(triggeredBy, executionId, kestraResponse.id, auditOverrides)
        } catch (e: Exception) {
            log.errorf(e, "Audit write failed: originalId=%s newId=%s", executionId, kestraResponse.id)
        }

        return RetriggerResponse(
            newExecutionId = kestraResponse.id,
            originalExecutionId = executionId,
            triggeredBy = triggeredBy,
            triggeredAt = Instant.now().toString()
        )
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && ./mvnw test -Dtest=RetriggerServiceTest -q 2>&1 | tail -3
```

Expected: `Tests run: 5, Failures: 0, Errors: 0`

- [ ] **Step 5: Commit**

```bash
cd /home/iron/projects/kestra-readonly-gui
git add backend/src/
git commit -m "feat: add overrides merge to RetriggerService"
```

---

## Task 5: Update `ExecutionResource` to accept `RetriggerRequest` body (TDD)

**Files:**
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt`

- [ ] **Step 1: Write failing test**

Replace the entire content of `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.test.InjectMock
import io.quarkus.test.junit.QuarkusTest
import io.quarkus.test.security.TestSecurity
import io.quarkus.test.security.oidc.Claim
import io.quarkus.test.security.oidc.OidcSecurity
import io.restassured.RestAssured.given
import org.hamcrest.Matchers.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.`when`

@QuarkusTest
class ExecutionResourceTest {

    @InjectMock
    lateinit var executionRepository: ExecutionRepository

    @InjectMock
    lateinit var retriggerService: RetriggerService

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET executions returns page`() {
        `when`(executionRepository.listExecutions(null, null, null, null, 0, 20))
            .thenReturn(ExecutionPage(2, 0, 20, listOf(
                ExecutionRow("id-1", "ns", "flow", "SUCCESS", null, null),
                ExecutionRow("id-2", "ns", "flow", "FAILED", null, null)
            )))

        given().`when`().get("/api/executions")
            .then().statusCode(200)
            .body("total", equalTo(2))
            .body("results.size()", equalTo(2))
    }

    @Test
    fun `GET executions without token returns 401`() {
        given().`when`().get("/api/executions")
            .then().statusCode(401)
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST retrigger with no body uses empty overrides`() {
        `when`(retriggerService.retrigger("exec-1", "john.doe", emptyMap()))
            .thenReturn(RetriggerResponse("new-1", "exec-1", "john.doe", "2026-05-01T00:00:00Z"))

        given().`when`().post("/api/executions/exec-1/retrigger")
            .then().statusCode(200)
            .body("newExecutionId", equalTo("new-1"))
            .body("triggeredBy", equalTo("john.doe"))
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST retrigger with overrides body passes overrides to service`() {
        val overrides = mapOf<String, Any?>("date" to "2026-05-02")
        `when`(retriggerService.retrigger("exec-2", "john.doe", overrides))
            .thenReturn(RetriggerResponse("new-2", "exec-2", "john.doe", "2026-05-01T00:00:00Z"))

        given()
            .contentType("application/json")
            .body("""{"overrides":{"date":"2026-05-02"}}""")
            .`when`().post("/api/executions/exec-2/retrigger")
            .then().statusCode(200)
            .body("newExecutionId", equalTo("new-2"))
    }
}
```

- [ ] **Step 2: Run tests to verify the new test fails**

```bash
cd backend && ./mvnw test -Dtest=ExecutionResourceTest -q 2>&1 | tail -5
```

Expected: FAIL — `retrigger("exec-1", "john.doe")` (2 args) no longer matches the 3-arg method.

- [ ] **Step 3: Implement updated `ExecutionResource`**

Replace the entire content of `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.security.Authenticated
import io.quarkus.security.identity.SecurityIdentity
import jakarta.ws.rs.*
import jakarta.ws.rs.core.MediaType
import org.eclipse.microprofile.jwt.JsonWebToken
import jakarta.inject.Inject

@Path("/api/executions")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
class ExecutionResource(
    private val executionRepository: ExecutionRepository,
    private val retriggerService: RetriggerService,
    private val identity: SecurityIdentity
) {

    @Inject
    lateinit var jwt: JsonWebToken

    @GET
    @Path("/summary")
    fun summary(): SummaryResponse = executionRepository.getSummary()

    @GET
    fun list(
        @QueryParam("namespace") namespace: String?,
        @QueryParam("status") status: String?,
        @QueryParam("from") from: String?,
        @QueryParam("to") to: String?,
        @QueryParam("page") @DefaultValue("0") page: Int,
        @QueryParam("size") @DefaultValue("20") size: Int
    ): ExecutionPage = executionRepository.listExecutions(namespace, status, from, to, page, size)

    @GET
    @Path("/{id}")
    fun getById(@PathParam("id") id: String): ExecutionDetailRow =
        executionRepository.findById(id) ?: throw NotFoundException("Execution $id not found")

    @POST
    @Path("/{id}/retrigger")
    @Consumes(MediaType.APPLICATION_JSON)
    fun retrigger(@PathParam("id") id: String, body: RetriggerRequest?): RetriggerResponse {
        val username = jwt.getClaim<String>("preferred_username") ?: identity.principal.name
        return retriggerService.retrigger(id, username, body?.overrides ?: emptyMap())
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && ./mvnw test -Dtest=ExecutionResourceTest -q 2>&1 | tail -3
```

Expected: `Tests run: 4, Failures: 0, Errors: 0`

- [ ] **Step 5: Run full backend test suite**

```bash
cd backend && ./mvnw test -q 2>&1 | grep -E "Tests run:|BUILD"
```

Expected: `Tests run: 17, Failures: 0, Errors: 0` · `BUILD SUCCESS`

- [ ] **Step 6: Commit**

```bash
cd /home/iron/projects/kestra-readonly-gui
git add backend/src/
git commit -m "feat: ExecutionResource accepts optional RetriggerRequest body"
```

---

## Task 6: Update `useRetrigger` hook

**Files:**
- Modify: `frontend/src/hooks/useRetrigger.ts`

- [ ] **Step 1: Update `useRetrigger` to send overrides in the POST body**

Replace the entire content of `frontend/src/hooks/useRetrigger.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import type { RetriggerResponse } from '../types/execution'

interface RetriggerRequest {
  id: string
  overrides: Record<string, unknown>
}

export function useRetrigger() {
  const queryClient = useQueryClient()
  return useMutation<RetriggerResponse, Error, RetriggerRequest>({
    mutationFn: ({ id, overrides }) =>
      api.post(`/api/executions/${id}/retrigger`, { overrides }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] })
      queryClient.invalidateQueries({ queryKey: ['executions-summary'] })
    },
  })
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /home/iron/projects/kestra-readonly-gui/frontend && npm run build 2>&1 | grep -E "error" | head -5
```

Expected: build succeeds (TypeScript will flag `RetriggerModal` which still calls `mutateAsync(id)` — that is expected and will be fixed in Task 7).

If TypeScript errors appear only in `RetriggerModal.tsx`, that is expected. If errors appear elsewhere, investigate.

- [ ] **Step 3: Commit**

```bash
cd /home/iron/projects/kestra-readonly-gui
git add frontend/src/hooks/useRetrigger.ts
git commit -m "feat: useRetrigger hook sends overrides as POST body"
```

---

## Task 7: Rewrite `RetriggerModal` with Simple/Advanced toggle (TDD)

**Files:**
- Modify: `frontend/src/components/RetriggerModal.tsx`
- Modify: `frontend/src/components/RetriggerModal.test.tsx`

- [ ] **Step 1: Write failing tests**

Replace the entire content of `frontend/src/components/RetriggerModal.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RetriggerModal } from './RetriggerModal'
import type { ExecutionRow } from '../types/execution'

vi.mock('../hooks/useRetrigger', () => ({
  useRetrigger: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const exec: ExecutionRow = {
  id: 'exec-1', namespace: 'prod.etl', flowId: 'daily-report',
  state: 'FAILED', startDate: null, endDate: null,
}

const execWithInputs = {
  ...exec,
  id: 'exec-2',
  inputs: { date: '2026-05-01', count: 5, active: true },
}

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {ui}
    </QueryClientProvider>
  )
}

describe('RetriggerModal', () => {
  it('shows flow and namespace', () => {
    wrap(<RetriggerModal execution={exec} onClose={vi.fn()} />)
    expect(screen.getByText('daily-report')).toBeInTheDocument()
    expect(screen.getByText('prod.etl')).toBeInTheDocument()
  })

  it('calls onClose when Cancel clicked', () => {
    const onClose = vi.fn()
    wrap(<RetriggerModal execution={exec} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('simple mode pre-fills input fields from execution inputs', () => {
    wrap(<RetriggerModal execution={execWithInputs} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('2026-05-01')).toBeInTheDocument()
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('advanced mode shows textarea containing JSON', () => {
    wrap(<RetriggerModal execution={execWithInputs} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Advanced'))
    const textarea = document.querySelector('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea!.value).toContain('2026-05-01')
  })

  it('switching Simple to Advanced serialises current field values into textarea', () => {
    wrap(<RetriggerModal execution={execWithInputs} onClose={vi.fn()} />)
    const dateInput = screen.getByDisplayValue('2026-05-01')
    fireEvent.change(dateInput, { target: { value: '2026-05-02' } })
    fireEvent.click(screen.getByText('Advanced'))
    const textarea = document.querySelector('textarea')
    expect(textarea!.value).toContain('2026-05-02')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/iron/projects/kestra-readonly-gui/frontend && npm run test -- --run 2>&1 | tail -8
```

Expected: 3 new tests fail (simple mode pre-fills, advanced mode textarea, mode switch).

- [ ] **Step 3: Implement the new `RetriggerModal`**

Replace the entire content of `frontend/src/components/RetriggerModal.tsx`:

```typescript
import { useState } from 'react'
import type { ExecutionRow } from '../types/execution'
import { useRetrigger } from '../hooks/useRetrigger'

type InputMode = 'simple' | 'advanced'
type FieldType = 'date' | 'datetime' | 'boolean' | 'number' | 'text'

function inferType(value: unknown): FieldType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime'
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
  }
  return 'text'
}

function toFieldValue(value: unknown, type: FieldType): string | number | boolean {
  if (type === 'boolean') return typeof value === 'boolean' ? value : false
  if (type === 'number') return typeof value === 'number' ? value : Number(value)
  if (type === 'datetime') return typeof value === 'string' ? value.slice(0, 16) : ''
  return value != null ? String(value) : ''
}

function toOverrideValue(raw: string | number | boolean, type: FieldType): unknown {
  if (type === 'boolean') return raw
  if (type === 'number') return raw === '' ? null : Number(raw)
  if (type === 'datetime') {
    const s = raw as string
    return s ? (s.endsWith('Z') ? s : s + ':00Z') : null
  }
  return raw
}

interface RetriggerModalProps {
  execution: ExecutionRow & { inputs?: Record<string, unknown> }
  onClose: () => void
}

export function RetriggerModal({ execution, onClose }: RetriggerModalProps) {
  const inputs = execution.inputs ?? {}
  const retrigger = useRetrigger()

  const [mode, setMode] = useState<InputMode>('simple')
  const [fields, setFields] = useState<Record<string, string | number | boolean>>(() =>
    Object.fromEntries(
      Object.entries(inputs).map(([k, v]) => [k, toFieldValue(v, inferType(v))])
    )
  )
  const [advancedJson, setAdvancedJson] = useState(() => JSON.stringify(inputs, null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)

  function switchMode(next: InputMode) {
    if (next === 'advanced') {
      setAdvancedJson(JSON.stringify(fields, null, 2))
      setMode('advanced')
    } else {
      try {
        const parsed = JSON.parse(advancedJson) as Record<string, unknown>
        setFields(
          Object.fromEntries(
            Object.entries(parsed).map(([k, v]) => [k, toFieldValue(v, inferType(v))])
          )
        )
        setJsonError(null)
        setMode('simple')
      } catch {
        setJsonError('Invalid JSON — fix before switching to Simple mode')
      }
    }
  }

  function buildOverrides(): Record<string, unknown> | null {
    if (mode === 'advanced') {
      try {
        return JSON.parse(advancedJson) as Record<string, unknown>
      } catch {
        setJsonError('Invalid JSON')
        return null
      }
    }
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      const type = inferType(inputs[k])
      const overrideVal = toOverrideValue(v, type)
      if (String(overrideVal) !== String(inputs[k] ?? '')) {
        result[k] = overrideVal
      }
    }
    return result
  }

  const handleConfirm = async () => {
    const overrides = buildOverrides()
    if (overrides === null) return
    try {
      await retrigger.mutateAsync({ id: execution.id, overrides })
      onClose()
    } catch {
      // error surfaced via retrigger.isError
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Retrigger Execution</h2>

        <div className="space-y-1 text-sm mb-4">
          <div><span className="font-medium text-gray-600">Flow:</span> {execution.flowId}</div>
          <div><span className="font-medium text-gray-600">Namespace:</span> {execution.namespace}</div>
          <div><span className="font-medium text-gray-600">Original ID:</span> <span className="font-mono text-xs">{execution.id}</span></div>
        </div>

        {Object.keys(inputs).length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-gray-500">Inputs</span>
              <div className="flex rounded border text-xs overflow-hidden">
                <button
                  onClick={() => switchMode('simple')}
                  className={`px-2 py-0.5 ${mode === 'simple' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'}`}
                >
                  Simple
                </button>
                <button
                  onClick={() => switchMode('advanced')}
                  className={`px-2 py-0.5 ${mode === 'advanced' ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'}`}
                >
                  Advanced
                </button>
              </div>
            </div>

            {mode === 'simple' && (
              <div className="space-y-2">
                {Object.entries(inputs).map(([key, originalVal]) => {
                  const type = inferType(originalVal)
                  const value = fields[key]
                  return (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <label className="w-32 text-gray-600 font-medium shrink-0">{key}</label>
                      {type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={value as boolean}
                          onChange={e => setFields(f => ({ ...f, [key]: e.target.checked }))}
                          className="h-4 w-4"
                        />
                      ) : (
                        <input
                          type={type === 'datetime' ? 'datetime-local' : type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
                          value={value as string | number}
                          onChange={e => setFields(f => ({
                            ...f,
                            [key]: type === 'number' ? Number(e.target.value) : e.target.value,
                          }))}
                          className="flex-1 border rounded px-2 py-1 text-sm"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {mode === 'advanced' && (
              <textarea
                value={advancedJson}
                onChange={e => { setAdvancedJson(e.target.value); setJsonError(null) }}
                className="w-full border rounded px-2 py-1 text-xs font-mono h-36"
                spellCheck={false}
              />
            )}

            {jsonError && <p className="text-red-600 text-xs mt-1">{jsonError}</p>}
          </div>
        )}

        <p className="text-sm text-gray-500 mb-4">
          This creates a new execution with the above inputs. The action is logged.
        </p>

        {retrigger.isError && (
          <p className="text-red-600 text-sm mb-3">{retrigger.error?.message ?? 'Retrigger failed'}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={retrigger.isPending || !!jsonError}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {retrigger.isPending ? 'Retriggering…' : 'Confirm Retrigger'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run all frontend tests to verify they pass**

```bash
cd /home/iron/projects/kestra-readonly-gui/frontend && npm run test -- --run 2>&1 | tail -6
```

Expected: `Tests 7 passed (3 files)` (2 original + 3 new + 2 StatusBadge + 1 AuthProvider = 8 total)

- [ ] **Step 5: Verify production build**

```bash
npm run build 2>&1 | tail -4
```

Expected: `dist/` created, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
cd /home/iron/projects/kestra-readonly-gui
git add frontend/src/components/
git commit -m "feat: RetriggerModal with editable inputs and Simple/Advanced toggle"
```

---

## Self-Review

**Spec coverage:**
| Spec requirement | Task |
|---|---|
| Edit existing inputs before retrigger | Task 7 (Simple mode pre-filled fields) |
| Simple mode with typed inputs | Task 7 (`inferType` + field rendering) |
| Advanced mode with raw JSON editor | Task 7 (textarea with validation) |
| Simple/Advanced toggle with state preservation | Task 7 (`switchMode`) |
| BE accepts optional overrides body | Task 5 (`RetriggerRequest?` body) |
| Overrides merged on top of originals (overrides win) | Task 4 (`original.inputs + overrides`) |
| Audit records overrides delta (null when empty) | Tasks 3+4 (`inputOverrides` column + `auditOverrides`) |
| Backward-compatible (no body = same as before) | Task 5 (nullable body, `?: emptyMap()`) |
| DB migration SQL | Included in Task 1 (H2) + note below |

**Production MySQL migration** — run once against the live database before deploying:
```sql
ALTER TABLE kestra_retrigger_audit ADD COLUMN input_overrides TEXT NULL;
```

**Type consistency check:**
- `RetriggerRequest` defined in Task 2, used in Task 5 ✓
- `writeAudit(…, inputOverrides: Map<String, Any?>?)` defined in Task 3, called in Task 4 ✓
- `retrigger(…, overrides: Map<String, Any?> = emptyMap())` defined in Task 4, called in Task 5 ✓
- `RetriggerRequest { id, overrides }` in `useRetrigger` Task 6, consumed in Task 7 ✓
