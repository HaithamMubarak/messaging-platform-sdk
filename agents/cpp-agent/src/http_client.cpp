#include "hmdev/messaging/api/http_client.h"
#include <curl/curl.h>
#include <sstream>
#include <stdexcept>

namespace hmdev {
namespace messaging {

// Callback for CURL write function
static size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    size_t totalSize = size * nmemb;
    std::string* str = static_cast<std::string*>(userp);
    str->append(static_cast<char*>(contents), totalSize);
    return totalSize;
}

json HttpClientResult::dataAsJson() const {
    if (data.empty()) {
        return json::object();
    }
    try {
        return json::parse(data);
    } catch (const std::exception& e) {
        return json::object();
    }
}

HttpClient::HttpClient(const std::string& baseUrl)
    : baseUrl_(baseUrl), curlHandle_(nullptr) {
    // Initialize CURL
    curl_global_init(CURL_GLOBAL_DEFAULT);
    curlHandle_ = curl_easy_init();

    if (!curlHandle_) {
        throw std::runtime_error("Failed to initialize CURL");
    }
}

HttpClient::~HttpClient() {
    closeAll();
    curl_global_cleanup();
}

void HttpClient::setDefaultHeader(const std::string& key, const std::string& value) {
    defaultHeaders_[key] = value;
}

void HttpClient::removeDefaultHeader(const std::string& key) {
    defaultHeaders_.erase(key);
}

HttpClientResult HttpClient::request(HttpMethod method,
                                     const std::string& path,
                                     const json& body,
                                     int timeoutMs) {
    HttpClientResult result;

    if (!curlHandle_) {
        return result;
    }

    CURL* curl = static_cast<CURL*>(curlHandle_);
    std::string url = buildUrl(path);
    std::string responseData;

    // Set URL
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

    // Set timeout
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs);

    // Set write callback
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseData);

    // Build headers
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    for (const auto& header : defaultHeaders_) {
        std::string headerStr = header.first + ": " + header.second;
        headers = curl_slist_append(headers, headerStr.c_str());
    }

    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    // Set method and body
    std::string bodyStr;
    if (method == HttpMethod::POST || method == HttpMethod::PUT) {
        if (!body.is_null()) {
            bodyStr = body.dump();
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, bodyStr.c_str());
        }

        if (method == HttpMethod::POST) {
            curl_easy_setopt(curl, CURLOPT_POST, 1L);
        } else {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
        }
    } else if (method == HttpMethod::DELETE) {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");
    } else {
        // GET
        curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    }

    // Perform request
    CURLcode res = curl_easy_perform(curl);

    // Clean up headers
    curl_slist_free_all(headers);

    if (res == CURLE_OK) {
        long statusCode;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &statusCode);
        result.statusCode = static_cast<int>(statusCode);
        result.data = responseData;
        result.success = true;
    } else {
        result.statusCode = 0;
        result.success = false;
    }

    return result;
}

HttpClientResult HttpClient::get(const std::string& path, int timeoutMs) {
    return request(HttpMethod::GET, path, nullptr, timeoutMs);
}

HttpClientResult HttpClient::post(const std::string& path,
                                  const json& body,
                                  int timeoutMs) {
    return request(HttpMethod::POST, path, body, timeoutMs);
}

void HttpClient::closeAll() {
    if (curlHandle_) {
        curl_easy_cleanup(static_cast<CURL*>(curlHandle_));
        curlHandle_ = nullptr;
    }
}

std::string HttpClient::buildUrl(const std::string& path) const {
    if (path.empty() || path[0] != '/') {
        return baseUrl_ + "/" + path;
    }
    return baseUrl_ + path;
}

} // namespace messaging
} // namespace hmdev

