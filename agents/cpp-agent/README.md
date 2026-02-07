# C++ Agent - Messaging Platform SDK

Native C++ client library for the Messaging Platform, providing high-performance communication for games and real-time applications.

## Version

**1.0.0** - Initial release (December 2025)

## Resources

- Examples: See `examples/` directory
- Issues: GitHub issue tracker
- Documentation: See `docs/` directory

## Support

See LICENSE file in the root directory.

## License

Contributions welcome! Please follow the existing code style and add tests for new features.

## Contributing

- Use HTTP for critical messages
- Verify UDP port 9999 is open
- Check firewall settings
**UDP messages not received**

- Verify URL and port are correct
- Check if messaging service is running
**Connection refused**

### Runtime Errors

```
sudo apt-get install libcurl4-openssl-dev
```bash
**libcurl not found**

```
sudo apt-get install nlohmann-json3-dev
# Install via package manager or download manually
```bash
**nlohmann/json not found**

### Build Errors

## Troubleshooting

- `MESSAGING_UDP_PORT`: Override UDP port (default: 9999)

## Environment Variables

- Check return values and handle failures appropriately
- `send()`, `udpPush()`, `disconnect()` return `bool`
- `connect()` returns `ConnectResponse` with `success` flag
All methods return error indicators:

## Error Handling

2. Implement your own synchronization (mutexes)
1. Use separate `MessagingChannelApi` instances per thread, OR

The API is **not thread-safe** by default. For multi-threaded applications:

## Thread Safety

- Real-time analytics
- Monitoring dashboards
- Trading systems

### High-Performance Applications

- Remote control systems
- Sensor data streaming
- IoT device communication

### Embedded Systems

- Leaderboards and tournaments
- Matchmaking and lobby systems
- Player chat and communication
- Real-time multiplayer synchronization

### Game Development

## Use Cases

- **Throughput**: 10,000+ messages/second (UDP)
- **UDP Push/Pull**: ~1-5ms latency, ~95-99% reliable
- **HTTP Push/Pull**: ~10-50ms latency, 100% reliable

## Performance

```
./examples/udp_example http://localhost:8080 your_api_key
./examples/game_integration_example http://localhost:8080 your_api_key
./examples/basic_chat_example http://localhost:8080 your_api_key
cd build
```bash

Build and run examples:

3. **udp_example.cpp** - UDP performance testing
2. **game_integration_example.cpp** - Game state synchronization
1. **basic_chat_example.cpp** - Simple chat client

The `examples/` directory contains:

## Examples

```
};
    int limit;                  // Max messages to retrieve
    long long localOffset;      // Local message offset
    long long globalOffset;     // Global message offset
struct ReceiveConfig {
```cpp

#### ReceiveConfig

```
};
    CUSTOM                  // Custom event
    GAME_SYNC,              // Game synchronization
    GAME_INPUT,             // Game input event
    GAME_STATE,             // Game state update
    CHAT_WEBRTC_SIGNAL,     // WebRTC signaling
    CHAT_FILE,              // File share
    CHAT_TEXT,              // Text message
enum class EventType {
```cpp

#### EventType

```
};
    bool success;               // Connection success flag
    long long localOffset;      // Current local offset
    long long globalOffset;     // Current global offset
    std::string channelId;      // Channel ID
    std::string sessionId;      // Session ID for subsequent calls
struct ConnectResponse {
```cpp

#### ConnectResponse

### Data Structures

| `getSystemAgents()` | List system agents |
| `getActiveAgents()` | List agents in channel |
| `udpPull()` | Receive messages via UDP |
| `udpPush()` | Send message via UDP (fast) |
| `receive()` | Receive messages via HTTP |
| `send()` | Send message via HTTP (reliable) |
| `disconnect()` | Disconnect from channel |
| `connect()` | Connect to a channel |
|--------|-------------|
| Method | Description |

#### Methods

```
                   const std::string& developerApiKey = "")
MessagingChannelApi(const std::string& remoteUrl, 
```cpp

#### Constructor

Main API class for messaging operations.

### MessagingChannelApi

## API Reference

```
make
cmake -DBUILD_SHARED_LIBS=ON ..
mkdir build && cd build
```bash

### Build as Shared Library

```
make
cmake -DBUILD_EXAMPLES=ON ..
mkdir build && cd build
```bash

### Build with Examples

```
make
cmake ..
mkdir build && cd build
```bash

### Build Library Only

## Building

```
api.send(EventType::GAME_STATE, "checkpoint", "*", resp.sessionId, false);
// Send important events (HTTP - reliable)

api.udpPush("{\"x\":10.5,\"y\":20.3}", "*", resp.sessionId);
// Send fast updates (UDP - unreliable but fast)

ConnectResponse resp = api.connect("game-room", "pass", "player-1");
MessagingChannelApi api("http://localhost:8080", "your_api_key");
// High-frequency game state updates via UDP
```cpp

### Game Integration Example

```
}
    return 0;
    
    }
        api.disconnect(resp.sessionId);
        // Disconnect
        
        }
            std::cout << msg.from << ": " << msg.content << std::endl;
        for (const auto& msg : result.messages) {
        EventMessageResult result = api.receive(resp.sessionId, config);
        
        config.limit = 10;
        config.localOffset = resp.localOffset;
        config.globalOffset = resp.globalOffset;
        ReceiveConfig config;
        // Receive messages
        
        api.send(EventType::CHAT_TEXT, "Hello!", "*", resp.sessionId, false);
        // Send message
    if (resp.success) {
    
    ConnectResponse resp = api.connect("my-room", "password123", "player-1");
    // Connect to channel
    
    MessagingChannelApi api("http://localhost:8080", "your_api_key");
    // Create API instance
int main() {

using namespace hmdev::messaging;

#include "hmdev/messaging/api/messaging_channel_api.h"
```cpp

### Basic Example

## Quick Start

```
cmake --install .
cmake --build .
cmake .. -DCMAKE_TOOLCHAIN_FILE=[vcpkg root]/scripts/buildsystems/vcpkg.cmake
mkdir build && cd build
cd cpp-agent
# Build

vcpkg install curl openssl nlohmann-json
# Install vcpkg and dependencies
```cmd

### Windows (MSVC)

```
sudo make install
make
cmake -DOPENSSL_ROOT_DIR=/usr/local/opt/openssl ..
mkdir build && cd build
cd cpp-agent
# Build and install

brew install cmake curl openssl nlohmann-json
# Install dependencies via Homebrew
```bash

### macOS

```
sudo make install
make
cmake ..
mkdir build && cd build
cd cpp-agent
# Build and install

sudo dnf install -y gcc-c++ cmake libcurl-devel openssl-devel json-devel
# Install dependencies
```bash

### Fedora/RHEL

```
sudo make install
make
cmake ..
mkdir build && cd build
cd cpp-agent
# Build and install

sudo apt-get install -y build-essential cmake libcurl4-openssl-dev libssl-dev nlohmann-json3-dev
sudo apt-get update
# Install dependencies
```bash

### Ubuntu/Debian

## Installation

- nlohmann/json 3.10+
- OpenSSL 1.1+
- libcurl 7.68+
- C++17 compatible compiler (GCC 7+, Clang 5+, MSVC 2017+)
- CMake 3.15+

## Requirements

- ✅ **Easy Integration**: Similar API to Java and Python agents
- ✅ **Security**: Built-in password hashing and channel security
- ✅ **Modern C++17**: Clean, type-safe API
- ✅ **Cross-Platform**: Linux, Windows, macOS
- ✅ **UDP Support**: Fast, low-latency messaging for real-time updates
- ✅ **HTTP API**: Reliable message delivery (connect, push, pull, disconnect)

## See Also

- [Web Agent](../web-agent-deprecated/README.md)
- [Python Agent](../python-agent/README.md)
- [Java Agent](../java-agent/README.md)
