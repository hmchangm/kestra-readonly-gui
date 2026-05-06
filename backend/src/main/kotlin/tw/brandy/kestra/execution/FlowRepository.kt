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
