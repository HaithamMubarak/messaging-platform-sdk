package com.hmdev.messaging.agent.storage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hmdev.messaging.common.security.MySecurity;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.testng.Assert;
import org.testng.annotations.AfterClass;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

/**
 * Channel storage, as the Java agent speaks it. A local stand-in keeps what is
 * written and answers in the shapes production answered on 2026-10-26: the
 * platform envelope for put/add/getList/keys/deleteByKey, raw bytes plus
 * X-Storage-* headers for get, "{}" without X-Storage-Key for a missing key, and
 * 409 with a statusMessage for a write to an append-only key.
 */
public class ChannelStorageTest {

    private static final String SESSION = "s-1";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** key -> versions, oldest first; each {content, encrypted, appendOnly}. */
    private final Map<String, List<ObjectNode>> store = new TreeMap<>();
    private final List<JsonNode> requests = new CopyOnWriteArrayList<>();
    private final String secret = MySecurity.deriveChannelSecret("parity-room", "pw-123456");
    private HttpServer server;
    private String url;

    @BeforeClass
    public void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();
        url = "http://127.0.0.1:" + server.getAddress().getPort() + "/api";
    }

    @AfterClass
    public void stop() {
        server.stop(0);
    }

    @BeforeMethod
    public void reset() {
        store.clear();
        requests.clear();
    }

    private ChannelStorage storage(String session, String channelSecret) {
        return new ChannelStorage(url, () -> session, () -> channelSecret);
    }

    @Test
    public void aValueRoundTripsAsWritten() {
        ChannelStorage s = storage(SESSION, secret);
        s.put("board", Map.of("turn", 3, "name", "Zoë"));
        JsonNode body = requests.get(requests.size() - 1);
        Assert.assertEquals(body.get("sessionId").asText(), SESSION);
        Assert.assertFalse(body.has("appendOnly"));
        Assert.assertTrue(decode(body.get("content").asText()).contains("Zoë"));
        StorageEntry entry = s.get("board").orElseThrow();
        Assert.assertEquals(entry.getJson().get("name").asText(), "Zoë");
        Assert.assertEquals(entry.getWrittenBy(), "ann");
        Assert.assertEquals(entry.getId(), Long.valueOf(2807));
        Assert.assertEquals(s.getList("board").get(0).getJson().get("turn").asInt(), 3);
    }

    @Test
    public void plainTextReadsBackAsText() {
        ChannelStorage s = storage(SESSION, secret);
        s.put("note", "hello, not json");
        StorageEntry entry = s.get("note").orElseThrow();
        Assert.assertEquals(entry.getText(), "hello, not json");
        Assert.assertNull(entry.getJson());
    }

    @Test
    public void aMissingKeyIsEmptyNotAnEmptyObject() {
        ChannelStorage s = storage(SESSION, secret);
        Assert.assertTrue(s.get("nothing").isEmpty());
        s.put("empty-object", Map.of());
        Assert.assertEquals(s.get("empty-object").orElseThrow().getText(), "{}");
        Assert.assertTrue(s.getList("nothing").isEmpty());
    }

    @Test
    public void anEncryptedValueIsCiphertextOnTheWire() {
        ChannelStorage s = storage(SESSION, secret);
        s.put("secret", Map.of("pin", 1234), true);
        String wire = decode(requests.get(requests.size() - 1).get("content").asText());
        Assert.assertFalse(wire.contains("1234"));
        Assert.assertEquals(MySecurity.decryptAndVerify(wire, secret), "{\"pin\":1234}");
        StorageEntry entry = s.get("secret").orElseThrow();
        Assert.assertTrue(entry.isEncrypted());
        Assert.assertEquals(entry.getJson().get("pin").asInt(), 1234);
    }

    @Test
    public void anotherSecretCannotReadAndSaysSo() {
        storage(SESSION, secret).add("log", "mine", true, false);
        storage(SESSION, secret).add("log", "plain");
        ChannelStorage other = storage(SESSION, MySecurity.deriveChannelSecret("parity-room", "other-pw"));
        Assert.assertEquals(texts(other.getList("log")), List.of("plain"));
        Assert.assertEquals(texts(storage(SESSION, secret).getList("log")), List.of("plain", "mine"));
        storage(SESSION, secret).put("secret", "x", true);
        Assert.assertThrows(StorageException.class, () -> other.get("secret"));
    }

    @Test
    public void encryptingWithoutASecretRefusesInsteadOfWritingClear() {
        Assert.assertThrows(StorageException.class, () -> storage(SESSION, null).put("secret", "x", true));
        Assert.assertTrue(requests.isEmpty());
    }

    @Test
    public void anAppendOnlyKeyRefusesPutAndDelete() {
        ChannelStorage s = storage(SESSION, secret);
        Assert.assertTrue(s.add("log", "one", false, true).get("appendOnly").asBoolean());
        s.add("log", "two");
        for (Runnable attempt : List.<Runnable>of(() -> s.put("log", "x"), () -> s.deleteByKey("log"))) {
            StorageException e = Assert.expectThrows(StorageException.class, attempt::run);
            Assert.assertTrue(e.isAppendOnly());
            Assert.assertEquals(e.getMessage(), "Storage key is append-only: log");
        }
        Assert.assertEquals(texts(s.getList("log")), List.of("two", "one"));
    }

    @Test
    public void keysAndDelete() {
        ChannelStorage s = storage(SESSION, secret);
        s.put("a", 1);
        s.add("b", 2);
        Assert.assertEquals(s.keys(), List.of("a", "b"));
        Assert.assertEquals(s.deleteByKey("a"), 1L);
        Assert.assertEquals(s.keys(), List.of("b"));
    }

    @Test
    public void aRefusedSessionThrowsWithTheStatus() {
        StorageException e = Assert.expectThrows(StorageException.class, () -> storage("stale", null).keys());
        Assert.assertEquals(e.getHttpStatus(), 401);
        Assert.assertEquals(e.getMessage(), "Invalid session ID");
    }

    @Test
    public void notConnectedThrowsWithoutARequest() {
        Assert.assertThrows(StorageException.class, () -> storage(null, null).get("a"));
        Assert.assertTrue(requests.isEmpty());
    }

    // ---- the stand-in -----------------------------------------------------

    private static String decode(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    private static List<String> texts(List<StorageEntry> entries) {
        return entries.stream().map(StorageEntry::getText).collect(Collectors.toList());
    }

    private void handle(HttpExchange exchange) throws IOException {
        JsonNode body = MAPPER.readTree(exchange.getRequestBody().readAllBytes());
        requests.add(body);
        String path = exchange.getRequestURI().getPath();
        String endpoint = path.substring(path.lastIndexOf('/') + 1);
        if (!SESSION.equals(body.path("sessionId").asText())) {
            reply(exchange, 401, envelope(null, "Invalid session ID"), Map.of());
        } else if ("get".equals(endpoint)) {
            answerGet(exchange, body.path("storageKey").asText());
        } else {
            synchronized (store) {
                answer(exchange, endpoint, body);
            }
        }
    }

    private void answer(HttpExchange exchange, String endpoint, JsonNode body) throws IOException {
        String key = body.path("storageKey").asText();
        List<ObjectNode> versions = store.getOrDefault(key, new ArrayList<>());
        boolean locked = !versions.isEmpty() && versions.get(0).get("appendOnly").asBoolean();
        if (locked && ("put".equals(endpoint) || "deleteByKey".equals(endpoint))) {
            reply(exchange, 409, envelope(null, "Storage key is append-only: " + key), Map.of());
            return;
        }
        ObjectNode data = MAPPER.createObjectNode().put("storageKey", key);
        switch (endpoint) {
            case "put":
            case "add":
                ObjectNode row = MAPPER.createObjectNode()
                        .put("content", body.get("content").asText())
                        .put("encrypted", body.get("encrypted").asBoolean())
                        .put("appendOnly", locked || (versions.isEmpty() && body.path("appendOnly").asBoolean()));
                List<ObjectNode> next = "add".equals(endpoint) ? versions : new ArrayList<>();
                next.add(row);
                store.put(key, next);
                data.put("writtenBy", "ann").put("appendOnly", row.get("appendOnly").asBoolean());
                break;
            case "getList":
                ArrayNode listed = data.putArray("versions");
                for (int i = versions.size() - 1; i >= 0; i--) {
                    listed.addObject().put("id", i + 1).put("content", versions.get(i).get("content").asText())
                            .put("writtenBy", "ann").put("appendOnly", versions.get(i).get("appendOnly").asBoolean())
                            .put("version", 0).put("createdAt", "2026-10-26T10:45:21.029+00:00");
                }
                break;
            case "keys":
                data.putArray("keys").addAll(store.keySet().stream().map(MAPPER.getNodeFactory()::textNode)
                        .collect(Collectors.toList()));
                break;
            case "deleteByKey":
                store.remove(key);
                data.put("message", "Storage deleted").put("versionsDeleted", versions.size());
                break;
            default:
                reply(exchange, 404, envelope(null, "no such endpoint"), Map.of());
                return;
        }
        reply(exchange, 200, envelope(data, null), Map.of());
    }

    private void answerGet(HttpExchange exchange, String key) throws IOException {
        List<ObjectNode> versions;
        synchronized (store) {
            versions = store.get(key);
        }
        if (versions == null || versions.isEmpty()) {
            reply(exchange, 200, "{}".getBytes(StandardCharsets.UTF_8), Map.of());
            return;
        }
        ObjectNode v = versions.get(versions.size() - 1);
        reply(exchange, 200, Base64.getDecoder().decode(v.get("content").asText()), Map.of(
                "X-Storage-Key", key,
                "X-Storage-Encrypted", v.get("encrypted").asText(),
                "X-Storage-Id", "2807",
                "X-Storage-Written-By", "ann",
                "X-Storage-Append-Only", v.get("appendOnly").asText(),
                "X-Storage-Metadata", "{\"contentType\":\"application/json\"}"));
    }

    private static byte[] envelope(JsonNode data, String message) {
        ObjectNode reply = MAPPER.createObjectNode().put("status", message == null ? "success" : "error");
        reply.put("statusMessage", message);
        reply.set("data", data);
        return reply.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static void reply(HttpExchange exchange, int status, byte[] out, Map<String, String> headers)
            throws IOException {
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        headers.forEach((k, v) -> exchange.getResponseHeaders().add(k, v));
        exchange.sendResponseHeaders(status, out.length);
        exchange.getResponseBody().write(out);
        exchange.close();
    }
}
