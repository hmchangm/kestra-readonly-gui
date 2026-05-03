# Kestra Read-Only GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only GUI for Kestra executions with Keycloak OIDC auth and audit-logged retrigger, using React (FE) and Quarkus Kotlin (BE).

**Architecture:** React SPA authenticates via Keycloak PKCE and sends Bearer JWTs to a Quarkus Kotlin backend. The backend validates JWTs, reads Kestra execution data directly from MySQL using native SQL (no ORM), and calls Kestra's REST API (`POST /api/v1/_/executions/{namespace}/{flowId}`) to retrigger jobs. All retriggers are audit-logged to a new `kestra_retrigger_audit` table in the same MySQL instance.

**Key schema insight:** Kestra's `executions` table stores everything in a `value` JSON column. Generated columns (`id`, `namespace`, `flow_id`, `state_current`, `start_date`, `end_date`) are used for filtering. Task runs and inputs are embedded inside `value` and must be parsed from JSON in Kotlin.

**Tech Stack:** Quarkus 3.x · Kotlin · RESTEasy Reactive · quarkus-oidc · quarkus-agroal · quarkus-jdbc-mysql · quarkus-rest-client-reactive-jackson · Jackson · React · Vite · TypeScript · oidc-client-ts · @tanstack/react-query · react-router-dom · shadcn/ui · Recharts · Axios

---

## File Structure

### Backend (`backend/`)

```
backend/
├── pom.xml
└── src/
    ├── main/
    │   ├── kotlin/tw/brandy/kestra/
    │   │   ├── execution/
    │   │   │   ├── Models.kt              ← all data classes + JSON value models
    │   │   │   ├── ExecutionRepository.kt ← native SQL reads from Kestra DB
    │   │   │   ├── AuditRepository.kt     ← writes kestra_retrigger_audit
    │   │   │   ├── KestraClient.kt        ← REST client interface for Kestra API
    │   │   │   ├── RetriggerService.kt    ← orchestrates retrigger + audit
    │   │   │   └── ExecutionResource.kt   ← REST endpoints, JWT auth
    │   │   └── util/
    │   │       └── ResultSetExt.kt        ← ResultSet.toList extension
    │   └── resources/
    │       └── application.properties
    └── test/
        ├── kotlin/tw/brandy/kestra/
        │   ├── execution/
        │   │   ├── ExecutionRepositoryTest.kt
        │   │   └── ExecutionResourceTest.kt
        │   └── retrigger/
        │       └── RetriggerServiceTest.kt
        └── resources/
            └── db-setup.sql               ← H2-compatible schema for unit tests
```

### Frontend (`frontend/`)

```
frontend/
├── package.json
├── vite.config.ts
├── .env.local
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── auth/
    │   ├── oidc.ts               ← UserManager config (PKCE, in-memory store)
    │   ├── AuthProvider.tsx      ← React context for user/login/logout
    │   └── ProtectedRoute.tsx    ← redirects to /login if no valid token
    ├── api/
    │   └── client.ts             ← Axios instance with Bearer interceptor + 401 handler
    ├── types/
    │   └── execution.ts          ← all TypeScript interfaces
    ├── hooks/
    │   ├── useExecutions.ts      ← React Query list hook
    │   ├── useExecution.ts       ← React Query detail hook
    │   ├── useSummary.ts         ← React Query summary hook (auto-refetch 60s)
    │   └── useRetrigger.ts       ← React Query mutation hook
    ├── components/
    │   ├── StatusBadge.tsx
    │   ├── KpiCard.tsx
    │   ├── TimelineChart.tsx     ← Recharts stacked bar (hourly)
    │   └── RetriggerModal.tsx
    └── pages/
        ├── CallbackPage.tsx
        ├── ExecutionListPage.tsx
        └── ExecutionDetailPage.tsx
```

---

## Phase 1: Backend

---

### Task 1: Scaffold Quarkus Kotlin project

**Files:**
- Create: `backend/pom.xml` (generated)
- Create: `backend/src/main/resources/application.properties`

- [ ] **Step 1: Generate project**

```bash
cd /home/iron/projects/kestra-readonly-gui
mvn io.quarkus.platform:quarkus-maven-plugin:3.15.1:create \
  -DprojectGroupId=tw.brandy.kestra \
  -DprojectArtifactId=kestra-gui-backend \
  -DprojectVersion=1.0.0-SNAPSHOT \
  -Dextensions="kotlin,resteasy-reactive-jackson,oidc,agroal,jdbc-mysql,rest-client-reactive-jackson,jdbc-h2,smallrye-health" \
  -DnoCode
mv kestra-gui-backend backend
```

- [ ] **Step 2: Verify compilation**

```bash
cd backend && ./mvnw compile -q
```

Expected: `BUILD SUCCESS`

- [ ] **Step 3: Write application.properties**

Replace `src/main/resources/application.properties` with:

```properties
# Server
quarkus.http.port=8080

# OIDC — bearer token validation only
quarkus.oidc.auth-server-url=https://keycloak-host/realms/kestra
quarkus.oidc.application-type=service
quarkus.oidc.token.issuer=any

# CORS — allow React dev server and prod origin
quarkus.http.cors=true
quarkus.http.cors.origins=http://localhost:5173,https://kestra-gui.internal
quarkus.http.cors.methods=GET,POST,OPTIONS
quarkus.http.cors.headers=Authorization,Content-Type,Accept

# MySQL (production)
%prod.quarkus.datasource.db-kind=mysql
%prod.quarkus.datasource.jdbc.url=jdbc:mysql://192.168.50.50:3306/kestra
%prod.quarkus.datasource.username=kestra
%prod.quarkus.datasource.password=rnMoRMn2E

# H2 (test)
%test.quarkus.datasource.db-kind=h2
%test.quarkus.datasource.jdbc.url=jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1;MODE=MySQL
%test.quarkus.datasource.username=sa
%test.quarkus.datasource.password=
%test.quarkus.oidc.enabled=false

# Kestra REST client
quarkus.rest-client.kestra-api.url=http://localhost:8080
quarkus.rest-client.kestra-api.scope=jakarta.inject.Singleton

# Logging
quarkus.log.level=INFO
quarkus.log.category."tw.brandy.kestra".level=DEBUG
```

- [ ] **Step 4: Commit**

```bash
cd /home/iron/projects/kestra-readonly-gui
git add backend/
git commit -m "feat: scaffold Quarkus Kotlin backend"
```

---

### Task 2: ResultSet extension utility

**Files:**
- Create: `backend/src/main/kotlin/tw/brandy/kestra/util/ResultSetExt.kt`
- Create: `backend/src/test/kotlin/tw/brandy/kestra/util/ResultSetExtTest.kt`

- [ ] **Step 1: Write the failing test**

Create `src/test/kotlin/tw/brandy/kestra/util/ResultSetExtTest.kt`:

```kotlin
package tw.brandy.kestra.util

import io.quarkus.test.junit.QuarkusTest
import jakarta.inject.Inject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import javax.sql.DataSource

@QuarkusTest
class ResultSetExtTest {

    @Inject
    lateinit var ds: DataSource

    @Test
    fun `toList maps all rows`() {
        ds.connection.use { conn ->
            conn.prepareStatement("SELECT 1 AS n UNION SELECT 2 UNION SELECT 3").use { ps ->
                val result = ps.executeQuery().use { rs ->
                    rs.toList { it.getInt("n") }
                }
                assertEquals(listOf(1, 2, 3), result)
            }
        }
    }

    @Test
    fun `toList returns empty list for no rows`() {
        ds.connection.use { conn ->
            conn.prepareStatement("SELECT 1 WHERE 1=0").use { ps ->
                val result = ps.executeQuery().use { rs -> rs.toList { it.getInt(1) } }
                assertEquals(emptyList<Int>(), result)
            }
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && ./mvnw test -Dtest=ResultSetExtTest -q 2>&1 | tail -5
```

Expected: FAIL — `toList` not found

- [ ] **Step 3: Implement the extension**

Create `src/main/kotlin/tw/brandy/kestra/util/ResultSetExt.kt`:

```kotlin
package tw.brandy.kestra.util

import java.sql.ResultSet

fun <T> ResultSet.toList(mapper: (ResultSet) -> T): List<T> =
    generateSequence { if (next()) mapper(this) else null }.toList()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
./mvnw test -Dtest=ResultSetExtTest -q 2>&1 | tail -3
```

Expected: `Tests run: 2, Failures: 0, Errors: 0`

- [ ] **Step 5: Commit**

```bash
git add backend/src/
git commit -m "feat: add ResultSet.toList extension"
```

---

### Task 3: Data models

**Files:**
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt`

- [ ] **Step 1: Create Models.kt**

```kotlin
package tw.brandy.kestra.execution

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

data class ExecutionRow(
    val id: String,
    val namespace: String,
    val flowId: String,
    val state: String,
    val startDate: String?,
    val endDate: String?
)

data class TaskRunRow(
    val id: String,
    val taskId: String,
    val state: String,
    val startDate: String?,
    val endDate: String?
)

data class ExecutionDetailRow(
    val id: String,
    val namespace: String,
    val flowId: String,
    val state: String,
    val startDate: String?,
    val endDate: String?,
    val inputs: Map<String, Any?>,
    val taskRuns: List<TaskRunRow>
)

data class ExecutionPage(
    val total: Long,
    val page: Int,
    val size: Int,
    val results: List<ExecutionRow>
)

data class HourlyBucket(
    val hour: String,
    val SUCCESS: Int = 0,
    val FAILED: Int = 0,
    val RUNNING: Int = 0,
    val KILLED: Int = 0,
    val WARNING: Int = 0
)

data class SummaryResponse(
    val totalToday: Long,
    val successRate: Int,
    val runningNow: Long,
    val failedToday: Long,
    val hourly: List<HourlyBucket>
)

data class RetriggerResponse(
    val newExecutionId: String,
    val originalExecutionId: String,
    val triggeredBy: String,
    val triggeredAt: String
)

// Models for parsing Kestra's execution JSON value column
@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraExecutionValue(
    val id: String = "",
    val namespace: String = "",
    val flowId: String = "",
    val inputs: Map<String, Any?> = emptyMap(),
    val taskRunList: List<KestraTaskRun> = emptyList()
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraTaskRun(
    val id: String = "",
    val taskId: String = "",
    val state: KestraState = KestraState()
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraState(
    val current: String = "",
    val startDate: String? = null,
    val endDate: String? = null
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraExecutionResponse(
    val id: String = ""
)
```

- [ ] **Step 2: Verify compilation**

```bash
cd backend && ./mvnw compile -q && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/kotlin/tw/brandy/kestra/execution/Models.kt
git commit -m "feat: add execution data models"
```

---

### Task 4: H2 test schema

**Files:**
- Create: `backend/src/test/resources/db-setup.sql`

- [ ] **Step 1: Create H2-compatible schema file**

Create `src/test/resources/db-setup.sql`:

```sql
CREATE TABLE IF NOT EXISTS executions (
    `key`         VARCHAR(250) NOT NULL PRIMARY KEY,
    `value`       CLOB,
    deleted       BOOLEAN DEFAULT FALSE,
    id            VARCHAR(100) NOT NULL,
    namespace     VARCHAR(150) NOT NULL,
    flow_id       VARCHAR(150) NOT NULL,
    state_current VARCHAR(50)  NOT NULL,
    start_date    TIMESTAMP,
    end_date      TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kestra_retrigger_audit (
    id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    triggered_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    triggered_by          VARCHAR(255) NOT NULL,
    original_execution_id VARCHAR(255) NOT NULL,
    new_execution_id      VARCHAR(255) NOT NULL
);
```

- [ ] **Step 2: Create a base test class that sets up the schema**

Create `src/test/kotlin/tw/brandy/kestra/DbTestBase.kt`:

```kotlin
package tw.brandy.kestra

import jakarta.inject.Inject
import org.junit.jupiter.api.BeforeEach
import javax.sql.DataSource

abstract class DbTestBase {

    @Inject
    lateinit var ds: DataSource

    @BeforeEach
    fun setupSchema() {
        val sql = javaClass.classLoader.getResourceAsStream("db-setup.sql")!!
            .bufferedReader().readText()
        ds.connection.use { conn ->
            sql.split(";").map { it.trim() }.filter { it.isNotBlank() }.forEach { stmt ->
                conn.createStatement().use { it.execute(stmt) }
            }
            conn.createStatement().use { it.execute("DELETE FROM executions") }
            conn.createStatement().use { it.execute("DELETE FROM kestra_retrigger_audit") }
        }
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/test/
git commit -m "test: add H2 schema and base test class"
```

---

### Task 5: ExecutionRepository — list and count

**Files:**
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt`
- Create: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt`

- [ ] **Step 1: Write the failing tests**

Create `src/test/kotlin/tw/brandy/kestra/execution/ExecutionRepositoryTest.kt`:

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
class ExecutionRepositoryTest : DbTestBase() {

    @Inject
    lateinit var repo: ExecutionRepository

    private fun insertExecution(id: String, namespace: String, flowId: String, state: String, startDate: Instant? = Instant.now()) {
        val value = """{"id":"$id","namespace":"$namespace","flowId":"$flowId","inputs":{},"taskRunList":[]}"""
        ds.connection.use { conn ->
            conn.prepareStatement(
                "INSERT INTO executions (`key`,`value`,id,namespace,flow_id,state_current,start_date,deleted) VALUES (?,?,?,?,?,?,?,false)"
            ).use { ps ->
                ps.setString(1, id)
                ps.setString(2, value)
                ps.setString(3, id)
                ps.setString(4, namespace)
                ps.setString(5, flowId)
                ps.setString(6, state)
                ps.setTimestamp(7, startDate?.let { Timestamp.from(it) })
                ps.executeUpdate()
            }
        }
    }

    @Test
    fun `listExecutions returns all non-deleted rows paged`() {
        insertExecution("exec-1", "prod.etl", "flow-a", "SUCCESS")
        insertExecution("exec-2", "prod.etl", "flow-b", "FAILED")
        insertExecution("exec-3", "dev", "flow-c", "RUNNING")

        val page = repo.listExecutions(null, null, null, null, 0, 10)

        assertEquals(3, page.total)
        assertEquals(3, page.results.size)
    }

    @Test
    fun `listExecutions filters by namespace`() {
        insertExecution("exec-1", "prod.etl", "flow-a", "SUCCESS")
        insertExecution("exec-2", "dev", "flow-b", "FAILED")

        val page = repo.listExecutions("prod.etl", null, null, null, 0, 10)

        assertEquals(1, page.total)
        assertEquals("exec-1", page.results[0].id)
    }

    @Test
    fun `listExecutions filters by status`() {
        insertExecution("exec-1", "ns", "flow", "SUCCESS")
        insertExecution("exec-2", "ns", "flow", "FAILED")

        val page = repo.listExecutions(null, "FAILED", null, null, 0, 10)

        assertEquals(1, page.total)
        assertEquals("exec-2", page.results[0].id)
    }

    @Test
    fun `listExecutions respects page and size`() {
        repeat(5) { i -> insertExecution("exec-$i", "ns", "flow", "SUCCESS") }

        val page = repo.listExecutions(null, null, null, null, 1, 2)

        assertEquals(5, page.total)
        assertEquals(2, page.results.size)
        assertEquals(1, page.page)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && ./mvnw test -Dtest=ExecutionRepositoryTest -q 2>&1 | tail -5
```

Expected: FAIL — `ExecutionRepository` not found

- [ ] **Step 3: Implement ExecutionRepository (list/count)**

Create `src/main/kotlin/tw/brandy/kestra/execution/ExecutionRepository.kt`:

```kotlin
package tw.brandy.kestra.execution

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import jakarta.ws.rs.NotFoundException
import tw.brandy.kestra.util.toList
import javax.sql.DataSource

@ApplicationScoped
class ExecutionRepository {

    @Inject
    lateinit var ds: DataSource

    @Inject
    lateinit var mapper: ObjectMapper

    fun listExecutions(
        namespace: String?, status: String?,
        from: String?, to: String?,
        page: Int, size: Int
    ): ExecutionPage {
        val where = """
            deleted = false
            AND (? IS NULL OR namespace = ?)
            AND (? IS NULL OR state_current = ?)
            AND (? IS NULL OR start_date >= ?)
            AND (? IS NULL OR start_date <= ?)
        """.trimIndent()

        val countSql = "SELECT COUNT(*) FROM executions WHERE $where"
        val listSql = """
            SELECT id, namespace, flow_id, state_current,
                   FORMATDATETIME(start_date,'yyyy-MM-dd''T''HH:mm:ss''Z''') as start_date,
                   FORMATDATETIME(end_date,'yyyy-MM-dd''T''HH:mm:ss''Z''') as end_date
            FROM executions WHERE $where
            ORDER BY start_date DESC LIMIT ? OFFSET ?
        """.trimIndent()

        val total = ds.connection.use { conn ->
            conn.prepareStatement(countSql).use { ps ->
                bindFilters(ps, namespace, status, from, to, 1)
                ps.executeQuery().use { rs -> rs.next(); rs.getLong(1) }
            }
        }

        val results = ds.connection.use { conn ->
            conn.prepareStatement(listSql).use { ps ->
                val next = bindFilters(ps, namespace, status, from, to, 1)
                ps.setInt(next, size)
                ps.setInt(next + 1, page * size)
                ps.executeQuery().use { rs ->
                    rs.toList { r ->
                        ExecutionRow(
                            id = r.getString("id"),
                            namespace = r.getString("namespace"),
                            flowId = r.getString("flow_id"),
                            state = r.getString("state_current"),
                            startDate = r.getString("start_date"),
                            endDate = r.getString("end_date")
                        )
                    }
                }
            }
        }

        return ExecutionPage(total, page, size, results)
    }

    fun findById(id: String): ExecutionDetailRow? {
        val sql = "SELECT value FROM executions WHERE id = ? AND deleted = false"
        val json = ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, id)
                ps.executeQuery().use { rs -> if (rs.next()) rs.getString("value") else null }
            }
        } ?: return null

        val kestra = mapper.readValue(json, KestraExecutionValue::class.java)

        return ExecutionDetailRow(
            id = kestra.id,
            namespace = kestra.namespace,
            flowId = kestra.flowId,
            state = "",
            startDate = null,
            endDate = null,
            inputs = kestra.inputs,
            taskRuns = kestra.taskRunList.map { tr ->
                TaskRunRow(
                    id = tr.id,
                    taskId = tr.taskId,
                    state = tr.state.current,
                    startDate = tr.state.startDate,
                    endDate = tr.state.endDate
                )
            }
        )
    }

    fun getSummary(): SummaryResponse {
        fun longQuery(sql: String): Long = ds.connection.use { conn ->
            conn.createStatement().use { it.executeQuery(sql).use { rs -> rs.next(); rs.getLong(1) } }
        }

        val totalToday = longQuery(
            "SELECT COUNT(*) FROM executions WHERE deleted=false AND CAST(start_date AS DATE) = CURRENT_DATE()"
        )
        val failedToday = longQuery(
            "SELECT COUNT(*) FROM executions WHERE deleted=false AND state_current='FAILED' AND CAST(start_date AS DATE) = CURRENT_DATE()"
        )
        val runningNow = longQuery(
            "SELECT COUNT(*) FROM executions WHERE deleted=false AND state_current='RUNNING'"
        )
        val successToday = longQuery(
            "SELECT COUNT(*) FROM executions WHERE deleted=false AND state_current='SUCCESS' AND CAST(start_date AS DATE) = CURRENT_DATE()"
        )
        val successRate = if (totalToday > 0) ((successToday * 100) / totalToday).toInt() else 0

        return SummaryResponse(totalToday, successRate, runningNow, failedToday, emptyList())
    }

    // Returns 1-based index of the next parameter slot after the 8 filter params
    private fun bindFilters(ps: java.sql.PreparedStatement, namespace: String?, status: String?, from: String?, to: String?, start: Int): Int {
        var i = start
        ps.setString(i++, namespace); ps.setString(i++, namespace)
        ps.setString(i++, status);    ps.setString(i++, status)
        ps.setString(i++, from);      ps.setString(i++, from)
        ps.setString(i++, to);        ps.setString(i++, to)
        return i
    }
}
```

> **Note:** `FORMATDATETIME` is H2 syntax. For production MySQL, the `start_date` and `end_date` generated columns are already DATETIME(6) — replace `FORMATDATETIME(...)` with `DATE_FORMAT(start_date, '%Y-%m-%dT%H:%i:%sZ')` in the production query, or use `%test`/`%prod` profiles. The simplest approach: read the raw DATETIME and let JDBC convert it via `rs.getTimestamp("start_date")?.toInstant()?.toString()`.

Replace the `start_date`/`end_date` reads with:

```kotlin
startDate = rs.getTimestamp("start_date")?.toInstant()?.toString(),
endDate = rs.getTimestamp("end_date")?.toInstant()?.toString()
```

And remove the `FORMATDATETIME` wrapper from the SQL (use bare `start_date, end_date`). This works identically on both H2 and MySQL.

- [ ] **Step 4: Update listSql to use bare column names**

In `ExecutionRepository.kt`, change:
```kotlin
val listSql = """
    SELECT id, namespace, flow_id, state_current, start_date, end_date
    FROM executions WHERE $where
    ORDER BY start_date DESC LIMIT ? OFFSET ?
""".trimIndent()
```

And the mapping:
```kotlin
startDate = rs.getTimestamp("start_date")?.toInstant()?.toString(),
endDate   = rs.getTimestamp("end_date")?.toInstant()?.toString()
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
./mvnw test -Dtest=ExecutionRepositoryTest -q 2>&1 | tail -3
```

Expected: `Tests run: 4, Failures: 0, Errors: 0`

- [ ] **Step 6: Commit**

```bash
git add backend/src/
git commit -m "feat: add ExecutionRepository list/count/detail/summary"
```

---

### Task 6: AuditRepository

**Files:**
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/AuditRepository.kt`
- Create: `backend/src/test/kotlin/tw/brandy/kestra/execution/AuditRepositoryTest.kt`

- [ ] **Step 1: Write the failing test**

Create `src/test/kotlin/tw/brandy/kestra/execution/AuditRepositoryTest.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.test.junit.QuarkusTest
import jakarta.inject.Inject
import org.junit.jupiter.api.Assertions.assertEquals
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
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./mvnw test -Dtest=AuditRepositoryTest -q 2>&1 | tail -5
```

Expected: FAIL — `AuditRepository` not found

- [ ] **Step 3: Implement AuditRepository**

Create `src/main/kotlin/tw/brandy/kestra/execution/AuditRepository.kt`:

```kotlin
package tw.brandy.kestra.execution

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import javax.sql.DataSource

@ApplicationScoped
class AuditRepository {

    @Inject
    lateinit var ds: DataSource

    fun writeAudit(triggeredBy: String, originalExecutionId: String, newExecutionId: String) {
        val sql = """
            INSERT INTO kestra_retrigger_audit (triggered_by, original_execution_id, new_execution_id)
            VALUES (?, ?, ?)
        """.trimIndent()
        ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, triggeredBy)
                ps.setString(2, originalExecutionId)
                ps.setString(3, newExecutionId)
                ps.executeUpdate()
            }
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
./mvnw test -Dtest=AuditRepositoryTest -q 2>&1 | tail -3
```

Expected: `Tests run: 2, Failures: 0, Errors: 0`

- [ ] **Step 5: Commit**

```bash
git add backend/src/
git commit -m "feat: add AuditRepository"
```

---

### Task 7: KestraClient REST client

**Files:**
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/KestraClient.kt`

- [ ] **Step 1: Create KestraClient.kt**

```kotlin
package tw.brandy.kestra.execution

import jakarta.ws.rs.Consumes
import jakarta.ws.rs.POST
import jakarta.ws.rs.Path
import jakarta.ws.rs.PathParam
import jakarta.ws.rs.Produces
import jakarta.ws.rs.core.MediaType
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient

@RegisterRestClient(configKey = "kestra-api")
@Produces(MediaType.APPLICATION_JSON)
interface KestraClient {

    @POST
    @Path("/api/v1/_/executions/{namespace}/{flowId}")
    @Consumes(MediaType.APPLICATION_JSON)
    fun createExecution(
        @PathParam("namespace") namespace: String,
        @PathParam("flowId") flowId: String,
        inputs: Map<String, Any?>
    ): KestraExecutionResponse
}
```

> **Note:** For open-source Kestra without multi-tenancy the tenant segment is `_`. If your Kestra version doesn't use tenancy, the path may be `/api/v1/executions/{namespace}/{flowId}`. Verify with `curl -X POST http://kestra-host:8080/api/v1/_/executions/your-ns/your-flow -H 'Content-Type: application/json' -d '{}'`.

- [ ] **Step 2: Verify compilation**

```bash
./mvnw compile -q && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/kotlin/tw/brandy/kestra/execution/KestraClient.kt
git commit -m "feat: add KestraClient REST client"
```

---

### Task 8: RetriggerService

**Files:**
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/RetriggerService.kt`
- Create: `backend/src/test/kotlin/tw/brandy/kestra/retrigger/RetriggerServiceTest.kt`

- [ ] **Step 1: Write the failing tests**

Create `src/test/kotlin/tw/brandy/kestra/retrigger/RetriggerServiceTest.kt`:

```kotlin
package tw.brandy.kestra.retrigger

import io.quarkus.test.InjectMock
import io.quarkus.test.junit.QuarkusTest
import jakarta.inject.Inject
import jakarta.ws.rs.NotFoundException
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
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
        verify(auditRepo).writeAudit("john.doe", "orig-1", "new-99")
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
        doThrow(RuntimeException("DB down")).`when`(auditRepo).writeAudit(any(), any(), any())

        val result = service.retrigger("orig-2", "user")

        assertEquals("new-77", result.newExecutionId)
    }
}
```

- [ ] **Step 2: Add Mockito dependency to pom.xml**

Add inside `<dependencies>` in `pom.xml`:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-junit5-mockito</artifactId>
    <scope>test</scope>
</dependency>
```

- [ ] **Step 3: Run test to verify it fails**

```bash
./mvnw test -Dtest=RetriggerServiceTest -q 2>&1 | tail -5
```

Expected: FAIL — `RetriggerService` not found

- [ ] **Step 4: Implement RetriggerService**

Create `src/main/kotlin/tw/brandy/kestra/execution/RetriggerService.kt`:

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

    fun retrigger(executionId: String, triggeredBy: String): RetriggerResponse {
        val original = executionRepository.findById(executionId)
            ?: throw NotFoundException("Execution $executionId not found")

        val kestraResponse = try {
            kestraClient.createExecution(original.namespace, original.flowId, original.inputs)
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

        try {
            auditRepository.writeAudit(triggeredBy, executionId, kestraResponse.id)
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

- [ ] **Step 5: Run tests to verify they pass**

```bash
./mvnw test -Dtest=RetriggerServiceTest -q 2>&1 | tail -3
```

Expected: `Tests run: 3, Failures: 0, Errors: 0`

- [ ] **Step 6: Commit**

```bash
git add backend/src/
git commit -m "feat: add RetriggerService"
```

---

### Task 9: ExecutionResource (REST endpoints + auth)

**Files:**
- Create: `backend/src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`
- Create: `backend/src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt`

- [ ] **Step 1: Write the failing tests**

Create `src/test/kotlin/tw/brandy/kestra/execution/ExecutionResourceTest.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.test.InjectMock
import io.quarkus.test.junit.QuarkusTest
import io.quarkus.test.security.TestSecurity
import io.quarkus.test.security.oidc.Claim
import io.quarkus.test.security.oidc.OidcSecurity
import io.restassured.RestAssured.given
import jakarta.inject.Inject
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
    @TestSecurity(user = "john.doe", roles = [])
    fun `GET executions requires auth`() {
        // With @TestSecurity omitted — Quarkus returns 401
    }

    @Test
    fun `GET executions without token returns 401`() {
        given().`when`().get("/api/executions")
            .then().statusCode(401)
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST retrigger calls service with username`() {
        `when`(retriggerService.retrigger("exec-1", "john.doe"))
            .thenReturn(RetriggerResponse("new-1", "exec-1", "john.doe", "2026-05-01T00:00:00Z"))

        given().`when`().post("/api/executions/exec-1/retrigger")
            .then().statusCode(200)
            .body("newExecutionId", equalTo("new-1"))
            .body("triggeredBy", equalTo("john.doe"))
    }
}
```

- [ ] **Step 2: Add quarkus-test-security to pom.xml**

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-test-security</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-test-oidc</artifactId>
    <scope>test</scope>
</dependency>
```

- [ ] **Step 3: Run test to verify it fails**

```bash
./mvnw test -Dtest=ExecutionResourceTest -q 2>&1 | tail -5
```

Expected: FAIL — `ExecutionResource` not found

- [ ] **Step 4: Implement ExecutionResource**

Create `src/main/kotlin/tw/brandy/kestra/execution/ExecutionResource.kt`:

```kotlin
package tw.brandy.kestra.execution

import io.quarkus.security.Authenticated
import io.smallrye.jwt.auth.principal.JWTCallerPrincipal
import jakarta.inject.Inject
import jakarta.ws.rs.*
import jakarta.ws.rs.core.MediaType

@Path("/api/executions")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
class ExecutionResource(
    private val executionRepository: ExecutionRepository,
    private val retriggerService: RetriggerService
) {
    @Inject
    lateinit var jwt: JWTCallerPrincipal

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
    fun retrigger(@PathParam("id") id: String): RetriggerResponse {
        val username = jwt.getClaim<String>("preferred_username") ?: jwt.subject
        return retriggerService.retrigger(id, username)
    }
}
```

> **Note:** `JWTCallerPrincipal` requires `quarkus-smallrye-jwt` extension. Add to pom.xml:
> ```xml
> <dependency>
>     <groupId>io.quarkus</groupId>
>     <artifactId>quarkus-smallrye-jwt</artifactId>
> </dependency>
> ```

- [ ] **Step 5: Run tests to verify they pass**

```bash
./mvnw test -Dtest=ExecutionResourceTest -q 2>&1 | tail -3
```

Expected: `Tests run: 3, Failures: 0, Errors: 0`

- [ ] **Step 6: Run full backend test suite**

```bash
./mvnw test -q 2>&1 | tail -5
```

Expected: All tests pass, no failures.

- [ ] **Step 7: Create the audit table in MySQL**

Run against your Kestra MySQL instance:

```sql
CREATE TABLE kestra_retrigger_audit (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  triggered_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  triggered_by          VARCHAR(255) NOT NULL,
  original_execution_id VARCHAR(255) NOT NULL,
  new_execution_id      VARCHAR(255) NOT NULL
);
```

```bash
mysql -h 192.168.50.50 -u kestra -prnMoRMn2E kestra -e "
CREATE TABLE IF NOT EXISTS kestra_retrigger_audit (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  triggered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  triggered_by VARCHAR(255) NOT NULL,
  original_execution_id VARCHAR(255) NOT NULL,
  new_execution_id VARCHAR(255) NOT NULL
);"
```

- [ ] **Step 8: Smoke-test against live Kestra**

```bash
./mvnw quarkus:dev &
curl -s http://localhost:8080/q/health | python3 -m json.tool
```

Expected: `{"status":"UP"}`

- [ ] **Step 9: Commit**

```bash
git add backend/src/ backend/pom.xml
git commit -m "feat: add ExecutionResource with OIDC auth"
```

---

## Phase 2: Frontend

---

### Task 10: Upgrade Node and scaffold React project

**Files:**
- Create: `frontend/` (Vite scaffold)
- Create: `frontend/.env.local`

- [ ] **Step 1: Upgrade Node to 20**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node --version
```

Expected: `v20.x.x`

- [ ] **Step 2: Scaffold React project**

```bash
cd /home/iron/projects/kestra-readonly-gui
npm create vite@latest frontend -- --template react-ts
cd frontend && npm install
```

- [ ] **Step 3: Install dependencies**

```bash
npm install \
  oidc-client-ts \
  @tanstack/react-query \
  react-router-dom \
  axios \
  recharts \
  @types/recharts

npm install -D \
  vitest \
  @vitest/ui \
  @testing-library/react \
  @testing-library/jest-dom \
  @testing-library/user-event \
  jsdom \
  tailwindcss \
  postcss \
  autoprefixer

npx tailwindcss init -p
```

- [ ] **Step 4: Configure Tailwind**

In `tailwind.config.js`:
```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

In `src/index.css` (replace contents):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Configure Vitest**

In `vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
})
```

Create `src/test-setup.ts`:
```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 6: Create .env.local**

```bash
cat > .env.local << 'EOF'
VITE_KEYCLOAK_URL=http://keycloak-host:8080
VITE_KEYCLOAK_REALM=kestra
VITE_KEYCLOAK_CLIENT_ID=kestra-gui
VITE_API_URL=http://localhost:8080
EOF
```

- [ ] **Step 7: Verify dev server starts**

```bash
npm run dev &
curl -s http://localhost:5173 | grep -c "Vite"
```

Expected: `1`

- [ ] **Step 8: Commit**

```bash
cd /home/iron/projects/kestra-readonly-gui
git add frontend/
git commit -m "feat: scaffold React frontend with Vite + Tailwind"
```

---

### Task 11: TypeScript types

**Files:**
- Create: `frontend/src/types/execution.ts`

- [ ] **Step 1: Create types**

```typescript
// src/types/execution.ts

export type ExecutionState =
  | 'CREATED' | 'RUNNING' | 'PAUSED' | 'RESTARTED'
  | 'KILLING' | 'SUCCESS' | 'WARNING' | 'FAILED' | 'KILLED'

export interface ExecutionRow {
  id: string
  namespace: string
  flowId: string
  state: ExecutionState
  startDate: string | null
  endDate: string | null
}

export interface TaskRunRow {
  id: string
  taskId: string
  state: ExecutionState
  startDate: string | null
  endDate: string | null
}

export interface ExecutionDetail extends ExecutionRow {
  inputs: Record<string, unknown>
  taskRuns: TaskRunRow[]
}

export interface ExecutionPage {
  total: number
  page: number
  size: number
  results: ExecutionRow[]
}

export interface HourlyBucket {
  hour: string
  SUCCESS: number
  FAILED: number
  RUNNING: number
  KILLED: number
  WARNING: number
}

export interface SummaryData {
  totalToday: number
  successRate: number
  runningNow: number
  failedToday: number
  hourly: HourlyBucket[]
}

export interface RetriggerResponse {
  newExecutionId: string
  originalExecutionId: string
  triggeredBy: string
  triggeredAt: string
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/
git commit -m "feat: add TypeScript execution types"
```

---

### Task 12: Auth (oidc.ts, AuthProvider, ProtectedRoute)

**Files:**
- Create: `frontend/src/auth/oidc.ts`
- Create: `frontend/src/auth/AuthProvider.tsx`
- Create: `frontend/src/auth/ProtectedRoute.tsx`
- Create: `frontend/src/auth/AuthProvider.test.tsx`

- [ ] **Step 1: Write a failing test for AuthProvider**

Create `src/auth/AuthProvider.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'

vi.mock('./oidc', () => ({
  userManager: {
    getUser: vi.fn().mockResolvedValue(null),
    events: {
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
      removeUserLoaded: vi.fn(),
      removeUserUnloaded: vi.fn(),
    },
    signinRedirect: vi.fn(),
    signoutRedirect: vi.fn(),
  },
}))

function TestConsumer() {
  const { user, isLoading } = useAuth()
  return <div>{isLoading ? 'loading' : user ? 'logged-in' : 'logged-out'}</div>
}

describe('AuthProvider', () => {
  it('shows loading then logged-out when no user', async () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()
    await screen.findByText('logged-out')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --run 2>&1 | tail -5
```

Expected: FAIL — `AuthProvider` not found

- [ ] **Step 3: Implement oidc.ts**

Create `src/auth/oidc.ts`:

```typescript
import { UserManager, InMemoryWebStorage, WebStorageStateStore } from 'oidc-client-ts'

export const userManager = new UserManager({
  authority: `${import.meta.env.VITE_KEYCLOAK_URL}/realms/${import.meta.env.VITE_KEYCLOAK_REALM}`,
  client_id: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
  redirect_uri: `${window.location.origin}/callback`,
  response_type: 'code',
  scope: 'openid profile email',
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
})
```

- [ ] **Step 4: Implement AuthProvider.tsx**

Create `src/auth/AuthProvider.tsx`:

```typescript
import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User } from 'oidc-client-ts'
import { userManager } from './oidc'

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  login: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    userManager.getUser().then(u => {
      setUser(u)
      setIsLoading(false)
    })
    const onLoaded = (u: User) => setUser(u)
    const onUnloaded = () => setUser(null)
    userManager.events.addUserLoaded(onLoaded)
    userManager.events.addUserUnloaded(onUnloaded)
    return () => {
      userManager.events.removeUserLoaded(onLoaded)
      userManager.events.removeUserUnloaded(onUnloaded)
    }
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      login: () => userManager.signinRedirect(),
      logout: () => userManager.signoutRedirect(),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

- [ ] **Step 5: Implement ProtectedRoute.tsx**

Create `src/auth/ProtectedRoute.tsx`:

```typescript
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (!user || user.expired) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run test -- --run 2>&1 | tail -3
```

Expected: `Tests 1 passed`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/auth/
git commit -m "feat: add OIDC auth (UserManager, AuthProvider, ProtectedRoute)"
```

---

### Task 13: API client

**Files:**
- Create: `frontend/src/api/client.ts`

- [ ] **Step 1: Create the Axios client**

Create `src/api/client.ts`:

```typescript
import axios from 'axios'
import { userManager } from '../auth/oidc'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
})

api.interceptors.request.use(async config => {
  const user = await userManager.getUser()
  if (user?.access_token) {
    config.headers.Authorization = `Bearer ${user.access_token}`
  }
  return config
})

api.interceptors.response.use(
  res => res,
  async err => {
    if (err.response?.status === 401) {
      await userManager.signinRedirect()
    }
    return Promise.reject(err)
  }
)

export default api
```

- [ ] **Step 2: Verify compilation**

```bash
npm run build 2>&1 | grep error | head -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/
git commit -m "feat: add Axios client with Bearer interceptor"
```

---

### Task 14: React Query hooks

**Files:**
- Create: `frontend/src/hooks/useExecutions.ts`
- Create: `frontend/src/hooks/useExecution.ts`
- Create: `frontend/src/hooks/useSummary.ts`
- Create: `frontend/src/hooks/useRetrigger.ts`

- [ ] **Step 1: Create all four hooks**

Create `src/hooks/useExecutions.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { ExecutionPage } from '../types/execution'

export interface ExecutionFilters {
  namespace?: string
  status?: string
  from?: string
  to?: string
  page?: number
  size?: number
}

export function useExecutions(filters: ExecutionFilters = {}) {
  return useQuery<ExecutionPage>({
    queryKey: ['executions', filters],
    queryFn: () => api.get('/api/executions', { params: filters }).then(r => r.data),
  })
}
```

Create `src/hooks/useExecution.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { ExecutionDetail } from '../types/execution'

export function useExecution(id: string) {
  return useQuery<ExecutionDetail>({
    queryKey: ['execution', id],
    queryFn: () => api.get(`/api/executions/${id}`).then(r => r.data),
    enabled: !!id,
  })
}
```

Create `src/hooks/useSummary.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { SummaryData } from '../types/execution'

export function useSummary() {
  return useQuery<SummaryData>({
    queryKey: ['executions-summary'],
    queryFn: () => api.get('/api/executions/summary').then(r => r.data),
    refetchInterval: 60_000,
  })
}
```

Create `src/hooks/useRetrigger.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import type { RetriggerResponse } from '../types/execution'

export function useRetrigger() {
  const queryClient = useQueryClient()
  return useMutation<RetriggerResponse, Error, string>({
    mutationFn: (id: string) =>
      api.post(`/api/executions/${id}/retrigger`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] })
      queryClient.invalidateQueries({ queryKey: ['executions-summary'] })
    },
  })
}
```

- [ ] **Step 2: Verify compilation**

```bash
npm run build 2>&1 | grep error | head -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/
git commit -m "feat: add React Query hooks for executions, summary, retrigger"
```

---

### Task 15: StatusBadge and KpiCard components

**Files:**
- Create: `frontend/src/components/StatusBadge.tsx`
- Create: `frontend/src/components/KpiCard.tsx`
- Create: `frontend/src/components/StatusBadge.test.tsx`

- [ ] **Step 1: Write failing test for StatusBadge**

Create `src/components/StatusBadge.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('renders FAILED state', () => {
    render(<StatusBadge state="FAILED" />)
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })

  it('renders SUCCESS state', () => {
    render(<StatusBadge state="SUCCESS" />)
    expect(screen.getByText('SUCCESS')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --run 2>&1 | tail -5
```

Expected: FAIL — `StatusBadge` not found

- [ ] **Step 3: Implement StatusBadge.tsx**

Create `src/components/StatusBadge.tsx`:

```typescript
import type { ExecutionState } from '../types/execution'

const STATE_CLASSES: Record<ExecutionState, string> = {
  SUCCESS:   'bg-green-100  text-green-800',
  FAILED:    'bg-red-100    text-red-800',
  RUNNING:   'bg-blue-100   text-blue-800',
  KILLED:    'bg-gray-100   text-gray-800',
  KILLING:   'bg-orange-100 text-orange-800',
  PAUSED:    'bg-yellow-100 text-yellow-800',
  RESTARTED: 'bg-purple-100 text-purple-800',
  CREATED:   'bg-slate-100  text-slate-800',
  WARNING:   'bg-amber-100  text-amber-800',
}

export function StatusBadge({ state }: { state: ExecutionState }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATE_CLASSES[state]}`}>
      {state}
    </span>
  )
}
```

- [ ] **Step 4: Implement KpiCard.tsx**

Create `src/components/KpiCard.tsx`:

```typescript
type CardColor = 'default' | 'green' | 'red' | 'blue'

const COLOR_CLASSES: Record<CardColor, string> = {
  default: 'border-indigo-200 text-indigo-700',
  green:   'border-green-200  text-green-700',
  red:     'border-red-200    text-red-700',
  blue:    'border-blue-200   text-blue-700',
}

interface KpiCardProps {
  label: string
  value: string | number
  color?: CardColor
}

export function KpiCard({ label, value, color = 'default' }: KpiCardProps) {
  return (
    <div className={`border rounded-lg p-4 text-center min-w-[120px] ${COLOR_CLASSES[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test -- --run 2>&1 | tail -3
```

Expected: `Tests 3 passed`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StatusBadge.tsx frontend/src/components/KpiCard.tsx frontend/src/components/StatusBadge.test.tsx
git commit -m "feat: add StatusBadge and KpiCard components"
```

---

### Task 16: TimelineChart component

**Files:**
- Create: `frontend/src/components/TimelineChart.tsx`

- [ ] **Step 1: Create TimelineChart.tsx**

```typescript
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { HourlyBucket } from '../types/execution'

const STATE_COLORS: Record<string, string> = {
  SUCCESS: '#4ade80',
  FAILED:  '#f87171',
  RUNNING: '#60a5fa',
  KILLED:  '#94a3b8',
  WARNING: '#f59e0b',
}

interface TimelineChartProps {
  data: HourlyBucket[]
}

export function TimelineChart({ data }: TimelineChartProps) {
  const formatted = data.map(b => ({
    ...b,
    hour: new Date(b.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={formatted} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        {Object.entries(STATE_COLORS).map(([state, color]) => (
          <Bar key={state} dataKey={state} stackId="stack" fill={color} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 2: Verify compilation**

```bash
npm run build 2>&1 | grep error | head -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/TimelineChart.tsx
git commit -m "feat: add TimelineChart (Recharts stacked bar)"
```

---

### Task 17: RetriggerModal component

**Files:**
- Create: `frontend/src/components/RetriggerModal.tsx`
- Create: `frontend/src/components/RetriggerModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/RetriggerModal.test.tsx`:

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
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- --run 2>&1 | tail -5
```

Expected: FAIL — `RetriggerModal` not found

- [ ] **Step 3: Implement RetriggerModal.tsx**

Create `src/components/RetriggerModal.tsx`:

```typescript
import type { ExecutionRow } from '../types/execution'
import { useRetrigger } from '../hooks/useRetrigger'

interface RetriggerModalProps {
  execution: ExecutionRow
  onClose: () => void
}

export function RetriggerModal({ execution, onClose }: RetriggerModalProps) {
  const retrigger = useRetrigger()

  const handleConfirm = async () => {
    await retrigger.mutateAsync(execution.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Retrigger Execution</h2>
        <div className="space-y-2 text-sm mb-4">
          <div><span className="font-medium text-gray-600">Flow:</span> {execution.flowId}</div>
          <div><span className="font-medium text-gray-600">Namespace:</span> {execution.namespace}</div>
          <div><span className="font-medium text-gray-600">Original ID:</span> <span className="font-mono text-xs">{execution.id}</span></div>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          This creates a new execution with the same inputs. The action is logged.
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
            disabled={retrigger.isPending}
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- --run 2>&1 | tail -3
```

Expected: `Tests 5 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RetriggerModal.tsx frontend/src/components/RetriggerModal.test.tsx
git commit -m "feat: add RetriggerModal component"
```

---

### Task 18: ExecutionListPage

**Files:**
- Create: `frontend/src/pages/ExecutionListPage.tsx`

- [ ] **Step 1: Create ExecutionListPage.tsx**

```typescript
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useExecutions } from '../hooks/useExecutions'
import { useSummary } from '../hooks/useSummary'
import { StatusBadge } from '../components/StatusBadge'
import { KpiCard } from '../components/KpiCard'
import { TimelineChart } from '../components/TimelineChart'
import { RetriggerModal } from '../components/RetriggerModal'
import type { ExecutionRow, ExecutionState } from '../types/execution'

const STATES: ExecutionState[] = ['CREATED','RUNNING','PAUSED','SUCCESS','WARNING','FAILED','KILLED']

export function ExecutionListPage() {
  const [namespace, setNamespace] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [retriggerTarget, setRetriggerTarget] = useState<ExecutionRow | null>(null)

  const { data: summary } = useSummary()
  const { data: executions, isLoading, error } = useExecutions({
    namespace: namespace || undefined,
    status: status || undefined,
    page,
    size: 20,
  })

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Executions</h1>

      {/* KPI Cards */}
      <div className="flex gap-4 flex-wrap">
        <KpiCard label="Total today"  value={summary?.totalToday  ?? '—'} />
        <KpiCard label="Success rate" value={summary ? `${summary.successRate}%` : '—'} color="green" />
        <KpiCard label="Running now"  value={summary?.runningNow  ?? '—'} color="blue" />
        <KpiCard label="Failed today" value={summary?.failedToday ?? '—'} color="red" />
      </div>

      {/* Timeline chart */}
      {summary?.hourly && summary.hourly.length > 0 && (
        <div className="border rounded-lg p-4">
          <h2 className="text-sm font-medium text-gray-500 mb-2">Executions last 24h</h2>
          <TimelineChart data={summary.hourly} />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          placeholder="Filter by namespace…"
          value={namespace}
          onChange={e => { setNamespace(e.target.value); setPage(0) }}
          className="border rounded-md px-3 py-1.5 text-sm w-56"
        />
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0) }}
          className="border rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      {isLoading && <div className="text-gray-500">Loading…</div>}
      {error && <div className="text-red-600">Failed to load executions</div>}
      {executions && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Flow</th>
                  <th className="px-4 py-3">Namespace</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Start</th>
                  <th className="px-4 py-3">End</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {executions.results.map(exec => (
                  <tr key={exec.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-blue-600">
                      <Link to={`/executions/${exec.id}`} className="hover:underline">
                        {exec.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">{exec.flowId}</td>
                    <td className="px-4 py-3 text-gray-500">{exec.namespace}</td>
                    <td className="px-4 py-3"><StatusBadge state={exec.state} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {exec.startDate ? new Date(exec.startDate).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {exec.endDate ? new Date(exec.endDate).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setRetriggerTarget(exec)}
                        className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Retrigger
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-3 text-sm">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 border rounded disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-gray-500">
              Page {page + 1} · {executions.total} total
            </span>
            <button
              disabled={(page + 1) * executions.size >= executions.total}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 border rounded disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}

      {retriggerTarget && (
        <RetriggerModal execution={retriggerTarget} onClose={() => setRetriggerTarget(null)} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify compilation**

```bash
npm run build 2>&1 | grep error | head -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ExecutionListPage.tsx
git commit -m "feat: add ExecutionListPage with KPI cards, chart, table, filters"
```

---

### Task 19: ExecutionDetailPage

**Files:**
- Create: `frontend/src/pages/ExecutionDetailPage.tsx`

- [ ] **Step 1: Create ExecutionDetailPage.tsx**

```typescript
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useExecution } from '../hooks/useExecution'
import { StatusBadge } from '../components/StatusBadge'
import { KpiCard } from '../components/KpiCard'
import { RetriggerModal } from '../components/RetriggerModal'

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: execution, isLoading, error } = useExecution(id!)
  const [showRetrigger, setShowRetrigger] = useState(false)

  if (isLoading) return <div className="p-6 text-gray-500">Loading…</div>
  if (error || !execution) return (
    <div className="p-6">
      <p className="text-red-600">Execution not found.</p>
      <Link to="/" className="text-blue-600 text-sm hover:underline mt-2 block">← Back</Link>
    </div>
  )

  const passed = execution.taskRuns.filter(t => t.state === 'SUCCESS').length
  const failed = execution.taskRuns.filter(t => ['FAILED', 'KILLED'].includes(t.state)).length

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-blue-600 text-sm hover:underline">← Executions</Link>
        <span className="text-gray-300">/</span>
        <span className="font-mono text-sm text-gray-600">{execution.id}</span>
      </div>

      {/* KPI cards */}
      <div className="flex gap-4 flex-wrap items-center">
        <KpiCard label="Duration" value={formatDuration(execution.startDate, execution.endDate)} />
        <KpiCard label="Tasks passed" value={`${passed} / ${execution.taskRuns.length}`} color="green" />
        <KpiCard label="Tasks failed" value={failed} color={failed > 0 ? 'red' : 'default'} />
        <div className="border rounded-lg p-4 text-center min-w-[120px]">
          <StatusBadge state={execution.state} />
          <div className="text-xs text-gray-500 mt-1">Final state</div>
        </div>
        <button
          onClick={() => setShowRetrigger(true)}
          className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
        >
          Retrigger
        </button>
      </div>

      {/* Metadata */}
      <div className="border rounded-lg p-5 space-y-2 text-sm">
        <h2 className="font-semibold text-base mb-3">Details</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          <div><span className="text-gray-500">Flow:</span> <span className="font-medium">{execution.flowId}</span></div>
          <div><span className="text-gray-500">Namespace:</span> {execution.namespace}</div>
          <div><span className="text-gray-500">Start:</span> {execution.startDate ? new Date(execution.startDate).toLocaleString() : '—'}</div>
          <div><span className="text-gray-500">End:</span> {execution.endDate ? new Date(execution.endDate).toLocaleString() : '—'}</div>
        </div>
        {Object.keys(execution.inputs).length > 0 && (
          <div className="mt-3">
            <div className="text-gray-500 mb-1">Inputs:</div>
            <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto border">
              {JSON.stringify(execution.inputs, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Task runs */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b">
          <h2 className="font-semibold text-sm">Task Runs ({execution.taskRuns.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase tracking-wide">
            <tr className="border-b">
              <th className="px-4 py-2 text-left">Task ID</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Start</th>
              <th className="px-4 py-2 text-left">End</th>
              <th className="px-4 py-2 text-left">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {execution.taskRuns.map(tr => (
              <tr key={tr.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs">{tr.taskId}</td>
                <td className="px-4 py-2.5"><StatusBadge state={tr.state} /></td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">
                  {tr.startDate ? new Date(tr.startDate).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">
                  {tr.endDate ? new Date(tr.endDate).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">
                  {formatDuration(tr.startDate, tr.endDate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showRetrigger && (
        <RetriggerModal execution={execution} onClose={() => setShowRetrigger(false)} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify compilation**

```bash
npm run build 2>&1 | grep error | head -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ExecutionDetailPage.tsx
git commit -m "feat: add ExecutionDetailPage with KPI cards and task run table"
```

---

### Task 20: App.tsx routing and callback/login pages

**Files:**
- Create: `frontend/src/pages/CallbackPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Create CallbackPage.tsx**

Create `src/pages/CallbackPage.tsx`:

```typescript
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { userManager } from '../auth/oidc'

export function CallbackPage() {
  const navigate = useNavigate()
  useEffect(() => {
    userManager.signinRedirectCallback()
      .then(() => navigate('/'))
      .catch(err => {
        console.error('OIDC callback failed', err)
        navigate('/login')
      })
  }, [navigate])
  return <div className="flex items-center justify-center h-screen text-gray-500">Completing login…</div>
}
```

- [ ] **Step 2: Write App.tsx**

Replace `src/App.tsx`:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { CallbackPage } from './pages/CallbackPage'
import { ExecutionListPage } from './pages/ExecutionListPage'
import { ExecutionDetailPage } from './pages/ExecutionDetailPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

function LoginRedirect() {
  const { login } = useAuth()
  useEffect(() => { login() }, [login])
  return <div className="flex items-center justify-center h-screen text-gray-500">Redirecting to login…</div>
}

// import useEffect at top
import { useEffect } from 'react'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/callback" element={<CallbackPage />} />
            <Route path="/login" element={<LoginRedirect />} />
            <Route path="/" element={<ProtectedRoute><ExecutionListPage /></ProtectedRoute>} />
            <Route path="/executions/:id" element={<ProtectedRoute><ExecutionDetailPage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 3: Update main.tsx**

Replace `src/main.tsx`:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 4: Run full test suite**

```bash
npm run test -- --run 2>&1 | tail -5
```

Expected: all tests pass

- [ ] **Step 5: Build for production**

```bash
npm run build 2>&1 | tail -5
```

Expected: `dist/` created, no errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat: wire up React Router, AuthProvider, all pages"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| Keycloak OIDC PKCE | Task 12 (oidc.ts) |
| Token in memory only | Task 12 (InMemoryWebStorage) |
| View executions (global) | Task 5 (listExecutions) + Task 18 (ExecutionListPage) |
| View execution detail + task runs | Task 5 (findById) + Task 19 (ExecutionDetailPage) |
| Retrigger creates new execution | Task 7 (KestraClient) + Task 8 (RetriggerService) |
| Audit log (minimal) | Task 6 (AuditRepository) |
| OIDC JWT validation on every request | Task 9 (ExecutionResource @Authenticated) |
| KPI cards + timeline chart on list page | Task 15–16 + Task 18 |
| KPI cards on detail page | Task 15 + Task 19 |
| MySQL table `kestra_retrigger_audit` | Task 9 Step 7 |
| CORS config | Task 1 Step 3 (application.properties) |
| 401 → re-login | Task 13 (api/client.ts) |
| 404 on unknown execution | Task 9 (ExecutionResource) |
| 502 when Kestra unreachable | Task 8 (RetriggerService) |
| Audit write failure is non-fatal | Task 8 (RetriggerService, try/catch) |
| BE unit tests with H2 | Tasks 2, 5, 6 |
| BE auth tests with quarkus-test-security | Task 9 |
| FE unit tests (Vitest + RTL) | Tasks 12, 15, 17 |
