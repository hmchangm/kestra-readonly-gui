package tw.brandy.kestra.execution

import io.quarkus.security.Authenticated
import jakarta.ws.rs.GET
import jakarta.ws.rs.Path
import jakarta.ws.rs.Produces
import jakarta.ws.rs.core.MediaType

@Path("/api/namespaces")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
class NamespaceResource(
    private val executionRepository: ExecutionRepository
) {
    @GET
    fun list(): List<String> = executionRepository.listNamespaces()
}
