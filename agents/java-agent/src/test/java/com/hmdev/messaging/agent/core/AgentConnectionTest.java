package com.hmdev.messaging.agent.core;

import com.hmdev.messaging.agent.api.ConnectionChannelApi;
import org.testng.Assert;
import org.testng.annotations.Test;

import java.lang.reflect.Field;

import static org.mockito.Mockito.*;

public class AgentConnectionTest {

    // Helper to set private fields via reflection
    private void setPrivateField(Object target, String fieldName, Object value) throws Exception {
        Field f = target.getClass().getDeclaredField(fieldName);
        f.setAccessible(true);
        f.set(target, value);
    }

    // Disabled temporarily - needs Utils.saveSessionId mock to avoid file I/O in tests
    @Test(enabled = false)
    public void testConnect_noAutomaticPasswordFlow() throws Exception {
        ConnectionChannelApi api = mock(ConnectionChannelApi.class);
        AgentConnection conn = new AgentConnection(api);

        // prepare agentName, session and connectionTime
        String agentName = "agent-1";
        setPrivateField(conn, "checkLastSession", false); // Disable session loading
        setPrivateField(conn, "readyState", false);
        setPrivateField(conn, "sessionId", null);
        setPrivateField(conn, "channelSecret", "test-secret"); // Set secret to avoid password request

        // stub connectWithChannelId response to include a session id
        com.hmdev.messaging.common.data.ConnectResponse resp = new com.hmdev.messaging.common.data.ConnectResponse();
        resp.setSessionId("sess-123");
        resp.setChannelId("chan-1");
        resp.setDate(System.currentTimeMillis());

        // Create state with offsets (required by AgentConnection.connect)
        com.hmdev.messaging.common.data.ChannelState state = new com.hmdev.messaging.common.data.ChannelState();
        state.setGlobalOffset(0L);
        state.setLocalOffset(0L);
        resp.setState(state);

        when(api.connectWithChannelId(anyString(), anyString(), anyString(), anyBoolean())).thenReturn(resp);

        boolean ok = conn.connect("chan-1", agentName);
        Assert.assertTrue(ok, "Expected connectWithChannelId to return true when session established");

        // Verify the API was called correctly (agentName, channelId, sessionId, enableWebrtcRelay)
        verify(api, times(1)).connectWithChannelId(eq(agentName), eq("chan-1"), anyString(), anyBoolean());
    }
}
