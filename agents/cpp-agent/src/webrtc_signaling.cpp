#include "hmdev/messaging/webrtc/webrtc_signaling.h"
#include <cstdlib>
#include <iostream>

namespace hmdev {
namespace messaging {

WebRtcSignaling::WebRtcSignaling(MessagingChannelApi* channel,
                                 std::string sessionId,
                                 std::string agentName)
    : channel_(channel),
      sessionId_(std::move(sessionId)),
      agentName_(std::move(agentName)) {}

// --- Outbound ---------------------------------------------------------------
bool WebRtcSignaling::sendSignal(const std::string& remoteAgent, const json& signalingMsg) {
    if (!channel_) {
        std::cerr << "[WebRTC] no channel to send signaling" << std::endl;
        return false;
    }
    return channel_->sendWebRtcSignaling(remoteAgent, signalingMsg.dump(), sessionId_);
}

bool WebRtcSignaling::sendOffer(const std::string& remoteAgent,
                                const std::string& streamId,
                                const std::string& sdp) {
    return sendSignal(remoteAgent, json{
        {"type", "offer"},
        {"sdp", sdp},
        {"streamSessionId", streamId}
    });
}

bool WebRtcSignaling::sendAnswer(const std::string& remoteAgent,
                                 const std::string& streamId,
                                 const std::string& sdp) {
    return sendSignal(remoteAgent, json{
        {"type", "answer"},
        {"sdp", sdp},
        {"streamSessionId", streamId}
    });
}

bool WebRtcSignaling::sendIceCandidate(const std::string& remoteAgent,
                                       const std::string& streamId,
                                       const std::string& candidate,
                                       const std::string& sdpMid,
                                       int sdpMLineIndex) {
    return sendSignal(remoteAgent, json{
        {"type", "ice-candidate"},
        {"candidate", {
            {"candidate", candidate},
            {"sdpMid", sdpMid},
            {"sdpMLineIndex", sdpMLineIndex}
        }},
        {"streamSessionId", streamId}
    });
}

// --- Inbound ----------------------------------------------------------------
EventMessageResult WebRtcSignaling::poll(const ReceiveConfig& config) {
    EventMessageResult result;
    if (!channel_) {
        return result;
    }
    result = channel_->receive(sessionId_, config);
    for (const auto& m : result.messages) {
        handleMessage(m);
    }
    for (const auto& m : result.ephemeralMessages) {
        handleMessage(m);
    }
    return result;
}

void WebRtcSignaling::handleMessage(const EventMessage& msg) {
    if (msg.type != EventType::CHAT_WEBRTC_SIGNAL) {
        return;   // not a signaling message
    }
    if (msg.from == agentName_) {
        return;   // ignore our own signaling echoed back (matches JS)
    }
    dispatch(msg.from, msg.content);
}

void WebRtcSignaling::dispatch(const std::string& sourceAgent, const std::string& contentJson) {
    json sig;
    try {
        sig = json::parse(contentJson);
    } catch (const std::exception& e) {
        std::cerr << "[WebRTC] bad signaling content: " << e.what() << std::endl;
        return;
    }
    const std::string type = sig.value("type", "");
    const std::string streamId = sig.value("streamSessionId", "");

    if (type == "offer" && onOffer_) {
        onOffer_(streamId, sourceAgent, sig.value("sdp", ""));
    } else if (type == "answer" && onAnswer_) {
        onAnswer_(streamId, sourceAgent, sig.value("sdp", ""));
    } else if (type == "ice-candidate" && onIceCandidate_) {
        const json cand = sig.value("candidate", json::object());
        onIceCandidate_(streamId, sourceAgent,
                        cand.value("candidate", ""),
                        cand.value("sdpMid", ""),
                        cand.value("sdpMLineIndex", 0));
    } else {
        std::cerr << "[WebRTC] unknown/unhandled signaling type: " << type << std::endl;
    }
}

// --- ICE servers (mirror of JS _buildIceServers) ----------------------------
json WebRtcSignaling::buildIceServers() {
    const char* turnServer = std::getenv("TURN_SERVER");
    const char* stunServer = std::getenv("STUN_SERVER");
    if (turnServer || stunServer) {
        const char* uEnv = std::getenv("TURN_USERNAME");
        const char* pEnv = std::getenv("TURN_PASSWORD");
        const std::string turn = turnServer ? turnServer : "coturn:3478";
        const std::string stun = stunServer ? stunServer : "coturn:3478";
        const std::string user = uEnv ? uEnv : "webrtc";
        const std::string pass = pEnv ? pEnv : "turnpassword123";
        return json::array({
            json{
                {"urls", json::array({
                    "stun:" + stun,
                    "turn:" + turn + "?transport=udp",
                    "turn:" + turn + "?transport=tcp"
                })},
                {"username", user},
                {"credential", pass}
            },
            json{ {"urls", "stun:stun.l.google.com:19302"} }
        });
    }
    // Default: public STUN.
    return json::array({
        json{ {"urls", "stun:stun.l.google.com:19302"} },
        json{ {"urls", "stun:stun1.l.google.com:19302"} },
        json{ {"urls", "stun:stun2.l.google.com:19302"} }
    });
}

} // namespace messaging
} // namespace hmdev
