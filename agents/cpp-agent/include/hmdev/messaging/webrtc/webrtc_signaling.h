#ifndef HMDEV_MESSAGING_WEBRTC_SIGNALING_H
#define HMDEV_MESSAGING_WEBRTC_SIGNALING_H

#include <string>
#include <functional>
#include <nlohmann/json.hpp>
#include "hmdev/messaging/api/messaging_channel_api.h"

namespace hmdev {
namespace messaging {

using json = nlohmann::json;

/**
 * WebRTC signaling for the C++ agent — the native mirror of web-agent-js's
 * WebRtcHelper signaling layer (agents/web-agent-js/js/web-agent.webrtc.js).
 *
 * It handles ONLY the signaling exchange over the messaging channel — offer,
 * answer and ICE candidates — using the exact same wire shape the JS agent
 * uses, so a C++ agent negotiates WebRTC with browser/Node peers on the same
 * channel. Wire format (ephemeral "webrtc-signaling" push, content = JSON):
 *
 *   offer:         { type:"offer",        sdp, streamSessionId }
 *   answer:        { type:"answer",       sdp, streamSessionId }
 *   ice-candidate: { type:"ice-candidate",candidate:{candidate,sdpMid,sdpMLineIndex},
 *                    streamSessionId }
 *
 * The actual RTCPeerConnection/DataChannel (DTLS/SCTP transport) is provided by
 * a WebRTC library of your choice (e.g. libdatachannel); wire this class's
 * callbacks to it. Instantiating it needs no WebRTC library — it is pure
 * signaling, so it always builds.
 */
class WebRtcSignaling {
public:
    /** on(streamId, sourceAgent, sdp) */
    using SdpHandler = std::function<void(const std::string& streamId,
                                          const std::string& sourceAgent,
                                          const std::string& sdp)>;
    /** on(streamId, sourceAgent, candidate, sdpMid, sdpMLineIndex) */
    using IceHandler = std::function<void(const std::string& streamId,
                                          const std::string& sourceAgent,
                                          const std::string& candidate,
                                          const std::string& sdpMid,
                                          int sdpMLineIndex)>;

    WebRtcSignaling(MessagingChannelApi* channel,
                    std::string sessionId,
                    std::string agentName);

    // --- Outbound signaling (offerer/answerer roles) ------------------------
    /** Send an SDP offer to remoteAgent for a stream session. */
    bool sendOffer(const std::string& remoteAgent,
                   const std::string& streamId,
                   const std::string& sdp);

    /** Send an SDP answer to remoteAgent. */
    bool sendAnswer(const std::string& remoteAgent,
                    const std::string& streamId,
                    const std::string& sdp);

    /** Send a local ICE candidate to remoteAgent. */
    bool sendIceCandidate(const std::string& remoteAgent,
                          const std::string& streamId,
                          const std::string& candidate,
                          const std::string& sdpMid,
                          int sdpMLineIndex);

    // --- Inbound signaling --------------------------------------------------
    /**
     * Pull the channel and dispatch any incoming signaling to the handlers.
     * Call this from your receive loop. Returns the raw result so the caller
     * can advance its offsets. Self-sent signaling is ignored (like the JS agent).
     */
    EventMessageResult poll(const ReceiveConfig& config);

    /** Feed one already-received message (alternative to poll). */
    void handleMessage(const EventMessage& msg);

    void setOnOffer(SdpHandler h) { onOffer_ = std::move(h); }
    void setOnAnswer(SdpHandler h) { onAnswer_ = std::move(h); }
    void setOnIceCandidate(IceHandler h) { onIceCandidate_ = std::move(h); }

    // --- ICE server configuration (mirrors JS _buildIceServers) -------------
    /**
     * Resolve ICE servers: TURN/STUN from env (TURN_SERVER, STUN_SERVER,
     * TURN_USERNAME, TURN_PASSWORD) if set, else public Google STUN. Returned
     * as a JSON array of { urls, [username, credential] } — feed straight into
     * your RTCPeerConnection config.
     */
    static json buildIceServers();

private:
    bool sendSignal(const std::string& remoteAgent, const json& signalingMsg);
    void dispatch(const std::string& sourceAgent, const std::string& contentJson);

    MessagingChannelApi* channel_;
    std::string sessionId_;
    std::string agentName_;

    SdpHandler onOffer_;
    SdpHandler onAnswer_;
    IceHandler onIceCandidate_;
};

} // namespace messaging
} // namespace hmdev

#endif // HMDEV_MESSAGING_WEBRTC_SIGNALING_H
