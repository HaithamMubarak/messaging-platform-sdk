package com.hmdev.messaging.agent.storage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hmdev.messaging.common.security.MySecurity;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * Channel storage: a key-value store kept by the server, per channel, with versions.
 *
 * <p>The Java half of the JS agent's {@code storage*} methods, on the same endpoints
 * ({@code <api>/storage/put|add|get|getList|keys|values|deleteByKey}). {@code put}
 * replaces every version of a key; {@code add} appends one. An add with
 * {@code appendOnly} on a NEW key locks it: put and delete are then refused (409)
 * for everyone, this session included.
 *
 * <p>Values travel as base64 of their UTF-8 text: a String as is, anything else as
 * JSON. {@code encrypted} stores {@code MySecurity.encryptAndSign(text, channelSecret)},
 * the envelope the JS agent writes, so either agent reads the other's values. Unlike
 * the JS agent, encrypting without a channel secret throws rather than storing the
 * value in clear.
 *
 * <p>Failures throw {@link StorageException}, so a failed read is never mistaken for
 * an empty one. A key with nothing stored reads as empty ({@link #get}) or an empty
 * list ({@link #getList}).
 */
public class ChannelStorage {

    private static final Duration TIMEOUT = Duration.ofSeconds(30);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final String base;
    private final Supplier<String> sessionId;
    private final Supplier<String> channelSecret;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();

    public ChannelStorage(String apiUrl, Supplier<String> sessionId, Supplier<String> channelSecret) {
        this.base = (apiUrl.endsWith("/") ? apiUrl : apiUrl + "/") + "storage/";
        this.sessionId = sessionId;
        this.channelSecret = channelSecret;
    }

    // ---- writes -----------------------------------------------------------

    /** Replace every version of {@code key}; answers the server's record of the write. */
    public JsonNode put(String key, Object value, boolean encrypted) {
        return write("put", key, value, encrypted, false);
    }

    public JsonNode put(String key, Object value) {
        return put(key, value, false);
    }

    /** Append a version of {@code key}; the answer's {@code appendOnly} says whether the key is locked. */
    public JsonNode add(String key, Object value, boolean encrypted, boolean appendOnly) {
        return write("add", key, value, encrypted, appendOnly);
    }

    public JsonNode add(String key, Object value) {
        return add(key, value, false, false);
    }

    /** Delete every version of {@code key}; answers how many were deleted. */
    public long deleteByKey(String key) {
        return postJson("deleteByKey", Map.of("storageKey", key)).path("versionsDeleted").asLong();
    }

    private JsonNode write(String endpoint, String key, Object value, boolean encrypted, boolean appendOnly) {
        String text = asText(value);
        if (encrypted) {
            String secret = channelSecret.get();
            if (secret == null || secret.isEmpty()) {
                throw new StorageException("Encryption needs the channel secret; connect with the channel password", 0);
            }
            text = MySecurity.encryptAndSign(text, secret);
        }
        ObjectNode body = MAPPER.createObjectNode();
        body.put("storageKey", key);
        body.put("content", Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)));
        body.put("encrypted", encrypted);
        body.putObject("metadata").put("contentType", "application/json");
        if (appendOnly) {
            body.put("appendOnly", true);
        }
        return postJson(endpoint, body);
    }

    // ---- reads ------------------------------------------------------------

    /** The latest version of {@code key}, or empty when nothing is stored under it. */
    public Optional<StorageEntry> get(String key) {
        HttpResponse<byte[]> r = post("get", Map.of("storageKey", key));
        if (r.statusCode() != 200) {
            throw failure(r);
        }
        // A missing key is a 200 with "{}"; only a stored value carries X-Storage-Key.
        if (header(r, "X-Storage-Key") == null) {
            return Optional.empty();
        }
        String text = new String(r.body(), StandardCharsets.UTF_8);
        boolean encrypted = "true".equals(header(r, "X-Storage-Encrypted"));
        if (encrypted && (text = decrypt(text)) == null) {
            throw new StorageException("Stored value of '" + key + "' is encrypted under another channel secret", 0);
        }
        return Optional.of(StorageEntry.builder()
                .text(text)
                .encrypted(encrypted)
                .writtenBy(header(r, "X-Storage-Written-By"))
                .appendOnly("true".equals(header(r, "X-Storage-Append-Only")))
                .id(header(r, "X-Storage-Id") == null ? null : Long.valueOf(header(r, "X-Storage-Id")))
                .version(header(r, "X-Storage-Version") == null ? null : Integer.valueOf(header(r, "X-Storage-Version")))
                .metadata(readTree(header(r, "X-Storage-Metadata")))
                .build());
    }

    /**
     * Every version of {@code key}, NEWEST FIRST, decrypted where they were encrypted.
     * A version this connection cannot decrypt (another channel password) is left out
     * rather than returned as ciphertext.
     */
    public List<StorageEntry> getList(String key) {
        List<StorageEntry> entries = new ArrayList<>();
        for (JsonNode v : postJson("getList", Map.of("storageKey", key)).path("versions")) {
            StorageEntry entry = listEntry(v);
            if (entry != null) {
                entries.add(entry);
            }
        }
        return entries;
    }

    /** Every storage key of the channel. */
    public List<String> keys() {
        List<String> keys = new ArrayList<>();
        postJson("keys", Map.of()).path("keys").forEach(k -> keys.add(k.asText()));
        return keys;
    }

    /** Metadata (not content) of the latest version of every key. */
    public JsonNode values() {
        return postJson("values", Map.of()).path("values");
    }

    private StorageEntry listEntry(JsonNode v) {
        String text = new String(Base64.getDecoder().decode(v.path("content").asText("")), StandardCharsets.UTF_8);
        // getList carries no encrypted flag, so an envelope is recognised by its shape.
        boolean encrypted = isEnvelope(text);
        if (encrypted && (text = decrypt(text)) == null) {
            return null;
        }
        return StorageEntry.builder()
                .text(text)
                .encrypted(encrypted)
                .writtenBy(v.hasNonNull("writtenBy") ? v.get("writtenBy").asText() : null)
                .appendOnly(v.path("appendOnly").asBoolean())
                .id(v.hasNonNull("id") ? v.get("id").asLong() : null)
                .version(v.hasNonNull("version") ? v.get("version").asInt() : null)
                .createdAt(v.hasNonNull("createdAt") ? v.get("createdAt").asText() : null)
                .metadata(v.get("metadata"))
                .build();
    }

    private String decrypt(String envelope) {
        String secret = channelSecret.get();
        return secret == null || secret.isEmpty() ? null : MySecurity.decryptAndVerify(envelope, secret);
    }

    // ---- transport --------------------------------------------------------

    private HttpResponse<byte[]> post(String endpoint, Object body) {
        String session = sessionId.get();
        if (session == null) {
            throw new StorageException("The channel is not ready.", 0);
        }
        try {
            ObjectNode payload = MAPPER.valueToTree(body);
            payload.put("sessionId", session);
            HttpRequest request = HttpRequest.newBuilder(URI.create(base + endpoint))
                    .timeout(TIMEOUT)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(MAPPER.writeValueAsBytes(payload)))
                    .build();
            return http.send(request, HttpResponse.BodyHandlers.ofByteArray());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new StorageException("Interrupted: storage/" + endpoint, e);
        } catch (Exception e) {
            throw new StorageException("Network error: " + e.getMessage(), e);
        }
    }

    /** POST and unwrap the platform envelope {status, statusMessage, data}. */
    private JsonNode postJson(String endpoint, Object body) {
        HttpResponse<byte[]> r = post(endpoint, body);
        if (r.statusCode() != 200) {
            throw failure(r);
        }
        JsonNode reply = readTree(new String(r.body(), StandardCharsets.UTF_8));
        if (reply == null) {
            throw new StorageException("Invalid response from storage/" + endpoint, r.statusCode());
        }
        return reply.path("data");
    }

    /** A non-200 answer; the server's own sentence when it sent one. */
    private static StorageException failure(HttpResponse<byte[]> r) {
        String text = new String(r.body(), StandardCharsets.UTF_8);
        JsonNode body = readTree(text);
        String message = body != null && body.hasNonNull("statusMessage") ? body.get("statusMessage").asText() : text;
        return new StorageException(message, r.statusCode());
    }

    private static String header(HttpResponse<?> r, String name) {
        return r.headers().firstValue(name).orElse(null);
    }

    private static String asText(Object value) {
        if (value instanceof String) {
            return (String) value;
        }
        if (value instanceof byte[]) {
            return new String((byte[]) value, StandardCharsets.UTF_8);
        }
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            throw new StorageException("Value cannot be written as JSON: " + e.getMessage(), e);
        }
    }

    private static boolean isEnvelope(String text) {
        JsonNode node = readTree(text);
        return node != null && node.isObject() && node.has("cipher") && node.has("hash");
    }

    private static JsonNode readTree(String text) {
        if (text == null) {
            return null;
        }
        try {
            return MAPPER.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }
}
