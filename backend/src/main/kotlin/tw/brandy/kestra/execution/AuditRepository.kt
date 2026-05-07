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
