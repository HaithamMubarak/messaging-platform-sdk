/**
 * WebRTC DataChannel connection test — cpp-agent + libdatachannel.
 *
 * Proves the SAME thing tests/production/js_webrtc_test.js and
 * games/shadow-rush/tools/webrtc_test.gd prove for their SDKs: two peers can
 * open a REAL native WebRTC DataChannel using the messaging platform purely
 * for signaling (SDP offer/answer + ICE candidates), with the actual P2P
 * transport (DTLS/SCTP) provided by a genuine WebRTC engine — here,
 * libdatachannel, linked directly. This file is NOT part of the
 * messaging-cpp-agent library: the SDK's own WebRtcSignaling class is pure
 * signaling and intentionally has no WebRTC engine dependency so the SDK
 * always builds (see include/hmdev/messaging/webrtc/webrtc_signaling.h);
 * pairing it with an actual engine is left to the consumer, which is exactly
 * what this file does.
 *
 * This is also the reference/common-code counterpart for Shadow Rush's UE5
 * port: UE5's FSRWebRtcMesh (Source/SRWebRtc/) vendors its own copy of
 * libdatachannel plus a bespoke signaling schema, and only builds on Win64.
 * This test instead drives the CANONICAL cpp-agent SDK (portable, builds on
 * Linux) paired with upstream libdatachannel, using the SDK's own
 * WebRtcSignaling wire format (matches web-agent-js: {type, sdp,
 * streamSessionId} / {type:"ice-candidate", candidate:{...}}) — the actual
 * shared/common code path, not a UE5-only reimplementation.
 *
 * Two roles (host/guest), both connect to the same channel/room, then:
 *   Host:  waits for the guest to join (getActiveAgents polling), creates an
 *          RTCPeerConnection + DataChannel (offerer), sends N pings once
 *          open, measures RTT from the guest's echoes, prints a parseable
 *          "RESULT: PASS ..." line.
 *   Guest: waits for the host's offer (arrives via WebRtcSignaling's poll
 *          loop), answers automatically, echoes every DataChannel message
 *          straight back.
 *
 * Usage:
 *   webrtc_datachannel_test --role host|guest --channel <name>
 *       --agent-name <name> --url <api> [--api-key K] --timeout <seconds>
 */

#include "hmdev/messaging/api/messaging_channel_api.h"
#include "hmdev/messaging/webrtc/webrtc_signaling.h"
#include "rtc/rtc.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <map>
#include <mutex>
#include <numeric>
#include <string>
#include <thread>
#include <vector>

using namespace hmdev::messaging;
using json = nlohmann::json;
using namespace std::chrono_literals;

namespace {

std::map<std::string, std::string> parseArgs(int argc, char **argv) {
    std::map<std::string, std::string> args;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a.rfind("--", 0) != 0) continue;
        auto eq = a.find('=');
        if (eq != std::string::npos) {
            args[a.substr(2, eq - 2)] = a.substr(eq + 1);
        } else if (i + 1 < argc) {
            args[a.substr(2)] = argv[++i];
        }
    }
    return args;
}

long long nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

void log(const std::string &role, const std::string &msg) {
    std::cout << "[" << role << "] " << msg << std::endl;
}

/** Same ICE server source as WebRtcSignaling::buildIceServers(), but
 * returning rtc::Configuration's own IceServer type directly (that class
 * wants JSON for the SDK's generic use; libdatachannel wants its own type). */
rtc::Configuration buildRtcConfig() {
    rtc::Configuration cfg;
    const char *turnServer = std::getenv("TURN_SERVER");
    const char *stunServer = std::getenv("STUN_SERVER");
    if (turnServer || stunServer) {
        const char *uEnv = std::getenv("TURN_USERNAME");
        const char *pEnv = std::getenv("TURN_PASSWORD");
        std::string stun = stunServer ? stunServer : "coturn:3478";
        std::string turn = turnServer ? turnServer : "coturn:3478";
        std::string user = uEnv ? uEnv : "webrtc";
        std::string pass = pEnv ? pEnv : "turnpassword123";
        cfg.iceServers.emplace_back("stun:" + stun);
        rtc::IceServer turnUdp("turn:" + turn);
        turnUdp.username = user;
        turnUdp.password = pass;
        turnUdp.relayType = rtc::IceServer::RelayType::TurnUdp;
        cfg.iceServers.push_back(turnUdp);
    } else {
        cfg.iceServers.emplace_back("stun:stun.l.google.com:19302");
    }
    return cfg;
}

} // namespace

int main(int argc, char **argv) {
    auto args = parseArgs(argc, argv);
    const std::string role = args.count("role") ? args["role"] : "";
    const std::string channel = args.count("channel") ? args["channel"] : "";
    const std::string agentName = args.count("agent-name") ? args["agent-name"] : "";
    const std::string apiUrl = args.count("url") ? args["url"]
        : "https://hmdevonline.com/messaging-platform/api/v1/messaging-service";
    const std::string apiKey = args.count("api-key") ? args["api-key"] : "";
    const double timeoutSec = args.count("timeout") ? std::stod(args["timeout"]) : 60.0;
    const bool isHost = role == "host";

    if (role != "host" && role != "guest") {
        std::cerr << "Usage: --role host|guest --channel <name> --agent-name <name> "
                     "--url <api> [--api-key K] --timeout <seconds>"
                  << std::endl;
        return 2;
    }

    rtc::InitLogger(rtc::LogLevel::Warning);

    // --- Connect to the messaging platform (signaling channel) -------------
    MessagingChannelApi api(apiUrl, apiKey);
    ConnectResponse conn = api.connect(channel, "123456781", agentName, "", "",
                                        /*enableWebrtcRelay=*/false, "public");
    if (!conn.success) {
        log(role, "RESULT: FAIL connect failed: " + conn.message);
        return 1;
    }
    log(role, "connected: session=" + conn.sessionId + " channel=" + conn.channelId);

    WebRtcSignaling signaling(&api, conn.sessionId, agentName);
    const std::string streamId = "dctest";

    // remotePeerName: host discovers it via getActiveAgents(); guest learns
    // it from the incoming offer's source agent. Guarded since it's written
    // from the poll loop (guest) or main thread (host) and read from
    // libdatachannel's own callback threads.
    std::mutex peerMu;
    std::string remotePeerName;
    auto setPeer = [&](const std::string &name) {
        std::lock_guard<std::mutex> lk(peerMu);
        if (remotePeerName.empty()) remotePeerName = name;
    };
    auto getPeer = [&]() -> std::string {
        std::lock_guard<std::mutex> lk(peerMu);
        return remotePeerName;
    };

    // --- Real WebRTC peer connection (libdatachannel) -----------------------
    auto pc = std::make_shared<rtc::PeerConnection>(buildRtcConfig());
    std::shared_ptr<rtc::DataChannel> dc;
    std::atomic<int> dcOpenCount{0};
    std::atomic<bool> dcIsOpen{false};

    // Host-side RTT accounting.
    std::mutex rttMu;
    std::vector<long long> pendingSeqSentAt(5, -1);
    std::vector<long long> rtts;

    // WebRTC signaling rides the platform's ephemeral delivery path (see
    // WebRtcSignaling's header comment), which is ordered by timestamp, not
    // a strict sequential offset — a candidate sent moments after the offer
    // can occasionally be observed by the receiver before the offer itself.
    // Buffer any candidate that arrives before setRemoteDescription has run,
    // and replay it once the description lands, instead of dropping it (the
    // same pattern used for Shadow Rush's "rtc" signaling in webrtc_test.gd
    // and main.gd — Godot signals and this candidate-before-description case
    // share the same shape: a real message arriving before its prerequisite
    // is ready, with no automatic redelivery from the sender).
    std::mutex pendingCandMu;
    std::vector<rtc::Candidate> pendingCandidates;
    std::atomic<bool> remoteDescSet{false};

    pc->onStateChange([&](rtc::PeerConnection::State s) {
        std::string name = s == rtc::PeerConnection::State::Connected ? "connected"
            : s == rtc::PeerConnection::State::Failed ? "failed"
            : s == rtc::PeerConnection::State::Disconnected ? "disconnected"
            : s == rtc::PeerConnection::State::Connecting ? "connecting"
            : "other";
        log(role, "pc state: " + name);
    });

    pc->onLocalDescription([&](rtc::Description desc) {
        std::string peer = getPeer();
        if (peer.empty()) {
            log(role, "WARN: local description generated before peer known, dropping");
            return;
        }
        const std::string typeStr = desc.typeString();
        log(role, "SIG-> " + typeStr + " to " + peer);
        if (typeStr == "offer") {
            signaling.sendOffer(peer, streamId, std::string(desc));
        } else {
            signaling.sendAnswer(peer, streamId, std::string(desc));
        }
    });

    pc->onLocalCandidate([&](rtc::Candidate cand) {
        std::string peer = getPeer();
        if (peer.empty()) return;
        signaling.sendIceCandidate(peer, streamId, std::string(cand), cand.mid(), 0);
    });

    auto wireDataChannel = [&](std::shared_ptr<rtc::DataChannel> channel) {
        dc = channel;
        dc->onOpen([&, role]() {
            dcIsOpen = true;
            dcOpenCount++;
            log(role, "datachannel-open (open #" + std::to_string(dcOpenCount.load()) + ")");
        });
        dc->onClosed([&, role]() { log(role, "datachannel-closed"); });
        dc->onMessage([&, role, isHost](rtc::message_variant data) {
            if (!std::holds_alternative<std::string>(data)) return;
            const std::string &msg = std::get<std::string>(data);
            if (!isHost) {
                dc->send(msg); // guest: echo straight back
                return;
            }
            // host: match the echoed ping by seq, record RTT
            try {
                json j = json::parse(msg);
                int seq = j.value("seq", -1);
                if (seq >= 0 && seq < static_cast<int>(pendingSeqSentAt.size())) {
                    std::lock_guard<std::mutex> lk(rttMu);
                    if (pendingSeqSentAt[seq] >= 0) {
                        rtts.push_back(nowMs() - pendingSeqSentAt[seq]);
                        pendingSeqSentAt[seq] = -1;
                    }
                }
            } catch (const std::exception &) {
                // ignore malformed
            }
        });
    };

    auto applyRemoteDescription = [&](const std::string &sdp, const std::string &type) {
        pc->setRemoteDescription(rtc::Description(sdp, type));
        remoteDescSet = true;
        std::vector<rtc::Candidate> replay;
        {
            std::lock_guard<std::mutex> lk(pendingCandMu);
            replay.swap(pendingCandidates);
        }
        for (auto &c : replay) {
            log(role, "replaying buffered candidate");
            try {
                pc->addRemoteCandidate(c);
            } catch (const std::exception &e) {
                log(role, "WARN: buffered candidate still rejected: " + std::string(e.what()));
            }
        }
    };

    // Feed incoming signaling into the peer connection.
    signaling.setOnOffer([&](const std::string &, const std::string &sourceAgent, const std::string &sdp) {
        setPeer(sourceAgent);
        log(role, "SIG<- offer from " + sourceAgent);
        applyRemoteDescription(sdp, "offer");
    });
    signaling.setOnAnswer([&](const std::string &, const std::string &sourceAgent, const std::string &sdp) {
        log(role, "SIG<- answer from " + sourceAgent);
        applyRemoteDescription(sdp, "answer");
    });
    signaling.setOnIceCandidate([&](const std::string &, const std::string &sourceAgent,
                                     const std::string &candidate, const std::string &sdpMid, int) {
        log(role, "SIG<- ice from " + sourceAgent);
        if (!remoteDescSet) {
            // The offer/answer that must precede this hasn't been applied
            // yet — ephemeral signaling delivery is ordered by timestamp,
            // not a strict sequence, so a candidate can occasionally be
            // observed before the offer sent moments earlier. Buffer it
            // instead of dropping it; applyRemoteDescription() replays
            // everything buffered here as soon as it runs.
            std::lock_guard<std::mutex> lk(pendingCandMu);
            pendingCandidates.emplace_back(candidate, sdpMid);
            log(role, "buffering candidate (no remote description yet)");
            return;
        }
        try {
            pc->addRemoteCandidate(rtc::Candidate(candidate, sdpMid));
        } catch (const std::exception &e) {
            log(role, "WARN: dropping remote candidate from " + sourceAgent + ": " + e.what());
        }
    });

    const auto deadline = std::chrono::steady_clock::now() + std::chrono::duration<double>(timeoutSec);

    // Host: discover the guest by polling the active-agent roster BEFORE
    // creating the DataChannel — createDataChannel() kicks off ICE gathering
    // immediately, which fires onLocalDescription (the offer) as soon as it
    // has enough candidates, often within milliseconds. If the peer isn't
    // known yet at that point the offer is generated exactly once and would
    // otherwise be silently lost forever (libdatachannel doesn't regenerate
    // it), permanently stalling the connection — confirmed live: this was
    // the actual root cause of "DataChannel never opened" on the host and a
    // guest crash from receiving a stray ICE candidate with no preceding
    // offer. Mirrors js_webrtc_test.js's waitForAgent / Shadow Rush's
    // _seed_lobby_from_server pattern (discover the peer, then act).
    if (isHost) {
        while (std::chrono::steady_clock::now() < deadline && getPeer().empty()) {
            auto agents = api.getActiveAgents(conn.sessionId);
            for (const auto &a : agents) {
                if (a.agentName != agentName) {
                    setPeer(a.agentName);
                    break;
                }
            }
            if (!getPeer().empty()) break;
            std::this_thread::sleep_for(300ms);
        }
        if (getPeer().empty()) {
            log(role, "RESULT: FAIL guest never joined");
            return 1;
        }
        log(role, "guest joined: " + getPeer());
    }

    if (isHost) {
        dc = pc->createDataChannel("data");
        wireDataChannel(dc);
    } else {
        pc->onDataChannel([&](std::shared_ptr<rtc::DataChannel> incoming) { wireDataChannel(incoming); });
    }

    // Drive the signaling poll loop + libdatachannel's async event loop
    // (libdatachannel's own callbacks run on its internal threads; this loop
    // just needs to keep the messaging-platform side fed) until the
    // DataChannel opens or the timeout elapses.
    ReceiveConfig rc;
    rc.globalOffset = conn.globalOffset;
    rc.localOffset = conn.localOffset;
    rc.limit = 100;
    rc.pollSource = "CACHE"; // fast Redis-only reads; see prior session's findings
    while (std::chrono::steady_clock::now() < deadline && !dcIsOpen) {
        EventMessageResult r = signaling.poll(rc);
        rc.globalOffset = r.globalOffset;
        rc.localOffset = r.localOffset;
        std::this_thread::sleep_for(50ms);
    }

    if (!dcIsOpen) {
        log(role, "RESULT: FAIL DataChannel never opened");
        return 1;
    }

    if (isHost) {
        // Fire 5 timestamped pings back-to-back (no artificial spacing,
        // matching js_webrtc_test.js), then poll a little longer for the
        // guest's echoes while continuing to service signaling (harmless
        // once connected, but keeps the loop uniform).
        for (int i = 0; i < 5; ++i) {
            {
                std::lock_guard<std::mutex> lk(rttMu);
                pendingSeqSentAt[i] = nowMs();
            }
            json ping = {{"seq", i}, {"ts", nowMs()}};
            dc->send(ping.dump());
        }
        const auto pongDeadline = std::chrono::steady_clock::now() + 2s;
        while (std::chrono::steady_clock::now() < pongDeadline) {
            size_t got;
            {
                std::lock_guard<std::mutex> lk(rttMu);
                got = std::count_if(pendingSeqSentAt.begin(), pendingSeqSentAt.end(),
                                     [](long long v) { return v < 0; });
            }
            if (got == pendingSeqSentAt.size()) break;
            std::this_thread::sleep_for(10ms);
        }

        std::vector<long long> samples;
        {
            std::lock_guard<std::mutex> lk(rttMu);
            samples = rtts;
        }
        if (samples.empty()) {
            log(role, "RESULT: FAIL no pong replies received");
            return 1;
        }
        long long mn = *std::min_element(samples.begin(), samples.end());
        long long mx = *std::max_element(samples.begin(), samples.end());
        double avg = std::accumulate(samples.begin(), samples.end(), 0.0) / samples.size();
        log(role, "RESULT: PASS rtt_samples=" + std::to_string(samples.size()) + "/5 rtt_min=" +
                       std::to_string(mn) + " rtt_avg=" + std::to_string(avg) + " rtt_max=" +
                       std::to_string(mx) + " dc_opens=" + std::to_string(dcOpenCount.load()));
    } else {
        // Guest: stay alive briefly so in-flight echoes/ICE finish, then exit.
        std::this_thread::sleep_for(1500ms);
        log(role, "RESULT: PASS dc_opens=" + std::to_string(dcOpenCount.load()));
    }

    if (dc) dc->close();
    pc->close();
    return 0;
}
