package com.hmdev.messaging.agent.api.impl;

import com.sun.net.httpserver.HttpServer;
import org.testng.Assert;
import org.testng.annotations.AfterClass;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Managed channels, as the Java agent sends them: agentKey goes with connect
 * when given, and not at all otherwise (ordinary channels see the same payload
 * as before). A local server stands in for the service and records bodies.
 */
public class ManagedConnectTest {

    private static final String KEY = "k-0123456789abcdef0123456789";
    private final List<String> connects = new CopyOnWriteArrayList<>();
    private HttpServer server;
    private String url;

    @BeforeClass
    public void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (exchange.getRequestURI().getPath().endsWith("/connect")) connects.add(body);
            byte[] out = "{\"status\":\"unauthorized\",\"statusMessage\":\"stand-in\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        url = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterClass
    public void stop() {
        server.stop(0);
    }

    @Test
    public void aManagedAgentSendsItsKey() {
        connect("u-ann", KEY);
        String last = connects.get(connects.size() - 1);
        Assert.assertTrue(last.contains("\"agentKey\":\"" + KEY + "\""), last);
    }

    @Test
    public void anOrdinaryAgentSendsNoKey() {
        connect("plain", null);
        String last = connects.get(connects.size() - 1);
        Assert.assertFalse(last.contains(KEY), last);
        Assert.assertFalse(last.matches("(?s).*\"agentKey\"\\s*:\\s*\"[^\"]+\".*"), "no key value: " + last);
    }

    private void connect(String agent, String key) {
        MessagingChannelApi api = new MessagingChannelApi(url, "temp-key");
        Map<String, Object> config = new HashMap<>();
        config.put("channelId", "room-1");
        config.put("agentName", agent);
        if (key != null) config.put("agentKey", key);
        try {
            api.connect(config);
        } catch (RuntimeException refused) {
            // the stand-in refuses; only the request body matters here
        }
    }
}
