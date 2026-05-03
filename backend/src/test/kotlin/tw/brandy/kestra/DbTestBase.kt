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
