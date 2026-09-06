// Proves Security::deriveChannelSecret and Security::hash produce the bytes
// the other agents produce. The service derives the channel id from the
// password hash, so a C++ agent that hashes differently lands on a different
// channel under the same name — see README "Troubleshooting".
#include "hmdev/messaging/agent/security.h"

#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

using hmdev::messaging::Security;

namespace {

int failures = 0;

void check(const std::string& name, const std::string& actual, const std::string& expected) {
    if (actual == expected) {
        std::cout << "ok   " << name << std::endl;
        return;
    }
    ++failures;
    std::cout << "FAIL " << name << "\n  expected: " << expected << "\n  actual:   " << actual << std::endl;
}

std::string hex(const std::vector<unsigned char>& bytes) {
    static const char* digits = "0123456789abcdef";
    std::string out;
    for (unsigned char b : bytes) {
        out += digits[b >> 4];
        out += digits[b & 0x0f];
    }
    return out;
}

// The same channel and password tools/check-cross-language.js feeds every
// agent: 'compat-חדר' and 'test-كلمة', written as UTF-8 bytes so the file
// compiles identically whatever source charset the compiler assumes.
const std::string kChannel = "compat-\xd7\x97\xd7\x93\xd7\xa8";
const std::string kPassword = "test-\xd9\x83\xd9\x84\xd9\x85\xd8\xa9";

// Expected values computed with the JavaScript agent (the reference the
// cross-language check asserts against), on 2026-09-06:
//   node -e "const {MySecurity}=require('./agents/web-agent-js');
//     MySecurity.deriveChannelSecret('compat-חדר','test-كلمة').then(s =>
//       console.log(s, MySecurity.hash('test-كلمة', s)))"
const std::string kExpectedSecret = "channel_Ck3KugJN7TGNR7R5wy5fhW7cB0K6b90sGaJJdonFK6A";
const std::string kExpectedPasswordHash = "156a1b19aa554627919df13dd6a26d52f857bc8dcb758c404c540ea21ee1d1f3";

}  // namespace

int main() {
    const std::string secret = Security::deriveChannelSecret(kChannel, kPassword);
    check("deriveChannelSecret matches the JS agent", secret, kExpectedSecret);
    check("hash matches the JS agent (hex HMAC-SHA256)", Security::hash(kPassword, secret), kExpectedPasswordHash);

    // Sanity for the primitives the above are built from: RFC 4648 and the
    // FIPS 180-4 "abc" digest.
    const std::vector<unsigned char> foobar = {'f', 'o', 'o', 'b', 'a', 'r'};
    check("base64Encode", Security::base64Encode(foobar), "Zm9vYmFy");
    const std::vector<unsigned char> decoded = Security::base64Decode("Zm9vYmFy");
    check("base64Decode", std::string(decoded.begin(), decoded.end()), "foobar");
    check("sha256(\"abc\")", hex(Security::sha256("abc")),
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    if (failures != 0) {
        std::cout << failures << " check(s) failed" << std::endl;
        return EXIT_FAILURE;
    }
    std::cout << "all security vectors match" << std::endl;
    return EXIT_SUCCESS;
}
