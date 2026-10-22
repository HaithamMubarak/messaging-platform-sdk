package com.hmdev.messaging.sdk.base;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hmdev.messaging.sdk.dto.ApiConfigResponse;
import com.hmdev.messaging.sdk.dto.HostRoomResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

import javax.servlet.http.HttpServletRequest;
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
 * POST /app/api/host opens a room whose host is the caller. The room is made
 * here, with the real key, under a random name and password, so nobody can
 * open it first; and its host is NAMED on the messaging service, so whoever
 * connects first is not the host.
 */
class HostedRoomTest {

    private final ObjectMapper json = new ObjectMapper();

    /* ---- the endpoint ---- */

    private static class RecordingClient implements MessagingServiceClientInterface {
        final List<String> calls = new ArrayList<>();

        @Override
        public ApiConfigResponse getApiAccessDetails(Integer ttlSeconds, Boolean singleUse) {
            return ApiConfigResponse.builder().temporaryKey("temp").build();
        }

        @Override
        public HostRoomResponse openHostedRoom(String tenant, String app, String hostAgent) {
            calls.add(tenant + "|" + app + "|" + hostAgent);
            return HostRoomResponse.builder().channelName(app + "-abc").channelPassword("pw").channelId("ch-1")
                .hostAgent(hostAgent).agentKey("key").agentKeyTtlSeconds(60L).build();
        }
    }

    @RestController
    @RequestMapping("/app/api")
    static class OpenController extends BaseApiConfigController {
        OpenController(MessagingServiceClientInterface c) { super(c); }
    }

    @RestController
    @RequestMapping("/app/api")
    static class ClosedController extends BaseApiConfigController {
        ClosedController(MessagingServiceClientInterface c) { super(c); }
        @Override protected boolean mayOpenRoom(HttpServletRequest request) { return false; }
    }

    private static MockMvc mvc(BaseApiConfigController controller) {
        return MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    @DisplayName("a room is opened for the app with the caller as its host")
    void opensARoom() throws Exception {
        RecordingClient client = new RecordingClient();
        mvc(new OpenController(client)).perform(post("/app/api/host").contentType(MediaType.APPLICATION_JSON)
                .content("{\"app\":\"signet\",\"agentName\":\"DrRowan\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.hostAgent").value("DrRowan"))
            .andExpect(jsonPath("$.data.agentKey").value("key"));
        assertThat(client.calls).containsExactly("null|signet|DrRowan");
    }

    @Test
    @DisplayName("an app id that cannot name a room, or no host name, is refused before anything is opened")
    void checksTheRequest() throws Exception {
        RecordingClient client = new RecordingClient();
        MockMvc mvc = mvc(new OpenController(client));
        for (String body : new String[] {"{}", "{\"app\":\"signet\"}", "{\"app\":\"Sig Net\",\"agentName\":\"a\"}",
                "{\"app\":\"signet.evil\",\"agentName\":\"a\"}", "{\"agentName\":\"a\"}"}) {
            mvc.perform(post("/app/api/host").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());
        }
        assertThat(client.calls).isEmpty();
    }

    @Test
    @DisplayName("a developer who closes mayOpenRoom keeps everyone else from opening rooms")
    void theDeveloperDecidesWhoMayOpen() throws Exception {
        RecordingClient client = new RecordingClient();
        mvc(new ClosedController(client)).perform(post("/app/api/host").contentType(MediaType.APPLICATION_JSON)
                .content("{\"app\":\"signet\",\"agentName\":\"DrRowan\"}"))
            .andExpect(status().isForbidden());
        assertThat(client.calls).isEmpty();
    }

    /* ---- what is sent to the messaging service ---- */

    private static BaseMessagingServiceClient client(RestTemplate rest) {
        return new BaseMessagingServiceClient(rest) {
            @Override protected String getApiKey() { return "real-key"; }
            @Override protected String getMessagingServiceUrl() { return "http://messaging"; }
        };
    }

    @Test
    @DisplayName("the room is created on the app's wire room with the real key, and its host named with a fresh key")
    void namesTheHostOnTheWireRoom() throws Exception {
        RestTemplate rest = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(rest).build();
        List<JsonNode> sent = new ArrayList<>();
        server.expect(requestTo("http://messaging/channels/managed/host"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("X-Api-Key", "real-key"))
            .andExpect(r -> sent.add(json.readTree(((org.springframework.mock.http.client.MockClientHttpRequest) r).getBodyAsString())))
            .andRespond(withSuccess("{\"status\":\"success\",\"data\":{\"channelId\":\"ch-9\",\"hostAgent\":\"DrRowan\"}}",
                MediaType.APPLICATION_JSON));

        HostRoomResponse room = client(rest).openHostedRoom(null, "signet", "DrRowan");

        server.verify();
        JsonNode body = sent.get(0);
        assertThat(room.getChannelName()).startsWith("signet-");
        assertThat(body.get("channelName").asText()).isEqualTo(room.getChannelName() + ".signet");
        assertThat(body.get("channelPassword").asText()).isEqualTo(room.getChannelPassword()).hasSizeGreaterThanOrEqualTo(24);
        assertThat(body.at("/host/agentName").asText()).isEqualTo("DrRowan");
        assertThat(body.at("/host/agentKey").asText()).isEqualTo(room.getAgentKey()).hasSizeGreaterThanOrEqualTo(24);
        assertThat(room.getChannelId()).isEqualTo("ch-9");
        assertThat(room.getHostAgent()).isEqualTo("DrRowan");
    }

    @Test
    @DisplayName("two rooms never share a name, a password or a host key")
    void everyRoomIsFresh() {
        RestTemplate rest = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(rest).build();
        for (int i = 0; i < 2; i++) {
            server.expect(requestTo("http://messaging/channels/managed/host")).andRespond(withSuccess(
                "{\"status\":\"success\",\"data\":{\"channelId\":\"ch\",\"hostAgent\":\"h\"}}", MediaType.APPLICATION_JSON));
        }
        BaseMessagingServiceClient c = client(rest);
        HostRoomResponse a = c.openHostedRoom(null, "signet", "h"), b = c.openHostedRoom(null, "signet", "h");
        assertThat(a.getChannelName()).isNotEqualTo(b.getChannelName());
        assertThat(a.getChannelPassword()).isNotEqualTo(b.getChannelPassword());
        assertThat(a.getAgentKey()).isNotEqualTo(b.getAgentKey());
    }

    @Test
    @DisplayName("a refusal from the messaging service is an error, not a room")
    void aRefusalIsAnError() {
        RestTemplate rest = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.bindTo(rest).build();
        server.expect(requestTo("http://messaging/channels/managed/host")).andRespond(withSuccess(
            "{\"status\":\"unauthorized\",\"statusMessage\":\"Managing a channel needs its owner's API key\"}", MediaType.APPLICATION_JSON));
        assertThatThrownBy(() -> client(rest).openHostedRoom(null, "signet", "h"))
            .hasMessageContaining("owner's API key");
    }
}
