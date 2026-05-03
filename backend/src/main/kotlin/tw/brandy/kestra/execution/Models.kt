package tw.brandy.kestra.execution

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

data class ExecutionRow(
    val id: String,
    val namespace: String,
    val flowId: String,
    val state: String,
    val startDate: String?,
    val endDate: String?
)

data class TaskRunRow(
    val id: String,
    val taskId: String,
    val state: String,
    val startDate: String?,
    val endDate: String?
)

data class ExecutionDetailRow(
    val id: String,
    val namespace: String,
    val flowId: String,
    val state: String,
    val startDate: String?,
    val endDate: String?,
    val inputs: Map<String, Any?>,
    val taskRuns: List<TaskRunRow>
)

data class ExecutionPage(
    val total: Long,
    val page: Int,
    val size: Int,
    val results: List<ExecutionRow>
)

data class HourlyBucket(
    val hour: String,
    val SUCCESS: Int = 0,
    val FAILED: Int = 0,
    val RUNNING: Int = 0,
    val KILLED: Int = 0,
    val WARNING: Int = 0
)

data class SummaryResponse(
    val totalToday: Long,
    val successRate: Int,
    val runningNow: Long,
    val failedToday: Long,
    val hourly: List<HourlyBucket>
)

data class RetriggerResponse(
    val newExecutionId: String,
    val originalExecutionId: String,
    val triggeredBy: String,
    val triggeredAt: String
)

// Models for parsing Kestra's execution JSON value column
@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraExecutionValue(
    val id: String = "",
    val namespace: String = "",
    val flowId: String = "",
    val inputs: Map<String, Any?> = emptyMap(),
    val taskRunList: List<KestraTaskRun> = emptyList()
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraTaskRun(
    val id: String = "",
    val taskId: String = "",
    val state: KestraState = KestraState()
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraState(
    val current: String = "",
    val startDate: String? = null,
    val endDate: String? = null
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class KestraExecutionResponse(
    val id: String = ""
)

data class RetriggerRequest(
    val overrides: Map<String, Any?> = emptyMap()
)
