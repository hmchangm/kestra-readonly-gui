package tw.brandy.kestra.util

import io.quarkus.test.junit.QuarkusTest
import jakarta.inject.Inject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import javax.sql.DataSource

@QuarkusTest
class ResultSetExtTest {

    @Inject
    lateinit var ds: DataSource

    @Test
    fun `toList maps all rows`() {
        ds.connection.use { conn ->
            conn.prepareStatement("SELECT 1 AS n UNION SELECT 2 UNION SELECT 3").use { ps ->
                val result = ps.executeQuery().use { rs ->
                    rs.toList { it.getInt("n") }
                }
                assertEquals(listOf(1, 2, 3), result.sorted())
            }
        }
    }

    @Test
    fun `toList returns empty list for no rows`() {
        ds.connection.use { conn ->
            conn.prepareStatement("SELECT 1 WHERE 1=0").use { ps ->
                val result = ps.executeQuery().use { rs -> rs.toList { it.getInt(1) } }
                assertEquals(emptyList<Int>(), result)
            }
        }
    }
}
