package tw.brandy.kestra.execution

import io.quarkus.test.InjectMock
import io.quarkus.test.junit.QuarkusTest
import io.quarkus.test.junit.mockito.MockitoConfig
import jakarta.inject.Inject
import jakarta.ws.rs.BadRequestException
import jakarta.ws.rs.NotFoundException
import jakarta.ws.rs.WebApplicationException
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.*

@QuarkusTest
class CancelServiceTest {

    @Inject
    lateinit var service: CancelService

    @InjectMock
    lateinit var executionRepo: ExecutionRepository

    @InjectMock
    lateinit var auditRepo: AuditRepository

    @InjectMock
    @RestClient
    @MockitoConfig(convertScopes = true)
    lateinit var kestraClient: KestraClient

    @Test
    fun `cancel returns response with executionId and cancelledBy`() {
        val detail = ExecutionDetailRow("exec-1", "ns", "flow", "RUNNING", null, null, emptyMap(), emptyList())
        `when`(executionRepo.findById("exec-1")).thenReturn(detail)
        doNothing().`when`(kestraClient).killExecution("exec-1")

        val result = service.cancel("exec-1", "john.doe")

        assertEquals("exec-1", result.executionId)
        assertEquals("john.doe", result.cancelledBy)
        assertNotNull(result.cancelledAt)
        verify(auditRepo).writeAudit("CANCEL", "john.doe", "exec-1", null, null)
    }

    @Test
    fun `cancel throws NotFoundException when execution does not exist`() {
        `when`(executionRepo.findById("missing")).thenReturn(null)

        assertThrows(NotFoundException::class.java) { service.cancel("missing", "user") }
        verifyNoInteractions(kestraClient)
        verifyNoInteractions(auditRepo)
    }

    @Test
    fun `cancel throws BadRequestException for terminal state`() {
        listOf("SUCCESS", "WARNING", "FAILED", "KILLED").forEach { state ->
            val detail = ExecutionDetailRow("exec-t", "ns", "flow", state, null, null, emptyMap(), emptyList())
            `when`(executionRepo.findById("exec-t")).thenReturn(detail)

            assertThrows(BadRequestException::class.java) { service.cancel("exec-t", "user") }
        }
        verifyNoInteractions(kestraClient)
        verifyNoInteractions(auditRepo)
    }

    @Test
    fun `cancel is allowed for all cancellable states`() {
        listOf("CREATED", "RUNNING", "PAUSED", "RESTARTED", "KILLING").forEach { state ->
            val detail = ExecutionDetailRow("exec-$state", "ns", "flow", state, null, null, emptyMap(), emptyList())
            `when`(executionRepo.findById("exec-$state")).thenReturn(detail)
            doNothing().`when`(kestraClient).killExecution("exec-$state")

            assertDoesNotThrow { service.cancel("exec-$state", "user") }
        }
    }

    @Test
    fun `cancel wraps Kestra API error as 502`() {
        val detail = ExecutionDetailRow("exec-3", "ns", "flow", "RUNNING", null, null, emptyMap(), emptyList())
        `when`(executionRepo.findById("exec-3")).thenReturn(detail)
        doThrow(RuntimeException("connection refused")).`when`(kestraClient).killExecution("exec-3")

        val ex = assertThrows(WebApplicationException::class.java) { service.cancel("exec-3", "user") }
        assertEquals(502, ex.response.status)
        verifyNoInteractions(auditRepo)
    }

    @Test
    fun `cancel still returns success when audit write fails`() {
        val detail = ExecutionDetailRow("exec-4", "ns", "flow", "RUNNING", null, null, emptyMap(), emptyList())
        `when`(executionRepo.findById("exec-4")).thenReturn(detail)
        doNothing().`when`(kestraClient).killExecution("exec-4")
        doThrow(RuntimeException("DB down")).`when`(auditRepo)
            .writeAudit(anyString(), anyString(), anyString(), any(), any())

        val result = service.cancel("exec-4", "user")
        assertEquals("exec-4", result.executionId)
    }
}
