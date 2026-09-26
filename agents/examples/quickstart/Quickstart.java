import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;
import com.hmdev.messaging.common.data.EventMessage;

public class Quickstart {
    public static void main(String[] args) throws Exception {
        // Step 2 — connect with your API key
        AgentConnection agent = new AgentConnection(
                "https://hmdevonline.com/messaging-platform/api/v1/messaging-service",
                System.getenv("MESSAGING_PLATFORM_API_KEY"));

        // Step 3 — join a channel (created on first use)
        agent.connect(ConnectConfig.of(System.getenv().getOrDefault("QS_CHANNEL", "quickstart-room"), "channel-password", "java-agent"));

        // Step 5 — receive
        agent.receiveAsync(events -> events.stream()
                .filter(e -> e.getType() == EventMessage.EventType.CHAT_TEXT)
                .forEach(e -> System.out.println(e.getFrom() + " says " + e.getContent())));

        // Step 4 — send
        agent.sendMessage("Hello from Java!");
        Thread.sleep(20_000);
        agent.disconnect();
    }
}
