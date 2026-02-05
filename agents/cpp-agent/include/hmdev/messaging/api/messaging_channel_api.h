#ifndef HMDEV_MESSAGING_CHANNEL_API_H
#define HMDEV_MESSAGING_CHANNEL_API_H

#include <memory>
#include "connection_channel_api.h"
#include "http_client.h"
#include "udp_client.h"

namespace hmdev {
namespace messaging {

/**
 * Main implementation of ConnectionChannelApi
 * Provides HTTP and UDP communication with messaging platform
 */
class MessagingChannelApi : public ConnectionChannelApi {
public:
    /**
     * Constructor
     * @param remoteUrl Base URL of messaging service (e.g., "https://api.example.com")
     * @param developerApiKey Developer API key (optional)
     */
    MessagingChannelApi(const std::string& remoteUrl,
                       const std::string& developerApiKey = "");

    /**
     * Destructor
     */
    ~MessagingChannelApi() override;

    // ConnectionChannelApi implementation
    ConnectResponse connect(const std::string& channelName,
                           const std::string& channelPassword,
                           const std::string& agentName) override;

    ConnectResponse connect(const std::string& channelName,
                           const std::string& channelPassword,
                           const std::string& agentName,
                           const std::string& sessionId) override;

    ConnectResponse connect(const std::string& channelName,
                           const std::string& channelPassword,
                           const std::string& agentName,
                           const std::string& sessionId,
                           const std::string& channelId) override;

    ConnectResponse connect(const std::string& channelName,
                           const std::string& channelPassword,
                           const std::string& agentName,
                           const std::string& sessionId,
                           const std::string& channelId,
                           bool enableWebrtcRelay) override;

    /**
     * Connect with API key scope support
     * @param channelName Channel name
     * @param channelPassword Channel password
     * @param agentName Agent name
     * @param sessionId Session ID (optional)
     * @param channelId Channel ID (optional)
     * @param enableWebrtcRelay Enable WebRTC relay
     * @param apiKeyScope API key scope: "private" (default) or "public"
     * @return Connect response
     */
    ConnectResponse connect(const std::string& channelName,
                           const std::string& channelPassword,
                           const std::string& agentName,
                           const std::string& sessionId,
                           const std::string& channelId,
                           bool enableWebrtcRelay,
                           const std::string& apiKeyScope);

    /**
     * Connect with API key scope and poll source
     * @param channelName Channel name
     * @param channelPassword Channel password
     * @param agentName Agent name
     * @param sessionId Session ID (optional)
     * @param channelId Channel ID (optional)
     * @param enableWebrtcRelay Enable WebRTC relay
     * @param apiKeyScope API key scope: "private" (default) or "public"
     * @param pollSource Default poll source: "AUTO", "CACHE", "DATABASE", or "KAFKA"
     * @return Connect response
     */
    ConnectResponse connect(const std::string& channelName,
                           const std::string& channelPassword,
                           const std::string& agentName,
                           const std::string& sessionId,
                           const std::string& channelId,
                           bool enableWebrtcRelay,
                           const std::string& apiKeyScope,
                           const std::string& pollSource) override;

    /**
     * Object-based connect for cleaner API (recommended)
     * @param config Map with keys: channelName, channelPassword, agentName, sessionId (optional),
     *               channelId (optional), enableWebrtcRelay (optional), apiKeyScope (optional)
     * @return Connect response
     */
    ConnectResponse connect(const std::map<std::string, std::string>& config);


    EventMessageResult udpPull(const std::string& sessionId,
                              const ReceiveConfig& config) override;

    /**
     * Set whether to use public key encryption (currently not implemented)
     * @param usePublicKey Enable public key encryption
     */
    void setUsePublicKey(bool usePublicKey) { usePublicKey_ = usePublicKey; }

private:
    static constexpr int POLLING_TIMEOUT_MS = 40000;  // 40 seconds
    static constexpr int DEFAULT_UDP_PORT = 9999;

    std::unique_ptr<HttpClient> httpClient_;
    std::unique_ptr<UdpClient> udpClient_;
    bool usePublicKey_;
    std::string defaultPollSource_;  // Default poll source for receive operations

    /**
     * Create channel on server
     * @param channelName Channel name
     * @param passwordHash Hashed password
     * @return Channel ID or empty string on failure
     */
    std::string createChannel(const std::string& channelName,
                             const std::string& passwordHash);

    /**
     * Create agent metadata for connect requests
     * @return Agent context map
     */
    std::map<std::string, std::string> createAgentMetadata() const;

    /**
     * Build action URL
     * @param action Action name (e.g., "connect")
     * @return Full action path
     */
    std::string getActionUrl(const std::string& action) const;
};

} // namespace messaging
} // namespace hmdev

#endif // HMDEV_MESSAGING_CHANNEL_API_H

