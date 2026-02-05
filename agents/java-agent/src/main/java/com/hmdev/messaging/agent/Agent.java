package com.hmdev.messaging.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.LocalTcpServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Agent service main. Runs a local TCP control server by default so local apps/games can
 * communicate with the agent which bridges to messaging-service.
 *
 * Args:
 *  --url=<baseUrl>          Messaging API base URL (default https://hmdevonline.com/messaging-platform/api/v1/messaging-service)
 *  --tcp-port=<port>        Local TCP server port (default 7071)
 */
public class Agent {
    private static final Logger logger = LoggerFactory.getLogger(Agent.class);

    private static final ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    public static void main(String[] args) {
        String apiUrl = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service";
        int tcpPort = 7071;
        String apiKey = null;

        for (String arg : args) {
            if (arg.startsWith("--url=")) {
                apiUrl = arg.substring("--url=".length());
            } else if (arg.startsWith("--tcp-port=")) {
                try { tcpPort = Integer.parseInt(arg.substring("--tcp-port=".length())); } catch (NumberFormatException ignored) {}
            } else if (arg.startsWith("--api-key=")) {
                apiKey = arg.substring("--api-key=".length());
            }
        }

        AgentConnection agentConnection = (apiKey == null || apiKey.isBlank()) ? new AgentConnection(apiUrl) : new AgentConnection(apiUrl, apiKey);

        try (LocalTcpServer server = new LocalTcpServer(tcpPort, agentConnection, mapper)) {
            server.start();
            logger.info("Agent service started. Local TCP control: localhost:{} | API: {}", tcpPort, apiUrl);
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                try {
                    server.close();
                } catch (Exception ignored) {
                }
                agentConnection.disconnect();
                logger.info("Agent service stopped.");
            }));
            // Keep alive
            while (true) {
                try {
                    Thread.sleep(60_000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        } catch (Exception ignored) {
        } finally {
            agentConnection.disconnect();
        }
    }
}
