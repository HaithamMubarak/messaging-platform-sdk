package com.hmdev.messaging.sdk.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hmdev.messaging.sdk.service.MessagingServiceClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * /health is public and unauthenticated, and has a rule that is easy to break
 * without noticing: it must say whether the backend is reachable but never
 * which backend. It used to return the configured messaging service URL, which
 * on a normal deployment is an internal hostname and port.
 *
 * (/games was removed 2026-09-27: nothing consumed it, and it was a fourth
 * catalogue that disagreed with the other three.)
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


}
