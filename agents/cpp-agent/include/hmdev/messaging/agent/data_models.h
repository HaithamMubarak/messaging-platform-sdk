#ifndef HMDEV_MESSAGING_DATA_MODELS_H
#define HMDEV_MESSAGING_DATA_MODELS_H

#include <string>
#include <vector>
#include <map>
#include <nlohmann/json.hpp>

namespace hmdev {
namespace messaging {

// Forward declarations
using json = nlohmann::json;

/**
 * Event message types
 */
enum class EventType {
    CHAT_TEXT,
    CHAT_FILE,
    CHAT_WEBRTC_SIGNAL,
    GAME_STATE,
    GAME_INPUT,
    GAME_SYNC,
    CUSTOM
};

// Helper functions for EventType
std::string eventTypeToString(EventType type);
EventType stringToEventType(const std::string& str);

/**
 * Receive configuration for pull operations
 */
struct ReceiveConfig {
    long long globalOffset;
    long long localOffset;
    int limit;
    std::string pollSource;  // "AUTO", "CACHE", "KAFKA", "DATABASE"

    ReceiveConfig() : globalOffset(-1), localOffset(-1), limit(10), pollSource("AUTO") {}
    ReceiveConfig(long long global, long long local, int lim)
        : globalOffset(global), localOffset(local), limit(lim), pollSource("AUTO") {}
    ReceiveConfig(long long global, long long local, int lim, const std::string& source)
        : globalOffset(global), localOffset(local), limit(lim), pollSource(source) {}

    json toJson() const;
};

/**
 * Agent information
 */
struct AgentInfo {
    std::string agentName;
    std::string agentType;        // "CPP-AGENT", "JAVA-AGENT", etc.
    std::string descriptor;       // Class name or identifier
    std::string ipAddress;
    std::map<std::string, std::string> metadata;
    std::string role;             // null, "observer", "system"

    AgentInfo() = default;

    json toJson() const;
    static AgentInfo fromJson(const json& j);
};

/**
 * Event message
 */
struct EventMessage {
    long long timestamp;
    std::string from;
    std::string to;
    EventType type;
    std::string content;
    bool encrypted;
    bool ephemeral;              // Short-term message (bypasses Kafka/DB, stored only in Redis)
    long long globalOffset;
    long long localOffset;

    EventMessage() : timestamp(0), type(EventType::CHAT_TEXT),
                     encrypted(false), ephemeral(false), globalOffset(-1), localOffset(-1) {}

    json toJson() const;
    static EventMessage fromJson(const json& j);
};

/**
 * Connect request
 */
struct ConnectRequest {
    std::string channelId;          // Optional: pre-derived
    std::string channelName;
    std::string channelPassword;    // Hashed password
    std::string agentName;
    std::map<std::string, std::string> agentContext;
    std::string sessionId;          // Optional: for reconnection
    bool enableWebrtcRelay;

    ConnectRequest() : enableWebrtcRelay(false) {}

    json toJson() const;
};

/**
 * Connect response
 */
struct ConnectResponse {
    std::string status;
    std::string sessionId;
    std::string channelId;
    long long globalOffset;
    long long localOffset;
    std::string message;
    bool success;

    ConnectResponse() : globalOffset(-1), localOffset(-1), success(false) {}

    static ConnectResponse fromJson(const json& j);
};

/**
 * Event message result (for pull operations)
 */
struct EventMessageResult {
    std::vector<EventMessage> messages;
    std::vector<EventMessage> ephemeralMessages;  // Short-term messages (time-sensitive)
    long long globalOffset;
    long long localOffset;

    EventMessageResult() : globalOffset(-1), localOffset(-1) {}

    static EventMessageResult fromJson(const json& j);
};

/**
 * Create channel request
 */
struct CreateChannelRequest {
    std::string channelName;
    std::string channelPassword;

    CreateChannelRequest() = default;
    CreateChannelRequest(const std::string& name, const std::string& password)
        : channelName(name), channelPassword(password) {}

    json toJson() const;
};

/**
 * Session request (for disconnect, list-agents, etc.)
 */
struct SessionRequest {
    std::string sessionId;

    SessionRequest() = default;
    explicit SessionRequest(const std::string& session) : sessionId(session) {}

    json toJson() const;
};

/**
 * Event message request (for push operations)
 */
struct EventMessageRequest {
    std::string sessionId;
    EventType type;
    std::string to;
    std::string content;
    bool encrypted;

    EventMessageRequest() : type(EventType::CHAT_TEXT), encrypted(false) {}

    json toJson() const;
};

/**
 * Message receive request (for pull operations)
 */
struct MessageReceiveRequest {
    std::string sessionId;
    ReceiveConfig receiveConfig;

    MessageReceiveRequest() = default;

    json toJson() const;
};

/**
 * UDP envelope for UDP operations
 */
struct UdpEnvelope {
    std::string action;  // "push" or "pull"
    json payload;

    UdpEnvelope() = default;
    UdpEnvelope(const std::string& act, const json& pay)
        : action(act), payload(pay) {}

    json toJson() const;
    static UdpEnvelope fromJson(const json& j);
};

} // namespace messaging
} // namespace hmdev

#endif // HMDEV_MESSAGING_DATA_MODELS_H

