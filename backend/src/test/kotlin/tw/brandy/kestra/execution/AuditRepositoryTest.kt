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
