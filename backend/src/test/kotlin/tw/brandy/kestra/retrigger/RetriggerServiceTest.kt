package tw.brandy.kestra.retrigger

import io.quarkus.test.InjectMock
import io.quarkus.test.junit.QuarkusTest
import io.quarkus.test.junit.mockito.MockitoConfig
import jakarta.inject.Inject
import jakarta.ws.rs.NotFoundException
import org.eclipse.microprofile.rest.client.inject.RestClient
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.anyList
import org.mockito.ArgumentMatchers.anyMap
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.*
import tw.brandy.kestra.execution.*

@QuarkusTest
class RetriggerServiceTest {

    @Inject
    lateinit var service: RetriggerService

    @InjectMock
    lateinit var executionRepo: ExecutionRepository

    @InjectMock
    lateinit var auditRepo: AuditRepository

    @InjectMock
    lateinit var partBuilder: tw.brandy.kestra.execution.KestraPartBuilder

    @InjectMock
    @RestClient
    @MockitoConfig(convertScopes = true)
    lateinit var kestraClient: KestraClient

    @Test
    fun `retrigger returns new execution id`() {
        val detail = ExecutionDetailRow("orig-1", "ns", "flow", "FAILED", null, null, mapOf("date" to "2026-05-01"), emptyList())
        `when`(executionRepo.findById("orig-1")).thenReturn(detail)
        `when`(partBuilder.fromMap(anyMap())).thenReturn(emptyList())
        `when`(kestraClient.createExecution(anyString(), anyString(), anyList()))
            .thenReturn(KestraExecutionResponse("new-99"))

        val result = service.retrigger("orig-1", "john.doe")

        assertEquals("new-99", result.newExecutionId)
        assertEquals("orig-1", result.originalExecutionId)
        assertEquals("john.doe", result.triggeredBy)
        verify(auditRepo).writeAudit("john.doe", "orig-1", "new-99", null)
    }

    @Test
    fun `retrigger throws NotFoundException when execution missing`() {
        `when`(executionRepo.findById("missing")).thenReturn(null)

        assertThrows(NotFoundException::class.java) {
            service.retrigger("missing", "user")
        }
        verifyNoInteractions(kestraClient)
        verifyNoInteractions(auditRepo)
    }

    @Test
    fun `retrigger still returns success when audit write fails`() {
        val detail = ExecutionDetailRow("orig-2", "ns", "flow", "SUCCESS", null, null, emptyMap(), emptyList())
        `when`(executionRepo.findById("orig-2")).thenReturn(detail)
        `when`(partBuilder.fromMap(anyMap())).thenReturn(emptyList())
        `when`(kestraClient.createExecution(anyString(), anyString(), anyList()))
            .thenReturn(KestraExecutionResponse("new-77"))
        doThrow(RuntimeException("DB down")).`when`(auditRepo)
            .writeAudit(anyString(), anyString(), anyString(), org.mockito.ArgumentMatchers.any())

        val result = service.retrigger("orig-2", "user")

        assertEquals("new-77", result.newExecutionId)
    }

    @Test
    fun `retrigger with overrides merges inputs and records delta in audit`() {
        val detail = ExecutionDetailRow("orig-3", "ns", "flow", "FAILED", null, null,
            mapOf("date" to "2026-05-01", "count" to 5), emptyList())
        `when`(executionRepo.findById("orig-3")).thenReturn(detail)
        `when`(partBuilder.fromMap(anyMap())).thenReturn(emptyList())
        `when`(kestraClient.createExecution(anyString(), anyString(), anyList()))
            .thenReturn(KestraExecutionResponse("new-100"))

        val overrides = mapOf<String, Any?>("date" to "2026-05-02")
        val result = service.retrigger("orig-3", "john.doe", overrides)

        assertEquals("new-100", result.newExecutionId)
        verify(kestraClient).createExecution(anyString(), anyString(), anyList())
        verify(auditRepo).writeAudit("john.doe", "orig-3", "new-100", overrides)
    }

    @Test
    fun `retrigger with empty overrides sends original inputs and records null in audit`() {
        val detail = ExecutionDetailRow("orig-4", "ns", "flow", "FAILED", null, null,
            mapOf("date" to "2026-05-01"), emptyList())
        `when`(executionRepo.findById("orig-4")).thenReturn(detail)
        `when`(partBuilder.fromMap(anyMap())).thenReturn(emptyList())
        `when`(kestraClient.createExecution(anyString(), anyString(), anyList()))
            .thenReturn(KestraExecutionResponse("new-101"))

        service.retrigger("orig-4", "john.doe", emptyMap())

        verify(kestraClient).createExecution(anyString(), anyString(), anyList())
        verify(auditRepo).writeAudit("john.doe", "orig-4", "new-101", null)
    }
}
