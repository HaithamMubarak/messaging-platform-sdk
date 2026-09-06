// Prints the channel secret for the cross-language test vector, using only
// the installed package's headers and library.
#include "hmdev/messaging/agent/security.h"

#include <iostream>

int main() {
    // 'compat-חדר' / 'test-كلمة' as UTF-8 bytes; see tests/security_vectors_test.cpp.
    std::cout << hmdev::messaging::Security::deriveChannelSecret(
                     "compat-\xd7\x97\xd7\x93\xd7\xa8", "test-\xd9\x83\xd9\x84\xd9\x85\xd8\xa9")
              << std::endl;
    return 0;
}
