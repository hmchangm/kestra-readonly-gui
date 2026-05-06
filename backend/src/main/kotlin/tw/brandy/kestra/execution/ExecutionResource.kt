package tw.brandy.kestra.execution

import io.quarkus.security.Authenticated
import io.quarkus.security.identity.SecurityIdentity
import jakarta.ws.rs.*
import jakarta.ws.rs.core.MediaType
import org.eclipse.microprofile.jwt.JsonWebToken
import jakarta.inject.Inject

@Path("/api/executions")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
class ExecutionResource(
    private val executionRepository: ExecutionRepository,
    private val retriggerService: RetriggerService,
    private val identity: SecurityIdentity
) {

    @Inject
    lateinit var jwt: JsonWebToken

    @GET
    @Path("/summary")
    fun summary(): SummaryResponse = executionRepository.getSummary()

    @GET
    fun list(
        @QueryParam("namespace") namespace: String?,
        @QueryParam("flowId") flowId: String?,
        @QueryParam("status") status: String?,
        @QueryParam("from") from: String?,
        @QueryParam("to") to: String?,
        @QueryParam("page") @DefaultValue("0") page: Int,
        @QueryParam("size") @DefaultValue("20") size: Int
    ): ExecutionPage = executionRepository.listExecutions(namespace, status, from, to, flowId, page, size)

    @GET
    @Path("/{id}")
    fun getById(@PathParam("id") id: String): ExecutionDetailRow =
        executionRepository.findById(id) ?: throw NotFoundException("Execution $id not found")

    private fun resolveUsername(): String =
        runCatching { jwt.getClaim<String>("preferred_username") }.getOrNull()
            ?: identity.principal.name

    @POST
    @Path("/{id}/retrigger")
    @Consumes(MediaType.APPLICATION_JSON)
    fun retriggerWithBody(@PathParam("id") id: String, body: RetriggerRequest?): RetriggerResponse {
        return retriggerService.retrigger(id, resolveUsername(), body?.overrides ?: emptyMap())
    }

    @POST
    @Path("/{id}/retrigger")
    fun retriggerNoBody(@PathParam("id") id: String): RetriggerResponse {
        return retriggerService.retrigger(id, resolveUsername(), emptyMap())
    }
}
