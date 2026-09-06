# C++ Agent - Messaging Platform SDK

Native C++ client library for the Messaging Platform, providing high-performance communication for games and real-time applications.

## Features

- ✅ **HTTP API**: Reliable message delivery (connect, push, pull, disconnect)
- ✅ **UDP Support**: Fast, low-latency messaging for real-time updates
- ✅ **Cross-Platform**: Linux, Windows, macOS
- ✅ **Modern C++17**: Clean, type-safe API
- ✅ **Security**: Built-in password hashing and channel security
- ✅ **Easy Integration**: Similar API to Java and Python agents
- ❌ **No message encryption**: `Security` derives channel secrets and
  password hashes exactly like the other agents, but has no AES-CTR cipher, so
  this agent cannot send or receive **encrypted** payloads. `send(..., encrypted=true)`
  refuses rather than transmitting plaintext under an "encrypted" flag, and an
  encrypted message from a Java/Python/JS agent arrives as its sealed JSON
  envelope. Tracked as a gap; unencrypted channels work fully.

## Requirements

- CMake 3.15+
- C++17 compatible compiler (GCC 7+, Clang 5+, MSVC 2017+)
- libcurl 7.68+
- OpenSSL 1.1+
- nlohmann/json 3.10+

## Installation

### Ubuntu/Debian

```bash
# Install dependencies
sudo apt-get update
sudo apt-get install -y build-essential cmake libcurl4-openssl-dev libssl-dev nlohmann-json3-dev

# Build and install
cd cpp-agent
mkdir build && cd build
cmake ..
make
sudo make install
```

### Fedora/RHEL

```bash
# Install dependencies
sudo dnf install -y gcc-c++ cmake libcurl-devel openssl-devel json-devel

# Build and install
cd cpp-agent
mkdir build && cd build
cmake ..
make
sudo make install
```

### macOS

```bash
# Install dependencies via Homebrew
brew install cmake curl openssl nlohmann-json

# Build and install
cd cpp-agent
mkdir build && cd build
cmake -DOPENSSL_ROOT_DIR=/usr/local/opt/openssl ..
make
sudo make install
```

### Windows (MSVC)

```cmd
# Install vcpkg and dependencies
vcpkg install curl openssl nlohmann-json

# Build
cd cpp-agent
mkdir build && cd build
cmake .. -DCMAKE_TOOLCHAIN_FILE=[vcpkg root]/scripts/buildsystems/vcpkg.cmake
cmake --build .
cmake --install .
```

## Quick Start

### Basic Example

```cpp
#include "hmdev/messaging/api/messaging_channel_api.h"

using namespace hmdev::messaging;

int main() {
    // Create API instance
    MessagingChannelApi api("http://localhost:8080", "your_api_key");
    
    // Connect to channel
    ConnectResponse resp = api.connect("my-room", "password123", "player-1");
    
    if (resp.success) {
        // Send message
        api.send(EventType::CHAT_TEXT, "Hello!", "*", resp.sessionId, false);
        
        // Receive messages
        ReceiveConfig config;
        config.globalOffset = resp.globalOffset;
        config.localOffset = resp.localOffset;
        config.limit = 10;
        
        EventMessageResult result = api.receive(resp.sessionId, config);
        for (const auto& msg : result.messages) {
            std::cout << msg.from << ": " << msg.content << std::endl;
        }
        
        // Disconnect
        api.disconnect(resp.sessionId);
    }
    
    return 0;
}
```

### Game Integration Example

```cpp
// High-frequency game state updates via UDP
MessagingChannelApi api("http://localhost:8080", "your_api_key");
ConnectResponse resp = api.connect("game-room", "pass", "player-1");

// Send fast updates (UDP - unreliable but fast)
api.udpPush("{\"x\":10.5,\"y\":20.3}", "*", resp.sessionId);

// Send important events (HTTP - reliable)
api.send(EventType::GAME_STATE, "checkpoint", "*", resp.sessionId, false);
```

## Building

### Build Library Only

```bash
mkdir build && cd build
cmake ..
make
```

### Build with Examples

```bash
mkdir build && cd build
cmake -DBUILD_EXAMPLES=ON ..
make
```

### Build as Shared Library

```bash
mkdir build && cd build
cmake -DBUILD_SHARED_LIBS=ON ..
make
```

### Run the tests

```bash
cmake -S . -B build -DBUILD_TESTS=ON
cmake --build build
ctest --test-dir build --output-on-failure
```

`tests/security_vectors_test` checks `deriveChannelSecret` and `hash` against
the vectors every other agent is held to (see `tools/check-cross-language.js`
at the repo root).

### Use from another CMake project

`cmake --install` writes a CMake package, so a consumer needs only:

```cmake
find_package(messaging-cpp-agent CONFIG REQUIRED)
target_link_libraries(my_game PRIVATE hmdev::messaging-cpp-agent)
```

Point `CMAKE_PREFIX_PATH` at the install prefix if it is not a system one.
The package re-finds libcurl, OpenSSL and nlohmann_json, so the consumer needs
the same toolchain/prefix (e.g. the vcpkg toolchain file on Windows). The
headers install under `include/hmdev/messaging/...`, the same paths as in
this tree. `consumer/` is the smallest such project, and
`tools/check-cpp-package.sh` (`.ps1` on Windows with vcpkg) builds, tests,
installs and runs it end to end — run it after touching `CMakeLists.txt`.

## API Reference

### MessagingChannelApi

Main API class for messaging operations.

#### Constructor

```cpp
MessagingChannelApi(const std::string& remoteUrl, 
                   const std::string& developerApiKey = "")
```

#### Methods

| Method | Description |
|--------|-------------|
| `connect()` | Connect to a channel |
| `disconnect()` | Disconnect from channel |
| `send()` | Send message via HTTP (reliable) |
| `receive()` | Receive messages via HTTP |
| `udpPush()` | Send message via UDP (fast) |
| `udpPull()` | Receive messages via UDP |
| `getActiveAgents()` | List agents in channel |
| `getSystemAgents()` | List system agents |

### Data Structures

#### ConnectResponse

```cpp
struct ConnectResponse {
    std::string sessionId;      // Session ID for subsequent calls
    std::string channelId;      // Channel ID
    long long globalOffset;     // Current global offset
    long long localOffset;      // Current local offset
    bool success;               // Connection success flag
};
```

#### EventType

```cpp
enum class EventType {
    CHAT_TEXT,              // Text message
    CHAT_FILE,              // File share
    CHAT_WEBRTC_SIGNAL,     // WebRTC signaling
    GAME_STATE,             // Game state update
    GAME_INPUT,             // Game input event
    GAME_SYNC,              // Game synchronization
    CUSTOM                  // Custom event
};
```

#### ReceiveConfig

```cpp
struct ReceiveConfig {
    long long globalOffset;     // Global message offset
    long long localOffset;      // Local message offset
    int limit;                  // Max messages to retrieve
};
```

## Examples

The `examples/` directory contains:

1. **basic_chat_example.cpp** - Simple chat client
2. **game_integration_example.cpp** - Game state synchronization
3. **udp_example.cpp** - UDP performance testing

Build and run examples:

```bash
cd build
./examples/udp_example https://hmdevonline.com/messaging-platform/api/v1/messaging-service your_api_key
./examples/game_integration_example https://hmdevonline.com/messaging-platform/api/v1/messaging-service your_api_key
./examples/basic_chat_example https://hmdevonline.com/messaging-platform/api/v1/messaging-service your_api_key
```

## Performance

- **HTTP Push/Pull**: ~10-50ms latency, 100% reliable
- **UDP Push/Pull**: ~1-5ms latency, ~95-99% reliable
- **Throughput**: 10,000+ messages/second (UDP)

## Use Cases

### Game Development

- Real-time multiplayer synchronization
- Player chat and communication
- Matchmaking and lobby systems
- Leaderboards and tournaments

### Embedded Systems

- IoT device communication
- Sensor data streaming
- Remote control systems

### High-Performance Applications

- Trading systems
- Monitoring dashboards
- Real-time analytics

## Thread Safety

The API is **not thread-safe** by default. For multi-threaded applications:

1. Use separate `MessagingChannelApi` instances per thread, OR
2. Implement your own synchronization (mutexes)

## Error Handling

All methods return error indicators:
- `connect()` returns `ConnectResponse` with `success` flag
- `send()`, `udpPush()`, `disconnect()` return `bool`
- Check return values and handle failures appropriately

## Environment Variables

- `MESSAGING_UDP_PORT`: Override UDP port (default: 9999)


## Troubleshooting

### Build Errors

**nlohmann/json not found**
```bash
# Install via package manager or download manually
sudo apt-get install nlohmann-json3-dev
```

**libcurl not found**
```bash
sudo apt-get install libcurl4-openssl-dev
```

**`find_package(messaging-cpp-agent)` fails in my project**
The package is written by `cmake --install`; a plain build tree has none.
Install to a prefix and pass it as `-DCMAKE_PREFIX_PATH=<prefix>`.

### Runtime Errors

**Connection refused**
- Check if messaging service is running
- Verify URL and port are correct

**UDP messages not received**
- Check firewall settings
- Verify UDP port 9999 is open
- Use HTTP for critical messages

**"My C++ agent and my Java/Python/JS agent are on the same channel but never
see each other."** Update to a build from 2026-09-03 or later. Before that,
`Security::deriveChannelSecret` and `Security::hash` used their own scheme
(base64 SHA-256 / base64 HMAC), while every other agent uses
PBKDF2-HMAC-SHA256 (salt `messaging-platform`, 100 000 iterations, 32 bytes,
`channel_` + url-safe base64) and a hex HMAC. The service derives the channel
id from the password hash, so the old C++ agent silently landed on a
different channel under the same name. C++ agents built before the fix cannot
share a channel with ones built after it either.

**"`send()` returns false and prints that it cannot encrypt."** This agent has
no cipher (see Features). Send unencrypted, or use the Java, Python or
JavaScript agent for encrypted channels.

## Contributing

Contributions welcome! Please follow the existing code style and add tests for new features.

## License

See LICENSE file in the root directory.

## Resources

- Documentation: See `docs/` directory
- Issues: GitHub issue tracker
- Examples: See `examples/` directory

## Version

**1.0.0** - Initial release (December 2025)

## See Also

- Web Agent
- Python Agent
- Java Agent
