#include "hmdev/messaging/api/udp_client.h"
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
#include <cstring>
#include <stdexcept>
#include <sys/select.h>

namespace hmdev {
namespace messaging {

UdpClient::UdpClient(const std::string& host, int port)
    : host_(host), port_(port), socketFd_(-1), isOpen_(false) {
}

UdpClient::~UdpClient() {
    close();
}

void UdpClient::ensureSocketOpen() {
    if (isOpen_) {
        return;
    }

    // Create UDP socket
    socketFd_ = socket(AF_INET, SOCK_DGRAM, 0);
    if (socketFd_ < 0) {
        throw std::runtime_error("Failed to create UDP socket");
    }

    isOpen_ = true;
}

bool UdpClient::send(const UdpEnvelope& envelope) {
    try {
        ensureSocketOpen();

        // Serialize envelope to JSON
        std::string jsonStr = envelope.toJson().dump();

        // Resolve hostname
        struct hostent* server = gethostbyname(host_.c_str());
        if (server == nullptr) {
            return false;
        }

        // Setup server address
        struct sockaddr_in serverAddr;
        std::memset(&serverAddr, 0, sizeof(serverAddr));
        serverAddr.sin_family = AF_INET;
        std::memcpy(&serverAddr.sin_addr.s_addr, server->h_addr, server->h_length);
        serverAddr.sin_port = htons(port_);

        // Send data
        ssize_t sent = sendto(socketFd_, jsonStr.c_str(), jsonStr.length(), 0,
                             reinterpret_cast<struct sockaddr*>(&serverAddr),
                             sizeof(serverAddr));

        return sent > 0;
    } catch (const std::exception& e) {
        return false;
    }
}

json UdpClient::sendAndWait(const UdpEnvelope& envelope, int timeoutMs) {
    try {
        ensureSocketOpen();

        // Serialize envelope to JSON
        std::string jsonStr = envelope.toJson().dump();

        // Resolve hostname
        struct hostent* server = gethostbyname(host_.c_str());
        if (server == nullptr) {
            return nullptr;
        }

        // Setup server address
        struct sockaddr_in serverAddr;
        std::memset(&serverAddr, 0, sizeof(serverAddr));
        serverAddr.sin_family = AF_INET;
        std::memcpy(&serverAddr.sin_addr.s_addr, server->h_addr, server->h_length);
        serverAddr.sin_port = htons(port_);

        // Send data
        ssize_t sent = sendto(socketFd_, jsonStr.c_str(), jsonStr.length(), 0,
                             reinterpret_cast<struct sockaddr*>(&serverAddr),
                             sizeof(serverAddr));

        if (sent <= 0) {
            return nullptr;
        }

        // Wait for response with timeout
        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(socketFd_, &readSet);

        struct timeval timeout;
        timeout.tv_sec = timeoutMs / 1000;
        timeout.tv_usec = (timeoutMs % 1000) * 1000;

        int selectResult = select(socketFd_ + 1, &readSet, nullptr, nullptr, &timeout);

        if (selectResult <= 0) {
            // Timeout or error
            return nullptr;
        }

        // Receive response
        char buffer[65536];
        struct sockaddr_in fromAddr;
        socklen_t fromLen = sizeof(fromAddr);

        ssize_t received = recvfrom(socketFd_, buffer, sizeof(buffer) - 1, 0,
                                   reinterpret_cast<struct sockaddr*>(&fromAddr),
                                   &fromLen);

        if (received > 0) {
            buffer[received] = '\0';
            return json::parse(buffer);
        }

        return nullptr;
    } catch (const std::exception& e) {
        return nullptr;
    }
}

void UdpClient::close() {
    if (isOpen_ && socketFd_ >= 0) {
        ::close(socketFd_);
        socketFd_ = -1;
        isOpen_ = false;
    }
}

} // namespace messaging
} // namespace hmdev

