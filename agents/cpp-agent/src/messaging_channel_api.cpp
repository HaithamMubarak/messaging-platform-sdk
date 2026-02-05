#include "hmdev/messaging/api/messaging_channel_api.h"
#include "hmdev/messaging/agent/security.h"
#include "hmdev/messaging/util/utils.h"
#include <stdexcept>
#include <iostream>

namespace hmdev {
namespace messaging {

MessagingChannelApi::MessagingChannelApi(const std::string& remoteUrl,
                                        const std::string& developerApiKey)
    : usePublicKey_(false), defaultPollSource_("AUTO") {

    // Create HTTP client
    httpClient_ = std::make_unique<HttpClient>(remoteUrl);

    // Set developer API key if provided
    if (!developerApiKey.empty()) {
        httpClient_->setDefaultHeader("X-Api-Key", developerApiKey);
    }

    // Parse URL to get host for UDP
    std::string host = "localhost";
    int udpPort = DEFAULT_UDP_PORT;

    std::string parsedHost;
    int parsedPort;
    if (Utils::parseUrl(remoteUrl, parsedHost, parsedPort)) {
        if (!parsedHost.empty()) {
            host = parsedHost;
        }
        if (parsedPort > 0) {
            udpPort = parsedPort;
        }
    }

    // Allow overriding UDP port via environment variable
    std::string envUdpPort = Utils::getEnv("MESSAGING_UDP_PORT");
    if (!envUdpPort.empty()) {
        try {
            int overridePort = std::stoi(envUdpPort);
            if (overridePort > 0 && overridePort <= 65535) {
                udpPort = overridePort;
            }
        } catch (const std::exception& e) {
            // Ignore invalid port
        }
    }

    // Create UDP client
    udpClient_ = std::make_unique<UdpClient>(host, udpPort);
}

MessagingChannelApi::~MessagingChannelApi() {
    // Unique pointers will auto-cleanup
}

ConnectResponse MessagingChannelApi::connect(const std::string& channelName,
                                            const std::string& channelPassword,
                                            const std::string& agentName) {
    return connect(channelName, channelPassword, agentName, "", "");
}

ConnectResponse MessagingChannelApi::connect(const std::string& channelName,
                                            const std::string& channelPassword,
                                            const std::string& agentName,
                                            const std::string& sessionId) {
    return connect(channelName, channelPassword, agentName, sessionId, "");
}

ConnectResponse MessagingChannelApi::connect(const std::string& channelName,
                                            const std::string& channelPassword,
                                            const std::string& agentName,
                                            const std::string& sessionId,
                                            const std::string& channelId) {
    return connect(channelName, channelPassword, agentName, sessionId, channelId, false);
}

ConnectResponse MessagingChannelApi::connect(const std::string& channelName,
                                            const std::string& channelPassword,
                                            const std::string& agentName,
                                            const std::string& sessionId,
                                            const std::string& channelId,
                                            bool enableWebrtcRelay) {
    return connect(channelName, channelPassword, agentName, sessionId, channelId, enableWebrtcRelay, "private");
}

ConnectResponse MessagingChannelApi::connect(const std::string& channelName,
                                            const std::string& channelPassword,
                                            const std::string& agentName,
                                            const std::string& sessionId,
                                            const std::string& channelId,
                                            bool enableWebrtcRelay,
                                            const std::string& apiKeyScope) {
    return connect(channelName, channelPassword, agentName, sessionId, channelId, enableWebrtcRelay, apiKeyScope, "AUTO");
}

ConnectResponse MessagingChannelApi::connect(const std::string& channelName,
                                            const std::string& channelPassword,
                                            const std::string& agentName,
                                            const std::string& sessionId,
                                            const std::string& channelId,
                                            bool enableWebrtcRelay,
                                            const std::string& apiKeyScope,
                                            const std::string& pollSource) {
    // Store default poll source for receive operations
    defaultPollSource_ = pollSource.empty() ? "AUTO" : pollSource;
        if (finalChannelId.empty()) {
            if (hasChannelLogin) {
                // Create channel on server
                finalChannelId = createChannel(channelName, passwordHash);
            } else {
                throw std::runtime_error("Missing channelId or channelName+channelPassword for connect operation");
            }
        }

        // Build connect request
        ConnectRequest connectRequest;
        connectRequest.channelId = finalChannelId;
        connectRequest.channelName = channelName;
        connectRequest.channelPassword = passwordHash;
        connectRequest.agentName = agentName;
        connectRequest.sessionId = sessionId;
        connectRequest.agentContext = createAgentMetadata();
        connectRequest.enableWebrtcRelay = enableWebrtcRelay;

        // Send connect request
        HttpClientResult result = httpClient_->post(getActionUrl("connect"),
                                                     connectRequest.toJson(),
                                                     POLLING_TIMEOUT_MS);

        if (result.isHttpOk()) {
            json responseJson = result.dataAsJson();
            if (responseJson.contains("data")) {
                return ConnectResponse::fromJson(responseJson["data"]);
        connectRequest.apiKeyScope = apiKeyScope.empty() ? "private" : apiKeyScope;
        }
    } catch (const std::exception& e) {
        std::cerr << "Exception in connect operation: " << e.what() << std::endl;
    }

    return ConnectResponse();
}

ConnectResponse MessagingChannelApi::connectWithChannelId(const std::string& agentName,
                                                          const std::string& channelId,
                                                          const std::string& sessionId) {
    return connect("", "", agentName, sessionId, channelId, false);
}

ConnectResponse MessagingChannelApi::connectWithChannelId(const std::string& agentName,
                                                          const std::string& channelId,
                                                          const std::string& sessionId,
                                                          bool enableWebrtcRelay) {
    return connect("", "", agentName, sessionId, channelId, enableWebrtcRelay);
ConnectResponse MessagingChannelApi::connect(const std::map<std::string, std::string>& config) {
    std::string channelName = config.count("channelName") ? config.at("channelName") : "";
    std::string channelPassword = config.count("channelPassword") ? config.at("channelPassword") : "";
    std::string agentName = config.count("agentName") ? config.at("agentName") : "";
    std::string sessionId = config.count("sessionId") ? config.at("sessionId") : "";
    std::string channelId = config.count("channelId") ? config.at("channelId") : "";
    bool enableWebrtcRelay = config.count("enableWebrtcRelay") && config.at("enableWebrtcRelay") == "true";
    std::string apiKeyScope = config.count("apiKeyScope") ? config.at("apiKeyScope") : "private";
    std::string pollSource = config.count("pollSource") ? config.at("pollSource") : "AUTO";

    return connect(channelName, channelPassword, agentName, sessionId, channelId, enableWebrtcRelay, apiKeyScope, pollSource);
}

                return responseJson["data"]["channelId"].get<std::string>();
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "create-channel failed: " << e.what() << std::endl;
    }

    return "";
}

EventMessageResult MessagingChannelApi::receive(const std::string& sessionId,
                                               const ReceiveConfig& config) {
    EventMessageResult result;

    try {
        MessageReceiveRequest request;
        request.sessionId = sessionId;

        // Apply default poll source if not specified in config
        ReceiveConfig effectiveConfig = config;
        if (effectiveConfig.pollSource.empty()) {
            effectiveConfig.pollSource = defaultPollSource_;
        }
        request.receiveConfig = effectiveConfig;

        HttpClientResult httpResult = httpClient_->post(getActionUrl("pull"),
                                                        request.toJson(),
                                                        POLLING_TIMEOUT_MS);

        if (httpResult.isHttpOk()) {
            json responseJson = httpResult.dataAsJson();
            if (responseJson.contains("data")) {
                return EventMessageResult::fromJson(responseJson["data"]);
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "Exception in receive operation: " << e.what() << std::endl;
    }

    return result;
}

std::vector<AgentInfo> MessagingChannelApi::getActiveAgents(const std::string& sessionId) {
    std::vector<AgentInfo> agents;

    try {
        SessionRequest request(sessionId);
        HttpClientResult result = httpClient_->post(getActionUrl("list-agents"),
                                                     request.toJson());

        if (result.isHttpOk()) {
            json responseJson = result.dataAsJson();
            if (responseJson.contains("data") && responseJson["data"].is_array()) {
                for (const auto& agentJson : responseJson["data"]) {
                    agents.push_back(AgentInfo::fromJson(agentJson));
                }
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "Exception in getActiveAgents: " << e.what() << std::endl;
    }

    return agents;
}

std::vector<AgentInfo> MessagingChannelApi::getSystemAgents(const std::string& sessionId) {
    std::vector<AgentInfo> agents;

    try {
        SessionRequest request(sessionId);
        HttpClientResult result = httpClient_->post(getActionUrl("list-system-agents"),
                                                     request.toJson());

        if (result.isHttpOk()) {
            json responseJson = result.dataAsJson();
            if (responseJson.contains("data") && responseJson["data"].is_array()) {
                for (const auto& agentJson : responseJson["data"]) {
                    agents.push_back(AgentInfo::fromJson(agentJson));
                }
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "Exception in getSystemAgents: " << e.what() << std::endl;
    }

    return agents;
}

bool MessagingChannelApi::send(EventType eventType,
                               const std::string& message,
                               const std::string& destination,
                               const std::string& sessionId,
                               bool encrypted) {
    try {
        EventMessageRequest request;
        request.sessionId = sessionId;
        request.type = eventType;
        request.to = destination;
        request.content = message;
        request.encrypted = encrypted;

        HttpClientResult result = httpClient_->post(getActionUrl("push"),
                                                     request.toJson());

        return result.isHttpOk();
    } catch (const std::exception& e) {
        std::cerr << "Exception in send operation: " << e.what() << std::endl;
        return false;
    }
}

bool MessagingChannelApi::disconnect(const std::string& sessionId) {
    try {
        udpClient_->close();
    } catch (const std::exception& e) {
        std::cerr << "Error closing UDP client: " << e.what() << std::endl;
    }

    try {
        SessionRequest request(sessionId);
        HttpClientResult result = httpClient_->post(getActionUrl("disconnect"),
                                                     request.toJson());

        httpClient_->closeAll();

        return result.isHttpOk();
    } catch (const std::exception& e) {
        std::cerr << "Exception in disconnect operation: " << e.what() << std::endl;
        return false;
    }
}

bool MessagingChannelApi::udpPush(const std::string& message,
                                  const std::string& destination,
                                  const std::string& sessionId) {
    try {
        EventMessageRequest request;
        request.sessionId = sessionId;
        request.type = EventType::CHAT_TEXT;
        request.to = destination;
        request.content = message;
        request.encrypted = false;

        UdpEnvelope envelope("push", request.toJson());

        return udpClient_->send(envelope);
    } catch (const std::exception& e) {
        std::cerr << "Exception in udpPush operation: " << e.what() << std::endl;
        return false;
    }
}

EventMessageResult MessagingChannelApi::udpPull(const std::string& sessionId,
                                               const ReceiveConfig& config) {
    EventMessageResult result;

    try {
        MessageReceiveRequest request;
        request.sessionId = sessionId;

        // Apply default poll source if not specified in config
        ReceiveConfig effectiveConfig = config;
        if (effectiveConfig.pollSource.empty()) {
            effectiveConfig.pollSource = defaultPollSource_;
        }
        request.receiveConfig = effectiveConfig;

        UdpEnvelope envelope("pull", request.toJson());

        json response = udpClient_->sendAndWait(envelope, 3000);

        if (!response.is_null()) {
            if (response.contains("status") && response["status"] == "ok") {
                if (response.contains("result")) {
                    json resultJson = response["result"];
                    if (resultJson.contains("status") && resultJson["status"] == "success") {
                        if (resultJson.contains("data")) {
                            return EventMessageResult::fromJson(resultJson["data"]);
                        }
                    }
                }
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "Exception in udpPull operation: " << e.what() << std::endl;
    }

    return result;
}

std::map<std::string, std::string> MessagingChannelApi::createAgentMetadata() const {
    std::map<std::string, std::string> metadata;
    metadata["agentType"] = "CPP-AGENT";
    metadata["descriptor"] = "hmdev::messaging::MessagingChannelApi";
    return metadata;
}

std::string MessagingChannelApi::getActionUrl(const std::string& action) const {
    return "/" + action;
}

} // namespace messaging
} // namespace hmdev

