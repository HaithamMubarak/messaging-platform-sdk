package com.hmdev.messaging.agent.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hmdev.messaging.common.data.EventMessageResult;
import com.hmdev.messaging.common.data.ReceiveConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Simple newline-delimited JSON TCP server for local game/agent integration.
 * Supported ops:
 * - connect: {"op":"connect","url"?,"channel","password","agentName"} or {"op":"connect","channelId", "agentName"}
 * - disconnect: {"op":"disconnect"}
 * - udpPush: {"op":"udpPush","content","destination"}   (WebRTC-relay path)
 * - udpPull: {"op":"udpPull","startOffset", "limit"}    (WebRTC-relay path)
 * - send:    {"op":"send","content"}                    (HTTP message store)
 * - pull:    {"op":"pull","startOffset","limit"}        (HTTP message store)
 */
public class LocalTcpServer implements AutoCloseable {
    private static final Logger logger = LoggerFactory.getLogger(LocalTcpServer.class);

    private final int port;
    private final AgentConnection agent;
    private final ObjectMapper mapper;

    private volatile boolean running = false;
    private ServerSocket serverSocket;
    private final ExecutorService executor = Executors.newCachedThreadPool();

    // Stateful cursor for the "pull" op: starts at the connect offset (channel
    // tail) and advances each pull, so successive pulls stream new messages.
    private ReceiveConfig pullCursor = null;

    public LocalTcpServer(int port, AgentConnection agent, ObjectMapper mapper) {
        this.port = port;
        this.agent = agent;
        this.mapper = mapper;
    }

    public void start() {
        if (running) return;
        running = true;
        executor.submit(this::acceptLoop);
        logger.info("Local TCP server started on localhost:{}", port);
    }

    private void acceptLoop() {
        try (ServerSocket ss = new ServerSocket(port, 50, InetAddress.getByName("127.0.0.1"))) {
            this.serverSocket = ss;
            while (running && !ss.isClosed()) {
                Socket sock = ss.accept();
                executor.submit(() -> handleClient(sock));
            }
        } catch (IOException e) {
            if (running) {
                logger.error("Local TCP server acceptLoop error: {}", e.getMessage());
            } else {
                logger.debug("Local TCP server closed: {}", e.getMessage());
            }
        }
    }

    private void handleClient(Socket sock) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8));
             BufferedWriter out = new BufferedWriter(new OutputStreamWriter(sock.getOutputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = in.readLine()) != null) {
                String resp = processLine(line);
                out.write(resp);
                out.write('\n');
                out.flush();
            }
        } catch (Exception e) {
            logger.debug("Local TCP client handler error: {}", e.getMessage());
        } finally {
            try { sock.close(); } catch (IOException ignored) {}
        }
    }

    private String processLine(String line) {
        try {
            JsonNode req = mapper.readTree(line);
            String op = req.path("op").asText("");
            switch (op) {
                case "connect":
                    // Support both legacy local API (channel+password) and new channelId-based connect
                    String channelId = req.has("channelId") && !req.path("channelId").isNull() ? req.path("channelId").asText(null) : null;
                    String channel = req.path("channel").asText(null);
                    // legacy field names: "channel" and "password"
                    String password = req.path("password").asText(null);
                    String agentName = req.path("agentName").asText(null);
                    // apiKeyScope: "public" for shared/test channels, "private" (default) for isolated
                    String apiKeyScope = req.path("apiKeyScope").asText("private");

                    boolean ok;
                    ConnectConfig.ConnectConfigBuilder configBuilder = ConnectConfig.builder()
                            .agentName(agentName)
                            .apiKeyScope(apiKeyScope);

                    if (channelId != null && !channelId.isEmpty()) {
                        // use new channelId-based connect
                        configBuilder.channelId(channelId);
                    } else {
                        // fallback to legacy name+password connect
                        configBuilder.channelName(channel).channelPassword(password);
                    }
                    ok = agent.connect(configBuilder.build());
                    if (ok) {
                        pullCursor = null;  // fresh pull stream for this session
                    }
                    return ok ? okResp(null) : errResp("connect failed");
                case "disconnect":
                    boolean disc = agent.disconnect();
                    return disc ? okResp(null) : errResp("disconnect failed");
                case "udpPush":
                    String content = req.path("content").asText("");
                    String dest = req.path("destination").asText("*");
                    boolean pushOk = agent.udpPushMessage(content, dest);
                    return pushOk ? okResp(null) : errResp("udpPush failed");
                case "udpPull":
                    long start = req.path("startOffset").asLong(0L);
                    long limit = req.path("limit").asLong(10L);
                    // Use ReceiveConfig (globalOffset, localOffset, limit)
                    ReceiveConfig range = new ReceiveConfig(start, null, limit);
                    EventMessageResult res = agent.udpPull(range);
                    ObjectNode data = mapper.createObjectNode();
                    data.set("result", mapper.valueToTree(res));
                    return okResp(data);
                case "send":
                    // Regular message send via the HTTP message store (durable,
                    // pull-retrievable) — unlike udpPush which is the relay path.
                    String sendContent = req.path("content").asText("");
                    boolean sendOk = agent.sendMessage(sendContent);
                    return sendOk ? okResp(null) : errResp("send failed");
                case "pull":
                    // Regular receive from the HTTP message store; mirrors udpPull's
                    // response shape ({result:{events,nextGlobalOffset}}). Stateful:
                    // starts at the connect offset (tail) and advances each call, so
                    // callers stream NEW messages without managing offsets themselves.
                    if (pullCursor == null) {
                        ReceiveConfig init = agent.getInitialReceiveConfig();
                        if (init == null) {
                            return errResp("pull before connect");
                        }
                        pullCursor = new ReceiveConfig(init);
                    }
                    EventMessageResult pRes = agent.receive(pullCursor);
                    if (pRes != null) {
                        if (pRes.getNextGlobalOffset() != null) {
                            pullCursor.setGlobalOffset(pRes.getNextGlobalOffset());
                        }
                        if (pRes.getNextLocalOffset() != null) {
                            pullCursor.setLocalOffset(pRes.getNextLocalOffset());
                        }
                    }
                    ObjectNode pData = mapper.createObjectNode();
                    pData.set("result", mapper.valueToTree(pRes));
                    return okResp(pData);
                default:
                    return errResp("unknown op: " + op);
            }
        } catch (Exception e) {
            return errResp("bad request: " + e.getMessage());
        }
    }

    private String okResp(JsonNode data) {
        ObjectNode node = mapper.createObjectNode();
        node.put("status", "ok");
        if (data != null) node.set("data", data);
        return node.toString();
    }

    private String okResp(Object o) {
        ObjectNode node = mapper.createObjectNode();
        node.put("status", "ok");
        if (o != null) node.set("data", mapper.valueToTree(o));
        return node.toString();
    }

    private String errResp(String message) {
        ObjectNode node = mapper.createObjectNode();
        node.put("status", "error");
        node.put("message", message);
        return node.toString();
    }

    @Override
    public void close() {
        running = false;
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) {}
        executor.shutdownNow();
        logger.info("Local TCP server stopped");
    }
}
