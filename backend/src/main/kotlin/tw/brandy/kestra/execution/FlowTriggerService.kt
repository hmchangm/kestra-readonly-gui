package tw.brandy.kestra.execution

import jakarta.enterprise.context.ApplicationScoped
import jakarta.ws.rs.NotFoundException
import jakarta.ws.rs.WebApplicationException
import jakarta.ws.rs.core.Response
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.jboss.logging.Logger
import java.time.Instant

@ApplicationScoped
class FlowTriggerService(
    private val flowRepository: FlowRepository,
    private val auditRepository: AuditRepository,
    private val partBuilder: KestraPartBuilder,
    @RestClient private val kestraClient: KestraClient
) {
    companion object {
        private val log = Logger.getLogger(FlowTriggerService::class.java)
    }

    fun trigger(namespace: String, flowId: String, triggeredBy: String, inputs: Map<String, Any?>): TriggerResponse {
        flowRepository.findFlow(namespace, flowId) ?: throw NotFoundException("Flow $namespace/$flowId not found")

        val kestraResponse = try {
            kestraClient.createExecution(namespace, flowId, partBuilder.fromMap(inputs))
        } catch (e: WebApplicationException) {
            val body = runCatching { e.response.readEntity(String::class.java) }.getOrDefault("Kestra error")
            throw WebApplicationException(Response.status(502).entity(body).build())
        } catch (e: Exception) {
            throw WebApplicationException(Response.status(502).entity("Kestra API unreachable: ${e.message}").build())
        }

        try {
            auditRepository.writeAudit("TRIGGER", triggeredBy, "$namespace/$flowId", kestraResponse.id, inputs.ifEmpty { null })
        } catch (e: Exception) {
            log.errorf(e, "Audit write failed: flow=%s/%s newId=%s", namespace, flowId, kestraResponse.id)
        }

        return TriggerResponse(kestraResponse.id, triggeredBy, Instant.now().toString())
    }
}
