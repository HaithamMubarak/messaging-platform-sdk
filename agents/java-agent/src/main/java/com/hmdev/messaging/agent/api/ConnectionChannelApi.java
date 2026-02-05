package com.hmdev.messaging.agent.api;

import com.hmdev.messaging.common.data.*;

import java.util.List;
import java.util.Map;
public interface ConnectionChannelApi {


    ConnectResponse connect(String channelName, String channelKey, String agentName);

    ConnectResponse connect(String channelName, String channelKey, String agentName, String sessionId);

    // New overloads: connect using server-side channelId directly
    ConnectResponse connect(String channelName, String channelKey, String agentName, String sessionId, String channelId);

    ConnectResponse connect(String channelName, String channelKey, String agentName, String sessionId, String channelId,
                            boolean enableWebrtcRelay);

    ConnectResponse connectWithChannelId (String agentName, String channelId, String sessionId);

    ConnectResponse connectWithChannelId (String agentName, String channelId, String sessionId, boolean enableWebrtcRelay);

    // New: connect with apiKeyScope support (recommended)
    ConnectResponse connect(String channelName, String channelKey, String agentName, String sessionId, String channelId,
                            boolean enableWebrtcRelay, String apiKeyScope);

    // Object-based connect method for cleaner API (recommended approach)
    ConnectResponse connect(Map<String, Object> config);

    // Receive messages from channel
    EventMessageResult receive(String sessionId, ReceiveConfig receiveConfig);

    // Get active agents in channel
    List<AgentInfo> getActiveAgents(String sessionId);

    // New: list system agents (relay/system roles)
    List<AgentInfo> getSystemAgents(String session);

    boolean send(EventMessage.EventType eventType, String msg, String destAgent, String sessionId, boolean encrypted);

    boolean disconnect(String session);

    // UDP bridge operations via the kafka-service HTTP endpoints
    boolean udpPush(String msg, String destAgent, String session);

    EventMessageResult udpPull(String session, ReceiveConfig receiveConfig);

}
