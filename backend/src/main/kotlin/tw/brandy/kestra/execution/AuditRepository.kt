package tw.brandy.kestra.execution

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import javax.sql.DataSource

@ApplicationScoped
class AuditRepository(
    private val ds: DataSource,
    private val mapper: ObjectMapper
) {

    fun writeAudit(
        triggeredBy: String,
        originalExecutionId: String,
        newExecutionId: String,
        inputOverrides: Map<String, Any?>? = null
    ) {
        val sql = """
            INSERT INTO kestra_retrigger_audit (triggered_by, original_execution_id, new_execution_id, input_overrides)
            VALUES (?, ?, ?, ?)
        """.trimIndent()
        ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, triggeredBy)
                ps.setString(2, originalExecutionId)
                ps.setString(3, newExecutionId)
                if (inputOverrides.isNullOrEmpty()) {
                    ps.setNull(4, java.sql.Types.VARCHAR)
                } else {
                    ps.setString(4, mapper.writeValueAsString(inputOverrides))
                }
                ps.executeUpdate()
            }
        }
    }
}
