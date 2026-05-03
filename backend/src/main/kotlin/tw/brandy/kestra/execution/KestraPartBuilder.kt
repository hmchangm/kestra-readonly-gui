package tw.brandy.kestra.execution

import jakarta.enterprise.context.ApplicationScoped
import jakarta.ws.rs.core.EntityPart

@ApplicationScoped
class KestraPartBuilder {
    fun fromMap(inputs: Map<String, Any?>): List<EntityPart> =
        inputs.map { (key, value) ->
            EntityPart.withName(key).content(value?.toString() ?: "").build()
        }
}
