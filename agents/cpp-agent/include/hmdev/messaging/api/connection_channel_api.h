#ifndef HMDEV_MESSAGING_CONNECTION_CHANNEL_API_H
#define HMDEV_MESSAGING_CONNECTION_CHANNEL_API_H

#include <string>
#include <vector>
#include "hmdev/messaging/agent/data_models.h"

namespace hmdev {
namespace messaging {

/**
 * Connection channel API interface
 * Defines core operations for messaging platform communication
 */
class ConnectionChannelApi {
public:
    virtual ~ConnectionChannelApi() = default;

    /**
     * Connect to a channel
     * @param channelName Channel name
     * @param channelPassword Channel password
     * @param agentName Agent name
     * @return Connect response with session ID
     */
    virtual ConnectResponse connect(const std::string& channelName,
                                   const std::string& channelPassword,
                                   const std::string& agentName) = 0;

    /**
     * Connect to a channel with session ID (reconnect)
     * @param channelName Channel name
     * @param channelPassword Channel password
     * @param agentName Agent name
     * @param sessionId Session ID for reconnection
     * @return Connect response
     */
    virtual ConnectResponse connect(const std::string& channelName,
                                   const std::string& channelPassword,
                                   const std::string& agentName,
                                   const std::string& sessionId) = 0;

    /**
     * Connect to a channel with channel ID
     * @param channelName Channel name
     * @param channelPassword Channel password
     * @param agentName Agent name
     * @param sessionId Session ID (optional)
     * @param channelId Channel ID
     * @return Connect response
     */
    virtual ConnectResponse connect(const std::string& channelName,
                                   const std::string& channelPassword,
                                   const std::string& agentName,
                                   const std::string& sessionId,
                                   const std::string& channelId) = 0;

    /**
     * Connect to a channel with WebRTC relay
     * @param channelName Channel name
     * @param channelPassword Channel password
     * @param agentName Agent name
     * @param sessionId Session ID (optional)
     * @param channelId Channel ID (optional)
     * @param enableWebrtcRelay Enable WebRTC relay
     * @return Connect response
     */
    virtual ConnectResponse connect(const std::string& channelName,
                                   const std::string& channelPassword,
                                   const std::string& agentName,
                                   const std::string& sessionId,
                                   const std::string& channelId,
                                   bool enableWebrtcRelay) = 0;

    /**
     * Connect to a channel with API key scope
     * @param channelName Channel name
     * @param channelPassword Channel password
     * @param agentName Agent name
     * @param sessionId Session ID (optional)
     * @param channelId Channel ID (optional)
     * @param enableWebrtcRelay Enable WebRTC relay
     * @param apiKeyScope API key scope: "private" (default) or "public"
     * @return Connect response
     */
    virtual ConnectResponse connect(const std::string& channelName,
                                   const std::string& channelPassword,
                                   const std::string& agentName,
                                   const std::string& sessionId,
                                   const std::string& channelId,
                                   bool enableWebrtcRelay,
                                   const std::string& apiKeyScope) = 0;

    /**
     * Connect to a channel with API key scope and poll source
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
    virtual ConnectResponse connect(const std::string& channelName,
                                   const std::string& channelPassword,
                                   const std::string& agentName,
                                   const std::string& sessionId,
                                   const std::string& channelId,
                                   bool enableWebrtcRelay,
                                   const std::string& apiKeyScope,
                                   const std::string& pollSource) = 0;

    /**
     * Object-based connect (recommended)
     * @param config Map with connection parameters
     * @return Connect response
     */
    virtual ConnectResponse connect(const std::map<std::string, std::string>& config) = 0;

     * @param sessionId Session ID
     * @param config Receive configuration
     * @return Event message result
     */
    virtual EventMessageResult receive(const std::string& sessionId,
                                      const ReceiveConfig& config) = 0;

    /**
     * Get active agents in channel
     * @param sessionId Session ID
     * @return List of agent info
     */
    virtual std::vector<AgentInfo> getActiveAgents(const std::string& sessionId) = 0;

    /**
     * Get system agents (relay/system roles)
     * @param sessionId Session ID
     * @return List of system agent info
     */
    virtual std::vector<AgentInfo> getSystemAgents(const std::string& sessionId) = 0;

    /**
     * Send/push message to channel
     * @param eventType Event type
     * @param message Message content
     * @param destination Destination agent ("*" for all)
     * @param sessionId Session ID
     * @param encrypted Whether message is encrypted
     * @return True if sent successfully
     */
    virtual bool send(EventType eventType,
                     const std::string& message,
                     const std::string& destination,
                     const std::string& sessionId,
                     bool encrypted) = 0;

    /**
     * Disconnect from channel
     * @param sessionId Session ID
     * @return True if disconnected successfully
     */
    virtual bool disconnect(const std::string& sessionId) = 0;

    /**
     * Send message via UDP (fast, unreliable)
     * @param message Message content
     * @param destination Destination agent ("*" for all)
     * @param sessionId Session ID
     * @return True if sent successfully
     */
    virtual bool udpPush(const std::string& message,
                        const std::string& destination,
                        const std::string& sessionId) = 0;

    /**
     * Receive messages via UDP (fast)
     * @param sessionId Session ID
     * @param config Receive configuration
     * @return Event message result
     */
    virtual EventMessageResult udpPull(const std::string& sessionId,
                                      const ReceiveConfig& config) = 0;
};

} // namespace messaging
} // namespace hmdev

#endif // HMDEV_MESSAGING_CONNECTION_CHANNEL_API_H

