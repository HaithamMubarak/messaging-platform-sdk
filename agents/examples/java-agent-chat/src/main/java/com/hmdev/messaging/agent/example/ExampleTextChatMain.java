package com.hmdev.messaging.agent.example;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;
import com.hmdev.messaging.common.util.EnvLoader;
import com.hmdev.messaging.common.CommonUtils;
import com.hmdev.messaging.common.data.AgentInfo;
import com.hmdev.messaging.common.data.EventMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class ExampleTextChatMain {
    private static final Logger logger = LoggerFactory.getLogger(ExampleTextChatMain.class);
    private static final String EXIT_COMMAND = "/java-agent:exit";

    private static final ObjectMapper mapper = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);

    public static void main(String[] args) {

        // Load environment variables from .env file
        // Searches: current project → services repo → system props → env vars → built-in defaults
        EnvLoader.load( "DEFAULT_API_KEY", "MESSAGING_API_URL");

        String apiUrl = EnvLoader.get("MESSAGING_API_URL", "https://hmdevonline.com/messaging-platform/api/v1/messaging-service");
        String channel = "system001";
        String password = "12345678";
        String agentName = "java-agent001";

        // IMPORTANT: Set API key via environment variable MESSAGING_API_KEY or DEFAULT_API_KEY
        // or pass via --api-key= command line argument
        String apiKey = EnvLoader.get("DEFAULT_API_KEY");
        if(CommonUtils.isEmpty(apiKey)) {
            apiKey = "your-api-key-here";  // Placeholder - must be configured
        }

        // Simple argument parser (--key=value style)
        for (String arg : args) {
            if (arg.startsWith("--url=")) {
                apiUrl = arg.substring("--url=".length());
            } else if (arg.startsWith("--channel=")) {
                channel = arg.substring("--channel=".length());
            } else if (arg.startsWith("--password=")) {
                password = arg.substring("--password=".length());
            } else if (arg.startsWith("--agent-name=")) {
                agentName = arg.substring("--agent-name=".length());
            } else if (arg.startsWith("--api-key=")) {
                // Allow passing developer API key via CLI; forward into AgentConnection constructor
                String key = arg.substring("--api-key=".length());
                if (!key.isEmpty()) {
                    // store locally and pass to AgentConnection below
                    apiKey = key;
                }
            }
        }

        CountDownLatch latch = new CountDownLatch(1);
        AgentConnection agentConnection = apiKey.isBlank() ? new AgentConnection(apiUrl) : new AgentConnection(apiUrl, apiKey);

        try {

            ConnectConfig config = ConnectConfig.builder()
                    .channelName(channel)
                    .channelPassword(password)
                    .agentName(agentName)
                    .apiKeyScope("public") // use "public" for testing with shared channels across API keys
                    .build();
            boolean connected = agentConnection.connect(config);
            if (!connected) {
                logger.error("Failed to connect to {}", apiUrl);
                return;
            }

            List<AgentInfo> agentsResults = agentConnection.getActiveAgents();
            logger.info("agentsResults: {}", agentsResults);


            boolean sendMessageResult = agentConnection.sendMessage("Hello, I am " + agentName + "! to exit, type " + EXIT_COMMAND);
            logger.info("sendMessageResult: {}", sendMessageResult);

            agentConnection.receiveAsync(messageEvents -> {

                try {
                    logger.info("New Message events:");
                    for (EventMessage messageEvent : messageEvents) {
                        logger.info("MessageEvent: {}", mapper.writeValueAsString(messageEvent));
                    }

                    // sample code to handle special prompts
                    if (messageEvents.stream()
                            .filter(event -> event.getDate() > agentConnection.getConnectionTime())
                            .map(EventMessage::getContent).filter(Objects::nonNull).map(String::trim).anyMatch(EXIT_COMMAND::equals)) {
                        agentConnection.sendMessage("Bye bye from your Java Agent - have a great day! :)");
                        CommonUtils.sleep(2000);
                        latch.countDown();
                    }
                } catch (Exception e) {
                    logger.warn("Exception {} caught for {}", e.getLocalizedMessage(), messageEvents);
                }
            });

            boolean awaited = false;
            try {
                awaited = latch.await(10, TimeUnit.MINUTES);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
            if (!awaited) {
                logger.info("Timed out waiting for exit command");
            }

        } catch (Exception e) {
            logger.error("Unexpected error in agent main: {}", e.getMessage(), e);
        } finally {
            agentConnection.disconnect();
        }
    }

}
