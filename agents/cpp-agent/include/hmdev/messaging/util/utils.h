#ifndef HMDEV_MESSAGING_UTILS_H
#define HMDEV_MESSAGING_UTILS_H

#include <string>
#include <chrono>

namespace hmdev {
namespace messaging {

/**
 * Utility functions
 */
class Utils {
public:
    /**
     * Get current timestamp in milliseconds
     * @return Current time in milliseconds since epoch
     */
    static long long getCurrentTimeMillis();

    /**
     * Parse URL to extract host and port
     * @param url URL string
     * @param host Output: host
     * @param port Output: port (-1 if not specified)
     * @return True if parsed successfully
     */
    static bool parseUrl(const std::string& url, std::string& host, int& port);

    /**
     * Get environment variable or default value
     * @param name Environment variable name
     * @param defaultValue Default value if not found
     * @return Environment variable value or default
     */
    static std::string getEnv(const std::string& name,
                             const std::string& defaultValue = "");

    /**
     * Trim whitespace from string
     * @param str String to trim
     * @return Trimmed string
     */
    static std::string trim(const std::string& str);

    /**
     * Check if string is empty or whitespace only
     * @param str String to check
     * @return True if empty or whitespace
     */
    static bool isBlank(const std::string& str);
};

} // namespace messaging
} // namespace hmdev

#endif // HMDEV_MESSAGING_UTILS_H

