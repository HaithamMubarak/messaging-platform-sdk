#ifndef HMDEV_MESSAGING_SECURITY_H
#define HMDEV_MESSAGING_SECURITY_H

#include <string>
#include <vector>

namespace hmdev {
namespace messaging {

/**
 * Security utilities for password hashing and encryption
 */
class Security {
public:
    /**
     * Derive channel secret from channel name and password
     * @param channelName Channel name
     * @param channelPassword Channel password
     * @return Derived secret key
     */
    static std::string deriveChannelSecret(const std::string& channelName,
                                           const std::string& channelPassword);

    /**
     * Hash password with secret using SHA-256
     * @param password Password to hash
     * @param secret Secret key for HMAC
     * @return Base64-encoded hash
     */
    static std::string hash(const std::string& password, const std::string& secret);

    /**
     * Generate channel ID from channel name, password, and developer key secret
     * @param channelName Channel name
     * @param channelPassword Channel password
     * @param developerKeySecret Developer key secret
     * @return Channel ID hash
     */
    static std::string generateChannelId(const std::string& channelName,
                                         const std::string& channelPassword,
                                         const std::string& developerKeySecret);

    /**
     * Base64 encode binary data
     * @param data Binary data
     * @return Base64-encoded string
     */
    static std::string base64Encode(const std::vector<unsigned char>& data);

    /**
     * Base64 decode string
     * @param encoded Base64-encoded string
     * @return Decoded binary data
     */
    static std::vector<unsigned char> base64Decode(const std::string& encoded);

    /**
     * SHA-256 hash
     * @param data Input data
     * @return SHA-256 hash (32 bytes)
     */
    static std::vector<unsigned char> sha256(const std::string& data);

    /**
     * HMAC-SHA256
     * @param data Input data
     * @param key HMAC key
     * @return HMAC-SHA256 hash (32 bytes)
     */
    static std::vector<unsigned char> hmacSha256(const std::string& data,
                                                  const std::string& key);
};

} // namespace messaging
} // namespace hmdev

#endif // HMDEV_MESSAGING_SECURITY_H

