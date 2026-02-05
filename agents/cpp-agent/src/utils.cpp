#include "hmdev/messaging/util/utils.h"
#include <cstdlib>
#include <algorithm>
#include <regex>

namespace hmdev {
namespace messaging {

long long Utils::getCurrentTimeMillis() {
    auto now = std::chrono::system_clock::now();
    auto duration = now.time_since_epoch();
    return std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();
}

bool Utils::parseUrl(const std::string& url, std::string& host, int& port) {
    // Simple URL parser: protocol://host:port/path
    std::regex urlRegex(R"(^(https?://)?([^:/]+)(:(\d+))?(/.*)?$)");
    std::smatch match;

    if (std::regex_match(url, match, urlRegex)) {
        host = match[2].str();
        if (match[4].matched) {
            port = std::stoi(match[4].str());
        } else {
            port = -1;  // No port specified
        }
        return true;
    }

    return false;
}

std::string Utils::getEnv(const std::string& name, const std::string& defaultValue) {
    const char* value = std::getenv(name.c_str());
    if (value != nullptr) {
        return std::string(value);
    }
    return defaultValue;
}

std::string Utils::trim(const std::string& str) {
    auto start = std::find_if_not(str.begin(), str.end(),
                                  [](unsigned char c) { return std::isspace(c); });
    auto end = std::find_if_not(str.rbegin(), str.rend(),
                                [](unsigned char c) { return std::isspace(c); }).base();

    return (start < end) ? std::string(start, end) : std::string();
}

bool Utils::isBlank(const std::string& str) {
    return trim(str).empty();
}

} // namespace messaging
} // namespace hmdev

