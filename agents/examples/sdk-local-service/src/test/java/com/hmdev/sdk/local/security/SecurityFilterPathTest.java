package com.hmdev.sdk.local.security;

import com.hmdev.sdk.local.config.SecurityProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Which paths the security filter lets through unauthenticated.
 *
 * This exists because the answer used to be "all of them": PUBLIC_ENDPOINTS
 * contained "/", the filter compared with startsWith(), and every HTTP path
 * begins with "/" — so every endpoint in this service, the SSH credential APIs
 * included, was public. Nothing failed; the bypass was silent.
 *
 * The filter's path decision is pure, so it is tested directly rather than
 * through a servlet stack — that keeps the protected list cheap enough to be
 * exhaustive.
 */
class SecurityFilterPathTest {

    private boolean isPublic(String path) {
        try {
            Method m = SecurityFilter.class.getDeclaredMethod("isPublicEndpoint", String.class);
            m.setAccessible(true);
            // The method touches no instance state, so a filter with no
            // collaborators is enough to invoke it.
            SecurityFilter filter = new SecurityFilter(null, null);
            return (boolean) m.invoke(filter, path);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("isPublicEndpoint(String) is the filter's routing decision", e);
        }
    }

    @Test
    @DisplayName("the bare root is not a public prefix for everything under it")
    void rootIsNotAPrefix() {
        assertThat(SecurityProperties.PUBLIC_SUBTREES)
                .as("a bare \"/\" subtree would make the whole service public again")
                .doesNotContain("/");
        assertThat(isPublic("/")).as("the index page itself stays reachable").isTrue();
    }

    @Test
    void theTerminalWebSocketIsReachableWithItsSessionId() {
        /*
         * The path carries the session id, so an exact-match entry can never
         * match it. That is what happened: "/terminal/stream" sat in
         * PUBLIC_ENDPOINTS, the filter blocked
         * "/terminal/stream/9d5f-…", and the service rejected the socket it
         * had just issued a token for. A browser WebSocket cannot send
         * X-SLS-Token, so there is no second way in.
         */
        assertThat(isPublic("/terminal/stream/9d5f6b7c-1234-4a5b-8c9d-0e1f2a3b4c5d")).isTrue();
        assertThat(isPublic("/terminal/stream")).isTrue();
    }

    @Test
    void butOnlyOnAPathSegmentBoundary() {
        // The control: a prefix that is not a whole segment must not inherit
        // the exemption, or "/terminal/stream" would open "/terminal/streamer".
        assertThat(isPublic("/terminal/streamer")).isFalse();
        assertThat(isPublic("/terminal/stream-admin")).isFalse();
    }

    @ParameterizedTest(name = "{0} requires authentication")
    @ValueSource(strings = {
            "/terminal/sessions",
            "/terminal/create",
            "/terminal/ssh-connections",
            "/terminal/ssh-connections/1",
            "/terminal/ssh-connections/by-name/prod",
            "/terminal/ssh-connections/test",
            "/config/backup/export",
            "/config/backup/import",
            "/filesystem/sessions",
            "/cloud/connection/secrets",
            "/auth/tokens",
            "/healthz",
            "/h2-consolexyz"
    })
    void protectedRoutesAreNotPublic(String path) {
        assertThat(isPublic(path))
                .as("%s must not be served without a token", path)
                .isFalse();
    }

    @ParameterizedTest(name = "{0} stays public")
    @ValueSource(strings = {
            "/health", "/auth/token", "/auth/status", "/auth/validate",
            "/favicon.ico", "/index.html", "/terminal/stream",
            "/cloud/connection", "/terminal/shells",
            "/h2-console", "/h2-console/login.do"
    })
    void declaredPublicRoutesStayPublic(String path) {
        assertThat(isPublic(path)).as("%s is deliberately public", path).isTrue();
    }

    @ParameterizedTest(name = "{0} cannot be spelled around the allowlist")
    @ValueSource(strings = {
            "/terminal/ssh-connections/",
            "/health/../terminal/ssh-connections",
            "/./terminal/ssh-connections"
    })
    void alternativeSpellingsDoNotSlipThrough(String path) {
        assertThat(isPublic(path))
                .as("%s resolves to a protected route", path)
                .isFalse();
    }

    @Test
    @DisplayName("a trailing slash does not hide a public route either")
    void trailingSlashStillMatchesPublicRoutes() {
        assertThat(isPublic("/health/")).isTrue();
    }
}
