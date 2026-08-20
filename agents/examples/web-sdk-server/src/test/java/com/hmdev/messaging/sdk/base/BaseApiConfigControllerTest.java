package com.hmdev.messaging.sdk.base;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hmdev.messaging.sdk.dto.ApiAccessRequest;
import com.hmdev.messaging.sdk.dto.ApiConfigResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * POST /app/api/config is unauthenticated by design — the demo pages need a key
 * before anybody has signed in. That makes two of its properties load-bearing
 * rather than incidental: a caller must not be able to choose how long the key
 * it mints lives, and it must not be possible to harvest keys in a loop.
 *
 * These tests exist so neither can be relaxed by accident.
 */
class BaseApiConfigControllerTest {

    /** Records the TTL actually passed downstream, so we can assert on the clamp. */
    private static class RecordingClient implements MessagingServiceClientInterface {
        final List<Integer> ttls = new ArrayList<>();

        @Override
        public ApiConfigResponse getApiAccessDetails(Integer ttlSeconds, Boolean singleUse) {
            ttls.add(ttlSeconds);
            return ApiConfigResponse.builder()
                    .temporaryKey("temp-key")
                    .ttlSeconds(ttlSeconds)
                    .singleUse(singleUse)
                    .build();
        }
    }

    @RestController
    @RequestMapping("/app/api")
    static class TestController extends BaseApiConfigController {
        TestController(MessagingServiceClientInterface client) {
            super(client);
        }
    }

    private RecordingClient client;
    private MockMvc mvc;
    private final ObjectMapper json = new ObjectMapper();

    @BeforeEach
    void setUp() {
        client = new RecordingClient();
        // A fresh controller per test: the rate-limit buckets are instance state.
        mvc = MockMvcBuilders.standaloneSetup(new TestController(client)).build();
    }

    private void requestKey(Integer ttlSeconds, String clientAddress) throws Exception {
        mvc.perform(post("/app/api/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Forwarded-For", clientAddress)
                        .content(json.writeValueAsString(new ApiAccessRequest(ttlSeconds, false))))
                .andExpect(status().isOk());
    }

    // ------------------------------------------------------------------ TTL

    @Test
    @DisplayName("a caller asking for a day gets the 300s ceiling, not a day")
    void clampsAnAbsurdTtlToTheCeiling() throws Exception {
        requestKey(86_400, "10.0.0.1");
        assertThat(client.ttls).containsExactly(BaseApiConfigController.MAX_TTL_SECONDS);
    }

    @Test
    @DisplayName("a TTL below the floor is raised, not honoured")
    void clampsATinyTtlToTheFloor() throws Exception {
        requestKey(1, "10.0.0.2");
        assertThat(client.ttls).containsExactly(BaseApiConfigController.MIN_TTL_SECONDS);
    }

    @Test
    @DisplayName("the TTLs the bundled apps actually ask for pass through untouched")
    void leavesTheAppsOwnTtlsAlone() {
        assertThat(BaseApiConfigController.clampTtl(60)).isEqualTo(60);
        assertThat(BaseApiConfigController.clampTtl(300)).isEqualTo(300);
    }

    @Test
    @DisplayName("no TTL means the default, not unlimited")
    void appliesTheDefaultWhenNoTtlIsGiven() {
        assertThat(BaseApiConfigController.clampTtl(null))
                .isEqualTo(BaseApiConfigController.DEFAULT_TTL_SECONDS);
    }

    @Test
    @DisplayName("a missing request body is still served, at the default TTL")
    void acceptsAnEmptyBody() throws Exception {
        mvc.perform(post("/app/api/config").contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"));
        assertThat(client.ttls).containsExactly(BaseApiConfigController.DEFAULT_TTL_SECONDS);
    }

    @Test
    @DisplayName("a negative TTL cannot produce a key that is already expired")
    void clampsANegativeTtl() throws Exception {
        requestKey(-1, "10.0.0.3");
        assertThat(client.ttls).containsExactly(BaseApiConfigController.MIN_TTL_SECONDS);
    }

    // ----------------------------------------------------------- rate limit

    @Test
    @DisplayName("a script looping on this endpoint is cut off at the limit")
    void refusesMoreThanThePerMinuteLimit() throws Exception {
        int limit = BaseApiConfigController.RATE_LIMIT_PER_MINUTE;
        for (int i = 0; i < limit; i++) {
            requestKey(60, "10.0.0.9");
        }

        mvc.perform(post("/app/api/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Forwarded-For", "10.0.0.9")
                        .content(json.writeValueAsString(new ApiAccessRequest(60, false))))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.status").value("error"));

        // The refusal must stop the key being minted, not just change the reply.
        assertThat(client.ttls).hasSize(limit);
    }

    @Test
    @DisplayName("one noisy client does not exhaust the budget of every other client")
    void limitsPerClientAddressRatherThanGlobally() throws Exception {
        for (int i = 0; i < BaseApiConfigController.RATE_LIMIT_PER_MINUTE; i++) {
            requestKey(60, "198.51.100.10");
        }
        // A different address still gets served.
        requestKey(60, "198.51.100.11");
        assertThat(client.ttls).hasSize(BaseApiConfigController.RATE_LIMIT_PER_MINUTE + 1);
    }

    @Test
    @DisplayName("a forged leading X-Forwarded-For cannot buy a fresh bucket per request")
    void ignoresACallerSuppliedForwardedPrefix() throws Exception {
        // nginx uses $proxy_add_x_forwarded_for, which APPENDS the real address to
        // whatever the caller sent. So the leftmost token is attacker-controlled:
        // reading it let a script rotate identities and mint keys without limit.
        // Only the rightmost hop — the address our own proxy observed — counts.
        for (int i = 0; i < BaseApiConfigController.RATE_LIMIT_PER_MINUTE; i++) {
            requestKey(60, "forged-" + i + ", 198.51.100.4");
        }

        mvc.perform(post("/app/api/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Forwarded-For", "forged-999, 198.51.100.4")
                        .content(json.writeValueAsString(new ApiAccessRequest(60, false))))
                .andExpect(status().isTooManyRequests());

        assertThat(client.ttls).hasSize(BaseApiConfigController.RATE_LIMIT_PER_MINUTE);
    }

    @Test
    @DisplayName("X-Real-IP from our own proxy identifies the client")
    void prefersRealIpFromATrustedProxy() throws Exception {
        for (int i = 0; i < BaseApiConfigController.RATE_LIMIT_PER_MINUTE; i++) {
            mvc.perform(post("/app/api/config")
                            .contentType(MediaType.APPLICATION_JSON)
                            .header("X-Real-IP", "198.51.100.9")
                            .content(json.writeValueAsString(new ApiAccessRequest(60, false))))
                    .andExpect(status().isOk());
        }
        mvc.perform(post("/app/api/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Real-IP", "198.51.100.9")
                        .content(json.writeValueAsString(new ApiAccessRequest(60, false))))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("forwarding headers from an untrusted peer are ignored entirely")
    void ignoresForwardingHeadersFromAnUntrustedPeer() throws Exception {
        // Reached directly rather than through our proxy: the caller could set any
        // header it likes, so the socket address is the only thing worth trusting.
        for (int i = 0; i < BaseApiConfigController.RATE_LIMIT_PER_MINUTE; i++) {
            directRequest("203.0.113.50", "spoofed-" + i);
        }
        mvc.perform(post("/app/api/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Forwarded-For", "spoofed-999")
                        .with(req -> { req.setRemoteAddr("203.0.113.50"); return req; })
                        .content(json.writeValueAsString(new ApiAccessRequest(60, false))))
                .andExpect(status().isTooManyRequests());
    }

    private void directRequest(String remoteAddr, String forgedForwardedFor) throws Exception {
        mvc.perform(post("/app/api/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Forwarded-For", forgedForwardedFor)
                        .with(req -> { req.setRemoteAddr(remoteAddr); return req; })
                        .content(json.writeValueAsString(new ApiAccessRequest(60, false))))
                .andExpect(status().isOk());
    }
}
