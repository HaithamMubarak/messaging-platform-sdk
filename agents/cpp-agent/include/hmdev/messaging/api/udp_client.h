#ifndef HMDEV_MESSAGING_UDP_CLIENT_H
#define HMDEV_MESSAGING_UDP_CLIENT_H

#include <string>
#include <nlohmann/json.hpp>
#include "hmdev/messaging/agent/data_models.h"

namespace hmdev {
namespace messaging {

using json = nlohmann::json;

/**
 * UDP client for fast message transport
 */
class UdpClient {
public:
    /**
     * Constructor
     * @param host Server host
     * @param port Server UDP port
     */
    UdpClient(const std::string& host, int port);

    /**
     * Destructor
     */
    ~UdpClient();

    /**
     * Send UDP envelope (fire and forget)
     * @param envelope UDP envelope to send
     * @return True if sent successfully
     */
    bool send(const UdpEnvelope& envelope);

    /**
     * Send UDP envelope and wait for response
     * @param envelope UDP envelope to send
     * @param timeoutMs Timeout in milliseconds
     * @return Response JSON or null on timeout/error
     */
    json sendAndWait(const UdpEnvelope& envelope, int timeoutMs = 3000);

    /**
     * Close UDP socket
     */
    void close();

private:
    std::string host_;
    int port_;
    int socketFd_;
    bool isOpen_;

    void ensureSocketOpen();
};

} // namespace messaging
} // namespace hmdev

#endif // HMDEV_MESSAGING_UDP_CLIENT_H

