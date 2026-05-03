package tw.brandy.kestra.execution

import jakarta.enterprise.context.ApplicationScoped
import jakarta.ws.rs.NotFoundException
import jakarta.ws.rs.WebApplicationException
import jakarta.ws.rs.core.Response
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.jboss.logging.Logger
import java.time.Instant

@ApplicationScoped
class RetriggerService(
    private val executionRepository: ExecutionRepository,
    private val auditRepository: AuditRepository,
    private val partBuilder: KestraPartBuilder,
    @RestClient private val kestraClient: KestraClient
) {
    companion object {
        private val log = Logger.getLogger(RetriggerService::class.java)
    }

    fun retrigger(
        executionId: String,
        triggeredBy: String,
        overrides: Map<String, Any?> = emptyMap()
    ): RetriggerResponse {
        val original = executionRepository.findById(executionId)
            ?: throw NotFoundException("Execution $executionId not found")

        val mergedInputs = original.inputs + overrides

        val kestraResponse = try {
            kestraClient.createExecution(original.namespace, original.flowId, partBuilder.fromMap(mergedInputs))
        } catch (e: WebApplicationException) {
            val status = e.response.status
            val body = runCatching { e.response.readEntity(String::class.java) }.getOrDefault("Kestra error")
            throw WebApplicationException(
                Response.status(if (status == 409) 409 else 502).entity(body).build()
            )
        } catch (e: Exception) {
            throw WebApplicationException(
                Response.status(502).entity("Kestra API unreachable: ${e.message}").build()
            )
        }

        val auditOverrides = overrides.ifEmpty { null }
        try {
            auditRepository.writeAudit(triggeredBy, executionId, kestraResponse.id, auditOverrides)
        } catch (e: Exception) {
            log.errorf(e, "Audit write failed: originalId=%s newId=%s", executionId, kestraResponse.id)
        }

        return RetriggerResponse(
            newExecutionId = kestraResponse.id,
            originalExecutionId = executionId,
            triggeredBy = triggeredBy,
            triggeredAt = Instant.now().toString()
        )
    }
}
