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
