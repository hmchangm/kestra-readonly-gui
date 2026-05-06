package tw.brandy.kestra.execution

import io.quarkus.security.Authenticated
import io.quarkus.security.identity.SecurityIdentity
import jakarta.inject.Inject
import jakarta.ws.rs.*
import jakarta.ws.rs.core.MediaType
import org.eclipse.microprofile.jwt.JsonWebToken

@Path("/api/flows")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
class FlowResource(
    private val flowRepository: FlowRepository,
    private val flowTriggerService: FlowTriggerService,
    private val identity: SecurityIdentity
) {

    @Inject
    lateinit var jwt: JsonWebToken

    @GET
    fun list(): List<FlowRow> = flowRepository.listFlows()

    @GET
    @Path("/{namespace}/{flowId}")
    fun detail(@PathParam("namespace") namespace: String, @PathParam("flowId") flowId: String): FlowDetail =
        flowRepository.findFlow(namespace, flowId) ?: throw NotFoundException("Flow $namespace/$flowId not found")

    @GET
    @Path("/{namespace}/{flowId}/inputs")
    fun inputs(@PathParam("namespace") namespace: String, @PathParam("flowId") flowId: String): List<FlowInput> =
        flowRepository.findFlowInputs(namespace, flowId)

    @POST
    @Path("/{namespace}/{flowId}/trigger")
    @Consumes(MediaType.APPLICATION_JSON)
    fun trigger(
        @PathParam("namespace") namespace: String,
        @PathParam("flowId") flowId: String,
        body: TriggerRequest?
    ): TriggerResponse =
        flowTriggerService.trigger(namespace, flowId, resolveUsername(), body?.inputs ?: emptyMap())

    private fun resolveUsername(): String =
        runCatching { jwt.getClaim<String>("preferred_username") }.getOrNull()
            ?: identity.principal.name
}
