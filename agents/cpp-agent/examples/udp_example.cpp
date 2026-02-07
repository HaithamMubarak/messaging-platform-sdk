/**
 * UDP Example
 * Demonstrates fast UDP messaging for real-time communication
 */

#include "hmdev/messaging/api/messaging_channel_api.h"
#include <iostream>
#include <thread>
#include <chrono>

using namespace hmdev::messaging;

int main(int argc, char* argv[]) {
    // Default messaging service URL (production)
    std::string apiUrl = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service";
    std::string apiKey = "your_api_key_here";
    std::string channelName = "udp-test";
    std::string channelPassword = "udppass";
    std::string agentName = "udp-client-1";

    if (argc >= 2) apiUrl = argv[1];
    if (argc >= 3) apiKey = argv[2];
    if (argc >= 4) channelName = argv[3];
    if (argc >= 5) channelPassword = argv[4];
    if (argc >= 6) agentName = argv[5];

    std::cout << "=== UDP Example ===" << std::endl;
    std::cout << "Testing UDP push/pull operations" << std::endl;
    std::cout << std::endl;

    try {
        MessagingChannelApi api(apiUrl, apiKey);

        // Connect
        std::cout << "Connecting..." << std::endl;
        ConnectResponse connectResp = api.connect(channelName, channelPassword, agentName);

        if (!connectResp.success) {
            std::cerr << "Failed to connect!" << std::endl;
            return 1;
        }

        std::cout << "Connected! Session: " << connectResp.sessionId << std::endl;
        std::cout << std::endl;

        // Test UDP push
        std::cout << "Testing UDP Push..." << std::endl;
        for (int i = 0; i < 5; i++) {
            std::string message = "UDP message #" + std::to_string(i + 1);
            bool sent = api.udpPush(message, "*", connectResp.sessionId);
            std::cout << "  " << (sent ? "✓" : "✗") << " Sent: " << message << std::endl;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        std::cout << std::endl;

        // Wait a bit for messages to propagate
        std::this_thread::sleep_for(std::chrono::seconds(1));

        // Test UDP pull
        std::cout << "Testing UDP Pull..." << std::endl;
        ReceiveConfig config;
        config.globalOffset = connectResp.globalOffset;
        config.localOffset = connectResp.localOffset;
        config.limit = 10;

        EventMessageResult result = api.udpPull(connectResp.sessionId, config);

        std::cout << "Received " << result.messages.size() << " messages via UDP:" << std::endl;
        for (const auto& msg : result.messages) {
            std::cout << "  [" << msg.from << "] " << msg.content << std::endl;
        }

        std::cout << std::endl;

        // Compare with HTTP pull
        std::cout << "Testing HTTP Pull (for comparison)..." << std::endl;
        config.globalOffset = connectResp.globalOffset;
        config.localOffset = connectResp.localOffset;

        auto httpStart = std::chrono::high_resolution_clock::now();
        EventMessageResult httpResult = api.receive(connectResp.sessionId, config);
        auto httpEnd = std::chrono::high_resolution_clock::now();
        auto httpDuration = std::chrono::duration_cast<std::chrono::milliseconds>(httpEnd - httpStart).count();

        std::cout << "Received " << httpResult.messages.size() << " messages via HTTP" << std::endl;
        std::cout << "HTTP latency: " << httpDuration << "ms" << std::endl;

        std::cout << std::endl;
        std::cout << "Note: UDP is faster but unreliable (may lose packets)" << std::endl;
        std::cout << "      HTTP is slower but reliable (guaranteed delivery)" << std::endl;
        std::cout << std::endl;

        // Disconnect
        api.disconnect(connectResp.sessionId);
        std::cout << "Disconnected." << std::endl;

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}

