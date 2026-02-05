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

std::string Security::deriveChannelSecret(const std::string& channelName,
                                          const std::string& channelPassword) {
    // Concatenate channelName and channelPassword to derive secret
    std::string combined = channelName + channelPassword;
    auto hash = sha256(combined);
    return base64Encode(hash);
}

std::string Security::hash(const std::string& password, const std::string& secret) {
    // HMAC-SHA256 of password with secret
    auto hmac = hmacSha256(password, secret);
    return base64Encode(hmac);
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

