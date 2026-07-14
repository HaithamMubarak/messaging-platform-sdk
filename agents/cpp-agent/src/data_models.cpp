#include "hmdev/messaging/agent/data_models.h"
#include <stdexcept>

namespace hmdev {
namespace messaging {

namespace {
// nlohmann's j.contains(key) is true even when the value is JSON null, and
// .get<T>() throws a type_error on null — this API's responses commonly
// include fields as explicit null (state.channelId, an agent's role, etc.),
// so every fromJson() below needs this null check, not just presence.
template <typename T>
bool getIfPresent(const json& j, const char* key, T& out) {
    if (j.contains(key) && !j[key].is_null()) {
        out = j[key].template get<T>();
        return true;
    }
    return false;
}
} // namespace

// EventType conversion functions
std::string eventTypeToString(EventType type) {
    switch (type) {
        case EventType::CHAT_TEXT: return "CHAT_TEXT";
        case EventType::CHAT_FILE: return "CHAT_FILE";
        // WebRTC signaling shares the JS/server wire type ("webrtc-signaling")
        // so a C++ agent interops with web-agent-js on the same channel.
        case EventType::CHAT_WEBRTC_SIGNAL: return "webrtc-signaling";
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
    if (str == "webrtc-signaling") return EventType::CHAT_WEBRTC_SIGNAL;   // JS/server wire type
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
    getIfPresent(j, "agentName", info.agentName);
    getIfPresent(j, "agentType", info.agentType);
    getIfPresent(j, "descriptor", info.descriptor);
    getIfPresent(j, "ipAddress", info.ipAddress);
    // role is commonly explicit null (a regular, non-observer/system agent) —
    // this was the exact field that threw type_error.302 on every
    // getActiveAgents() call against a normal agent roster.
    getIfPresent(j, "role", info.role);
    getIfPresent(j, "metadata", info.metadata);
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
    getIfPresent(j, "timestamp", msg.timestamp);
    getIfPresent(j, "from", msg.from);
    getIfPresent(j, "to", msg.to);
    std::string typeStr;
    if (getIfPresent(j, "type", typeStr)) msg.type = stringToEventType(typeStr);
    getIfPresent(j, "content", msg.content);
    getIfPresent(j, "encrypted", msg.encrypted);
    getIfPresent(j, "ephemeral", msg.ephemeral);
    getIfPresent(j, "globalOffset", msg.globalOffset);
    getIfPresent(j, "localOffset", msg.localOffset);
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

    if (!apiKeyScope.empty()) {
        j["apiKeyScope"] = apiKeyScope;
    }

    return j;
}

// ConnectResponse
ConnectResponse ConnectResponse::fromJson(const json& j) {
    ConnectResponse resp;
    // `j` is the response's "data" object; the server puts "status" as a
    // SIBLING of "data" at the top level, not nested inside it (see the
    // actual wire shape: {"status":"success","data":{"sessionId":...,
    // "state":{"globalOffset":...,"localOffset":...},...}}). Checking
    // j["status"] here always read an absent field, so resp.status stayed
    // "" and resp.success was unconditionally false even on a genuinely
    // successful connect (sessionId correctly populated). A non-empty
    // sessionId is itself sufficient evidence of success — the caller only
    // reaches fromJson() after confirming the HTTP call succeeded and the
    // top-level "data" envelope was present.
    getIfPresent(j, "status", resp.status);
    getIfPresent(j, "sessionId", resp.sessionId);
    // channelId is frequently explicit null inside "state" (seen live:
    // state.channelId=null even on a successful connect) — getIfPresent
    // leaves resp.channelId at its default rather than throwing.
    getIfPresent(j, "channelId", resp.channelId);
    // globalOffset/localOffset live under "state" in the actual response,
    // not at this level — check both so this keeps working if a future
    // server response ever flattens them.
    if (!getIfPresent(j, "globalOffset", resp.globalOffset) && j.contains("state"))
        getIfPresent(j["state"], "globalOffset", resp.globalOffset);
    if (!getIfPresent(j, "localOffset", resp.localOffset) && j.contains("state"))
        getIfPresent(j["state"], "localOffset", resp.localOffset);
    getIfPresent(j, "message", resp.message);
    resp.success = !resp.sessionId.empty();
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

    getIfPresent(j, "globalOffset", result.globalOffset);
    getIfPresent(j, "nextGlobalOffset", result.globalOffset);
    getIfPresent(j, "localOffset", result.localOffset);
    getIfPresent(j, "nextLocalOffset", result.localOffset);

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
    json j = {
        {"sessionId", sessionId},
        {"type", eventTypeToString(type)},
        {"to", to},
        {"content", content},
        {"encrypted", encrypted}
    };
    if (ephemeral) {
        j["ephemeral"] = true;
    }
    return j;
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
    getIfPresent(j, "action", envelope.action);
    if (j.contains("payload") && !j["payload"].is_null()) envelope.payload = j["payload"];
    return envelope;
}

} // namespace messaging
} // namespace hmdev

