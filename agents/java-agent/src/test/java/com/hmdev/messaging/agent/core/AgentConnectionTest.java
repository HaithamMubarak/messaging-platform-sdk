package com.hmdev.messaging.agent.core;

import com.hmdev.messaging.agent.api.ConnectionChannelApi;
import com.hmdev.messaging.common.data.ChannelStateDto;
import com.hmdev.messaging.common.data.ConnectResponse;
import org.testng.Assert;
import org.testng.annotations.Test;

import java.lang.reflect.Field;
import java.util.Map;

import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Connecting an agent, against the API the agent actually has today.
 *
 * This test stopped compiling — and so silently stopped running — when the
 * surface moved underneath it: ChannelState became ChannelStateDto,
 * connect(String, String) became connect(ConnectConfig), and the call the agent
 * makes is now the Map-based channelApi.connect(config) rather than
 * connectWithChannelId. It was left disabled on top of that, so nothing here
 * had run for a long time.
 */
public class AgentConnectionTest {

    /** Set a private field, for the connection state a constructor cannot reach. */
    private void setPrivateField(Object target, String fieldName, Object value) throws Exception {
        Field f = target.getClass().getDeclaredField(fieldName);
        f.setAccessible(true);
        f.set(target, value);
    }

    private ConnectResponse sessionResponse() {
        ConnectResponse resp = new ConnectResponse();
        resp.setSessionId("sess-123");
        resp.setChannelId("chan-1");
        resp.setDate(System.currentTimeMillis());

        ChannelStateDto state = new ChannelStateDto();
        state.setGlobalOffset(0L);
        state.setLocalOffset(0L);
        state.setOriginalGlobalOffset(0L);
        resp.setState(state);
        return resp;
    }

    private AgentConnection connectionWithoutSessionFile(ConnectionChannelApi api) throws Exception {
        AgentConnection conn = new AgentConnection(api);
        // checkLastSession=false keeps the test off the filesystem: with it on,
        // connect() reads a previously saved session id from disk.
        setPrivateField(conn, "checkLastSession", false);
        setPrivateField(conn, "readyState", false);
        setPrivateField(conn, "sessionId", null);
        return conn;
    }

    @Test
    public void connectEstablishesASessionFromTheApiResponse() throws Exception {
        ConnectionChannelApi api = mock(ConnectionChannelApi.class);
        when(api.connect(anyMap())).thenReturn(sessionResponse());

        AgentConnection conn = connectionWithoutSessionFile(api);
        ConnectConfig config = ConnectConfig.withChannelId("chan-1", "agent-1");
        config.setCheckLastSession(false);

        Assert.assertTrue(conn.connect(config), "a response carrying a session id means connected");
        verify(api, times(1)).connect(anyMap());
    }

    @Test
    public void connectPassesTheCallersIdentityThrough() throws Exception {
        ConnectionChannelApi api = mock(ConnectionChannelApi.class);
        when(api.connect(anyMap())).thenReturn(sessionResponse());

        AgentConnection conn = connectionWithoutSessionFile(api);
        ConnectConfig config = ConnectConfig.withChannelId("chan-1", "agent-1");
        config.setCheckLastSession(false);
        conn.connect(config);

        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<Map<String, Object>> sent =
                org.mockito.ArgumentCaptor.forClass((Class) Map.class);
        verify(api).connect(sent.capture());

        Assert.assertEquals(sent.getValue().get("agentName"), "agent-1");
        Assert.assertEquals(sent.getValue().get("channelId"), "chan-1");
    }

    @Test
    public void connectingTwiceOnOneSessionIsRefused() throws Exception {
        ConnectionChannelApi api = mock(ConnectionChannelApi.class);
        when(api.connect(anyMap())).thenReturn(sessionResponse());

        AgentConnection conn = connectionWithoutSessionFile(api);
        ConnectConfig config = ConnectConfig.withChannelId("chan-1", "agent-1");
        config.setCheckLastSession(false);
        conn.connect(config);

        // A second connect on a live session would strand the first one.
        try {
            conn.connect(config);
            Assert.fail("expected the second connect to be refused");
        } catch (Exception expected) {
            Assert.assertTrue(expected.getMessage().contains("already connected"),
                    "message should say why: " + expected.getMessage());
        }
    }
}
