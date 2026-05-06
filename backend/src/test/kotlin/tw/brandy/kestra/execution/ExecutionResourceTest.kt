package tw.brandy.kestra.execution

import io.quarkus.test.InjectMock
import io.quarkus.test.junit.QuarkusTest
import io.quarkus.test.security.TestSecurity
import io.quarkus.test.security.oidc.Claim
import io.quarkus.test.security.oidc.OidcSecurity
import io.restassured.RestAssured.given
import org.hamcrest.Matchers.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.`when`

@QuarkusTest
class ExecutionResourceTest {

    @InjectMock
    lateinit var executionRepository: ExecutionRepository

    @InjectMock
    lateinit var retriggerService: RetriggerService

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET executions returns page`() {
        `when`(executionRepository.listExecutions(null, null, null, null, null, 0, 20))
            .thenReturn(ExecutionPage(2, 0, 20, listOf(
                ExecutionRow("id-1", "ns", "flow", "SUCCESS", null, null),
                ExecutionRow("id-2", "ns", "flow", "FAILED", null, null)
            )))

        given().`when`().get("/api/executions")
            .then().statusCode(200)
            .body("total", equalTo(2))
            .body("results.size()", equalTo(2))
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET executions passes flowId query parameter`() {
        `when`(executionRepository.listExecutions("prod", null, null, null, "daily", 0, 20))
            .thenReturn(ExecutionPage(1, 0, 20, listOf(
                ExecutionRow("exec-1", "prod", "daily", "SUCCESS", null, null)
            )))

        given().queryParam("namespace", "prod").queryParam("flowId", "daily")
            .`when`().get("/api/executions")
            .then().statusCode(200)
            .body("total", equalTo(1))
            .body("results[0].flowId", equalTo("daily"))
    }

    @Test
    fun `GET executions without token returns 401`() {
        given().`when`().get("/api/executions")
            .then().statusCode(401)
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST retrigger with no body uses empty overrides`() {
        `when`(retriggerService.retrigger("exec-1", "john.doe", emptyMap()))
            .thenReturn(RetriggerResponse("new-1", "exec-1", "john.doe", "2026-05-01T00:00:00Z"))

        given().`when`().post("/api/executions/exec-1/retrigger")
            .then().statusCode(200)
            .body("newExecutionId", equalTo("new-1"))
            .body("triggeredBy", equalTo("john.doe"))
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET namespaces returns sorted list`() {
        `when`(executionRepository.listNamespaces())
            .thenReturn(listOf("company.finance", "company.ops", "company.team"))

        given().`when`().get("/api/namespaces")
            .then().statusCode(200)
            .body("size()", equalTo(3))
            .body("[0]", equalTo("company.finance"))
            .body("[2]", equalTo("company.team"))
    }

    @Test
    fun `GET namespaces without token returns 401`() {
        given().`when`().get("/api/namespaces")
            .then().statusCode(401)
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST retrigger with overrides body passes overrides to service`() {
        val overrides = mapOf<String, Any?>("date" to "2026-05-02")
        `when`(retriggerService.retrigger("exec-2", "john.doe", overrides))
            .thenReturn(RetriggerResponse("new-2", "exec-2", "john.doe", "2026-05-01T00:00:00Z"))

        given()
            .contentType("application/json")
            .body("""{"overrides":{"date":"2026-05-02"}}""")
            .`when`().post("/api/executions/exec-2/retrigger")
            .then().statusCode(200)
            .body("newExecutionId", equalTo("new-2"))
    }
}
