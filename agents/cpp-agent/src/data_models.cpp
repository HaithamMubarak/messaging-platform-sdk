#include "hmdev/messaging/agent/data_models.h"
#include <stdexcept>

namespace hmdev {
namespace messaging {

// EventType conversion functions
std::string eventTypeToString(EventType type) {
    switch (type) {
        case EventType::CHAT_TEXT: return "CHAT_TEXT";
        case EventType::CHAT_FILE: return "CHAT_FILE";
        case EventType::CHAT_WEBRTC_SIGNAL: return "CHAT_WEBRTC_SIGNAL";
        case EventType::GAME_STATE: return "GAME_STATE";
        case EventType::GAME_INPUT: return "GAME_INPUT";
        case EventType::GAME_SYNC: return "GAME_SYNC";
        case EventType::CUSTOM: return "CUSTOM";
        default: return "CHAT_TEXT";
    }
}

EventType stringToEventType(const std::string& str) {
    if (str == "CHAT_TEXT") return EventType::CHAT_TEXT;
    if (str == "CHAT_FILE") return EventType::CHAT_FILE;
    if (str == "CHAT_WEBRTC_SIGNAL") return EventType::CHAT_WEBRTC_SIGNAL;
    if (str == "GAME_STATE") return EventType::GAME_STATE;
    if (str == "GAME_INPUT") return EventType::GAME_INPUT;
    if (str == "GAME_SYNC") return EventType::GAME_SYNC;
    if (str == "CUSTOM") return EventType::CUSTOM;
    return EventType::CHAT_TEXT;  // Default
}

// ReceiveConfig
json ReceiveConfig::toJson() const {
    return json{
        {"globalOffset", globalOffset},
        {"localOffset", localOffset},
        {"limit", limit},
        {"pollSource", pollSource}
    };
}

// AgentInfo
json AgentInfo::toJson() const {
    json j = {
        {"agentName", agentName},
        {"agentType", agentType},
        {"descriptor", descriptor}
    };

    if (!ipAddress.empty()) {
        j["ipAddress"] = ipAddress;
    }

    if (!metadata.empty()) {
        j["metadata"] = metadata;
    }

    if (!role.empty()) {
        j["role"] = role;
    }

    return j;
}

AgentInfo AgentInfo::fromJson(const json& j) {
    AgentInfo info;
    if (j.contains("agentName")) info.agentName = j["agentName"].get<std::string>();
    if (j.contains("agentType")) info.agentType = j["agentType"].get<std::string>();
    if (j.contains("descriptor")) info.descriptor = j["descriptor"].get<std::string>();
    if (j.contains("ipAddress")) info.ipAddress = j["ipAddress"].get<std::string>();
    if (j.contains("role")) info.role = j["role"].get<std::string>();
    if (j.contains("metadata")) info.metadata = j["metadata"].get<std::map<std::string, std::string>>();
    return info;
}

// EventMessage
json EventMessage::toJson() const {
    json j = {
        {"timestamp", timestamp},
        {"from", from},
        {"to", to},
        {"type", eventTypeToString(type)},
        {"content", content},
        {"encrypted", encrypted},
        {"globalOffset", globalOffset},
        {"localOffset", localOffset}
    };
    if (ephemeral) {
        j["ephemeral"] = true;
    }
    return j;
}

EventMessage EventMessage::fromJson(const json& j) {
    EventMessage msg;
    if (j.contains("timestamp")) msg.timestamp = j["timestamp"].get<long long>();
    if (j.contains("from")) msg.from = j["from"].get<std::string>();
    if (j.contains("to")) msg.to = j["to"].get<std::string>();
    if (j.contains("type")) msg.type = stringToEventType(j["type"].get<std::string>());
    if (j.contains("content")) msg.content = j["content"].get<std::string>();
    if (j.contains("encrypted")) msg.encrypted = j["encrypted"].get<bool>();
    if (j.contains("ephemeral")) msg.ephemeral = j["ephemeral"].get<bool>();
    if (j.contains("globalOffset")) msg.globalOffset = j["globalOffset"].get<long long>();
    if (j.contains("localOffset")) msg.localOffset = j["localOffset"].get<long long>();
    return msg;
}

// ConnectRequest
json ConnectRequest::toJson() const {
    json j = {
        {"agentName", agentName},
        {"agentContext", agentContext},
        {"enableWebrtcRelay", enableWebrtcRelay}
    };

    if (!channelId.empty()) {
        j["channelId"] = channelId;
    }

    if (!channelName.empty()) {
        j["channelName"] = channelName;
    }

    if (!channelPassword.empty()) {
        j["channelPassword"] = channelPassword;
    }

    if (!sessionId.empty()) {
        j["sessionId"] = sessionId;
    }

    return j;
}

// ConnectResponse
ConnectResponse ConnectResponse::fromJson(const json& j) {
    ConnectResponse resp;
    if (j.contains("status")) resp.status = j["status"].get<std::string>();
    if (j.contains("sessionId")) resp.sessionId = j["sessionId"].get<std::string>();
    if (j.contains("channelId")) resp.channelId = j["channelId"].get<std::string>();
    if (j.contains("globalOffset")) resp.globalOffset = j["globalOffset"].get<long long>();
    if (j.contains("localOffset")) resp.localOffset = j["localOffset"].get<long long>();
    if (j.contains("message")) resp.message = j["message"].get<std::string>();
    resp.success = (resp.status == "success" && !resp.sessionId.empty());
    return resp;
}

// EventMessageResult
EventMessageResult EventMessageResult::fromJson(const json& j) {
    EventMessageResult result;

    if (j.contains("messages") && j["messages"].is_array()) {
        for (const auto& msgJson : j["messages"]) {
            result.messages.push_back(EventMessage::fromJson(msgJson));
        }
    }

    // Also check "events" field (server response uses "events" not "messages")
    if (j.contains("events") && j["events"].is_array()) {
        for (const auto& msgJson : j["events"]) {
            result.messages.push_back(EventMessage::fromJson(msgJson));
        }
    }

    // Parse ephemeral messages (short-term, time-sensitive)
    if (j.contains("ephemeralEvents") && j["ephemeralEvents"].is_array()) {
        for (const auto& msgJson : j["ephemeralEvents"]) {
            result.ephemeralMessages.push_back(EventMessage::fromJson(msgJson));
        }
    }

    if (j.contains("globalOffset")) {
        result.globalOffset = j["globalOffset"].get<long long>();
    }

    if (j.contains("nextGlobalOffset")) {
        result.globalOffset = j["nextGlobalOffset"].get<long long>();
    }

    if (j.contains("localOffset")) {
        result.localOffset = j["localOffset"].get<long long>();
    }

    if (j.contains("nextLocalOffset")) {
        result.localOffset = j["nextLocalOffset"].get<long long>();
    }

    return result;
}

// CreateChannelRequest
json CreateChannelRequest::toJson() const {
    return json{
        {"channelName", channelName},
        {"channelPassword", channelPassword}
    };
}

// SessionRequest
json SessionRequest::toJson() const {
    return json{
        {"sessionId", sessionId}
    };
}

// EventMessageRequest
json EventMessageRequest::toJson() const {
    return json{
        {"sessionId", sessionId},
        {"type", eventTypeToString(type)},
        {"to", to},
        {"content", content},
        {"encrypted", encrypted}
    };
}

// MessageReceiveRequest
json MessageReceiveRequest::toJson() const {
    return json{
        {"sessionId", sessionId},
        {"receiveConfig", receiveConfig.toJson()}
    };
}

// UdpEnvelope
json UdpEnvelope::toJson() const {
    return json{
        {"action", action},
        {"payload", payload}
    };
}

UdpEnvelope UdpEnvelope::fromJson(const json& j) {
    UdpEnvelope envelope;
    if (j.contains("action")) envelope.action = j["action"].get<std::string>();
    if (j.contains("payload")) envelope.payload = j["payload"];
    return envelope;
}

} // namespace messaging
} // namespace hmdev

