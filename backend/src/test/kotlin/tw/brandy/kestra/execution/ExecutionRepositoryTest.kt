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

        val page = repo.listExecutions(null, null, null, null, null, 0, 10)

        assertEquals(3, page.total)
        assertEquals(3, page.results.size)
    }

    @Test
    fun `listExecutions filters by namespace`() {
        insertExecution("exec-1", "prod.etl", "flow-a", "SUCCESS")
        insertExecution("exec-2", "dev", "flow-b", "FAILED")

        val page = repo.listExecutions("prod.etl", null, null, null, null, 0, 10)

        assertEquals(1, page.total)
        assertEquals("exec-1", page.results[0].id)
    }

    @Test
    fun `listExecutions filters by flow id`() {
        insertExecution("exec-1", "prod", "daily", "SUCCESS")
        insertExecution("exec-2", "prod", "adhoc", "SUCCESS")

        val page = repo.listExecutions("prod", null, null, null, "daily", 0, 10)

        assertEquals(1, page.total)
        assertEquals("exec-1", page.results[0].id)
        assertEquals("daily", page.results[0].flowId)
    }

    @Test
    fun `listExecutions filters by status`() {
        insertExecution("exec-1", "ns", "flow", "SUCCESS")
        insertExecution("exec-2", "ns", "flow", "FAILED")

        val page = repo.listExecutions(null, "FAILED", null, null, null, 0, 10)

        assertEquals(1, page.total)
        assertEquals("exec-2", page.results[0].id)
    }

    @Test
    fun `listExecutions respects page and size`() {
        repeat(5) { i -> insertExecution("exec-$i", "ns", "flow", "SUCCESS") }

        val page = repo.listExecutions(null, null, null, null, null, 1, 2)

        assertEquals(5, page.total)
        assertEquals(2, page.results.size)
        assertEquals(1, page.page)
    }

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

    private fun insertLog(key: String, executionId: String, taskRunId: String, level: String, message: String) {
        ds.connection.use { conn ->
            conn.prepareStatement(
                "INSERT INTO logs (`key`, execution_id, taskrun_id, level, message, `timestamp`) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)"
            ).use { ps ->
                ps.setString(1, key)
                ps.setString(2, executionId)
                ps.setString(3, taskRunId)
                ps.setString(4, level)
                ps.setString(5, message)
                ps.executeUpdate()
            }
        }
    }

    @Test
    fun `findTaskLogs returns logs for matching executionId and taskRunId`() {
        insertLog("log-1", "exec-1", "tr-1", "INFO", "Starting task")
        insertLog("log-2", "exec-1", "tr-1", "ERROR", "Task failed")
        insertLog("log-3", "exec-1", "tr-2", "INFO", "Other task")  // different taskRunId

        val logs = repo.findTaskLogs("exec-1", "tr-1")

        assertEquals(2, logs.size)
        assertEquals("INFO", logs[0].level)
        assertEquals("Starting task", logs[0].message)
        assertEquals("ERROR", logs[1].level)
    }

    @Test
    fun `findTaskLogs returns empty list when no logs match`() {
        val logs = repo.findTaskLogs("exec-nonexistent", "tr-nonexistent")
        assertEquals(emptyList<LogEntry>(), logs)
    }

    @Test
    fun `findTaskLogs orders by timestamp ascending`() {
        ds.connection.use { conn ->
            conn.prepareStatement(
                "INSERT INTO logs (`key`, execution_id, taskrun_id, level, message, `timestamp`) VALUES (?,?,?,?,?,?)"
            ).use { ps ->
                ps.setString(1, "log-b"); ps.setString(2, "exec-2"); ps.setString(3, "tr-1")
                ps.setString(4, "WARN"); ps.setString(5, "Second")
                ps.setTimestamp(6, java.sql.Timestamp.from(java.time.Instant.parse("2026-05-06T10:00:02Z")))
                ps.executeUpdate()
            }
            conn.prepareStatement(
                "INSERT INTO logs (`key`, execution_id, taskrun_id, level, message, `timestamp`) VALUES (?,?,?,?,?,?)"
            ).use { ps ->
                ps.setString(1, "log-a"); ps.setString(2, "exec-2"); ps.setString(3, "tr-1")
                ps.setString(4, "INFO"); ps.setString(5, "First")
                ps.setTimestamp(6, java.sql.Timestamp.from(java.time.Instant.parse("2026-05-06T10:00:01Z")))
                ps.executeUpdate()
            }
        }

        val logs = repo.findTaskLogs("exec-2", "tr-1")

        assertEquals("First", logs[0].message)
        assertEquals("Second", logs[1].message)
    }
}
