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
class FlowResourceTest {

    @InjectMock
    lateinit var flowRepository: FlowRepository

    @InjectMock
    lateinit var flowTriggerService: FlowTriggerService

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET flows returns list`() {
        `when`(flowRepository.listFlows()).thenReturn(listOf(FlowRow("prod", "daily", "2026-05-06T10:00:00Z", 2)))

        given().`when`().get("/api/flows")
            .then().statusCode(200)
            .body("size()", equalTo(1))
            .body("[0].namespace", equalTo("prod"))
            .body("[0].flowId", equalTo("daily"))
            .body("[0].executionCount", equalTo(2))
    }

    @Test
    fun `GET flows without token returns 401`() {
        given().`when`().get("/api/flows").then().statusCode(401)
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET flow detail returns detail for known flow`() {
        `when`(flowRepository.findFlow("prod", "daily")).thenReturn(FlowDetail("prod", "daily"))

        given().`when`().get("/api/flows/prod/daily")
            .then().statusCode(200)
            .body("namespace", equalTo("prod"))
            .body("flowId", equalTo("daily"))
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET flow detail returns 404 for unknown flow`() {
        `when`(flowRepository.findFlow("prod", "missing")).thenReturn(null)

        given().`when`().get("/api/flows/prod/missing").then().statusCode(404)
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `GET flow inputs returns input definitions`() {
        `when`(flowRepository.findFlowInputs("prod", "daily"))
            .thenReturn(listOf(FlowInput("date", "STRING"), FlowInput("flag", "BOOLEAN")))

        given().`when`().get("/api/flows/prod/daily/inputs")
            .then().statusCode(200)
            .body("size()", equalTo(2))
            .body("[0].id", equalTo("date"))
            .body("[1].type", equalTo("BOOLEAN"))
    }

    @Test
    @TestSecurity(user = "john.doe", roles = [])
    @OidcSecurity(claims = [Claim(key = "preferred_username", value = "john.doe")])
    fun `POST trigger returns trigger response`() {
        `when`(flowTriggerService.trigger("prod", "daily", "john.doe", mapOf("date" to "2026-05-06")))
            .thenReturn(TriggerResponse("exec-new", "john.doe", "2026-05-06T10:00:00Z"))

        given()
            .contentType("application/json")
            .body("""{"inputs":{"date":"2026-05-06"}}""")
            .`when`().post("/api/flows/prod/daily/trigger")
            .then().statusCode(200)
            .body("newExecutionId", equalTo("exec-new"))
            .body("triggeredBy", equalTo("john.doe"))
    }
}
