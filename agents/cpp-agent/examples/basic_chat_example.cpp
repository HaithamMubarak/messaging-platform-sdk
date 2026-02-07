/**
 * Basic Chat Example
 * Demonstrates connecting to a channel and sending/receiving messages
 */

#include "hmdev/messaging/api/messaging_channel_api.h"
#include <iostream>
#include <thread>
#include <chrono>

using namespace hmdev::messaging;

int main(int argc, char* argv[]) {
    // Configuration
    // Default messaging service URL (production)
    std::string apiUrl = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service";
    std::string apiKey = "your_api_key_here";
    std::string channelName = "test-room";
    std::string channelPassword = "password123";
    std::string agentName = "cpp-agent-1";

    // Parse command line arguments
    if (argc >= 2) apiUrl = argv[1];
    if (argc >= 3) apiKey = argv[2];
    if (argc >= 4) channelName = argv[3];
    if (argc >= 5) channelPassword = argv[4];
    if (argc >= 6) agentName = argv[5];

    std::cout << "=== Basic Chat Example ===" << std::endl;
    std::cout << "API URL: " << apiUrl << std::endl;
    std::cout << "Channel: " << channelName << std::endl;
    std::cout << "Agent: " << agentName << std::endl;
    std::cout << std::endl;

    try {
        // Create API instance
        MessagingChannelApi api(apiUrl, apiKey);

        // Connect to channel
        std::cout << "Connecting to channel..." << std::endl;
        ConnectResponse connectResp = api.connect(channelName, channelPassword, agentName);

        if (!connectResp.success) {
            std::cerr << "Failed to connect to channel!" << std::endl;
            return 1;
        }

        std::cout << "Connected! Session ID: " << connectResp.sessionId << std::endl;
        std::cout << "Channel ID: " << connectResp.channelId << std::endl;
        std::cout << std::endl;

        // List active agents
        std::cout << "Active agents:" << std::endl;
        auto agents = api.getActiveAgents(connectResp.sessionId);
        for (const auto& agent : agents) {
            std::cout << "  - " << agent.agentName
                     << " (" << agent.agentType << ")" << std::endl;
        }
        std::cout << std::endl;

        // Send a message
        std::cout << "Sending message..." << std::endl;
        bool sent = api.send(EventType::CHAT_TEXT,
                            "Hello from C++ agent!",
                            "*",  // Broadcast to all
                            connectResp.sessionId,
                            false);

        if (sent) {
            std::cout << "Message sent successfully!" << std::endl;
        } else {
            std::cerr << "Failed to send message!" << std::endl;
        }

        // Receive messages (polling loop)
        std::cout << std::endl << "Listening for messages (10 seconds)..." << std::endl;

        ReceiveConfig config;
        config.globalOffset = connectResp.globalOffset;
        config.localOffset = connectResp.localOffset;
        config.limit = 10;

        auto startTime = std::chrono::steady_clock::now();
        while (true) {
            auto now = std::chrono::steady_clock::now();
            auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - startTime).count();

            if (elapsed >= 10) {
                break;
            }

            EventMessageResult result = api.receive(connectResp.sessionId, config);

            if (!result.messages.empty()) {
                for (const auto& msg : result.messages) {
                    std::cout << "[" << msg.from << " -> " << msg.to << "] "
                             << msg.content << std::endl;
                }

                // Update offsets for next pull
                config.globalOffset = result.globalOffset;
                config.localOffset = result.localOffset;
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }

        // Disconnect
        std::cout << std::endl << "Disconnecting..." << std::endl;
        api.disconnect(connectResp.sessionId);
        std::cout << "Disconnected." << std::endl;

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}

