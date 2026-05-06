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
