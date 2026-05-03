package tw.brandy.kestra

import io.quarkus.runtime.LaunchMode
import io.quarkus.security.identity.AuthenticationRequestContext
import io.quarkus.security.identity.SecurityIdentity
import io.quarkus.security.identity.SecurityIdentityAugmentor
import io.quarkus.security.runtime.QuarkusPrincipal
import io.quarkus.security.runtime.QuarkusSecurityIdentity
import io.smallrye.mutiny.Uni
import jakarta.enterprise.context.ApplicationScoped

@ApplicationScoped
class DevIdentityAugmentor : SecurityIdentityAugmentor {

    override fun augment(identity: SecurityIdentity, context: AuthenticationRequestContext): Uni<SecurityIdentity> {
        if (LaunchMode.current() != LaunchMode.DEVELOPMENT) return Uni.createFrom().item(identity)
        if (!identity.isAnonymous) return Uni.createFrom().item(identity)
        return Uni.createFrom().item(
            QuarkusSecurityIdentity.builder()
                .setPrincipal(QuarkusPrincipal("dev-user"))
                .setAnonymous(false)
                .build()
        )
    }
}
