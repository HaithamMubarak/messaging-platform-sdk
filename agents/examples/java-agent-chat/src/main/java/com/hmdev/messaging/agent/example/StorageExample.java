package com.hmdev.messaging.agent.example;

import com.fasterxml.jackson.databind.JsonNode;
import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;
import com.hmdev.messaging.agent.storage.ChannelStorage;
import com.hmdev.messaging.agent.storage.StorageEntry;
import com.hmdev.messaging.agent.storage.StorageException;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Channel storage with the Java agent: a key-value store the server keeps per
 * channel, with versions. Live, against a real server — needs a URL + API key.
 *
 * It connects, then puts an encrypted JSON value and reads it back (the server
 * only sees ciphertext), adds two versions to an append-only log and lists them
 * newest first, shows that a put to the locked log is refused (409), lists the
 * keys and deletes the plain key.
 *
 * RUN (from the SDK repo root):
 *   ./gradlew :agents:examples:java-agent-chat:storageExample --args="--url=<URL> --api-key=<KEY>"
 *   (--url and --api-key also read from MESSAGING_API_URL / DEFAULT_API_KEY if omitted.)
 *
 * Each run uses a fresh channel named <prefix>-<time>; delete it afterwards, e.g.
 *   python scripts/cleanup_channels.py --prefix '^parity-' --yes   (ops repo)
 *
 * Exit code 0 = PASS, 1 = FAIL.
 */
public class StorageExample {

    public static void main(String[] args) {
        String url = env("MESSAGING_API_URL", "https://hmdevonline.com/messaging-platform/api/v1/messaging-service");
        String apiKey = env("DEFAULT_API_KEY", env("MESSAGING_API_KEY", ""));
        String prefix = "parity-storage-java";
        for (String a : args) {
            if (a.startsWith("--url=")) url = a.substring(6);
            else if (a.startsWith("--api-key=")) apiKey = a.substring(10);
            else if (a.startsWith("--prefix=")) prefix = a.substring(9);
        }
        if (apiKey.isBlank()) fail("no API key — pass --api-key=... or set DEFAULT_API_KEY");

        String channel = prefix + "-" + System.currentTimeMillis() / 1000;
        System.out.println("Channel storage example — channel " + channel);
        AgentConnection agent = new AgentConnection(url, apiKey);
        agent.setCheckLastSession(false);
        try {
            check(agent.connect(ConnectConfig.builder().channelName(channel).channelPassword("storage-example-pw")
                    .agentName("storage-java").build()), "connected");
            exercise(agent.storage());
        } catch (Exception e) {
            fail("exception: " + e);
        } finally {
            try { agent.disconnect(); } catch (Exception ignored) {}
        }
        System.out.println("\n  RESULT: ✅ PASS");
        System.exit(0);
    }

    private static void exercise(ChannelStorage storage) {
        storage.put("settings", Map.of("theme", "dark", "volume", 7), true);
        Optional<StorageEntry> settings = storage.get("settings");
        JsonNode json = settings.map(StorageEntry::getJson).orElse(null);
        check(json != null && "dark".equals(json.path("theme").asText()) && settings.get().isEncrypted(),
                "put an encrypted value and read it back: " + json);

        JsonNode first = storage.add("audit", Map.of("event", "opened"), false, true);
        storage.add("audit", Map.of("event", "closed"), false, true);
        List<StorageEntry> log = storage.getList("audit");
        List<String> events = log.stream().map(e -> e.getJson().path("event").asText()).collect(Collectors.toList());
        check(first.path("appendOnly").asBoolean() && events.equals(List.of("closed", "opened")),
                "append-only log, newest first, written by " + (log.isEmpty() ? null : log.get(0).getWrittenBy()));

        try {
            storage.put("audit", "overwrite");
            check(false, "a put to the append-only log should be refused");
        } catch (StorageException e) {
            check(e.isAppendOnly(), "put to the locked log refused: " + e.getMessage());
        }

        List<String> keys = storage.keys();
        check(keys.containsAll(List.of("audit", "settings")) && keys.size() == 2, "keys: " + keys);
        check(storage.deleteByKey("settings") == 1 && storage.get("settings").isEmpty(),
                "deleted 'settings'; it now reads as empty");
    }

    private static void check(boolean ok, String what) {
        System.out.println((ok ? "  ✅ " : "  ❌ ") + what);
        if (!ok) fail(what);
    }

    private static void fail(String why) {
        System.out.println("\n  RESULT: ❌ FAIL — " + why);
        System.exit(1);
    }

    private static String env(String name, String fallback) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? fallback : v;
    }
}
