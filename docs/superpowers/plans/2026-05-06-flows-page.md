# Flows Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Flows section where authenticated users can list Kestra flows, view flow details with recent executions, and trigger a new execution from flow input definitions.

**Architecture:** The backend reads flow rows directly from Kestra's MySQL `flows` table through a new JDBC `FlowRepository`, and exposes `/api/flows` routes through a new authenticated `FlowResource`. Triggering is handled by a small `FlowTriggerService` that builds multipart form data with `KestraPartBuilder`, calls `KestraClient.createExecution`, and writes an audit row using the existing audit table with the flow identity as the audited original id. The frontend adds flow-specific query hooks, a top navigation bar, flow list/detail pages, and a trigger modal backed by TanStack Query.

**Tech Stack:** Kotlin/Quarkus + Agroal JDBC + Jackson + H2 tests, React 19 + TypeScript + React Router + TanStack Query + Tailwind CSS, Vitest + Testing Library

---

## File Map

| File | Change |
|---|---|
| `backend/src/main/resources/db-setup.sql` | Add `flows` table for H2 tests |
| `backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt` | Clear `flows` before `executions` in tests |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt` | Add flow API models, trigger request/response, and Jackson flow-value parsing models |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt` | Add optional `flowId` filtering for recent executions on the flow detail page |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt` | Accept `flowId` query parameter for `GET /api/executions` |
| `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt` | Add flow-id filter test |
| `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt` | Add flow-id query-param test |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/FlowRepository.kt` | Create JDBC repository for flow list/detail/input parsing |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/FlowTriggerService.kt` | Create trigger service for flow-trigger POST behavior |
| `backend/src/main/kotlin/tw/brandy/kestra/execution/FlowResource.kt` | Create authenticated `/api/flows` resource |
| `backend/src/test/kotlin/tw/brandy/kestra/execution/FlowRepositoryTest.kt` | Create repository tests |
| `backend/src/test/kotlin/tw/brandy/kestra/execution/FlowResourceTest.kt` | Create resource tests |
| `frontend/src/types/execution.ts` | Add flow and trigger types |
| `frontend/src/hooks/useExecutions.ts` | Add optional `flowId` filter type |
| `frontend/src/hooks/useFlows.ts` | Create flow-list query hook |
| `frontend/src/hooks/useFlow.ts` | Create flow-detail query hook |
| `frontend/src/hooks/useFlowInputs.ts` | Create lazy flow-inputs query hook |
| `frontend/src/hooks/useTrigger.ts` | Create flow-trigger mutation hook |
| `frontend/src/components/NavBar.tsx` | Create shared top navigation |
| `frontend/src/components/TriggerModal.tsx` | Create modal for triggering a flow from input definitions |
| `frontend/src/pages/FlowListPage.tsx` | Create `/flows` page |
| `frontend/src/pages/FlowDetailPage.tsx` | Create `/flows/:namespace/:flowId` page |
| `frontend/src/App.tsx` | Add flow routes |
| `frontend/src/pages/ExecutionListPage.tsx` | Render `NavBar` at top |
| `frontend/src/pages/ExecutionDetailPage.tsx` | Render `NavBar` at top |
| `frontend/src/pages/FlowListPage.test.tsx` | Create list-page tests |
| `frontend/src/pages/FlowDetailPage.test.tsx` | Create detail-page tests |
| `frontend/src/components/TriggerModal.test.tsx` | Create modal tests |

---

## Task 1: Backend schema and models

**Files:**
- Modify: `backend/src/main/resources/db-setup.sql`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt`

- [ ] **Step 1: Confirm real Kestra schema before SQL work**

Run against the real Kestra MySQL database used by the backend. If you connect through a local MySQL CLI profile, use that profile name in place of `kestra-prod`:

```bash
mysql --login-path=kestra-prod -e "DESCRIBE flows;"
```

Expected: the output includes `id`, `namespace`, `deleted`, and `value`. If the real database is unavailable in this session, proceed with these four column names from the spec and record in the final implementation notes that the schema was not live-verified.

- [ ] **Step 2: Add H2 `flows` test table**

Append this table to `backend/src/main/resources/db-setup.sql`:

```sql
CREATE TABLE IF NOT EXISTS flows (
    `key`     VARCHAR(250) NOT NULL PRIMARY KEY,
    id        VARCHAR(150) NOT NULL,
    namespace VARCHAR(150) NOT NULL,
    deleted   BOOLEAN DEFAULT FALSE,
    `value`   CLOB
);
```

- [ ] **Step 3: Clear flows in DbTestBase**

In `backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt`, update schema cleanup so `flows` is cleared before test data is inserted:

```kotlin
conn.createStatement().use { it.execute("DELETE FROM executions") }
conn.createStatement().use { it.execute("DELETE FROM kestra_retrigger_audit") }
conn.createStatement().use { it.execute("DELETE FROM flows") }
```

- [ ] **Step 4: Add flow models**

Append to `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt`:

```kotlin
data class FlowRow(
    val namespace: String,
    val flowId: String,
    val lastRunDate: String?,
    val executionCount: Long
)

data class FlowDetail(val namespace: String, val flowId: String)

data class FlowInput(val id: String, val type: String)

data class TriggerRequest(val inputs: Map<String, Any?> = emptyMap())

data class TriggerResponse(
    val newExecutionId: String,
    val triggeredBy: String,
    val triggeredAt: String
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraFlowValue(
    val inputs: List<KestraFlowInput> = emptyList()
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraFlowInput(val id: String = "", val type: String = "")
```

- [ ] **Step 5: Run backend compile to verify model syntax**

```bash
cd backend && ./mvnw test -DskipTests
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/resources/db-setup.sql backend/src/test/kotlin/tw/brandy/kestra/DbTestBase.kt backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt
git commit -m "feat: add flow models and test schema"
```

---

## Task 2: Execution flow-id filter TDD

**Files:**
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt`
- Modify: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt`
- Modify: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`
- Modify: `frontend/src/hooks/useExecutions.ts`

- [ ] **Step 1: Write failing repository test**

Add to `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt`:

```kotlin
@Test
fun `listExecutions filters by flow id`() {
    insertExecution("exec-1", "prod", "daily", "SUCCESS")
    insertExecution("exec-2", "prod", "adhoc", "SUCCESS")

    val page = repo.listExecutions("prod", null, null, null, "daily", 0, 10)

    assertEquals(1, page.total)
    assertEquals("exec-1", page.results[0].id)
    assertEquals("daily", page.results[0].flowId)
}
```

- [ ] **Step 2: Write failing resource test**

Add to `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt`:

```kotlin
@Test
@TestSecurity(user = "john.doe", roles = [])
@OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
fun `GET executions passes flowId query parameter`() {
    `when`(executionRepository.listExecutions("prod", null, null, null, "daily", 0, 20))
        .thenReturn(ExecutionPage(1, 0, 20, listOf(
            ExecutionRow("exec-1", "prod", "daily", "SUCCESS", null, null)
        )))

    given().queryParam("namespace", "prod").queryParam("flowId", "daily")
        .`when`().get("/api/executions")
        .then().statusCode(200)
        .body("total", equalTo(1))
        .body("results[0].flowId", equalTo("daily"))
}
```

- [ ] **Step 3: Run execution tests to verify RED**

```bash
cd backend && ./mvnw test -Dtest=ExecutionRepositoryTest,ExecutionResourceTest
```

Expected: `BUILD FAILURE` because `listExecutions` does not accept the `flowId` argument.

- [ ] **Step 4: Add flowId to ExecutionRepository**

In `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt`, change the method signature:

```kotlin
fun listExecutions(
    namespace: String?, status: String?,
    from: String?, to: String?,
    flowId: String?,
    page: Int, size: Int
): ExecutionPage {
```

Add this condition after the namespace condition:

```kotlin
if (flowId != null) {
    conditions.add("flow_id = ?")
    params.add(flowId)
}
```

- [ ] **Step 5: Add flowId to ExecutionResource**

In `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`, add the query parameter:

```kotlin
@QueryParam("flowId") flowId: String?,
```

Call the repository with the new argument:

```kotlin
): ExecutionPage = executionRepository.listExecutions(namespace, status, from, to, flowId, page, size)
```

Update existing test stubs that call `listExecutions` so they pass `null` before `page`.

- [ ] **Step 6: Add flowId to frontend ExecutionFilters**

In `frontend/src/hooks/useExecutions.ts`, add the optional field:

```ts
flowId?: string
```

The full interface should be:

```ts
export interface ExecutionFilters {
  namespace?: string
  flowId?: string
  status?: string
  from?: string
  to?: string
  page?: number
  size?: number
}
```

- [ ] **Step 7: Run tests to verify GREEN**

```bash
cd backend && ./mvnw test -Dtest=ExecutionRepositoryTest,ExecutionResourceTest
cd frontend && npm run build
```

Expected: backend tests pass and frontend build completes.

- [ ] **Step 8: Commit**

```bash
git add backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt frontend/src/hooks/useExecutions.ts
git commit -m "feat: filter executions by flow id"
```

---

## Task 3: FlowRepository TDD

**Files:**
- Create: `backend/src/test/kotlin/tw/brandy/kestra/execution/FlowRepositoryTest.kt`
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/FlowRepository.kt`

- [ ] **Step 1: Write failing repository tests**

Create `backend/src/test/kotlin/tw/brandy/kestra/execution/FlowRepositoryTest.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.test.junit.QuarkusTest
import jakarta.inject.Inject
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tw.brandy.kestra.DbTestBase
import java.sql.Timestamp
import java.time.Instant

@QuarkusTest
class FlowRepositoryTest : DbTestBase() {

    @Inject
    lateinit var repo: FlowRepository

    private fun insertFlow(id: String, namespace: String, deleted: Boolean = false, value: String = """{"inputs":[]}""") {
        ds.connection.use { conn ->
            conn.prepareStatement(
                "INSERT INTO flows (`key`, id, namespace, deleted, `value`) VALUES (?,?,?,?,?)"
            ).use { ps ->
                ps.setString(1, "$namespace:$id")
                ps.setString(2, id)
                ps.setString(3, namespace)
                ps.setBoolean(4, deleted)
                ps.setString(5, value)
                ps.executeUpdate()
            }
        }
    }

    private fun insertExecution(id: String, namespace: String, flowId: String, startDate: Instant, deleted: Boolean = false) {
        val value = """{"id":"$id","namespace":"$namespace","flowId":"$flowId","inputs":{},"taskRunList":[]}"""
        ds.connection.use { conn ->
            conn.prepareStatement(
                "INSERT INTO executions (`key`,`value`,id,namespace,flow_id,state_current,start_date,deleted) VALUES (?,?,?,?,?,?,?,?)"
            ).use { ps ->
                ps.setString(1, id)
                ps.setString(2, value)
                ps.setString(3, id)
                ps.setString(4, namespace)
                ps.setString(5, flowId)
                ps.setString(6, "SUCCESS")
                ps.setTimestamp(7, Timestamp.from(startDate))
                ps.setBoolean(8, deleted)
                ps.executeUpdate()
            }
        }
    }

    @Test
    fun `listFlows returns non-deleted flows with aggregate execution data`() {
        insertFlow("daily", "prod")
        insertFlow("adhoc", "prod")
        insertFlow("deleted", "prod", deleted = true)
        insertExecution("exec-1", "prod", "daily", Instant.parse("2026-05-06T08:00:00Z"))
        insertExecution("exec-2", "prod", "daily", Instant.parse("2026-05-06T10:00:00Z"))
        insertExecution("exec-3", "prod", "daily", Instant.parse("2026-05-06T11:00:00Z"), deleted = true)

        val rows = repo.listFlows()

        assertEquals(2, rows.size)
        assertEquals(FlowRow("prod", "adhoc", null, 0), rows[0])
        assertEquals("prod", rows[1].namespace)
        assertEquals("daily", rows[1].flowId)
        assertEquals("2026-05-06T10:00:00Z", rows[1].lastRunDate)
        assertEquals(2, rows[1].executionCount)
    }

    @Test
    fun `findFlow returns detail for existing flow and null for missing flow`() {
        insertFlow("daily", "prod")

        assertEquals(FlowDetail("prod", "daily"), repo.findFlow("prod", "daily"))
        assertNull(repo.findFlow("prod", "missing"))
    }

    @Test
    fun `findFlowInputs parses inputs from value json`() {
        insertFlow(
            "daily",
            "prod",
            value = """{"inputs":[{"id":"date","type":"STRING","required":true},{"id":"count","type":"INT"},{"id":"flag","type":"BOOLEAN"}]}"""
        )

        val inputs = repo.findFlowInputs("prod", "daily")

        assertEquals(listOf(FlowInput("date", "STRING"), FlowInput("count", "INT"), FlowInput("flag", "BOOLEAN")), inputs)
    }

    @Test
    fun `findFlowInputs returns empty list when inputs are absent`() {
        insertFlow("daily", "prod", value = """{"tasks":[]}""")

        assertEquals(emptyList<FlowInput>(), repo.findFlowInputs("prod", "daily"))
    }

    @Test
    fun `findFlowInputs returns empty list for unknown flow`() {
        assertEquals(emptyList<FlowInput>(), repo.findFlowInputs("prod", "missing"))
    }
}
```

- [ ] **Step 2: Run repository tests to verify RED**

```bash
cd backend && ./mvnw test -Dtest=FlowRepositoryTest
```

Expected: `BUILD FAILURE` because `FlowRepository` does not exist.

- [ ] **Step 3: Create FlowRepository**

Create `backend/src/main/kotlin/tw/brandy/kestra/execution/FlowRepository.kt`:

```kotlin
package tw.brandy.kestra.execution

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import tw.brandy.kestra.util.toList
import javax.sql.DataSource

@ApplicationScoped
class FlowRepository(
    private val ds: DataSource,
    private val mapper: ObjectMapper
) {

    fun listFlows(): List<FlowRow> {
        val sql = """
            SELECT f.namespace, f.id AS flow_id,
                   MAX(e.start_date) AS last_run_date,
                   COUNT(e.id) AS execution_count
            FROM flows f
            LEFT JOIN executions e
                   ON e.namespace = f.namespace
                  AND e.flow_id = f.id
                  AND e.deleted = false
            WHERE f.deleted = false
            GROUP BY f.namespace, f.id
            ORDER BY f.namespace, f.id
        """.trimIndent()
        return ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.executeQuery().use { rs ->
                    rs.toList { r ->
                        FlowRow(
                            namespace = r.getString("namespace"),
                            flowId = r.getString("flow_id"),
                            lastRunDate = r.getTimestamp("last_run_date")?.toInstant()?.toString(),
                            executionCount = r.getLong("execution_count")
                        )
                    }
                }
            }
        }
    }

    fun findFlow(namespace: String, flowId: String): FlowDetail? {
        val sql = "SELECT namespace, id FROM flows WHERE namespace = ? AND id = ? AND deleted = false"
        return ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, namespace)
                ps.setString(2, flowId)
                ps.executeQuery().use { rs ->
                    if (!rs.next()) null else FlowDetail(rs.getString("namespace"), rs.getString("id"))
                }
            }
        }
    }

    fun findFlowInputs(namespace: String, flowId: String): List<FlowInput> {
        val sql = "SELECT `value` FROM flows WHERE namespace = ? AND id = ? AND deleted = false"
        val json = ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, namespace)
                ps.setString(2, flowId)
                ps.executeQuery().use { rs ->
                    if (!rs.next()) return emptyList()
                    rs.getString("value") ?: return emptyList()
                }
            }
        }
        val parsed = mapper.readValue(json, KestraFlowValue::class.java)
        return parsed.inputs
            .filter { it.id.isNotBlank() }
            .map { FlowInput(it.id, it.type) }
    }
}
```

- [ ] **Step 4: Run repository tests to verify GREEN**

```bash
cd backend && ./mvnw test -Dtest=FlowRepositoryTest
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/test/kotlin/tw/brandy/kestra/execution/FlowRepositoryTest.kt backend/src/main/kotlin/tw/brandy/kestra/execution/FlowRepository.kt
git commit -m "feat: add FlowRepository"
```

---

## Task 4: FlowResource and trigger service TDD

**Files:**
- Create: `backend/src/test/kotlin/tw/brandy/kestra/execution/FlowResourceTest.kt`
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/FlowTriggerService.kt`
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/FlowResource.kt`

- [ ] **Step 1: Write failing resource tests**

Create `backend/src/test/kotlin/tw/brandy/kestra/execution/FlowResourceTest.kt`:

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
class FlowResourceTest {

    @InjectMock
    lateinit var flowRepository: FlowRepository

    @InjectMock
    lateinit var flowTriggerService: FlowTriggerService

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET flows returns list`() {
        `when`(flowRepository.listFlows()).thenReturn(listOf(FlowRow("prod", "daily", "2026-05-06T10:00:00Z", 2)))

        given().`when`().get("/api/flows")
            .then().statusCode(200)
            .body("size()", equalTo(1))
            .body("[0].namespace", equalTo("prod"))
            .body("[0].flowId", equalTo("daily"))
            .body("[0].executionCount", equalTo(2))
    }

    @Test
    fun `GET flows without token returns 401`() {
        given().`when`().get("/api/flows").then().statusCode(401)
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET flow detail returns detail for known flow`() {
        `when`(flowRepository.findFlow("prod", "daily")).thenReturn(FlowDetail("prod", "daily"))

        given().`when`().get("/api/flows/prod/daily")
            .then().statusCode(200)
            .body("namespace", equalTo("prod"))
            .body("flowId", equalTo("daily"))
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET flow detail returns 404 for unknown flow`() {
        `when`(flowRepository.findFlow("prod", "missing")).thenReturn(null)

        given().`when`().get("/api/flows/prod/missing").then().statusCode(404)
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET flow inputs returns input definitions`() {
        `when`(flowRepository.findFlowInputs("prod", "daily"))
            .thenReturn(listOf(FlowInput("date", "STRING"), FlowInput("flag", "BOOLEAN")))

        given().`when`().get("/api/flows/prod/daily/inputs")
            .then().statusCode(200)
            .body("size()", equalTo(2))
            .body("[0].id", equalTo("date"))
            .body("[1].type", equalTo("BOOLEAN"))
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST trigger returns trigger response`() {
        `when`(flowTriggerService.trigger("prod", "daily", "john.doe", mapOf("date" to "2026-05-06")))
            .thenReturn(TriggerResponse("exec-new", "john.doe", "2026-05-06T10:00:00Z"))

        given()
            .contentType("application/json")
            .body("""{"inputs":{"date":"2026-05-06"}}""")
            .`when`().post("/api/flows/prod/daily/trigger")
            .then().statusCode(200)
            .body("newExecutionId", equalTo("exec-new"))
            .body("triggeredBy", equalTo("john.doe"))
    }
}
```

- [ ] **Step 2: Run resource tests to verify RED**

```bash
cd backend && ./mvnw test -Dtest=FlowResourceTest
```

Expected: `BUILD FAILURE` because `FlowResource` and `FlowTriggerService` do not exist.

- [ ] **Step 3: Create FlowTriggerService**

Create `backend/src/main/kotlin/tw/brandy/kestra/execution/FlowTriggerService.kt`:

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
class FlowTriggerService(
    private val flowRepository: FlowRepository,
    private val auditRepository: AuditRepository,
    private val partBuilder: KestraPartBuilder,
    @RestClient private val kestraClient: KestraClient
) {
    companion object {
        private val log = Logger.getLogger(FlowTriggerService::class.java)
    }

    fun trigger(namespace: String, flowId: String, triggeredBy: String, inputs: Map<String, Any?>): TriggerResponse {
        flowRepository.findFlow(namespace, flowId) ?: throw NotFoundException("Flow $namespace/$flowId not found")

        val kestraResponse = try {
            kestraClient.createExecution(namespace, flowId, partBuilder.fromMap(inputs))
        } catch (e: WebApplicationException) {
            val body = runCatching { e.response.readEntity(String::class.java) }.getOrDefault("Kestra error")
            throw WebApplicationException(Response.status(502).entity(body).build())
        } catch (e: Exception) {
            throw WebApplicationException(Response.status(502).entity("Kestra API unreachable: ${e.message}").build())
        }

        try {
            auditRepository.writeAudit(triggeredBy, "$namespace/$flowId", kestraResponse.id, inputs.ifEmpty { null })
        } catch (e: Exception) {
            log.errorf(e, "Audit write failed: flow=%s/%s newId=%s", namespace, flowId, kestraResponse.id)
        }

        return TriggerResponse(kestraResponse.id, triggeredBy, Instant.now().toString())
    }
}
```

- [ ] **Step 4: Create FlowResource**

Create `backend/src/main/kotlin/tw/brandy/kestra/execution/FlowResource.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.security.Authenticated
import io.quarkus.security.identity.SecurityIdentity
import jakarta.inject.Inject
import jakarta.ws.rs.*
import jakarta.ws.rs.core.MediaType
import org.eclipse.microprofile.jwt.JsonWebToken

@Path("/api/flows")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
class FlowResource(
    private val flowRepository: FlowRepository,
    private val flowTriggerService: FlowTriggerService,
    private val identity: SecurityIdentity
) {

    @Inject
    lateinit var jwt: JsonWebToken

    @GET
    fun list(): List<FlowRow> = flowRepository.listFlows()

    @GET
    @Path("/{namespace}/{flowId}")
    fun detail(@PathParam("namespace") namespace: String, @PathParam("flowId") flowId: String): FlowDetail =
        flowRepository.findFlow(namespace, flowId) ?: throw NotFoundException("Flow $namespace/$flowId not found")

    @GET
    @Path("/{namespace}/{flowId}/inputs")
    fun inputs(@PathParam("namespace") namespace: String, @PathParam("flowId") flowId: String): List<FlowInput> =
        flowRepository.findFlowInputs(namespace, flowId)

    @POST
    @Path("/{namespace}/{flowId}/trigger")
    @Consumes(MediaType.APPLICATION_JSON)
    fun trigger(
        @PathParam("namespace") namespace: String,
        @PathParam("flowId") flowId: String,
        body: TriggerRequest?
    ): TriggerResponse =
        flowTriggerService.trigger(namespace, flowId, resolveUsername(), body?.inputs ?: emptyMap())

    private fun resolveUsername(): String =
        runCatching { jwt.getClaim<String>("preferred_username") }.getOrNull()
            ?: identity.principal.name
}
```

- [ ] **Step 5: Run resource tests to verify GREEN**

```bash
cd backend && ./mvnw test -Dtest=FlowResourceTest
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 6: Run backend tests**

```bash
cd backend && ./mvnw test
```

Expected: `BUILD SUCCESS`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/test/kotlin/tw/brandy/kestra/execution/FlowResourceTest.kt backend/src/main/kotlin/tw/brandy/kestra/execution/FlowTriggerService.kt backend/src/main/kotlin/tw/brandy/kestra/execution/FlowResource.kt
git commit -m "feat: add authenticated flow API"
```

---

## Task 5: Frontend types, hooks, and NavBar

**Files:**
- Modify: `frontend/src/types/execution.ts`
- Create: `frontend/src/hooks/useFlows.ts`
- Create: `frontend/src/hooks/useFlow.ts`
- Create: `frontend/src/hooks/useFlowInputs.ts`
- Create: `frontend/src/hooks/useTrigger.ts`
- Create: `frontend/src/components/NavBar.tsx`

- [ ] **Step 1: Add flow types**

Append to `frontend/src/types/execution.ts`:

```ts
export interface FlowRow {
  namespace: string
  flowId: string
  lastRunDate: string | null
  executionCount: number
}

export interface FlowDetail {
  namespace: string
  flowId: string
}

export interface FlowInput {
  id: string
  type: string
}

export interface TriggerResponse {
  newExecutionId: string
  triggeredBy: string
  triggeredAt: string
}
```

- [ ] **Step 2: Create query hooks**

Create `frontend/src/hooks/useFlows.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { FlowRow } from '../types/execution'

export function useFlows() {
  return useQuery<FlowRow[]>({
    queryKey: ['flows'],
    queryFn: () => api.get('/api/flows').then(r => r.data),
  })
}
```

Create `frontend/src/hooks/useFlow.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { FlowDetail } from '../types/execution'

export function useFlow(namespace: string | undefined, flowId: string | undefined) {
  return useQuery<FlowDetail>({
    queryKey: ['flow', namespace, flowId],
    queryFn: () => api.get(`/api/flows/${namespace}/${flowId}`).then(r => r.data),
    enabled: !!namespace && !!flowId,
  })
}
```

Create `frontend/src/hooks/useFlowInputs.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { FlowInput } from '../types/execution'

export function useFlowInputs(namespace: string, flowId: string, enabled: boolean) {
  return useQuery<FlowInput[]>({
    queryKey: ['flowInputs', namespace, flowId],
    queryFn: () => api.get(`/api/flows/${namespace}/${flowId}/inputs`).then(r => r.data),
    enabled,
  })
}
```

Create `frontend/src/hooks/useTrigger.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import type { TriggerResponse } from '../types/execution'

export function useTrigger(namespace: string, flowId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (inputs: Record<string, unknown>) =>
      api
        .post<TriggerResponse>(`/api/flows/${namespace}/${flowId}/trigger`, { inputs })
        .then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] })
      queryClient.invalidateQueries({ queryKey: ['flows'] })
    },
  })
}
```

- [ ] **Step 3: Create NavBar**

Create `frontend/src/components/NavBar.tsx`:

```tsx
import { NavLink } from 'react-router-dom'

export function NavBar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-3 text-sm border-b-2 ${
      isActive
        ? 'border-blue-400 text-white'
        : 'border-transparent text-gray-300 hover:text-white hover:border-gray-500'
    }`

  return (
    <nav className="bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto px-6 flex items-center gap-6">
        <div className="font-semibold">Kestra GUI</div>
        <div className="flex items-center gap-1">
          <NavLink to="/" end className={linkClass}>Executions</NavLink>
          <NavLink to="/flows" className={linkClass}>Flows</NavLink>
        </div>
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Run frontend type check**

```bash
cd frontend && npm run build
```

Expected: build completes without TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/execution.ts frontend/src/hooks/useFlows.ts frontend/src/hooks/useFlow.ts frontend/src/hooks/useFlowInputs.ts frontend/src/hooks/useTrigger.ts frontend/src/components/NavBar.tsx
git commit -m "feat: add flow frontend types and hooks"
```

---

## Task 6: TriggerModal TDD

**Files:**
- Create: `frontend/src/components/TriggerModal.test.tsx`
- Create: `frontend/src/components/TriggerModal.tsx`

- [ ] **Step 1: Write failing modal tests**

Create `frontend/src/components/TriggerModal.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TriggerModal } from './TriggerModal'
import type { FlowInput } from '../types/execution'

const mutateAsync = vi.fn().mockResolvedValue({})

vi.mock('../hooks/useTrigger', () => ({
  useTrigger: () => ({
    mutateAsync,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const inputs: FlowInput[] = [
  { id: 'date', type: 'STRING' },
  { id: 'count', type: 'INT' },
  { id: 'flag', type: 'BOOLEAN' },
]

describe('TriggerModal', () => {
  it('renders input controls based on flow input types', () => {
    render(<TriggerModal namespace="prod" flowId="daily" inputs={inputs} onClose={vi.fn()} />)

    expect(screen.getByLabelText('date')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('count')).toHaveAttribute('type', 'number')
    expect(screen.getByLabelText('flag')).toHaveAttribute('type', 'checkbox')
  })

  it('submits entered values and closes on success', async () => {
    const onClose = vi.fn()
    render(<TriggerModal namespace="prod" flowId="daily" inputs={inputs} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('date'), { target: { value: '2026-05-06' } })
    fireEvent.change(screen.getByLabelText('count'), { target: { value: '3' } })
    fireEvent.click(screen.getByLabelText('flag'))
    fireEvent.click(screen.getByText('Trigger'))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ date: '2026-05-06', count: 3, flag: true })
      expect(onClose).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run modal tests to verify RED**

```bash
cd frontend && npx vitest run src/components/TriggerModal.test.tsx
```

Expected: test run fails because `TriggerModal` does not exist.

- [ ] **Step 3: Create TriggerModal**

Create `frontend/src/components/TriggerModal.tsx`:

```tsx
import { useState } from 'react'
import type { FlowInput } from '../types/execution'
import { useTrigger } from '../hooks/useTrigger'

function inputType(type: string): 'text' | 'number' | 'checkbox' {
  if (type === 'INT' || type === 'FLOAT') return 'number'
  if (type === 'BOOLEAN') return 'checkbox'
  return 'text'
}

function toSubmitValue(value: string | boolean, type: string): unknown {
  if (type === 'BOOLEAN') return value === true
  if (type === 'INT' || type === 'FLOAT') return value === '' ? null : Number(value)
  return value
}

interface TriggerModalProps {
  namespace: string
  flowId: string
  inputs: FlowInput[]
  onClose: () => void
}

export function TriggerModal({ namespace, flowId, inputs, onClose }: TriggerModalProps) {
  const trigger = useTrigger(namespace, flowId)
  const [fields, setFields] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(inputs.map(input => [input.id, input.type === 'BOOLEAN' ? false : '']))
  )

  async function handleSubmit() {
    const payload = Object.fromEntries(
      inputs.map(input => [input.id, toSubmitValue(fields[input.id], input.type)])
    )
    try {
      await trigger.mutateAsync(payload)
      onClose()
    } catch {
      // mutation state renders the error below
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Trigger Flow</h2>
        <div className="space-y-1 text-sm mb-4">
          <div><span className="font-medium text-gray-600">Flow:</span> {flowId}</div>
          <div><span className="font-medium text-gray-600">Namespace:</span> {namespace}</div>
        </div>

        <div className="space-y-2 mb-4">
          {inputs.length === 0 && <p className="text-sm text-gray-500">This flow has no inputs.</p>}
          {inputs.map(input => {
            const type = inputType(input.type)
            return (
              <div key={input.id} className="flex items-center gap-2 text-sm">
                <label htmlFor={`flow-input-${input.id}`} className="w-32 text-gray-600 font-medium shrink-0">{input.id}</label>
                {type === 'checkbox' ? (
                  <input
                    id={`flow-input-${input.id}`}
                    aria-label={input.id}
                    type="checkbox"
                    checked={fields[input.id] as boolean}
                    onChange={e => setFields(prev => ({ ...prev, [input.id]: e.target.checked }))}
                    className="h-4 w-4"
                  />
                ) : (
                  <input
                    id={`flow-input-${input.id}`}
                    aria-label={input.id}
                    type={type}
                    value={fields[input.id] as string}
                    onChange={e => setFields(prev => ({ ...prev, [input.id]: e.target.value }))}
                    className="flex-1 border rounded px-2 py-1 text-sm"
                  />
                )}
              </div>
            )
          })}
        </div>

        {trigger.isError && (
          <p className="text-red-600 text-sm mb-3">{trigger.error?.message ?? 'Trigger failed'}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={trigger.isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {trigger.isPending ? 'Triggering...' : 'Trigger'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run modal tests to verify GREEN**

```bash
cd frontend && npx vitest run src/components/TriggerModal.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TriggerModal.test.tsx frontend/src/components/TriggerModal.tsx
git commit -m "feat: add flow trigger modal"
```

---

## Task 7: Flow pages and routing TDD

**Files:**
- Create: `frontend/src/pages/FlowListPage.test.tsx`
- Create: `frontend/src/pages/FlowDetailPage.test.tsx`
- Create: `frontend/src/pages/FlowListPage.tsx`
- Create: `frontend/src/pages/FlowDetailPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/ExecutionListPage.tsx`
- Modify: `frontend/src/pages/ExecutionDetailPage.tsx`

- [ ] **Step 1: Write failing page tests**

Create `frontend/src/pages/FlowListPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FlowListPage } from './FlowListPage'

vi.mock('../hooks/useFlows', () => ({
  useFlows: () => ({
    data: [{ namespace: 'prod', flowId: 'daily', lastRunDate: '2026-05-06T10:00:00Z', executionCount: 2 }],
    isLoading: false,
    error: null,
  }),
}))

describe('FlowListPage', () => {
  it('renders flow rows as links to flow detail', () => {
    render(<MemoryRouter><FlowListPage /></MemoryRouter>)

    expect(screen.getByText('prod')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'daily' })
    expect(link).toHaveAttribute('href', '/flows/prod/daily')
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
```

Create `frontend/src/pages/FlowDetailPage.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FlowDetailPage } from './FlowDetailPage'

vi.mock('../hooks/useFlow', () => ({
  useFlow: () => ({
    data: { namespace: 'prod', flowId: 'daily' },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../hooks/useExecutions', () => ({
  useExecutions: () => ({
    data: {
      results: [{ id: 'exec-1', namespace: 'prod', flowId: 'daily', state: 'SUCCESS', startDate: '2026-05-06T10:00:00Z', endDate: '2026-05-06T10:01:00Z' }],
    },
    isLoading: false,
  }),
}))

vi.mock('../hooks/useFlowInputs', () => ({
  useFlowInputs: () => ({
    data: [{ id: 'date', type: 'STRING' }],
    isLoading: false,
  }),
}))

vi.mock('../components/TriggerModal', () => ({
  TriggerModal: () => <div>Trigger modal open</div>,
}))

describe('FlowDetailPage', () => {
  it('shows flow identity and recent executions', () => {
    render(
      <MemoryRouter initialEntries={['/flows/prod/daily']}>
        <Routes><Route path="/flows/:namespace/:flowId" element={<FlowDetailPage />} /></Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('prod')).toBeInTheDocument()
    expect(screen.getByText('daily')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'exec-1' })).toHaveAttribute('href', '/executions/exec-1')
  })

  it('opens trigger modal from trigger button', () => {
    render(
      <MemoryRouter initialEntries={['/flows/prod/daily']}>
        <Routes><Route path="/flows/:namespace/:flowId" element={<FlowDetailPage />} /></Routes>
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Trigger'))
    expect(screen.getByText('Trigger modal open')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run page tests to verify RED**

```bash
cd frontend && npx vitest run src/pages/FlowListPage.test.tsx src/pages/FlowDetailPage.test.tsx
```

Expected: test run fails because `FlowListPage` and `FlowDetailPage` do not exist.

- [ ] **Step 3: Create FlowListPage**

Create `frontend/src/pages/FlowListPage.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { useFlows } from '../hooks/useFlows'

export function FlowListPage() {
  const { data: flows, isLoading, error } = useFlows()

  if (isLoading) return <><NavBar /><div className="p-6 text-gray-500">Loading...</div></>
  if (error) return <><NavBar /><div className="p-6 text-red-600">Failed to load flows.</div></>

  return (
    <>
      <NavBar />
      <div className="p-6 space-y-4 max-w-6xl mx-auto">
        <h1 className="text-2xl font-semibold">Flows</h1>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Namespace</th>
                <th className="px-4 py-2 text-left">Flow</th>
                <th className="px-4 py-2 text-left">Last run</th>
                <th className="px-4 py-2 text-left">Executions</th>
              </tr>
            </thead>
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
          </table>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Create FlowDetailPage**

Create `frontend/src/pages/FlowDetailPage.tsx`:

```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { NavBar } from '../components/NavBar'
import { StatusBadge } from '../components/StatusBadge'
import { TriggerModal } from '../components/TriggerModal'
import { useExecutions } from '../hooks/useExecutions'
import { useFlow } from '../hooks/useFlow'
import { useFlowInputs } from '../hooks/useFlowInputs'

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '-'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function FlowDetailPage() {
  const { namespace, flowId } = useParams<{ namespace: string; flowId: string }>()
  const [showTrigger, setShowTrigger] = useState(false)
  const { data: flow, isLoading, error } = useFlow(namespace, flowId)
  const { data: executions, isLoading: executionsLoading } = useExecutions({ namespace, flowId, size: 20 })
  const { data: inputs, isLoading: inputsLoading } = useFlowInputs(namespace!, flowId!, showTrigger)

  if (isLoading) return <><NavBar /><div className="p-6 text-gray-500">Loading...</div></>
  if (error || !flow) return <><NavBar /><div className="p-6 text-red-600">Flow not found.</div></>

  return (
    <>
      <NavBar />
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <Link to="/flows" className="text-blue-600 text-sm hover:underline">← Flows</Link>
          <span className="text-gray-300">/</span>
          <span>{flow.namespace}</span>
          <span className="text-gray-300">/</span>
          <span className="font-medium">{flow.flowId}</span>
          <button
            onClick={() => setShowTrigger(true)}
            className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            Trigger
          </button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b">
            <h2 className="font-semibold text-sm">Recent Executions</h2>
          </div>
          {executionsLoading ? (
            <div className="p-5 text-sm text-gray-500">Loading...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase tracking-wide">
                <tr className="border-b">
                  <th className="px-4 py-2 text-left">ID</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Start</th>
                  <th className="px-4 py-2 text-left">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(executions?.results ?? []).map(execution => (
                  <tr key={execution.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <Link to={`/executions/${execution.id}`} className="text-blue-600 hover:underline">{execution.id}</Link>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge state={execution.state} /></td>
                    <td className="px-4 py-2.5 text-gray-500">{execution.startDate ? new Date(execution.startDate).toLocaleString() : '-'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{formatDuration(execution.startDate, execution.endDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showTrigger && (
          inputsLoading ? (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 shadow-xl text-sm text-gray-500">Loading inputs...</div>
            </div>
          ) : (
            <TriggerModal namespace={flow.namespace} flowId={flow.flowId} inputs={inputs ?? []} onClose={() => setShowTrigger(false)} />
          )
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 5: Add routes to App**

In `frontend/src/App.tsx`, import pages:

```ts
import { FlowListPage } from './pages/FlowListPage'
import { FlowDetailPage } from './pages/FlowDetailPage'
```

Add routes before the wildcard route:

```tsx
<Route path="/flows" element={<ProtectedRoute><FlowListPage /></ProtectedRoute>} />
<Route path="/flows/:namespace/:flowId" element={<ProtectedRoute><FlowDetailPage /></ProtectedRoute>} />
```

- [ ] **Step 6: Add NavBar to existing execution pages**

In `frontend/src/pages/ExecutionListPage.tsx` and `frontend/src/pages/ExecutionDetailPage.tsx`, import:

```ts
import { NavBar } from '../components/NavBar'
```

Render `<NavBar />` before each page's main content. For early loading/error returns, wrap the existing content in a fragment with `<NavBar />` first.

- [ ] **Step 7: Run page tests to verify GREEN**

```bash
cd frontend && npx vitest run src/pages/FlowListPage.test.tsx src/pages/FlowDetailPage.test.tsx
```

Expected: all tests pass.

- [ ] **Step 8: Run full frontend tests and build**

```bash
cd frontend && npm test -- --run
cd frontend && npm run build
```

Expected: tests pass and production build completes.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/FlowListPage.test.tsx frontend/src/pages/FlowDetailPage.test.tsx frontend/src/pages/FlowListPage.tsx frontend/src/pages/FlowDetailPage.tsx frontend/src/App.tsx frontend/src/pages/ExecutionListPage.tsx frontend/src/pages/ExecutionDetailPage.tsx
git commit -m "feat: add flows pages and routes"
```

---

## Done

Run final verification:

```bash
cd backend && ./mvnw test
cd frontend && npm test -- --run
cd frontend && npm run build
```

Expected: all commands complete successfully. Then manually start the backend and frontend dev servers and verify:

```bash
cd backend && ./mvnw compile quarkus:dev
cd frontend && npm run dev
```

Open `/flows`, click a flow, open Trigger, submit a small input payload, and confirm the new execution appears in the recent executions table after query invalidation.
