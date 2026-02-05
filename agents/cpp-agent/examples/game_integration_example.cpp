/**
 * Game Integration Example
 * Demonstrates game state synchronization and fast UDP messaging
 */

#include "hmdev/messaging/api/messaging_channel_api.h"
#include <iostream>
#include <thread>
#include <chrono>
#include <sstream>

using namespace hmdev::messaging;

// Simulated game state
struct GameState {
    float playerX = 0.0f;
    float playerY = 0.0f;
    int score = 0;

    std::string toJson() const {
        std::ostringstream oss;
        oss << "{\"x\":" << playerX << ",\"y\":" << playerY
            << ",\"score\":" << score << "}";
        return oss.str();
    }
};

int main(int argc, char* argv[]) {
    // Configuration
    std::string apiUrl = "http://localhost:8080";
    std::string apiKey = "your_api_key_here";
    std::string channelName = "game-room";
    std::string channelPassword = "gamepass123";
    std::string agentName = "player-1";

    if (argc >= 2) apiUrl = argv[1];
    if (argc >= 3) apiKey = argv[2];
    if (argc >= 4) channelName = argv[3];
    if (argc >= 5) channelPassword = argv[4];
    if (argc >= 6) agentName = argv[5];

    std::cout << "=== Game Integration Example ===" << std::endl;
    std::cout << "API URL: " << apiUrl << std::endl;
    std::cout << "Channel: " << channelName << std::endl;
    std::cout << "Agent: " << agentName << std::endl;
    std::cout << std::endl;

    try {
        // Create API instance
        MessagingChannelApi api(apiUrl, apiKey);

        // Connect to channel
        std::cout << "Connecting to game channel..." << std::endl;
        ConnectResponse connectResp = api.connect(channelName, channelPassword, agentName);

        if (!connectResp.success) {
            std::cerr << "Failed to connect to channel!" << std::endl;
            return 1;
        }

        std::cout << "Connected! Session ID: " << connectResp.sessionId << std::endl;
        std::cout << std::endl;

        // Game state
        GameState state;

        // Game loop simulation (5 seconds)
        std::cout << "Starting game loop..." << std::endl;
        auto startTime = std::chrono::steady_clock::now();
        int frameCount = 0;

        ReceiveConfig config;
        config.globalOffset = connectResp.globalOffset;
        config.localOffset = connectResp.localOffset;
        config.limit = 20;

        while (true) {
            auto now = std::chrono::steady_clock::now();
            auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - startTime).count();

            if (elapsed >= 5) {
                break;
            }

            // Update game state
            state.playerX += 0.1f;
            state.playerY += 0.05f;
            state.score += 10;
            frameCount++;

            // Send state update via UDP (fast, unreliable - suitable for frequent updates)
            if (frameCount % 10 == 0) {  // Send every 10th frame
                bool sent = api.udpPush(state.toJson(), "*", connectResp.sessionId);
                if (sent) {
                    std::cout << "Frame " << frameCount << " - State sent via UDP: "
                             << "x=" << state.playerX << ", y=" << state.playerY
                             << ", score=" << state.score << std::endl;
                }
            }

            // Send important events via HTTP (reliable)
            if (frameCount % 50 == 0) {  // Every 50th frame
                api.send(EventType::GAME_STATE,
                        "Checkpoint: score=" + std::to_string(state.score),
                        "*",
                        connectResp.sessionId,
                        false);
                std::cout << "Checkpoint saved via HTTP" << std::endl;
            }

            // Receive messages from other players
            EventMessageResult result = api.receive(connectResp.sessionId, config);
            if (!result.messages.empty()) {
                for (const auto& msg : result.messages) {
                    if (msg.from != agentName) {  // Ignore own messages
                        std::cout << "Received from " << msg.from << ": "
                                 << msg.content << std::endl;
                    }
                }
                config.globalOffset = result.globalOffset;
                config.localOffset = result.localOffset;
            }

            // Simulate game frame rate (60 FPS = ~16ms per frame)
            std::this_thread::sleep_for(std::chrono::milliseconds(16));
        }

        std::cout << std::endl << "Game loop completed. Total frames: " << frameCount << std::endl;

        // Disconnect
        std::cout << "Disconnecting..." << std::endl;
        api.disconnect(connectResp.sessionId);
        std::cout << "Disconnected." << std::endl;

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}

