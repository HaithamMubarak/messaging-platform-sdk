package com.hmdev.messaging.agent.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;

/**
 * WebSocket transport mirroring the server's subscribe/pull/push/message
 * protocol (see messaging-service's MessagingWebSocketHandler and the browser
 * SDK's web-agent.js _websocketSend/_handleWebSocketMessage). AgentConnection
 * uses this as an optional low-latency, push-driven alternative to HTTP
 * polling: send/receive still go over the same session, but new messages
 * arrive as unsolicited 'message' pushes instead of being polled for.
 *
 * Built on java.net.http.WebSocket (JDK 11+, no extra dependency).
 */
public class WsChannelClient {

    private static final Logger logger = LoggerFactory.getLogger(WsChannelClient.class);

    private final String sessionId;
    private final ObjectMapper mapper;
    private final java.util.function.Consumer<JsonNode> onPush;

    private final HttpClient httpClient;
    private final URI wsUri;
    private volatile WebSocket webSocket;
    private volatile boolean running = false;

    private final AtomicLong nextMessageId = new AtomicLong(0);
    private final Map<Long, CompletableFuture<JsonNode>> pending = new ConcurrentHashMap<>();

    private final CompletableFuture<Boolean> subscribed = new CompletableFuture<>();

    // Accumulates fragmented text frames until the server marks one as `last`.
    private final StringBuilder textBuffer = new StringBuilder();

    public WsChannelClient(String httpBaseUrl, String sessionId, ObjectMapper mapper,
                            java.util.function.Consumer<JsonNode> onPush) {
        this.sessionId = sessionId;
        this.mapper = mapper;
        this.onPush = onPush;
        this.httpClient = HttpClient.newHttpClient();
        this.wsUri = toWsUri(httpBaseUrl);
    }

    private static URI toWsUri(String httpBaseUrl) {
        String url = httpBaseUrl;
        if (url.startsWith("https://")) {
            url = "wss://" + url.substring(8);
        } else if (url.startsWith("http://")) {
            url = "ws://" + url.substring(7);
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return URI.create(url + "/ws");
    }

    public boolean isOpen() {
        return running && webSocket != null && !webSocket.isOutputClosed();
    }

    /**
     * Opens the socket and subscribes at the given offsets. Blocks (up to
     * timeoutMs) for the server's "subscribed" ack. Returns false on any
     * failure — callers should fall back to HTTP polling.
     */
    public boolean connectBlocking(long globalOffset, long localOffset, long timeoutMs) {
        try {
            WebSocket.Listener listener = new WebSocket.Listener() {
                @Override
                public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
                    textBuffer.append(data);
                    if (last) {
                        String full = textBuffer.toString();
                        textBuffer.setLength(0);
                        handleFrame(full);
                    }
                    webSocket.request(1);
                    return null;
                }

                @Override
                public void onError(WebSocket webSocket, Throwable error) {
                    logger.debug("[WsChannelClient] Transport error: {}", error.getMessage());
                    running = false;
                    failAllPending();
                }

                @Override
                public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
                    running = false;
                    failAllPending();
                    return null;
                }
            };

            webSocket = httpClient.newWebSocketBuilder()
                    .buildAsync(wsUri, listener)
                    .get(timeoutMs, TimeUnit.MILLISECONDS);
            running = true;

            ObjectNode subscribeMsg = mapper.createObjectNode();
            subscribeMsg.put("action", "subscribe");
            subscribeMsg.put("sessionId", sessionId);
            subscribeMsg.put("offset", globalOffset);
            subscribeMsg.put("localOffset", localOffset);
            webSocket.sendText(subscribeMsg.toString(), true);

            Boolean ok = subscribed.get(timeoutMs, TimeUnit.MILLISECONDS);
            if (!Boolean.TRUE.equals(ok)) {
                close();
                return false;
            }
            return true;
        } catch (Exception e) {
            logger.warn("[WsChannelClient] connect/subscribe failed: {}", e.getMessage());
            close();
            return false;
        }
    }

    private void handleFrame(String raw) {
        JsonNode json;
        try {
            json = mapper.readTree(raw);
        } catch (Exception e) {
            logger.debug("[WsChannelClient] Failed to parse frame: {}", raw);
            return;
        }

        String action = json.has("action") ? json.get("action").asText() : null;

        if ("subscribed".equals(action)) {
            boolean ok = json.has("status") && "success".equals(json.get("status").asText());
            subscribed.complete(ok);
            return;
        }

        if ("message".equals(action)) {
            boolean ok = json.has("status") && "success".equals(json.get("status").asText());
            if (ok && json.has("data")) {
                try {
                    onPush.accept(json.get("data"));
                } catch (Exception e) {
                    logger.warn("[WsChannelClient] push handler raised: {}", e.getMessage());
                }
            }
            return;
        }

        // pull/push responses (and any other correlated response) resolve by
        // messageId regardless of action.
        if (json.has("messageId")) {
            long messageId = json.get("messageId").asLong();
            CompletableFuture<JsonNode> fut = pending.remove(messageId);
            if (fut != null) {
                fut.complete(json);
            }
            return;
        }

        if ("pong".equals(action)) {
            return;
        }

        logger.debug("[WsChannelClient] Unhandled frame: {}", raw);
    }

    private void failAllPending() {
        for (Map.Entry<Long, CompletableFuture<JsonNode>> e : pending.entrySet()) {
            e.getValue().completeExceptionally(new java.io.IOException("WebSocket closed"));
        }
        pending.clear();
        subscribed.complete(false);
    }

    private JsonNode request(String action, ObjectNode payload, long timeoutMs) {
        if (!isOpen()) {
            return null;
        }
        long messageId = nextMessageId.incrementAndGet();
        CompletableFuture<JsonNode> fut = new CompletableFuture<>();
        pending.put(messageId, fut);

        payload.put("action", action);
        payload.put("sessionId", sessionId);
        payload.put("messageId", messageId);

        try {
            webSocket.sendText(payload.toString(), true);
        } catch (Exception e) {
            pending.remove(messageId);
            logger.warn("[WsChannelClient] send failed for action={}: {}", action, e.getMessage());
            return null;
        }

        try {
            return fut.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException te) {
            pending.remove(messageId);
            logger.warn("[WsChannelClient] {} request timed out (messageId={})", action, messageId);
            return null;
        } catch (Exception e) {
            pending.remove(messageId);
            logger.warn("[WsChannelClient] {} request failed: {}", action, e.getMessage());
            return null;
        }
    }

    /**
     * Sends a 'pull' request over the socket. Returns the response's `data`
     * node ({events, ephemeralEvents, nextGlobalOffset, nextLocalOffset}) or
     * null on timeout/failure/non-success.
     */
    public JsonNode pull(Long globalOffset, Long localOffset, Long limit, String pollSource, long timeoutMs) {
        ObjectNode receiveConfig = mapper.createObjectNode();
        if (globalOffset != null) receiveConfig.put("globalOffset", globalOffset);
        if (localOffset != null) receiveConfig.put("localOffset", localOffset);
        if (limit != null) receiveConfig.put("limit", limit);
        receiveConfig.put("pollSource", pollSource != null ? pollSource : "AUTO");

        ObjectNode payload = mapper.createObjectNode();
        payload.set("receiveConfig", receiveConfig);

        JsonNode resp = request("pull", payload, timeoutMs);
        if (resp == null || !resp.has("status") || !"success".equals(resp.get("status").asText())) {
            return null;
        }
        return resp.get("data");
    }

    /**
     * Sends a message over the socket. Returns true once the server acks the
     * push (messageId echoed back with status=success).
     */
    public boolean push(String eventType, String to, String content, boolean encrypted,
                        String customType, boolean ephemeral, long timeoutMs) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("type", eventType);
        payload.put("to", to != null ? to : "*");
        payload.put("content", content);
        payload.put("encrypted", encrypted);
        if (customType != null) payload.put("customType", customType);
        if (ephemeral) payload.put("ephemeral", true);

        JsonNode resp = request("push", payload, timeoutMs);
        return resp != null && resp.has("status") && "success".equals(resp.get("status").asText());
    }

    public void close() {
        running = false;
        try {
            if (webSocket != null) {
                webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "bye");
            }
        } catch (Exception ignored) {
        }
        failAllPending();
    }
}
