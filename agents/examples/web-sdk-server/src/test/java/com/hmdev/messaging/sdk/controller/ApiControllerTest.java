package com.hmdev.messaging.sdk.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hmdev.messaging.sdk.service.MessagingServiceClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Iterator;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Both endpoints here are public and unauthenticated, and both have a rule that
 * is easy to break without noticing:
 *
 *  - /health must say whether the backend is reachable but never which backend.
 *    It used to return the configured messaging service URL, which on a normal
 *    deployment is an internal hostname and port.
 *  - /games must hand out RELATIVE urls. The site is served from
 *    /messaging-platform/sdk/, so a leading slash points at nothing.
 */
class ApiControllerTest {

    private MessagingServiceClient client;
    private MockMvc mvc;
    private final ObjectMapper json = new ObjectMapper();

    @BeforeEach
    void setUp() {
        client = mock(MessagingServiceClient.class);
        when(client.isMessagingServiceAvailable()).thenReturn(true);
        mvc = MockMvcBuilders.standaloneSetup(new ApiController(client)).build();
    }

    // --------------------------------------------------------------- health

    @Test
    @DisplayName("health never discloses which backend it is talking to")
    void healthDoesNotLeakTheBackendUrl() throws Exception {
        String body = mvc.perform(get("/app/api/health"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("messagingServiceUrl");
        // Nothing that looks like a host, port or scheme should survive either.
        assertThat(body).doesNotContain("http://").doesNotContain("https://");

        Map<String, Object> parsed = json.readValue(body, new TypeReference<>() { });
        assertThat(parsed.keySet())
                .containsExactlyInAnyOrder("status", "service", "version", "messagingService");
    }

    @Test
    @DisplayName("health still reports whether the backend is reachable")
    void healthReportsBackendReachability() throws Exception {
        mvc.perform(get("/app/api/health"))
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.messagingService").value("UP"));

        when(client.isMessagingServiceAvailable()).thenReturn(false);
        mvc.perform(get("/app/api/health"))
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.messagingService").value("DOWN"));
    }

    @Test
    @DisplayName("version comes from the jar manifest, falling back to dev when unstamped")
    void healthReportsAVersion() throws Exception {
        // Under Gradle's test runtime there is no jar manifest, so this is "dev";
        // the assertion is that the field is populated at all, not hardcoded.
        mvc.perform(get("/app/api/health"))
                .andExpect(jsonPath("$.version").isNotEmpty());
    }

    // ---------------------------------------------------------------- games

    @Test
    @DisplayName("every game url is relative, because the site is not at the domain root")
    void gameUrlsAreRelative() throws Exception {
        JsonNode games = games();
        assertThat(games).isNotEmpty();

        for (Iterator<String> it = games.fieldNames(); it.hasNext(); ) {
            String key = it.next();
            String url = games.get(key).get("url").asText();
            assertThat(url).as("url for %s", key).doesNotStartWith("/").doesNotStartWith("http");
        }
    }

    @Test
    @DisplayName("every listed game carries the metadata the catalogue promises")
    void gamesAreFullyDescribed() throws Exception {
        JsonNode games = games();

        for (Iterator<String> it = games.fieldNames(); it.hasNext(); ) {
            String key = it.next();
            JsonNode game = games.get(key);
            for (String field : new String[] { "name", "icon", "description", "url",
                                               "players", "duration", "difficulty" }) {
                assertThat(game.hasNonNull(field)).as("%s.%s present", key, field).isTrue();
                assertThat(game.get(field).asText()).as("%s.%s non-blank", key, field).isNotBlank();
            }
        }
    }

    @Test
    @DisplayName("the catalogue lists the games that were previously unreachable")
    void gamesIncludeTheOnesNothingUsedToLinkTo() throws Exception {
        JsonNode games = games();
        assertThat(games.has("pictionary")).isTrue();
        assertThat(games.has("chess")).isTrue();
    }

    @Test
    @DisplayName("the catalogue does not advertise the demos this site does not publish")
    void gamesExcludeUnpublishedDemos() throws Exception {
        JsonNode games = games();
        assertThat(games.has("party-physics")).isFalse();
        assertThat(games.has("race-balls")).isFalse();
    }

    private JsonNode games() throws Exception {
        String body = mvc.perform(get("/app/api/games"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).get("data");
    }
}
