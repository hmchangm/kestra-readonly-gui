package tw.brandy.kestra.execution

import jakarta.enterprise.context.ApplicationScoped
import jakarta.ws.rs.BadRequestException
import jakarta.ws.rs.NotFoundException
import jakarta.ws.rs.WebApplicationException
import jakarta.ws.rs.core.Response
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.jboss.logging.Logger
import java.time.Instant

@ApplicationScoped
class CancelService(
    private val executionRepository: ExecutionRepository,
    private val auditRepository: AuditRepository,
    @RestClient private val kestraClient: KestraClient
) {
    companion object {
        private val log = Logger.getLogger(CancelService::class.java)
        private val CANCELLABLE_STATES = setOf("CREATED", "RUNNING", "PAUSED", "RESTARTED", "KILLING")
    }

    fun cancel(executionId: String, cancelledBy: String): CancelResponse {
        val execution = executionRepository.findById(executionId)
            ?: throw NotFoundException("Execution $executionId not found")

        if (execution.state !in CANCELLABLE_STATES) {
            throw BadRequestException(
                "Execution $executionId is in state ${execution.state} and cannot be cancelled"
            )
        }

        try {
            kestraClient.killExecution(executionId)
        } catch (e: WebApplicationException) {
            val status = e.response.status
            val body = runCatching { e.response.readEntity(String::class.java) }.getOrDefault("Kestra error")
            throw WebApplicationException(Response.status(if (status == 404) 404 else 502).entity(body).build())
        } catch (e: Exception) {
            throw WebApplicationException(
                Response.status(502).entity("Kestra API unreachable: ${e.message}").build()
            )
        }

        try {
            auditRepository.writeAudit("CANCEL", cancelledBy, executionId)
        } catch (e: Exception) {
            log.errorf(e, "Audit write failed for cancel: executionId=%s", executionId)
        }

        return CancelResponse(
            executionId = executionId,
            cancelledBy = cancelledBy,
            cancelledAt = Instant.now().toString()
        )
    }
}
