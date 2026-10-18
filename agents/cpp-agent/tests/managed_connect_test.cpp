// Managed channels, as the C++ agent sends them: agentKey goes with connect
// when given, and not at all otherwise (ordinary channels see the same payload
// as before), and the CPPAGENT_DEBUG dump of the connect request never shows
// the key. A local server stands in for the service and records each body;
// the same checks the JS, Python and Java agents' managed-connect tests make.
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
typedef SOCKET socket_t;
#define CLOSE_SOCKET closesocket
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
typedef int socket_t;
#define CLOSE_SOCKET close
#endif

#include "hmdev/messaging/agent/data_models.h"
#include "hmdev/messaging/api/messaging_channel_api.h"

#include <atomic>
#include <cctype>
#include <cstdlib>
#include <iostream>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

using hmdev::messaging::ConnectRequest;
using hmdev::messaging::MessagingChannelApi;

namespace {

const std::string kKey = "k-0123456789abcdef0123456789";
int failures = 0;

void check(const std::string& name, bool ok, const std::string& detail) {
    std::cout << (ok ? "ok   " : "FAIL ") << name << std::endl;
    if (!ok) {
        ++failures;
        std::cout << "  " << detail << std::endl;
    }
}

bool contains(const std::string& text, const std::string& part) {
    return text.find(part) != std::string::npos;
}

// --- the stand-in service ----------------------------------------------------

std::string headerValue(const std::string& head, const std::string& name) {
    std::string lower;
    for (char c : head) lower += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    size_t at = lower.find("\r\n" + name + ":");
    if (at == std::string::npos) return "";
    size_t start = at + name.size() + 3;
    size_t end = head.find("\r\n", start);
    std::string value = head.substr(start, end - start);
    size_t first = value.find_first_not_of(' ');
    return first == std::string::npos ? "" : value.substr(first);
}

// Reads one request, answering curl's "Expect: 100-continue" if it asks.
bool readRequest(socket_t client, std::string& head, std::string& body) {
    std::string data;
    char buf[4096];
    size_t headEnd;
    while ((headEnd = data.find("\r\n\r\n")) == std::string::npos) {
        int n = recv(client, buf, sizeof(buf), 0);
        if (n <= 0) return false;
        data.append(buf, n);
    }
    head = data.substr(0, headEnd);
    body = data.substr(headEnd + 4);
    if (contains(headerValue(head, "expect"), "100")) {
        const char* go = "HTTP/1.1 100 Continue\r\n\r\n";
        send(client, go, static_cast<int>(std::string(go).size()), 0);
    }
    std::string lengthText = headerValue(head, "content-length");
    size_t length = lengthText.empty() ? 0 : static_cast<size_t>(std::stoul(lengthText));
    while (body.size() < length) {
        int n = recv(client, buf, sizeof(buf), 0);
        if (n <= 0) return false;
        body.append(buf, n);
    }
    return true;
}

class StandIn {
public:
    StandIn() {
        listener_ = socket(AF_INET, SOCK_STREAM, 0);
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0;
        bind(listener_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
        listen(listener_, 8);
        socklen_t size = sizeof(addr);
        getsockname(listener_, reinterpret_cast<sockaddr*>(&addr), &size);
        port_ = ntohs(addr.sin_port);
        thread_ = std::thread([this] { serve(); });
    }

    ~StandIn() {
        stopping_ = true;
#ifdef _WIN32
        shutdown(listener_, SD_BOTH);
#else
        shutdown(listener_, SHUT_RDWR);
#endif
        CLOSE_SOCKET(listener_);
        thread_.join();
    }

    std::string url() const { return "http://127.0.0.1:" + std::to_string(port_); }

    std::string lastConnect() {
        std::lock_guard<std::mutex> lock(mutex_);
        return connects_.empty() ? "" : connects_.back();
    }

private:
    void serve() {
        while (!stopping_) {
            socket_t client = accept(listener_, nullptr, nullptr);
            if (stopping_) break;
            std::string head, body;
            if (readRequest(client, head, body) && contains(head.substr(0, head.find("\r\n")), "/connect")) {
                std::lock_guard<std::mutex> lock(mutex_);
                connects_.push_back(body);
            }
            const std::string reply = "{\"status\":\"unauthorized\",\"statusMessage\":\"stand-in\"}";
            std::string out = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n"
                              "Content-Length: " + std::to_string(reply.size()) + "\r\n\r\n" + reply;
            send(client, out.data(), static_cast<int>(out.size()), 0);
            CLOSE_SOCKET(client);
        }
    }

    socket_t listener_;
    int port_ = 0;
    std::atomic<bool> stopping_{false};
    std::thread thread_;
    std::mutex mutex_;
    std::vector<std::string> connects_;
};

// --- the checks --------------------------------------------------------------

void setDebug() {
#ifdef _WIN32
    _putenv_s("CPPAGENT_DEBUG", "1");
#else
    setenv("CPPAGENT_DEBUG", "1", 1);
#endif
}

// Runs fn with std::cerr captured, and returns what it wrote there.
template <typename Fn>
std::string capturingStderr(Fn fn) {
    std::ostringstream captured;
    std::streambuf* old = std::cerr.rdbuf(captured.rdbuf());
    fn();
    std::cerr.rdbuf(old);
    return captured.str();
}

void dataModel() {
    ConnectRequest request;
    request.channelId = "room-1";
    request.agentName = "plain";
    check("no key: agentKey absent from JSON", !request.toJson().contains("agentKey"), request.toJson().dump());

    request.agentKey = kKey;
    check("key: agentKey in JSON", request.toJson().value("agentKey", "") == kKey, request.toJson().dump());
    std::string redacted = request.toRedactedJson().dump();
    check("key: redacted JSON hides it", !contains(redacted, kKey) && contains(redacted, "agentKey"), redacted);
}

void overTheWire(StandIn& server) {
    MessagingChannelApi managed(server.url(), "temp-key");
    managed.setAgentKey(kKey);
    std::string log = capturingStderr([&] { managed.connectWithChannelId("u-ann", "room-1", ""); });
    std::string sent = server.lastConnect();
    check("setAgentKey: connect body carries the key", contains(sent, "\"agentKey\":\"" + kKey + "\""), sent);
    check("debug dump printed", contains(log, "[DEBUG] connect"), log);
    check("debug dump never shows the key", !contains(log, kKey), log);

    MessagingChannelApi plain(server.url(), "temp-key");
    plain.connectWithChannelId("plain", "room-1", "");
    sent = server.lastConnect();
    check("ordinary agent: no agentKey in connect body", !sent.empty() && !contains(sent, "agentKey"), sent);

    MessagingChannelApi byMap(server.url(), "temp-key");
    std::map<std::string, std::string> config{{"channelId", "room-1"}, {"agentName", "u-bob"}, {"agentKey", kKey}};
    log = capturingStderr([&] { byMap.connect(config); });
    sent = server.lastConnect();
    check("config[\"agentKey\"]: connect body carries the key", contains(sent, "\"agentKey\":\"" + kKey + "\""), sent);
    check("config[\"agentKey\"]: debug dump never shows the key", !contains(log, kKey), log);
}

}  // namespace

int main() {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
    setDebug();
    dataModel();
    {
        StandIn server;
        overTheWire(server);
    }
    std::cout << (failures == 0 ? "all managed-connect checks passed" : "managed-connect checks FAILED") << std::endl;
    return failures == 0 ? 0 : 1;
}
