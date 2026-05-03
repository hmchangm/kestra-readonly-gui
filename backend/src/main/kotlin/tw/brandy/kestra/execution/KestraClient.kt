package tw.brandy.kestra.execution

import jakarta.ws.rs.Consumes
import jakarta.ws.rs.POST
import jakarta.ws.rs.Path
import jakarta.ws.rs.PathParam
import jakarta.ws.rs.Produces
import jakarta.ws.rs.core.EntityPart
import jakarta.ws.rs.core.MediaType
import org.eclipse.microprofile.rest.client.annotation.ClientHeaderParam
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient

@RegisterRestClient(configKey = "kestra-api")
@ClientHeaderParam(name = "Authorization", value = ["\${kestra.auth.basic}"])
@Produces(MediaType.APPLICATION_JSON)
interface KestraClient {

    @POST
    @Path("/api/v1/main/executions/{namespace}/{flowId}")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    fun createExecution(
        @PathParam("namespace") namespace: String,
        @PathParam("flowId") flowId: String,
        parts: List<EntityPart>
    ): KestraExecutionResponse
}
