#ifndef HMDEV_MESSAGING_HTTP_CLIENT_H
#define HMDEV_MESSAGING_HTTP_CLIENT_H

#include <string>
#include <map>
#include <nlohmann/json.hpp>

namespace hmdev {
namespace messaging {

using json = nlohmann::json;

/**
 * HTTP request method
 */
enum class HttpMethod {
    GET,
    POST,
    PUT,
    DELETE
};

/**
 * HTTP response result
 */
struct HttpClientResult {
    int statusCode;
    std::string data;
    bool success;

    HttpClientResult() : statusCode(0), success(false) {}

    bool isHttpOk() const { return statusCode >= 200 && statusCode < 300; }
    json dataAsJson() const;
};

/**
 * HTTP client for REST API calls
 */
class HttpClient {
public:
    /**
     * Constructor
     * @param baseUrl Base URL for API (e.g., "https://api.example.com")
     */
    explicit HttpClient(const std::string& baseUrl);

    /**
     * Destructor
     */
    ~HttpClient();

    /**
     * Set default header for all requests
     * @param key Header key
     * @param value Header value
     */
    void setDefaultHeader(const std::string& key, const std::string& value);

    /**
     * Remove default header
     * @param key Header key
     */
    void removeDefaultHeader(const std::string& key);

    /**
     * Make HTTP request with JSON body
     * @param method HTTP method
     * @param path API path (e.g., "/connect")
     * @param body Request body as JSON
     * @param timeoutMs Timeout in milliseconds (default: 30000)
     * @return HTTP response result
     */
    HttpClientResult request(HttpMethod method,
                            const std::string& path,
                            const json& body = nullptr,
                            int timeoutMs = 30000);

    /**
     * Make HTTP GET request
     * @param path API path
     * @param timeoutMs Timeout in milliseconds
     * @return HTTP response result
     */
    HttpClientResult get(const std::string& path, int timeoutMs = 30000);

    /**
     * Make HTTP POST request
     * @param path API path
     * @param body Request body as JSON
     * @param timeoutMs Timeout in milliseconds
     * @return HTTP response result
     */
    HttpClientResult post(const std::string& path,
                         const json& body,
                         int timeoutMs = 30000);

    /**
     * Close all connections
     */
    void closeAll();

private:
    std::string baseUrl_;
    std::map<std::string, std::string> defaultHeaders_;
    void* curlHandle_;  // CURL handle (opaque pointer)

    std::string buildUrl(const std::string& path) const;
};

} // namespace messaging
} // namespace hmdev

#endif // HMDEV_MESSAGING_HTTP_CLIENT_H

