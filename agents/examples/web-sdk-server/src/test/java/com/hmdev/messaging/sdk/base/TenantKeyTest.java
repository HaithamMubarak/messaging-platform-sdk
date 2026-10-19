package com.hmdev.messaging.sdk.base;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hmdev.messaging.sdk.dto.ApiAccessRequest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Which key a temporary key is minted from. The games' rooms count against the
 * account that owns the minting key, so a game asking for the "games" tenant
 * must get the Games key when this server has one, and the site's own (the
 * demos' quota, as before) when it does not, so a game never breaks for a
 * missing setting.
 */
class TenantKeyTest {

    /** The base class with fixed keys; null games key means "not configured". */
    private static BaseMessagingServiceClient client(String gamesKey) {
        return new BaseMessagingServiceClient(new RestTemplate()) {
            @Override protected String getApiKey() { return "site-key"; }
            @Override protected String getMessagingServiceUrl() { return "http://localhost:0"; }
            @Override protected String getTenantApiKey(String tenant) { return "games".equals(tenant) ? gamesKey : null; }
        };
    }

    @Test
    @DisplayName("the games tenant is minted from the Games key when it is configured")
    void gamesKeyWhenConfigured() {
        assertThat(client("games-key").keyFor("games")).isEqualTo("games-key");
    }

    @Test
    @DisplayName("no tenant, an unknown one, or an unset Games key all mint from the site's own key")
    void siteKeyOtherwise() {
        assertThat(client("games-key").keyFor(null)).isEqualTo("site-key");
        assertThat(client("games-key").keyFor("someone-else")).isEqualTo("site-key");
        assertThat(client("").keyFor("games")).isEqualTo("site-key");
        assertThat(client(null).keyFor("games")).isEqualTo("site-key");
    }

    @Test
    @DisplayName("the request forwarded to messaging-service carries no tenant field")
    void tenantStaysHere() throws Exception {
        String body = new ObjectMapper().writeValueAsString(new ApiAccessRequest(60, false));
        assertThat(body).doesNotContain("tenant");
        assertThat(body).contains("\"ttlSeconds\":60");
    }
}
