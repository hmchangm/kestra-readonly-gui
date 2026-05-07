# Cancel Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cancel button to both the execution list and detail pages that sends a kill signal to Kestra via a confirmation modal, audited in a unified `kestra_execution_audit` table with a configurable on/off flag.

**Architecture:** Replace `kestra_retrigger_audit` with `kestra_execution_audit` (adds `action` column). `AuditRepository` gains a config flag `app.audit.enabled`; `CancelService` calls `KestraClient.killExecution` then audits. Frontend gets a `useCancel` hook and `CancelModal` wired into both pages behind a state check.

**Tech Stack:** Kotlin/Quarkus (backend), React/TypeScript + TanStack Query (frontend), Vitest + Testing Library (frontend tests), JUnit 5 + Mockito + RestAssured (backend tests)

---

## File Map

**Modified — backend:**
- `backend/src/main/resources/db-setup.sql` — replace `kestra_retrigger_audit` DDL
- `backend/src/main/kotlin/tw/brandy/kestra/DevSchemaInit.kt` — update MySQL branch
- `backend/src/main/kotlin/tw/brandy/kestra/execution/AuditRepository.kt` — new signature + config flag
- `backend/src/main/kotlin/tw/brandy/kestra/execution/RetriggerService.kt` — update `writeAudit` call
- `backend/src/main/kotlin/tw/brandy/kestra/execution/KestraClient.kt` — add `killExecution`
- `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt` — add `CancelResponse`
- `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt` — add cancel endpoint, inject `CancelService`
- `backend/src/main/resources/application.properties` — add `app.audit.enabled=true`
- `backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt` — update DELETE
- `backend/src/test/kotlin/tw/brandy/kestra/execution/AuditRepositoryTest.kt` — rewrite for new table/signature
- `backend/src/test/kotlin/tw/brandy/kestra/retrigger/RetriggerServiceTest.kt` — update mock verifications
- `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt` — add cancel tests

**Created — backend:**
- `backend/src/main/kotlin/tw/brandy/kestra/execution/CancelService.kt`
- `backend/src/test/kotlin/tw/brandy/kestra/execution/CancelServiceTest.kt`

**Modified — frontend:**
- `frontend/src/types/execution.ts` — add `CancelResponse`
- `frontend/src/pages/ExecutionDetailPage.tsx` — cancel button + modal
- `frontend/src/pages/ExecutionListPage.tsx` — cancel button per row + modal
- `frontend/src/pages/ExecutionDetailPage.test.tsx` — cancel button visibility tests

**Created — frontend:**
- `frontend/src/hooks/useCancel.ts`
- `frontend/src/components/CancelModal.tsx`
- `frontend/src/components/CancelModal.test.tsx`

---

## Task 1: Migrate audit table and update AuditRepository + RetriggerService

**Files:**
- Modify: `backend/src/main/resources/db-setup.sql`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/DevSchemaInit.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/AuditRepository.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/RetriggerService.kt`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/AuditRepositoryTest.kt`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/retrigger/RetriggerServiceTest.kt`

- [ ] **Step 1: Update AuditRepositoryTest for new table name and signature**

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
    fun `writeAudit inserts a row with action and execution id`() {
        repo.writeAudit("RETRIGGER", "john.doe", "orig-123", "new-456")

        ds.connection.use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery(
                    "SELECT COUNT(*) FROM kestra_execution_audit WHERE acted_by='john.doe'"
                )
                rs.next()
                assertEquals(1, rs.getInt(1))
            }
        }
    }

    @Test
    fun `writeAudit stores action and execution ids correctly`() {
        repo.writeAudit("RETRIGGER", "jane", "orig-aaa", "new-bbb")

        ds.connection.use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery(
                    "SELECT action, execution_id, new_execution_id FROM kestra_execution_audit WHERE acted_by='jane'"
                )
                rs.next()
                assertEquals("RETRIGGER", rs.getString("action"))
                assertEquals("orig-aaa", rs.getString("execution_id"))
                assertEquals("new-bbb", rs.getString("new_execution_id"))
            }
        }
    }

    @Test
    fun `writeAudit with overrides stores JSON in input_overrides column`() {
        repo.writeAudit("RETRIGGER", "alice", "orig-x", "new-y", mapOf("date" to "2026-05-02"))

        ds.connection.use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery(
                    "SELECT input_overrides FROM kestra_execution_audit WHERE acted_by='alice'"
                )
                rs.next()
                val json = rs.getString("input_overrides")
                assertNotNull(json)
                assertTrue(json!!.contains("2026-05-02"))
            }
        }
    }

    @Test
    fun `writeAudit for CANCEL stores null for new_execution_id and input_overrides`() {
        repo.writeAudit("CANCEL", "bob", "orig-z")

        ds.connection.use { conn ->
            conn.createStatement().use { stmt ->
                val rs = stmt.executeQuery(
                    "SELECT action, new_execution_id, input_overrides FROM kestra_execution_audit WHERE acted_by='bob'"
                )
                rs.next()
                assertEquals("CANCEL", rs.getString("action"))
                assertNull(rs.getString("new_execution_id"))
                assertNull(rs.getString("input_overrides"))
            }
        }
    }
}
```

- [ ] **Step 2: Run AuditRepositoryTest to confirm it fails**

```bash
cd backend && ./mvnw test -pl . -Dtest=AuditRepositoryTest -q 2>&1 | tail -20
```

Expected: FAIL — table `kestra_execution_audit` does not exist.

- [ ] **Step 3: Update db-setup.sql**

Replace the `kestra_retrigger_audit` CREATE TABLE block with:

```sql
CREATE TABLE IF NOT EXISTS kestra_execution_audit (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    acted_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acted_by         VARCHAR(255) NOT NULL,
    action           VARCHAR(20)  NOT NULL,
    execution_id     VARCHAR(255) NOT NULL,
    new_execution_id VARCHAR(255) NULL,
    input_overrides  TEXT NULL
);
```

- [ ] **Step 4: Update DbTestBase to DELETE from new table**

In `backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt`, replace:
```kotlin
conn.createStatement().use { it.execute("DELETE FROM kestra_retrigger_audit") }
```
with:
```kotlin
conn.createStatement().use { it.execute("DELETE FROM kestra_execution_audit") }
```

- [ ] **Step 5: Replace AuditRepository implementation**

Replace the entire content of `backend/src/main/kotlin/tw/brandy/kestra/execution/AuditRepository.kt`:

```kotlin
package tw.brandy.kestra.execution

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import org.eclipse.microprofile.config.inject.ConfigProperty
import javax.sql.DataSource

@ApplicationScoped
class AuditRepository(
    private val ds: DataSource,
    private val mapper: ObjectMapper,
    @ConfigProperty(name = "app.audit.enabled", defaultValue = "true")
    private val auditEnabled: Boolean
) {

    fun writeAudit(
        action: String,
        actedBy: String,
        executionId: String,
        newExecutionId: String? = null,
        inputOverrides: Map<String, Any?>? = null
    ) {
        if (!auditEnabled) return
        val sql = """
            INSERT INTO kestra_execution_audit (action, acted_by, execution_id, new_execution_id, input_overrides)
            VALUES (?, ?, ?, ?, ?)
        """.trimIndent()
        ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, action)
                ps.setString(2, actedBy)
                ps.setString(3, executionId)
                if (newExecutionId == null) ps.setNull(4, java.sql.Types.VARCHAR)
                else ps.setString(4, newExecutionId)
                if (inputOverrides.isNullOrEmpty()) ps.setNull(5, java.sql.Types.VARCHAR)
                else ps.setString(5, mapper.writeValueAsString(inputOverrides))
                ps.executeUpdate()
            }
        }
    }
}
```

- [ ] **Step 6: Update RetriggerService to use new writeAudit signature**

In `backend/src/main/kotlin/tw/brandy/kestra/execution/RetriggerService.kt`, replace:
```kotlin
auditRepository.writeAudit(triggeredBy, executionId, kestraResponse.id, auditOverrides)
```
with:
```kotlin
auditRepository.writeAudit("RETRIGGER", triggeredBy, executionId, kestraResponse.id, auditOverrides)
```

- [ ] **Step 7: Update RetriggerServiceTest mock verifications**

In `backend/src/test/kotlin/tw/brandy/kestra/retrigger/RetriggerServiceTest.kt`:

Replace:
```kotlin
verify(auditRepo).writeAudit("john.doe", "orig-1", "new-99", null)
```
with:
```kotlin
verify(auditRepo).writeAudit("RETRIGGER", "john.doe", "orig-1", "new-99", null)
```

Replace:
```kotlin
doThrow(RuntimeException("DB down")).`when`(auditRepo)
    .writeAudit(anyString(), anyString(), anyString(), org.mockito.ArgumentMatchers.any())
```
with:
```kotlin
doThrow(RuntimeException("DB down")).`when`(auditRepo)
    .writeAudit(anyString(), anyString(), anyString(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any())
```

Replace:
```kotlin
verify(auditRepo).writeAudit("john.doe", "orig-3", "new-100", overrides)
```
with:
```kotlin
verify(auditRepo).writeAudit("RETRIGGER", "john.doe", "orig-3", "new-100", overrides)
```

Replace:
```kotlin
verify(auditRepo).writeAudit("john.doe", "orig-4", "new-101", null)
```
with:
```kotlin
verify(auditRepo).writeAudit("RETRIGGER", "john.doe", "orig-4", "new-101", null)
```

- [ ] **Step 8: Update DevSchemaInit MySQL branch**

In `backend/src/main/kotlin/tw/brandy/kestra/DevSchemaInit.kt`, replace the entire `else` block body with:

```kotlin
log.info("Dev mode (MySQL): ensuring kestra_execution_audit table exists")
try {
    conn.createStatement().use {
        it.execute("""
            CREATE TABLE IF NOT EXISTS kestra_execution_audit (
                id               BIGINT AUTO_INCREMENT PRIMARY KEY,
                acted_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                acted_by         VARCHAR(255) NOT NULL,
                action           VARCHAR(20)  NOT NULL,
                execution_id     VARCHAR(255) NOT NULL,
                new_execution_id VARCHAR(255) NULL,
                input_overrides  TEXT NULL
            )
        """.trimIndent())
    }
} catch (e: Exception) {
    log.warn("Could not create kestra_execution_audit table (run migration manually): ${e.message}")
}
```

- [ ] **Step 9: Run all backend tests**

```bash
cd backend && ./mvnw test -q 2>&1 | tail -30
```

Expected: BUILD SUCCESS, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add backend/src/main/resources/db-setup.sql \
        backend/src/main/kotlin/tw/brandy/kestra/DevSchemaInit.kt \
        backend/src/main/kotlin/tw/brandy/kestra/execution/AuditRepository.kt \
        backend/src/main/kotlin/tw/brandy/kestra/execution/RetriggerService.kt \
        backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt \
        backend/src/test/kotlin/tw/brandy/kestra/execution/AuditRepositoryTest.kt \
        backend/src/test/kotlin/tw/brandy/kestra/retrigger/RetriggerServiceTest.kt
git commit -m "refactor: unify retrigger audit into kestra_execution_audit table"
```

---

## Task 2: Add CancelService and cancel endpoint

**Files:**
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/CancelService.kt`
- Create: `backend/src/test/kotlin/tw/brandy/kestra/execution/CancelServiceTest.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/KestraClient.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`
- Modify: `backend/src/main/resources/application.properties`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt`

- [ ] **Step 1: Write CancelServiceTest**

Create `backend/src/test/kotlin/tw/brandy/kestra/execution/CancelServiceTest.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.test.InjectMock
import io.quarkus.test.junit.QuarkusTest
import io.quarkus.test.junit.mockito.MockitoConfig
import jakarta.inject.Inject
import jakarta.ws.rs.BadRequestException
import jakarta.ws.rs.NotFoundException
import jakarta.ws.rs.WebApplicationException
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.*

@QuarkusTest
class CancelServiceTest {

    @Inject
    lateinit var service: CancelService

    @InjectMock
    lateinit var executionRepo: ExecutionRepository

    @InjectMock
    lateinit var auditRepo: AuditRepository

    @InjectMock
    @RestClient
    @MockitoConfig(convertScopes = true)
    lateinit var kestraClient: KestraClient

    @Test
    fun `cancel returns response with executionId and cancelledBy`() {
        val detail = ExecutionDetailRow("exec-1", "ns", "flow", "RUNNING", null, null, emptyMap(), emptyList())
        `when`(executionRepo.findById("exec-1")).thenReturn(detail)
        doNothing().`when`(kestraClient).killExecution("exec-1")

        val result = service.cancel("exec-1", "john.doe")

        assertEquals("exec-1", result.executionId)
        assertEquals("john.doe", result.cancelledBy)
        assertNotNull(result.cancelledAt)
        verify(auditRepo).writeAudit("CANCEL", "john.doe", "exec-1", null, null)
    }

    @Test
    fun `cancel throws NotFoundException when execution does not exist`() {
        `when`(executionRepo.findById("missing")).thenReturn(null)

        assertThrows(NotFoundException::class.java) { service.cancel("missing", "user") }
        verifyNoInteractions(kestraClient)
        verifyNoInteractions(auditRepo)
    }

    @Test
    fun `cancel throws BadRequestException for terminal state`() {
        listOf("SUCCESS", "WARNING", "FAILED", "KILLED").forEach { state ->
            val detail = ExecutionDetailRow("exec-t", "ns", "flow", state, null, null, emptyMap(), emptyList())
            `when`(executionRepo.findById("exec-t")).thenReturn(detail)

            assertThrows(BadRequestException::class.java) { service.cancel("exec-t", "user") }
        }
        verifyNoInteractions(kestraClient)
        verifyNoInteractions(auditRepo)
    }

    @Test
    fun `cancel is allowed for all cancellable states`() {
        listOf("CREATED", "RUNNING", "PAUSED", "RESTARTED", "KILLING").forEach { state ->
            val detail = ExecutionDetailRow("exec-$state", "ns", "flow", state, null, null, emptyMap(), emptyList())
            `when`(executionRepo.findById("exec-$state")).thenReturn(detail)
            doNothing().`when`(kestraClient).killExecution("exec-$state")

            assertDoesNotThrow { service.cancel("exec-$state", "user") }
        }
    }

    @Test
    fun `cancel wraps Kestra API error as 502`() {
        val detail = ExecutionDetailRow("exec-3", "ns", "flow", "RUNNING", null, null, emptyMap(), emptyList())
        `when`(executionRepo.findById("exec-3")).thenReturn(detail)
        doThrow(RuntimeException("connection refused")).`when`(kestraClient).killExecution("exec-3")

        val ex = assertThrows(WebApplicationException::class.java) { service.cancel("exec-3", "user") }
        assertEquals(502, ex.response.status)
        verifyNoInteractions(auditRepo)
    }

    @Test
    fun `cancel still returns success when audit write fails`() {
        val detail = ExecutionDetailRow("exec-4", "ns", "flow", "RUNNING", null, null, emptyMap(), emptyList())
        `when`(executionRepo.findById("exec-4")).thenReturn(detail)
        doNothing().`when`(kestraClient).killExecution("exec-4")
        doThrow(RuntimeException("DB down")).`when`(auditRepo)
            .writeAudit(anyString(), anyString(), anyString(), any(), any())

        val result = service.cancel("exec-4", "user")
        assertEquals("exec-4", result.executionId)
    }
}
```

- [ ] **Step 2: Add cancel tests to ExecutionResourceTest**

At the end of the `ExecutionResourceTest` class body (before the closing `}`), add:

```kotlin
    @InjectMock
    lateinit var cancelService: CancelService

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST cancel returns 200 with cancelledBy`() {
        `when`(cancelService.cancel("exec-1", "john.doe"))
            .thenReturn(CancelResponse("exec-1", "john.doe", "2026-05-07T10:00:00Z"))

        given().`when`().post("/api/executions/exec-1/cancel")
            .then().statusCode(200)
            .body("executionId", equalTo("exec-1"))
            .body("cancelledBy", equalTo("john.doe"))
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST cancel returns 404 when execution not found`() {
        `when`(cancelService.cancel("missing", "john.doe"))
            .thenThrow(jakarta.ws.rs.NotFoundException("not found"))

        given().`when`().post("/api/executions/missing/cancel")
            .then().statusCode(404)
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST cancel returns 400 when state not cancellable`() {
        `when`(cancelService.cancel("exec-done", "john.doe"))
            .thenThrow(jakarta.ws.rs.BadRequestException("not cancellable"))

        given().`when`().post("/api/executions/exec-done/cancel")
            .then().statusCode(400)
    }

    @Test
    fun `POST cancel without token returns 401`() {
        given().`when`().post("/api/executions/exec-1/cancel")
            .then().statusCode(401)
    }
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd backend && ./mvnw test -pl . -Dtest="CancelServiceTest,ExecutionResourceTest" -q 2>&1 | tail -20
```

Expected: FAIL — `CancelService` and `CancelResponse` do not exist yet.

- [ ] **Step 4: Add CancelResponse to Models.kt**

At the end of `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt`, add:

```kotlin
data class CancelResponse(
    val executionId: String,
    val cancelledBy: String,
    val cancelledAt: String
)
```

- [ ] **Step 5: Add killExecution to KestraClient**

In `backend/src/main/kotlin/tw/brandy/kestra/execution/KestraClient.kt`, add after the `createExecution` method:

```kotlin
    @DELETE
    @Path("/api/v1/main/executions/{executionId}")
    fun killExecution(@PathParam("executionId") executionId: String)
```

Also add `import jakarta.ws.rs.DELETE` to the imports if not already present (it should be available from the existing `jakarta.ws.rs.*` wildcard — if not, add it explicitly).

- [ ] **Step 6: Create CancelService**

Create `backend/src/main/kotlin/tw/brandy/kestra/execution/CancelService.kt`:

```kotlin
package tw.brandy.kestra.execution

import jakarta.enterprise.context.ApplicationScoped
import jakarta.ws.rs.BadRequestException
import jakarta.ws.rs.NotFoundException
import jakarta.ws.rs.WebApplicationException
import jakarta.ws.rs.core.Response
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.jboss.logging.Logger
import java.time.Instant

@ApplicationScoped
class CancelService(
    private val executionRepository: ExecutionRepository,
    private val auditRepository: AuditRepository,
    @RestClient private val kestraClient: KestraClient
) {
    companion object {
        private val log = Logger.getLogger(CancelService::class.java)
        private val CANCELLABLE_STATES = setOf("CREATED", "RUNNING", "PAUSED", "RESTARTED", "KILLING")
    }

    fun cancel(executionId: String, cancelledBy: String): CancelResponse {
        val execution = executionRepository.findById(executionId)
            ?: throw NotFoundException("Execution $executionId not found")

        if (execution.state !in CANCELLABLE_STATES) {
            throw BadRequestException(
                "Execution $executionId is in state ${execution.state} and cannot be cancelled"
            )
        }

        try {
            kestraClient.killExecution(executionId)
        } catch (e: WebApplicationException) {
            val status = e.response.status
            val body = runCatching { e.response.readEntity(String::class.java) }.getOrDefault("Kestra error")
            throw WebApplicationException(Response.status(if (status == 404) 404 else 502).entity(body).build())
        } catch (e: Exception) {
            throw WebApplicationException(
                Response.status(502).entity("Kestra API unreachable: ${e.message}").build()
            )
        }

        try {
            auditRepository.writeAudit("CANCEL", cancelledBy, executionId)
        } catch (e: Exception) {
            log.errorf(e, "Audit write failed for cancel: executionId=%s", executionId)
        }

        return CancelResponse(
            executionId = executionId,
            cancelledBy = cancelledBy,
            cancelledAt = Instant.now().toString()
        )
    }
}
```

- [ ] **Step 7: Add cancel endpoint to ExecutionResource**

In `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`:

Add `cancelService: CancelService` to the constructor:
```kotlin
class ExecutionResource(
    private val executionRepository: ExecutionRepository,
    private val retriggerService: RetriggerService,
    private val cancelService: CancelService,
    private val identity: SecurityIdentity
)
```

Add the cancel endpoint after the retrigger endpoints:
```kotlin
    @POST
    @Path("/{id}/cancel")
    fun cancel(@PathParam("id") id: String): CancelResponse =
        cancelService.cancel(id, resolveUsername())
```

- [ ] **Step 8: Add app.audit.enabled to application.properties**

In `backend/src/main/resources/application.properties`, add at the end:

```
# Audit
app.audit.enabled=true
```

- [ ] **Step 9: Run all backend tests**

```bash
cd backend && ./mvnw test -q 2>&1 | tail -30
```

Expected: BUILD SUCCESS, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add backend/src/main/kotlin/tw/brandy/kestra/execution/CancelService.kt \
        backend/src/main/kotlin/tw/brandy/kestra/execution/KestraClient.kt \
        backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt \
        backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt \
        backend/src/main/resources/application.properties \
        backend/src/test/kotlin/tw/brandy/kestra/execution/CancelServiceTest.kt \
        backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt
git commit -m "feat: add cancel execution backend (CancelService + POST /{id}/cancel endpoint)"
```

---

## Task 3: Frontend — CancelResponse type and useCancel hook

**Files:**
- Modify: `frontend/src/types/execution.ts`
- Create: `frontend/src/hooks/useCancel.ts`

- [ ] **Step 1: Add CancelResponse to types/execution.ts**

At the end of `frontend/src/types/execution.ts`, add:

```typescript
export interface CancelResponse {
  executionId: string
  cancelledBy: string
  cancelledAt: string
}
```

- [ ] **Step 2: Create useCancel hook**

Create `frontend/src/hooks/useCancel.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import type { CancelResponse } from '../types/execution'

export function useCancel() {
  const queryClient = useQueryClient()
  return useMutation<CancelResponse, Error, string>({
    mutationFn: (id: string) =>
      api.post(`/api/executions/${id}/cancel`).then(r => r.data),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['executions'] })
      queryClient.invalidateQueries({ queryKey: ['execution', id] })
      queryClient.invalidateQueries({ queryKey: ['executions-summary'] })
    },
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/execution.ts frontend/src/hooks/useCancel.ts
git commit -m "feat: add useCancel hook and CancelResponse type"
```

---

## Task 4: Frontend — CancelModal component

**Files:**
- Create: `frontend/src/components/CancelModal.tsx`
- Create: `frontend/src/components/CancelModal.test.tsx`

- [ ] **Step 1: Write CancelModal tests**

Create `frontend/src/components/CancelModal.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CancelModal } from './CancelModal'
import type { ExecutionRow } from '../types/execution'

vi.mock('../hooks/useCancel', () => ({
  useCancel: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const exec: ExecutionRow = {
  id: 'exec-1', namespace: 'prod.etl', flowId: 'daily-report',
  state: 'RUNNING', startDate: null, endDate: null,
}

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
  )
}

describe('CancelModal', () => {
  it('shows flow, namespace and execution id', () => {
    wrap(<CancelModal execution={exec} onClose={vi.fn()} />)
    expect(screen.getByText('daily-report')).toBeInTheDocument()
    expect(screen.getByText('prod.etl')).toBeInTheDocument()
    expect(screen.getByText('exec-1')).toBeInTheDocument()
  })

  it('calls onClose when Back is clicked', () => {
    const onClose = vi.fn()
    wrap(<CancelModal execution={exec} onClose={onClose} />)
    fireEvent.click(screen.getByText('Back'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows kill signal warning', () => {
    wrap(<CancelModal execution={exec} onClose={vi.fn()} />)
    expect(screen.getByText(/kill signal/i)).toBeInTheDocument()
  })

  it('Confirm Cancel button is present and not disabled', () => {
    wrap(<CancelModal execution={exec} onClose={vi.fn()} />)
    const btn = screen.getByText('Confirm Cancel')
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npx vitest run src/components/CancelModal.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `CancelModal` module not found.

- [ ] **Step 3: Create CancelModal component**

Create `frontend/src/components/CancelModal.tsx`:

```tsx
import type { ExecutionRow } from '../types/execution'
import { useCancel } from '../hooks/useCancel'

export const CANCELLABLE_STATES = new Set(['CREATED', 'RUNNING', 'PAUSED', 'RESTARTED'])

interface CancelModalProps {
  execution: ExecutionRow
  onClose: () => void
}

export function CancelModal({ execution, onClose }: CancelModalProps) {
  const cancel = useCancel()

  const handleConfirm = async () => {
    try {
      await cancel.mutateAsync(execution.id)
      onClose()
    } catch {
      // error surfaced via cancel.isError
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Cancel Execution</h2>

        <div className="space-y-1 text-sm mb-4">
          <div><span className="font-medium text-gray-600">Flow:</span> {execution.flowId}</div>
          <div><span className="font-medium text-gray-600">Namespace:</span> {execution.namespace}</div>
          <div><span className="font-medium text-gray-600">ID:</span>{' '}
            <span className="font-mono text-xs">{execution.id}</span>
          </div>
        </div>

        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-4">
          This sends a kill signal to Kestra. The execution will transition to KILLED.
        </p>

        {cancel.isError && (
          <p className="text-red-600 text-sm mb-3">{cancel.error?.message ?? 'Cancel failed'}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={cancel.isPending}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {cancel.isPending ? 'Cancelling…' : 'Confirm Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npx vitest run src/components/CancelModal.test.tsx 2>&1 | tail -20
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CancelModal.tsx frontend/src/components/CancelModal.test.tsx
git commit -m "feat: add CancelModal confirmation component"
```

---

## Task 5: Wire cancel button into both pages

**Files:**
- Modify: `frontend/src/pages/ExecutionDetailPage.tsx`
- Modify: `frontend/src/pages/ExecutionListPage.tsx`
- Modify: `frontend/src/pages/ExecutionDetailPage.test.tsx`

- [ ] **Step 1: Add cancel button visibility tests to ExecutionDetailPage.test.tsx**

The existing mock uses a plain function factory. Replace the `useExecution` mock declaration at the top of `ExecutionDetailPage.test.tsx` with a `vi.fn()` version so individual tests can override it, and add `CancelModal` to the mocked modules:

At the top of `ExecutionDetailPage.test.tsx`, replace:
```tsx
vi.mock('../hooks/useExecution', () => ({
  useExecution: () => ({
    data: {
      id: 'exec-1',
      ...
    },
    isLoading: false,
    error: null,
  }),
}))
```
with:
```tsx
import { useExecution } from '../hooks/useExecution'

vi.mock('../hooks/useExecution')
vi.mock('../components/CancelModal', () => ({ CancelModal: () => null, CANCELLABLE_STATES: new Set(['CREATED', 'RUNNING', 'PAUSED', 'RESTARTED']) }))
```

Add a `beforeEach` inside the existing `describe('ExecutionDetailPage log view', ...)` block to restore the default mock:

```tsx
beforeEach(() => {
  vi.mocked(useExecution).mockReturnValue({
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
  })
})
```

Add a new describe block at the end of the file (before the final closing `}`):

```tsx
describe('ExecutionDetailPage cancel button', () => {
  const baseExecution = {
    id: 'exec-1', namespace: 'prod', flowId: 'my-flow',
    startDate: null, endDate: null, inputs: {}, taskRuns: [],
  }

  it('shows Cancel button for RUNNING execution', () => {
    vi.mocked(useExecution).mockReturnValue({
      data: { ...baseExecution, state: 'RUNNING' },
      isLoading: false,
      error: null,
    })
    wrap(<ExecutionDetailPage />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('hides Cancel button for FAILED execution', () => {
    vi.mocked(useExecution).mockReturnValue({
      data: { ...baseExecution, state: 'FAILED' },
      isLoading: false,
      error: null,
    })
    wrap(<ExecutionDetailPage />)
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })

  it('hides Cancel button for SUCCESS execution', () => {
    vi.mocked(useExecution).mockReturnValue({
      data: { ...baseExecution, state: 'SUCCESS' },
      isLoading: false,
      error: null,
    })
    wrap(<ExecutionDetailPage />)
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
cd frontend && npx vitest run src/pages/ExecutionDetailPage.test.tsx 2>&1 | tail -20
```

Expected: existing log-view tests still pass; new cancel button tests FAIL (Cancel button not yet in the page).

- [ ] **Step 3: Update ExecutionDetailPage to add cancel button and modal**

In `frontend/src/pages/ExecutionDetailPage.tsx`:

Add imports at the top:
```tsx
import { CancelModal, CANCELLABLE_STATES } from '../components/CancelModal'
```

Add state for the cancel modal alongside the existing `showRetrigger` state:
```tsx
const [showCancel, setShowCancel] = useState(false)
```

In the KPI card row, add a Cancel button immediately before the Retrigger button (at line ~67, after the status badge card):
```tsx
        {CANCELLABLE_STATES.has(execution.state) && (
          <button
            onClick={() => setShowCancel(true)}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => setShowRetrigger(true)}
          className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
        >
          Retrigger
        </button>
```

After the existing `{showRetrigger && ...}` block, add:
```tsx
        {showCancel && (
          <CancelModal execution={execution} onClose={() => setShowCancel(false)} />
        )}
```

- [ ] **Step 4: Update ExecutionListPage to add cancel button and modal**

In `frontend/src/pages/ExecutionListPage.tsx`:

Add imports at the top:
```tsx
import { CancelModal, CANCELLABLE_STATES } from '../components/CancelModal'
```

Add state for the cancel target alongside `retriggerTarget`:
```tsx
const [cancelTarget, setCancelTarget] = useState<ExecutionRow | null>(null)
```

In the table row actions cell (the last `<td>` in each row), replace:
```tsx
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setRetriggerTarget(exec)}
                        className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Retrigger
                      </button>
                    </td>
```
with:
```tsx
                    <td className="px-4 py-3 flex gap-2">
                      {CANCELLABLE_STATES.has(exec.state) && (
                        <button
                          onClick={() => setCancelTarget(exec)}
                          className="px-2.5 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => setRetriggerTarget(exec)}
                        className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Retrigger
                      </button>
                    </td>
```

After the existing `{retriggerTarget && ...}` block, add:
```tsx
        {cancelTarget && (
          <CancelModal execution={cancelTarget} onClose={() => setCancelTarget(null)} />
        )}
```

- [ ] **Step 5: Run all frontend tests**

```bash
cd frontend && npx vitest run 2>&1 | tail -30
```

Expected: all tests pass, including the new cancel button visibility tests.

- [ ] **Step 6: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ExecutionDetailPage.tsx \
        frontend/src/pages/ExecutionListPage.tsx \
        frontend/src/pages/ExecutionDetailPage.test.tsx
git commit -m "feat: add cancel button to execution list and detail pages"
```

---

## Self-Review

**Spec coverage:**
- ✅ Cancel button on both list and detail pages
- ✅ Only visible for CREATED, RUNNING, PAUSED, RESTARTED states
- ✅ Confirmation modal (CancelModal) with Back + Confirm Cancel buttons
- ✅ Calls Kestra kill API via KestraClient.killExecution
- ✅ Unified kestra_execution_audit table with action column
- ✅ app.audit.enabled config flag in AuditRepository
- ✅ RetriggerService updated to new writeAudit signature
- ✅ Audit failure is non-fatal (logged, cancel still succeeds)
- ✅ 404 on missing execution, 400 on bad state, 502 on Kestra API failure
- ✅ Backend tests: CancelServiceTest covers all branches
- ✅ Frontend tests: CancelModal component, cancel button visibility

**Type consistency check:**
- `CancelResponse` defined in `Models.kt` (Task 2) and `types/execution.ts` (Task 3) — consistent field names
- `writeAudit(action, actedBy, executionId, newExecutionId?, inputOverrides?)` — used consistently in CancelService and RetriggerService
- `CANCELLABLE_STATES` exported from `CancelModal.tsx` and imported in both pages
- `useCancel()` returns `useMutation<CancelResponse, Error, string>` — `string` is the executionId, consistent with `mutateAsync(execution.id)` call sites
