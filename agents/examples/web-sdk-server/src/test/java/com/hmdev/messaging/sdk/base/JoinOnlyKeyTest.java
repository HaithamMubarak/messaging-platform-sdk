package com.hmdev.messaging.sdk.base;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hmdev.messaging.sdk.dto.ApiConfigResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * POST /app/api/config {createChannels:false} hands a guest's page a join-only
 * key: it joins rooms that exist and never creates one, so the page cannot open
 * a room of its own and be first in it. A key that CAN create must never be
 * handed out in its place, whichever part fails to make it join-only.
 */
class JoinOnlyKeyTest {

    private final ObjectMapper json = new ObjectMapper();

    /* ---- the endpoint ---- */

    /** Records what the controller asked for; mints join-only keys as asked. */
    private static class RecordingClient implements MessagingServiceClientInterface {
        final List<Boolean> joinOnly = new ArrayList<>();

        @Override
        public ApiConfigResponse getApiAccessDetails(Integer ttlSeconds, Boolean singleUse) {
            return getApiAccessDetails(null, ttlSeconds, singleUse, false);
        }

        @Override
        public ApiConfigResponse getApiAccessDetails(String tenant, Integer ttlSeconds, Boolean singleUse, boolean only) {
            joinOnly.add(only);
            return ApiConfigResponse.builder().temporaryKey("temp").createChannels(!only).build();
        }
    }

    /** A client written before join-only keys: it overrides only the old method. */
    private static class OlderClient implements MessagingServiceClientInterface {
        @Override
        public ApiConfigResponse getApiAccessDetails(Integer ttlSeconds, Boolean singleUse) {
            return ApiConfigResponse.builder().temporaryKey("creates-rooms").build();
        }
    }

    @RestController
    @RequestMapping("/app/api")
    static class TestController extends BaseApiConfigController {
        TestController(MessagingServiceClientInterface c) { super(c); }
    }

    private static MockMvc mvc(MessagingServiceClientInterface client) {
        return MockMvcBuilders.standaloneSetup(new TestController(client)).build();
    }

    @Test
    @DisplayName("createChannels:false asks for a join-only key, and the page is told it got one")
    void asksForJoinOnly() throws Exception {
        RecordingClient client = new RecordingClient();
        mvc(client).perform(post("/app/api/config").contentType(MediaType.APPLICATION_JSON)
                .content("{\"ttlSeconds\":60,\"createChannels\":false}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.createChannels").value(false));
        assertThat(client.joinOnly).containsExactly(true);
    }

    @Test
    @DisplayName("no field, or createChannels:true, mints the key pages have always had")
    void otherwiseUnchanged() throws Exception {
        RecordingClient client = new RecordingClient();
        MockMvc mvc = mvc(client);
        for (String body : new String[] {"{\"ttlSeconds\":60}", "{\"createChannels\":true}"}) {
            mvc.perform(post("/app/api/config").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
        }
        mvc.perform(post("/app/api/config").contentType(MediaType.APPLICATION_JSON)).andExpect(status().isOk());
        assertThat(client.joinOnly).containsExactly(false, false, false);
    }

    @Test
    @DisplayName("a client that cannot mint join-only keys refuses instead of handing out one that creates rooms")
    void anOlderClientRefuses() throws Exception {
        mvc(new OlderClient()).perform(post("/app/api/config").contentType(MediaType.APPLICATION_JSON)
                .content("{\"createChannels\":false}"))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.data").doesNotExist());
    }

    /* ---- what is sent to the messaging service ---- */

    private static BaseMessagingServiceClient client(RestTemplate rest) {
        return new BaseMessagingServiceClient(rest) {
            @Override protected String getApiKey() { return "real-key"; }
            @Override protected String getMessagingServiceUrl() { return "http://messaging"; }
        };
    }

    /** The service's answer to /channels/api-access, as captured live (key redacted, plan trimmed). */
    private static String answer(String createChannels) {
        return "{\"status\":\"success\",\"statusMessage\":null,\"data\":{\"temporaryKey\":\"tk\",\"ttlSeconds\":60,"
            + "\"singleUse\":false,\"expiresAt\":1792703826974" + createChannels + ",\"plan\":{\"name\":\"Free\"}}}";
    }

    private JsonNode mint(boolean joinOnly, String reply, List<ApiConfigResponse> out) {
        RestTemplate rest = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(rest).build();
        List<JsonNode> sent = new ArrayList<>();
        server.expect(requestTo("http://messaging/channels/api-access"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("X-Api-Key", "real-key"))
            .andExpect(r -> sent.add(json.readTree(((MockClientHttpRequest) r).getBodyAsString())))
            .andRespond(withSuccess(reply, MediaType.APPLICATION_JSON));
        out.add(client(rest).getApiAccessDetails(null, 60, false, joinOnly));
        server.verify();
        return sent.get(0);
    }

    @Test
    @DisplayName("a join-only request sends createChannels:false and passes the service's answer on")
    void sendsCreateChannelsFalse() {
        List<ApiConfigResponse> out = new ArrayList<>();
        JsonNode body = mint(true, answer(",\"createChannels\":false"), out);
        assertThat(body.get("createChannels").asBoolean(true)).isFalse();
        assertThat(out.get(0).getCreateChannels()).isFalse();
        assertThat(out.get(0).getTemporaryKey()).isEqualTo("tk");
    }

    @Test
    @DisplayName("an ordinary request leaves createChannels out, so the service's default holds")
    void ordinaryRequestOmitsTheField() {
        List<ApiConfigResponse> out = new ArrayList<>();
        JsonNode body = mint(false, answer(",\"createChannels\":true"), out);
        assertThat(body.has("createChannels")).isFalse();
        assertThat(out.get(0).getTemporaryKey()).isEqualTo("tk");
    }

    @Test
    @DisplayName("a service that ignores createChannels gets its key refused, not handed to a guest")
    void aServiceThatIgnoresItIsRefused() {
        for (String ignored : new String[] {"", ",\"createChannels\":true"}) {
            assertThatThrownBy(() -> mint(true, answer(ignored), new ArrayList<>()))
                .hasMessageContaining("join-only");
        }
    }
}
