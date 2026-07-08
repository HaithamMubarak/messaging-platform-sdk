package com.hmdev.messaging.agent.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hmdev.messaging.agent.webrtc.ISignalingMessageHandler;
import com.hmdev.messaging.common.CommonUtils;
import com.hmdev.messaging.common.data.AgentInfo;
import com.hmdev.messaging.common.data.ConnectResponse;
import com.hmdev.messaging.common.data.EventMessage;
import com.hmdev.messaging.common.data.EventMessageResult;
import com.hmdev.messaging.common.data.ReceiveConfig;
import lombok.Getter;
import lombok.Setter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;


import java.security.KeyPair;
import java.security.PrivateKey;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.hmdev.messaging.agent.util.Utils;

import com.hmdev.messaging.agent.api.ConnectionChannelApi;
import com.hmdev.messaging.agent.api.ConnectionChannelApiFactory;
import com.hmdev.messaging.common.security.MySecurity;

import org.json.JSONObject;

/**
 * Manages a messaging agent connection lifecycle: connect, send/receive (sync/async),
 * and session recovery. Business logic preserved; refactor focuses on readability
 * and maintainability while staying Java 11 compatible.
 */
public class AgentConnection {

    private static final Logger logger = LoggerFactory.getLogger(AgentConnection.class);
    private static final Long DEFAULT_RECEIVE_LIMIT = 20L;

    /**
     * Enable/disable last-session recovery behavior at connect-time.
     */
    @Setter
    private boolean checkLastSession = true;

    /**
     * Enable/disable WebRTC relay creation when connecting to a channel.
     */
    @Setter
    private boolean enableWebrtcRelay = false;

    private final ConnectionChannelApi channelApi;
    // Base API URL, kept so the (opt-in) WebSocket transport can derive its
    // ws(s)://.../ws endpoint. Null when constructed via the test-friendly
    // ConnectionChannelApi-injecting constructor — WS setup then just no-ops
    // back to HTTP polling.
    private final String apiUrl;
    private String agentName;
    private String sessionId;

    // Local channel credentials (mirror JS _self._channelName/_self._channelPassword)
    private String channelName;
    private String channelPassword;
    // Local derived channel secret used for encrypting/decrypting agent-to-agent messages
    @Getter
    @Setter
    private String channelSecret;

    private boolean readyState = false;
    private Thread receiveThread;
    @Getter
    private long connectionTime;
    // Optional handler called when a PASSWORD_REQUEST event arrives. If set and returns true,
    // the agent will send a PASSWORD_REPLY encrypted to the requester's provided public key.
    @Setter
    private PasswordRequestHandler passwordRequestHandler;
    @Getter
    private String channelId;

    /**
     * Starting point for reading messages (originalGlobalOffset, localOffset=0).
     * Use this to read from the beginning of the current channel instance.
     */
    @Getter
    private ReceiveConfig initialReceiveConfig;

    /**
     * Current state at connect time (actual globalOffset, localOffset from state).
     * Represents where the channel was when you connected.
     */
    @Getter
    private ReceiveConfig currentReceiveConfig;

    // Key pair used for password request/reply encryption
    private KeyPair keyPair;

    // WebRTC stream manager for video signaling
    @Getter
    @Setter
    private ISignalingMessageHandler webRtcHandler;

    // --- WebSocket transport (opt-in via ConnectConfig.useWebsocket) ---
    private static final long WS_CONNECT_TIMEOUT_MS = 5000;
    private static final long WS_REQUEST_TIMEOUT_MS = 15000;
    private static final int WS_SEEN_SIGNATURES_MAX = 2000;

    private WsChannelClient wsClient;
    private boolean websocketActive = false;
    private AgentConnectionEventHandler wsPushHandler;
    private final ObjectMapper wsMapper = new ObjectMapper()
            .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    // Dedup cache for WS-delivered items: the one-shot catch-up pull can
    // overlap with server push for the same message, so without this an event
    // (e.g. a WebRTC offer) can reach the handler twice. Bounded FIFO so a
    // long-lived session doesn't grow unbounded.
    private final Map<String, Boolean> seenWsSignatures = Collections.synchronizedMap(
            new LinkedHashMap<String, Boolean>(16, 0.75f, false) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                    return size() > WS_SEEN_SIGNATURES_MAX;
                }
            });

    /**
     * Create an AgentConnection bound to a backend API endpoint.
     *
     * @param apiUrl Base URL of messaging API
     *
     */
    public AgentConnection(String apiUrl) {
        this(apiUrl, null);
    }

    public AgentConnection(String apiUrl, String developerApiKey) {
        this.apiUrl = apiUrl;
        this.channelApi = ConnectionChannelApiFactory.getConnectionApi(apiUrl, developerApiKey);
    }

    // Test-friendly constructor that allows injecting a mock ConnectionChannelApi
    public AgentConnection(ConnectionChannelApi channelApi) {
        this.apiUrl = null;
        this.channelApi = channelApi;
    }


    /**
     * Connect to a channel using a configuration object (RECOMMENDED).
     * This method provides a clean API with all connection parameters in one object.
     *
     * Example usage:
     * <pre>
     * ConnectConfig config = ConnectConfig.builder()
     *     .channelName("my-channel")
     *     .channelPassword("password")
     *     .agentName("player-1")
     *     .apiKeyScope("private")  // or "public" for testing
     *     .enableWebrtcRelay(false)
     *     .build();
     *
     * agent.connect(config);
     * </pre>
     *
     * @param config ConnectConfig object with all connection parameters
     * @return true if connected successfully, false otherwise
     * @throws Exception if connection fails
     */
    public boolean connect(ConnectConfig config) throws Exception {
        // Apply config settings to instance
        this.checkLastSession = config.isCheckLastSession();
        this.enableWebrtcRelay = config.isEnableWebrtcRelay();

        // Delegate to internal connect with Map-based API call
        if (readyState && sessionId != null) {
            throw new Exception("Agent " + config.getAgentName() + " is already connected with session " + sessionId);
        }

        if (this.sessionId == null && config.isCheckLastSession()) {
            this.sessionId = Utils.loadSessionId(config.getChannelId());
        }

        this.channelName = config.getChannelName();
        this.channelPassword = config.getChannelPassword();
        this.agentName = config.getAgentName();
        this.keyPair = MySecurity.rsaGenerate();

        // Build Map for API call
        java.util.Map<String, Object> apiConfig = new java.util.HashMap<>();
        apiConfig.put("channelName", config.getChannelName());
        apiConfig.put("channelPassword", config.getChannelPassword());
        apiConfig.put("agentName", config.getAgentName());
        apiConfig.put("sessionId", config.getSessionId());
        apiConfig.put("channelId", config.getChannelId());
        apiConfig.put("enableWebrtcRelay", config.isEnableWebrtcRelay());
        apiConfig.put("apiKeyScope", config.getApiKeyScope());

        ConnectResponse connectResponse = channelApi.connect(apiConfig);

        if (CommonUtils.isNotEmpty(connectResponse.getSessionId())) {
            logger.debug("Connection Response is {}", connectResponse);
            this.sessionId = connectResponse.getSessionId();
            this.channelId = connectResponse.getChannelId();
            this.connectionTime = connectResponse.getDate();

            // Use originalGlobalOffset to start from the beginning of the current channel instance
            // initialReceiveConfig represents the STARTING point (where to begin reading)
            // - globalOffset = originalGlobalOffset (where this channel instance started)
            // - localOffset = 0 (start from beginning of this instance)
            Long startOffset = connectResponse.getState().getOriginalGlobalOffset() != null
                    ? connectResponse.getState().getOriginalGlobalOffset()
                    : connectResponse.getState().getGlobalOffset();

            this.initialReceiveConfig = new ReceiveConfig(startOffset, 0L, DEFAULT_RECEIVE_LIMIT);

            // currentReceiveConfig represents the CURRENT state at connect time
            // - globalOffset = current globalOffset (where channel is NOW)
            // - localOffset = current localOffset (current position in instance)
            this.currentReceiveConfig = new ReceiveConfig(
                    connectResponse.getState().getGlobalOffset(),
                    connectResponse.getState().getLocalOffset(),
                    DEFAULT_RECEIVE_LIMIT
            );

            // If we have channel credentials, derive the channel secret locally
            if (this.channelName != null && this.channelPassword != null) {
                this.channelSecret = MySecurity.deriveChannelSecret(this.channelName, this.channelPassword);
            } else if (CommonUtils.isEmpty(this.channelSecret)) {
                // If we don't have a secret, try password request flow
                requestPassword();
            }

            readyState = true;
            logger.debug("Connected to session : {}", this.sessionId);

            if (config.isUseWebsocket()) {
                setupWebsocket();
            }

            Utils.saveSessionId(config.getChannelId(), this.sessionId);
            return true;
        }
        return false;
    }

    /**
     * Disconnects the agent and performs any cleanup required.
     */
    public boolean disconnect() {

        if (!readyState) {
            logger.debug("Channel connection {} is already disconnected.", agentName);
        }

        boolean result = channelApi.disconnect(sessionId);

        if (result) {
            sessionId = null;
            readyState = false;
        }

        if (wsClient != null) {
            try {
                wsClient.close();
            } catch (Exception ignored) {
            }
            wsClient = null;
            websocketActive = false;
        }

        return result;

    }

    /**
     * Pull messages using an ReceiveConfig object.
     *
     * @param receiveConfig the reception config for receive operation
     * @return list of message events
     */
    public EventMessageResult receive(ReceiveConfig receiveConfig) {
        logger.debug("ConnectionChannel.receive: {}", receiveConfig);
        if (!isReady()) {
            return null;
        }

        EventMessageResult eventMessageResult;
        if (websocketActive && wsClient != null) {
            // Force CACHE, ignoring any caller-supplied pollSource: AUTO can
            // fall through to a multi-second Kafka/DB read on a cache miss,
            // and the server appears to process frames on a WS session
            // sequentially, so one slow AUTO pull can even stall a LATER
            // request on the same socket. WS delivery exists for real-time
            // cache reads — anything not yet cached will arrive via server
            // push (which itself always uses CACHE).
            JsonNode data = wsClient.pull(receiveConfig.getGlobalOffset(), receiveConfig.getLocalOffset(),
                    receiveConfig.getLimit(), "CACHE", WS_REQUEST_TIMEOUT_MS);
            if (data == null) {
                return null;
            }
            try {
                eventMessageResult = wsMapper.treeToValue(data, EventMessageResult.class);
            } catch (Exception e) {
                logger.warn("Failed to parse WS pull data: {}", e.getMessage());
                return null;
            }
        } else {
            eventMessageResult = channelApi.receive(sessionId, receiveConfig);
        }

        // Decrypt any encrypted events using the derived channelSecret (if present)
        eventMessageResult.getEvents().forEach(this::verifyAndDecryptMessage);

        // Auto-handle special event types and decrypt messages if needed
        this.checkAutoEvents(eventMessageResult.getEvents());

        return eventMessageResult;
    }

    /**
     * The receive config captured at connect (where to start reading from —
     * the channel tail — with a valid localOffset). Use this as the starting
     * cursor for a synchronous pull loop instead of building one from scratch
     * (globalOffset=0/localOffset=null is rejected by the server).
     */
    public ReceiveConfig getInitialReceiveConfig() {
        return initialReceiveConfig;
    }

    /**
     * Opens the WebSocket transport and subscribes at currentReceiveConfig's
     * offsets. Best-effort: on any failure this logs a warning and leaves the
     * connection on HTTP polling (websocketActive stays false), so callers
     * never need to check for WS-specific errors.
     */
    private void setupWebsocket() {
        if (apiUrl == null) {
            logger.warn("No apiUrl available; cannot use WebSocket transport");
            return;
        }
        try {
            // Subscribe at the CURRENT channel position, not
            // initialReceiveConfig (which deliberately starts at
            // localOffset=0 — "replay this channel instance from the
            // beginning", meant for HTTP polling with AUTO/Kafka fallback). WS
            // pulls are forced to pollSource=CACHE (see receive()), which has
            // no history fallback; on a long-lived/reused channel, localOffset
            // 0 can point at a position long evicted from cache, so every
            // catch-up/ongoing pull would silently return nothing forever.
            // currentReceiveConfig reflects the channel's actual tip at
            // connect time, which CACHE can always serve.
            ReceiveConfig cfg = currentReceiveConfig != null ? currentReceiveConfig : initialReceiveConfig;
            long go = (cfg != null && cfg.getGlobalOffset() != null) ? cfg.getGlobalOffset() : 0L;
            long lo = (cfg != null && cfg.getLocalOffset() != null) ? cfg.getLocalOffset() : 0L;

            WsChannelClient client = new WsChannelClient(apiUrl, sessionId, wsMapper, this::onWsPush);
            if (client.connectBlocking(go, lo, WS_CONNECT_TIMEOUT_MS)) {
                this.wsClient = client;
                this.websocketActive = true;
                logger.info("WebSocket transport active for session {}", sessionId);
            } else {
                logger.warn("WebSocket connect/subscribe failed; falling back to HTTP polling");
            }
        } catch (Exception e) {
            logger.warn("WebSocket setup failed, falling back to HTTP polling: {}", e.getMessage());
            this.wsClient = null;
            this.websocketActive = false;
        }
    }

    /**
     * Callback invoked by WsChannelClient for unsolicited server pushes AND
     * for the one-shot catch-up pull result — both funnel through the same
     * dedup + dispatch path.
     */
    private void onWsPush(JsonNode data) {
        try {
            EventMessageResult result = wsMapper.treeToValue(data, EventMessageResult.class);
            List<EventMessage> events = result.getEvents() != null ? result.getEvents() : new ArrayList<>();
            List<EventMessage> ephemeral = result.getEphemeralEvents() != null ? result.getEphemeralEvents() : new ArrayList<>();
            deliverWsEvents(ephemeral, events);
        } catch (Exception e) {
            logger.warn("Error parsing WS push data: {}", e.getMessage());
        }
    }

    private void deliverWsEvents(List<EventMessage> ephemeralEvents, List<EventMessage> events) {
        AgentConnectionEventHandler handler = this.wsPushHandler;
        if (handler == null) {
            return;
        }

        // Ephemeral first (time-sensitive), then persistent — mirrors
        // RunnableReceive's ordering for the HTTP polling path.
        List<EventMessage> eph = new ArrayList<>();
        for (EventMessage e : ephemeralEvents) {
            if (!isDuplicateWsItem(e)) {
                verifyAndDecryptMessage(e);
                eph.add(e);
            }
        }
        if (!eph.isEmpty()) {
            try {
                handler.onMessageEvents(eph);
            } catch (Exception ex) {
                logger.warn("Handler raised exception on ephemeral WS events: {}", ex.getMessage());
            }
        }

        List<EventMessage> ev = new ArrayList<>();
        for (EventMessage e : events) {
            if (!isDuplicateWsItem(e)) {
                verifyAndDecryptMessage(e);
                ev.add(e);
            }
        }
        if (!ev.isEmpty()) {
            try {
                handler.onMessageEvents(ev);
            } catch (Exception ex) {
                logger.warn("Handler raised exception on WS events: {}", ex.getMessage());
            }
            // auto-handle special event types, same parity as the HTTP path
            // (which only runs this over the persistent events, not ephemeral)
            try {
                checkAutoEvents(ev);
            } catch (Exception ex) {
                logger.warn("checkAutoEvents raised: {}", ex.getMessage());
            }
        }
    }

    /**
     * Stable signature identifying a single logical message, so re-deliveries
     * collapse to one. Persistent events carry a monotonic localOffset
     * (unique per channel instance). Ephemeral events (no offset) are keyed
     * on sender + target + type + the sender's ms timestamp + a content hash
     * — identical across re-deliveries, distinct across genuinely different
     * messages.
     */
    private String messageSignatureWs(EventMessage item) {
        try {
            if (item == null) {
                return null;
            }
            if (!item.isEphemeral() && item.getLocalOffset() != null) {
                return "o:" + item.getLocalOffset();
            }
            String content = item.getContent() != null ? item.getContent() : "";
            return "e:" + item.getFrom() + "|" + item.getTo() + "|" + item.getType() + "|" + item.getDate()
                    + "|" + content.length() + "|" + content.hashCode();
        } catch (Exception e) {
            return null;
        }
    }

    private boolean isDuplicateWsItem(EventMessage item) {
        String sig = messageSignatureWs(item);
        if (sig == null) {
            return false;
        }
        synchronized (seenWsSignatures) {
            if (seenWsSignatures.containsKey(sig)) {
                return true;
            }
            seenWsSignatures.put(sig, Boolean.TRUE);
        }
        return false;
    }

    /**
     * Gets all agents
     *
     * @return return the list of all agents
     */
    public List<AgentInfo> getActiveAgents() {

        logger.debug("ConnectionChannel.getActiveAgents: ");

        if (!isReady()) {
            return null;
        }

        return channelApi.getActiveAgents(sessionId);
    }

    /**
     * Determine if this agent is the "host" (agent with earliest connectionTime).
     * Host is responsible for sending board state to new joiners.
     *
     * @return true if this agent is the host, false otherwise
     */
    public boolean isHostAgent() {
        if (!isReady()) {
            return false;
        }

        List<AgentInfo> agentsInfo = getActiveAgents();
        if (agentsInfo == null || agentsInfo.isEmpty()) {
            return true;  // Only agent, so is host
        }

        // Find agent with earliest connectionTime
        String earliestAgent = this.agentName;
        Long earliestTime = null;

        for (AgentInfo agent : agentsInfo) {
            String agentName = agent.getAgentName() != null ? agent.getAgentName() : agent.get("name");
            Long connectionTime = agent.getConnectionTime();

            if (agentName != null && agentName.equals(this.agentName)) {
                earliestTime = connectionTime;
            }

            if (connectionTime != null) {
                if (earliestTime == null || connectionTime < earliestTime) {
                    earliestTime = connectionTime;
                    earliestAgent = agentName;
                }
            }
        }

        boolean isHost = earliestAgent != null && earliestAgent.equals(this.agentName);

        // Build agent names list for logging
        StringBuilder agentNamesList = new StringBuilder();
        for (int i = 0; i < agentsInfo.size(); i++) {
            AgentInfo a = agentsInfo.get(i);
            String name = a.getAgentName() != null ? a.getAgentName() : a.get("name");
            agentNamesList.append(name != null ? name : "Unknown");
            if (i < agentsInfo.size() - 1) {
                agentNamesList.append(", ");
            }
        }

        logger.info("[Host Check] Agents: {} | Host: {} (connectionTime: {}) | I am {} | Is host: {}",
                agentNamesList, earliestAgent, earliestTime, this.agentName, isHost);

        return isHost;
    }

    /**
     * Starts an asynchronous polling routine that emits batches to the handler.
     *
     * @param messageHandler callback for message-arrival events
     */
    public void receiveAsync(AgentConnectionEventHandler messageHandler) {
        // null = "no explicit override"; the two-arg overload picks the right
        // default per transport (currentReceiveConfig for WS, initialReceiveConfig
        // for HTTP polling — see its comment for why they differ).
        this.receiveAsync(messageHandler, null);
    }

    /**
     * Starts an asynchronous polling routine that emits batches to the handler.
     *
     * @param messageHandler callback for message-arrival events
     * @param startFrom optional explicit starting cursor; pass null to use the
     *                  transport's default (currentReceiveConfig for WS,
     *                  initialReceiveConfig for HTTP polling)
     */
    public void receiveAsync(AgentConnectionEventHandler messageHandler, ReceiveConfig startFrom) {
        if (!isReady()) {
            return;
        }

        if (websocketActive && wsClient != null) {
            this.wsPushHandler = messageHandler;
            // One-shot catch-up pull over WS (same 'pull' action + same server
            // receive() + same dedup/dispatch path as an unsolicited push):
            // grabs anything sent between the HTTP connect and the WS
            // subscribe taking effect. Ongoing delivery is via server push —
            // no polling thread needed.
            //
            // Defaults to currentReceiveConfig (the channel's ACTUAL position
            // at connect time), not initialReceiveConfig (which starts at
            // localOffset=0 — "replay from the beginning of this channel
            // instance"). WS pulls are forced to pollSource=CACHE (see
            // receive()), which has no history fallback, so on a long-lived/
            // reused channel localOffset=0 can point at a position long
            // evicted from cache and every pull would silently return nothing
            // forever. See setupWebsocket() for the matching subscribe fix.
            ReceiveConfig cfg = startFrom != null ? startFrom
                    : (currentReceiveConfig != null ? currentReceiveConfig : initialReceiveConfig);
            Long go = cfg != null ? cfg.getGlobalOffset() : 0L;
            Long lo = cfg != null ? cfg.getLocalOffset() : 0L;
            Long limit = cfg != null ? cfg.getLimit() : DEFAULT_RECEIVE_LIMIT;
            JsonNode data = wsClient.pull(go, lo, limit, "CACHE", WS_REQUEST_TIMEOUT_MS);
            if (data != null) {
                onWsPush(data);
            }
            return;
        }

        ReceiveConfig cfg = startFrom != null ? startFrom : initialReceiveConfig;
        if (receiveThread == null) {
            receiveThread = new Thread(new RunnableReceive(this, messageHandler, cfg));
            receiveThread.start();
        } else {
            logger.debug("Asynchronous receive is already running.");
        }
    }

    /**
     * Broadcast or default-route send, depending on server defaults.
     *
     * @param msg message body
     * @return true on success, false otherwise
     */

    public boolean sendMessage(String msg) {
        return sendMessage(msg, "*");
    }

    /**
     * Send a message to a specific destination (agent or topic).
     *
     * @param msg         message body
     * @param destination destination routing value
     * @return true on success, false on failure
     */

    public boolean sendMessage(String msg, String destination) {
        return sendMessage(EventMessage.EventType.CHAT_TEXT, msg, destination, true);
    }


    /**
     * Send a message to a specific destination (agent or topic), with optional encryption.
     *
     * @param eventType   type of event/message
     * @param content     message body
     * @param destination destination routing value
     * @param encrypted   whether to encrypt the message
     * @return true on success, false on failure
     */
    public boolean sendMessage(EventMessage.EventType eventType, String content, String destination, boolean encrypted) {

        if (!isReady()) {
            return false;
        }

        try {
            if (encrypted && this.channelSecret != null) {
                content = MySecurity.encryptAndSign(content, this.channelSecret);
            } else {
                encrypted = false;
            }
        } catch (Exception ex) {
            logger.error("Failed to encrypt message: {}", ex.getMessage());
            return false;
        }

        if (websocketActive && wsClient != null) {
            if (wsClient.push(eventType.toJson(), destination, content, encrypted, null, false, WS_REQUEST_TIMEOUT_MS)) {
                return true;
            }
            logger.debug("WS push failed/timed out, falling back to HTTP send");
        }

        return channelApi.send(eventType, content, destination, sessionId, encrypted);
    }

    /**
     * Send a message through the HTTP-to-UDP bridge (udpPush) provided by the kafka-service.
     * Uses the same encryption and session as the normal `send` operation.
     *
     * @param content     message body
     * @param destination destination routing value
     * @return true on success, false on failure
     */
    public boolean udpPushMessage(String content, String destination) {
        if (!isReady()) {
            return false;
        }

        return channelApi.udpPush(content, destination, sessionId);
    }

    /**
     * Pull messages via the HTTP-to-UDP bridge (udpPull). Delegates to the channel API's udpPull.
     *
     * @param receiveConfig receive config object containing global/local offsets and limit
     * @return EventMessageResult containing messages and next offset, or null on error/not ready
     */
    public EventMessageResult udpPull(ReceiveConfig receiveConfig) {
        if (!isReady()) {
            return null;
        }

        return channelApi.udpPull(sessionId, receiveConfig);
    }

    public boolean isReady() {
        if (!readyState || sessionId == null) {
            logger.debug("Unable use channel operation, channel is not ready");
            return false;
        } else {
            return true;
        }
    }

    /**
     * Request the channel password from other agents by broadcasting a PASSWORD_REQUEST event.
     * Waits up to the specified timeout for a PASSWORD_REPLY addressed to this agent.
     *
     * @param replyTimeoutSeconds number of seconds to wait for a reply; 0 or less means no wait
     * @return true if password was obtained and channel secret set, false otherwise
     */
    public boolean requestPassword(int replyTimeoutSeconds) {
        if (!isReady()) {
            return false;
        }
        try {
            // send password-reque st with JSON wrapper
            JSONObject req = new JSONObject();
            req.put("publicKeyPem", MySecurity.rsaEncodePublicKey(keyPair.getPublic()));

            // broadcast to '*' so any initiator can reply
            channelApi.send(EventMessage.EventType.PASSWORD_REQUEST, req.toString(), "*", sessionId, false);

            if (replyTimeoutSeconds <= 0) {
                return false;
            }
            // Blocking wait for a reply addressed to this agent
            long start = System.currentTimeMillis();
            ReceiveConfig receiveConfig = new ReceiveConfig(initialReceiveConfig);
            while (CommonUtils.isNotEmpty(this.channelSecret) &&
                    (System.currentTimeMillis() - start) < (replyTimeoutSeconds * 1000L)) {
                EventMessageResult eventMessageResult = this.receive(receiveConfig);
                receiveConfig.updateOffsets(eventMessageResult);

                if (CommonUtils.sleep(400)) {
                    break;
                }
            }

        } catch (Exception e) {
            logger.debug("requestPassword failed: {}", e.getMessage());
        }

        return false;
    }

    private void requestPassword() {
        requestPassword(0);
    }

    /**
     * Decrypts and verifies an EventMessage if it is marked as encrypted.
     *
     * @param ev the EventMessage to process
     */
    private void verifyAndDecryptMessage(EventMessage ev) {
        if (ev != null && ev.isEncrypted()) {
            try {
                String plain = MySecurity.decryptAndVerify(ev.getContent(), this.channelSecret);
                ev.setContent(plain);
                ev.setEncrypted(false);
            } catch (Exception ex) {
                logger.debug("Failed to decrypt event content: {}", ex.getMessage());
            }
        }
    }

    /**
     * Internal handler for special event types that require automatic processing.
     *
     * @param events list of EventMessage objects to process
     */
    private void checkAutoEvents(List<EventMessage> events) {
        try {
            for (EventMessage event : events) {
                // Handle PASSWORD_REQUEST events
                if (event.getDate() > this.connectionTime &&
                        event.getType() == EventMessage.EventType.PASSWORD_REQUEST) {
                    this.verifyPasswordRequest(event);
                }

                if (event.getDate() > this.connectionTime &&
                        event.getType() == EventMessage.EventType.PASSWORD_REPLY && this.agentName.equals(event.getTo())) {
                    this.handlePasswordReply(event, this.keyPair.getPrivate());
                }

                // Handle WebRTC signaling messages
                if (event.getDate() > this.connectionTime &&
                        event.getType() == EventMessage.EventType.WEBRTC_SIGNALING &&
                        !event.getFrom().equals(this.agentName) &&
                        this.webRtcHandler != null) {
                    webRtcHandler.handleSignalingMessage(event);
                }
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }


    private void handlePasswordReply(EventMessage ev, PrivateKey pendingPrivateKey) throws Exception {
        if (pendingPrivateKey != null) {
            JSONObject channelDetails = new JSONObject(MySecurity.rsaDecrypt(
                    pendingPrivateKey, ev.getContent()));

            String channelName = channelDetails.optString("channelName");
            String channelPassword = channelDetails.optString("channelPassword");

            if (this.channelName == null) this.channelName = channelName;
            if (this.channelPassword == null) this.channelPassword = channelPassword;

            this.channelSecret = MySecurity.deriveChannelSecret(this.channelName, this.channelPassword);
        }
    }


    private void verifyPasswordRequest(EventMessage event) {
        try {
            String requesterAgent = event.getFrom();
            String requesterPub = new JSONObject(event.getContent()).optString("publicKeyPem");
            boolean allowed = true;
            if (this.passwordRequestHandler != null) {
                allowed = this.passwordRequestHandler.onPasswordRequest(this.getChannelId(),
                        requesterAgent, requesterPub);
            }

            if (allowed && this.channelPassword != null && this.channelName != null && requesterPub != null) {
                JSONObject reply = new JSONObject();
                reply.put("channelName", this.channelName);
                reply.put("channelPassword", this.channelPassword);

                String cipher = MySecurity.rsaEncrypt(requesterPub, reply.toString());
                // send unencrypted (cipher text already encrypted with RSA)
                this.sendMessage(EventMessage.EventType.PASSWORD_REPLY, cipher, requesterAgent, false);
            }
        } catch (Exception exception) {
            logger.debug("Error in verifyPasswordRequest: {}", exception.getMessage());
        }
    }
}
