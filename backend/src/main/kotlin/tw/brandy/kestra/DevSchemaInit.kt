package tw.brandy.kestra

import io.quarkus.runtime.LaunchMode
import io.quarkus.runtime.StartupEvent
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.event.Observes
import org.jboss.logging.Logger
import javax.sql.DataSource

@ApplicationScoped
class DevSchemaInit(private val ds: DataSource) {

    private val log = Logger.getLogger(DevSchemaInit::class.java)

    fun onStart(@Observes event: StartupEvent) {
        if (LaunchMode.current() != LaunchMode.DEVELOPMENT) return
        ds.connection.use { conn ->
            val isH2 = conn.metaData.databaseProductName.contains("H2", ignoreCase = true)
            if (isH2) {
                log.info("Dev mode (H2): initialising schema from db-setup.sql")
                val sql = javaClass.classLoader.getResourceAsStream("db-setup.sql")
                    ?.bufferedReader()?.readText() ?: return
                sql.split(";").map { it.trim() }.filter { it.isNotBlank() }.forEach { stmt ->
                    conn.createStatement().use { it.execute(stmt) }
                }
            } else {
                log.info("Dev mode (MySQL): ensuring kestra_retrigger_audit table exists")
                try {
                    conn.createStatement().use {
                        it.execute("""
                            CREATE TABLE IF NOT EXISTS kestra_retrigger_audit (
                                id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
                                triggered_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                triggered_by          VARCHAR(255) NOT NULL,
                                original_execution_id VARCHAR(255) NOT NULL,
                                new_execution_id      VARCHAR(255) NOT NULL,
                                input_overrides       TEXT NULL
                            )
                        """.trimIndent())
                    }
                    conn.createStatement().use {
                        it.execute("ALTER TABLE kestra_retrigger_audit ADD COLUMN IF NOT EXISTS input_overrides TEXT NULL")
                    }
                } catch (e: Exception) {
                    log.warn("Could not create kestra_retrigger_audit table (run migration manually): ${e.message}")
                }
            }
        }
    }
}
