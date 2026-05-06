package tw.brandy.kestra.execution

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import tw.brandy.kestra.util.toList
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import javax.sql.DataSource

@ApplicationScoped
class ExecutionRepository {

    companion object {
        private val HOUR_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH':00:00Z'").withZone(ZoneOffset.UTC)
    }

    @Inject
    lateinit var ds: DataSource

    @Inject
    lateinit var mapper: ObjectMapper

    fun listExecutions(
        namespace: String?, status: String?,
        from: String?, to: String?,
        flowId: String?,
        page: Int, size: Int
    ): ExecutionPage {
        // Build WHERE clause dynamically to avoid H2 IS NULL incompatibility with JDBC setString(i, null)
        val conditions = mutableListOf("deleted = false")
        val params = mutableListOf<Any?>()

        if (namespace != null) {
            conditions.add("namespace = ?")
            params.add(namespace)
        }
        if (flowId != null) {
            conditions.add("flow_id = ?")
            params.add(flowId)
        }
        if (status != null) {
            conditions.add("state_current = ?")
            params.add(status)
        }
        if (from != null) {
            conditions.add("start_date >= ?")
            params.add(java.sql.Timestamp.from(Instant.parse(from)))
        }
        if (to != null) {
            conditions.add("start_date <= ?")
            params.add(java.sql.Timestamp.from(Instant.parse(to)))
        }

        val where = conditions.joinToString(" AND ")

        val countSql = "SELECT COUNT(*) FROM executions WHERE $where"
        val listSql = """
            SELECT id, namespace, flow_id, state_current, start_date, end_date
            FROM executions WHERE $where
            ORDER BY start_date DESC LIMIT ? OFFSET ?
        """.trimIndent()

        val total = ds.connection.use { conn ->
            conn.prepareStatement(countSql).use { ps ->
                params.forEachIndexed { idx, v -> ps.setObject(idx + 1, v) }
                ps.executeQuery().use { rs -> rs.next(); rs.getLong(1) }
            }
        }

        val results = ds.connection.use { conn ->
            conn.prepareStatement(listSql).use { ps ->
                params.forEachIndexed { idx, v -> ps.setObject(idx + 1, v) }
                ps.setInt(params.size + 1, size)
                ps.setInt(params.size + 2, page * size)
                ps.executeQuery().use { rs ->
                    rs.toList { r ->
                        ExecutionRow(
                            id = r.getString("id"),
                            namespace = r.getString("namespace"),
                            flowId = r.getString("flow_id"),
                            state = r.getString("state_current"),
                            startDate = r.getTimestamp("start_date")?.toInstant()?.toString(),
                            endDate = r.getTimestamp("end_date")?.toInstant()?.toString()
                        )
                    }
                }
            }
        }

        return ExecutionPage(total, page, size, results)
    }

    fun findById(id: String): ExecutionDetailRow? {
        val sql = "SELECT `value`, state_current, start_date, end_date FROM executions WHERE id = ? AND deleted = false"
        return ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, id)
                ps.executeQuery().use { rs ->
                    if (!rs.next()) return@use null
                    val json = rs.getString("value")
                    val kestra = mapper.readValue(json, KestraExecutionValue::class.java)
                    ExecutionDetailRow(
                        id = kestra.id,
                        namespace = kestra.namespace,
                        flowId = kestra.flowId,
                        state = rs.getString("state_current"),
                        startDate = rs.getTimestamp("start_date")?.toInstant()?.toString(),
                        endDate = rs.getTimestamp("end_date")?.toInstant()?.toString(),
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
            }
        }
    }

    fun getSummary(): SummaryResponse {
        fun longQuery(sql: String): Long = ds.connection.use { conn ->
            conn.createStatement().use { it.executeQuery(sql).use { rs -> rs.next(); rs.getLong(1) } }
        }

        val totalToday = longQuery(
            "SELECT COUNT(*) FROM executions WHERE deleted=false AND CAST(start_date AS DATE) = CURRENT_DATE"
        )
        val failedToday = longQuery(
            "SELECT COUNT(*) FROM executions WHERE deleted=false AND state_current='FAILED' AND CAST(start_date AS DATE) = CURRENT_DATE"
        )
        val runningNow = longQuery(
            "SELECT COUNT(*) FROM executions WHERE deleted=false AND state_current='RUNNING'"
        )
        val successToday = longQuery(
            "SELECT COUNT(*) FROM executions WHERE deleted=false AND state_current='SUCCESS' AND CAST(start_date AS DATE) = CURRENT_DATE"
        )
        val successRate = if (totalToday > 0) ((successToday * 100) / totalToday).toInt() else 0

        // Hourly breakdown: fetch all executions from the last 24h and bucket in Kotlin
        val since = Instant.now().minus(24, ChronoUnit.HOURS)
        val hourlySql = """
            SELECT state_current, start_date FROM executions
            WHERE deleted = false AND start_date >= ?
        """.trimIndent()

        data class Row(val state: String, val startDate: Instant)

        val rows = ds.connection.use { conn ->
            conn.prepareStatement(hourlySql).use { ps ->
                ps.setTimestamp(1, java.sql.Timestamp.from(since))
                ps.executeQuery().use { rs ->
                    rs.toList { r ->
                        Row(
                            state = r.getString("state_current"),
                            startDate = r.getTimestamp("start_date")?.toInstant() ?: since
                        )
                    }
                }
            }
        }

        // Build 24 hourly buckets
        val buckets = mutableMapOf<String, MutableMap<String, Int>>()
        val now = Instant.now()
        for (h in 23 downTo 0) {
            val bucketStart = now.minus(h.toLong(), ChronoUnit.HOURS)
                .truncatedTo(ChronoUnit.HOURS)
            val key = HOUR_FORMATTER.format(bucketStart)
            buckets[key] = mutableMapOf("SUCCESS" to 0, "FAILED" to 0, "RUNNING" to 0, "KILLED" to 0, "WARNING" to 0)
        }
        for (row in rows) {
            val truncated = row.startDate.truncatedTo(ChronoUnit.HOURS)
            val key = HOUR_FORMATTER.format(truncated)
            buckets[key]?.compute(row.state) { _, v -> (v ?: 0) + 1 }
        }

        val hourly = buckets.entries.sortedBy { it.key }.map { (hour, counts) ->
            HourlyBucket(
                hour = hour,
                SUCCESS = counts["SUCCESS"] ?: 0,
                FAILED  = counts["FAILED"]  ?: 0,
                RUNNING = counts["RUNNING"] ?: 0,
                KILLED  = counts["KILLED"]  ?: 0,
                WARNING = counts["WARNING"] ?: 0
            )
        }

        return SummaryResponse(totalToday, successRate, runningNow, failedToday, hourly)
    }

    fun listNamespaces(): List<String> =
        ds.connection.use { conn ->
            conn.createStatement().use { st ->
                st.executeQuery("SELECT DISTINCT namespace FROM executions ORDER BY namespace").use { rs ->
                    rs.toList { it.getString("namespace") }
                }
            }
        }

    fun findTaskLogs(executionId: String, taskRunId: String): List<LogEntry> {
        val sql = """
            SELECT level, message, `timestamp`
            FROM logs
            WHERE execution_id = ? AND taskrun_id = ?
            ORDER BY `timestamp` ASC
        """.trimIndent()
        return ds.connection.use { conn ->
            conn.prepareStatement(sql).use { ps ->
                ps.setString(1, executionId)
                ps.setString(2, taskRunId)
                ps.executeQuery().use { rs ->
                    rs.toList { r ->
                        LogEntry(
                            timestamp = r.getTimestamp("timestamp")?.toInstant()?.toString() ?: "",
                            level = r.getString("level") ?: "",
                            message = r.getString("message") ?: ""
                        )
                    }
                }
            }
        }
    }
}
