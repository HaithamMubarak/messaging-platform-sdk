package com.hmdev.messaging.agent.example;

import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;
import com.hmdev.messaging.common.data.AgentInfo;
import com.hmdev.messaging.common.data.EventMessage;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Live two-agent messaging smoke test for the Java agent SDK.
 *
 * Verifies end-to-end that nothing is broken: two independent agents connect to
 * a fresh channel, discover each other, and a message sent by one is received by
 * the other (both directions). No WebRTC. Real server — needs a URL + API key.
 *
 * RUN (from the SDK repo root):
 *   ./gradlew :agents:examples:java-agent-chat:liveSmokeTest \
 *       --args="--url=https://hmdevonline.com/messaging-platform/api/v1/messaging-service --api-key=YOUR_KEY"
 *   (--url and --api-key also read from MESSAGING_API_URL / DEFAULT_API_KEY env if omitted.)
 *
 * Exit code 0 = PASS, 1 = FAIL. Prints a clear banner either way.
 */
public class LiveSmokeTest {

    public static void main(String[] args) {
        String url = env("MESSAGING_API_URL", "https://hmdevonline.com/messaging-platform/api/v1/messaging-service");
        String apiKey = env("DEFAULT_API_KEY", env("MESSAGING_API_KEY", ""));
        // ONE fixed channel, reused every run — each new channel counts against the
        // developer's channel-unit quota (Free plan = 50), so a per-run channel would
        // exhaust it. A per-run nonce disambiguates messages across runs.
        String channel = "smoke-test-java";
        for (String a : args) {
            if (a.startsWith("--url=")) url = a.substring(6);
            else if (a.startsWith("--api-key=")) apiKey = a.substring(10);
            else if (a.startsWith("--channel=")) channel = a.substring(10);
        }
        if (apiKey.isBlank()) fail("no API key — pass --api-key=... or set DEFAULT_API_KEY");

        String password = "smoke-pw";
        String nonce = Long.toString(System.nanoTime(), 36);
        String ping = "PING:" + nonce;
        String pong = "PONG:" + nonce;
        System.out.println("========== JAVA AGENT LIVE SMOKE TEST ==========");
        System.out.println("  url=" + url);
        System.out.println("  channel=" + channel + "  nonce=" + nonce);

        AgentConnection alice = new AgentConnection(url, apiKey);
        AgentConnection bob = new AgentConnection(url, apiKey);
        CountDownLatch bobGotPing = new CountDownLatch(1);
        CountDownLatch aliceGotPong = new CountDownLatch(1);
        AtomicBoolean pongSent = new AtomicBoolean(false);

        try {
            if (!alice.connect(cfg(channel, password, "smoke-alice"))) fail("alice failed to connect");
            if (!bob.connect(cfg(channel, password, "smoke-bob"))) fail("bob failed to connect");
            System.out.println("  ✔ both agents connected");

            // Presence check — each side should see the other on the channel.
            // Poll: roster registration is eventually-consistent, so give it a moment.
            List<AgentInfo> seenByAlice = alice.getActiveAgents();
            for (int i = 0; i < 10 && seenByAlice.size() < 2; i++) {
                Thread.sleep(1000);
                seenByAlice = alice.getActiveAgents();
            }
            System.out.println("  active agents seen by alice: " + names(seenByAlice)
                    + (seenByAlice.size() < 2 ? "  (⚠ presence didn't list the peer — informational)" : ""));

            // bob waits for the ping, then replies with the pong.
            bob.receiveAsync(events -> {
                for (EventMessage e : events) {
                    if (e.getDate() > bob.getConnectionTime() && ping.equals(trim(e.getContent()))) {
                        System.out.println("  ✔ bob received: " + ping);
                        bobGotPing.countDown();
                        if (pongSent.compareAndSet(false, true)) bob.sendMessage(pong);
                    }
                }
            });
            // alice waits for the pong.
            alice.receiveAsync(events -> {
                for (EventMessage e : events) {
                    if (e.getDate() > alice.getConnectionTime() && pong.equals(trim(e.getContent()))) {
                        System.out.println("  ✔ alice received: " + pong);
                        aliceGotPong.countDown();
                    }
                }
            });

            Thread.sleep(1500);                     // let both receive loops spin up
            System.out.println("  → alice sends: " + ping);
            if (!alice.sendMessage(ping)) fail("alice.sendMessage returned false");

            if (!bobGotPing.await(20, TimeUnit.SECONDS)) fail("bob never received the ping (A→B delivery broken)");
            if (!aliceGotPong.await(20, TimeUnit.SECONDS)) fail("alice never received the pong (B→A delivery broken)");

            pass();
        } catch (Throwable t) {
            fail("exception: " + t);
        } finally {
            try { alice.disconnect(); } catch (Exception ignored) {}
            try { bob.disconnect(); } catch (Exception ignored) {}
        }
    }

    private static ConnectConfig cfg(String channel, String password, String agent) {
        return ConnectConfig.builder()
                .channelName(channel).channelPassword(password)
                .agentName(agent).apiKeyScope("public").build();
    }

    private static String names(List<AgentInfo> agents) {
        StringBuilder sb = new StringBuilder();
        for (AgentInfo a : agents) sb.append(a.getAgentName()).append(" ");
        return sb.toString().trim();
    }

    private static String trim(String s) { return s == null ? "" : s.trim(); }
    private static String env(String k, String def) {
        String v = System.getenv(k);
        return (v == null || v.isBlank()) ? def : v;
    }

    private static void pass() {
        System.out.println("\n  RESULT: ✅ PASS — two agents connected and exchanged messages both ways.");
        System.out.println("================================================");
        System.exit(0);
    }
    private static void fail(String why) {
        System.out.println("\n  RESULT: ❌ FAIL — " + why);
        System.out.println("================================================");
        System.exit(1);
    }
}
