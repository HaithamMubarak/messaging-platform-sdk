#include "hmdev/messaging/agent/security.h"
#include <openssl/sha.h>
#include <openssl/hmac.h>
#include <openssl/evp.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <cstring>
#include <sstream>
#include <iomanip>

namespace hmdev {
namespace messaging {

namespace {
    // Must match the Java, Python and JS agents byte for byte: the service
    // derives the channel id from the password HASH, so an agent that hashes
    // differently lands on a different channel under the same name and never
    // meets the others. (That was the case until 2026-09-03: this file used
    // base64(sha256(name+password)) and base64 HMACs, and a C++ agent could
    // not share a channel with any other SDK.)
    const char* kPbkdf2Salt = "messaging-platform";
    const int kPbkdf2Iterations = 100000;
    const int kPbkdf2KeyLength = 32;   // 256 bits

    std::string base64UrlNoPadding(const std::vector<unsigned char>& data) {
        std::string s = Security::base64Encode(data);
        for (char& c : s) {
            if (c == '+') c = '-';
            else if (c == '/') c = '_';
        }
        while (!s.empty() && s.back() == '=') s.pop_back();
        return s;
    }

    std::string hexEncode(const std::vector<unsigned char>& data) {
        std::stringstream ss;
        for (unsigned char byte : data) {
            ss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(byte);
        }
        return ss.str();
    }
}

std::string Security::deriveChannelSecret(const std::string& channelName,
                                          const std::string& channelPassword) {
    // PBKDF2-HMAC-SHA256(name + password, "messaging-platform", 100000, 32)
    // -> "channel_" + url-safe base64 without padding. Same as MySecurity in
    // the Java, Python and JS agents.
    const std::string combined = channelName + channelPassword;
    std::vector<unsigned char> key(kPbkdf2KeyLength);
    PKCS5_PBKDF2_HMAC(combined.c_str(), static_cast<int>(combined.size()),
                      reinterpret_cast<const unsigned char*>(kPbkdf2Salt),
                      static_cast<int>(std::strlen(kPbkdf2Salt)),
                      kPbkdf2Iterations, EVP_sha256(), kPbkdf2KeyLength, key.data());
    return "channel_" + base64UrlNoPadding(key);
}

std::string Security::hash(const std::string& password, const std::string& secret) {
    // Hex HMAC-SHA256(password) keyed by the channel secret, as the other agents do.
    return hexEncode(hmacSha256(password, secret));
}

std::string Security::generateChannelId(const std::string& channelName,
                                       const std::string& channelPassword,
                                       const std::string& developerKeySecret) {
    // Hash(channelName + channelPassword + developerKeySecret)
    std::string combined = channelName + channelPassword + developerKeySecret;
    auto hash = sha256(combined);

    // Convert to hex string
    std::stringstream ss;
    for (unsigned char byte : hash) {
        ss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(byte);
    }
    return ss.str();
}

std::string Security::base64Encode(const std::vector<unsigned char>& data) {
    BIO* bio = BIO_new(BIO_s_mem());
    BIO* b64 = BIO_new(BIO_f_base64());
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    bio = BIO_push(b64, bio);

    BIO_write(bio, data.data(), data.size());
    BIO_flush(bio);

    BUF_MEM* bufferPtr;
    BIO_get_mem_ptr(bio, &bufferPtr);

    std::string result(bufferPtr->data, bufferPtr->length);
    BIO_free_all(bio);

    return result;
}

std::vector<unsigned char> Security::base64Decode(const std::string& encoded) {
    BIO* bio = BIO_new_mem_buf(encoded.data(), encoded.length());
    BIO* b64 = BIO_new(BIO_f_base64());
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    bio = BIO_push(b64, bio);

    std::vector<unsigned char> result(encoded.length());
    int decodedLength = BIO_read(bio, result.data(), encoded.length());
    BIO_free_all(bio);

    if (decodedLength > 0) {
        result.resize(decodedLength);
    } else {
        result.clear();
    }

    return result;
}

std::vector<unsigned char> Security::sha256(const std::string& data) {
    std::vector<unsigned char> hash(SHA256_DIGEST_LENGTH);
    SHA256_CTX sha256;
    SHA256_Init(&sha256);
    SHA256_Update(&sha256, data.c_str(), data.length());
    SHA256_Final(hash.data(), &sha256);
    return hash;
}

std::vector<unsigned char> Security::hmacSha256(const std::string& data,
                                                const std::string& key) {
    std::vector<unsigned char> hash(EVP_MAX_MD_SIZE);
    unsigned int hashLen = 0;

    HMAC(EVP_sha256(),
         key.c_str(), key.length(),
         reinterpret_cast<const unsigned char*>(data.c_str()), data.length(),
         hash.data(), &hashLen);

    hash.resize(hashLen);
    return hash;
}

} // namespace messaging
} // namespace hmdev

