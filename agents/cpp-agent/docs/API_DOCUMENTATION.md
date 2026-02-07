# C++ Agent API Documentation

## Overview

The C++ agent provides a native, high-performance interface to the Messaging Platform. It follows the same design patterns as the Java and Python agents for consistency.

## Architecture

```
cpp-agent/
├── include/hmdev/messaging/
│   ├── agent/
│   │   ├── data_models.h     # Data structures (DTOs)
│   │   └── security.h        # Security utilities
│   ├── api/
│   │   ├── connection_channel_api.h    # Interface
│   │   ├── messaging_channel_api.h     # Implementation
│   │   ├── http_client.h               # HTTP client
│   │   └── udp_client.h                # UDP client
│   └── util/
│       └── utils.h           # Utility functions
├── src/                      # Implementation files
├── examples/                 # Example programs
└── CMakeLists.txt           # Build configuration
```

## Core Components

### 1. MessagingChannelApi

Main API class implementing `ConnectionChannelApi` interface.

**Responsibilities:**
- HTTP/UDP communication
- Message serialization/deserialization
- Session management
- Error handling

### 2. HttpClient

HTTP client using libcurl for RESTful API calls.

**Features:**
- Automatic JSON serialization
- Custom headers support
- Timeout configuration
- Connection pooling

### 3. UdpClient

UDP client for fast, unreliable messaging.

**Features:**
- Fire-and-forget send
- Send-and-wait with timeout
- Binary packet handling
- Automatic socket management

### 4. Security

Security utilities for password hashing and encryption.

**Features:**
- SHA-256 hashing
- HMAC-SHA256
- Base64 encoding/decoding
- Channel secret derivation

### 5. Data Models

C++ structs representing API data structures.

**Key Types:**
- `ConnectRequest` / `ConnectResponse`
- `EventMessage` / `EventMessageResult`
- `AgentInfo`
- `ReceiveConfig`
- `UdpEnvelope`

## API Design Principles

### 1. Type Safety

All data structures are strongly typed with enums and structs:

```cpp
enum class EventType {
    CHAT_TEXT,
    GAME_STATE,
    // ...
};

struct ConnectResponse {
    std::string sessionId;
    bool success;
    // ...
};
```

### 2. Resource Management

Use RAII (Resource Acquisition Is Initialization):

```cpp
MessagingChannelApi api(...);  // Constructor acquires resources
// Use api
// Destructor automatically cleans up
```

### 3. Error Handling

Return error indicators instead of exceptions:

```cpp
ConnectResponse resp = api.connect(...);
if (!resp.success) {
    // Handle error
}
```

### 4. Minimal Dependencies

Only essential dependencies:
- libcurl (HTTP)
- OpenSSL (crypto)
- nlohmann/json (JSON)
- Standard library

## Threading Model

The API is **single-threaded** by default. For multi-threaded applications:

### Option 1: Separate Instances

```cpp
void thread1() {
    MessagingChannelApi api1(...);
    // Use api1
}

void thread2() {
    MessagingChannelApi api2(...);
    // Use api2
}
```

### Option 2: Synchronization

```cpp
class ThreadSafeApi {
    MessagingChannelApi api;
    std::mutex mutex;
    
public:
    bool send(...) {
        std::lock_guard<std::mutex> lock(mutex);
        return api.send(...);
    }
};
```

## Memory Management

### Smart Pointers

Internal resources use `std::unique_ptr`:

```cpp
class MessagingChannelApi {
    std::unique_ptr<HttpClient> httpClient_;
    std::unique_ptr<UdpClient> udpClient_;
};
```

### No Raw Pointers

All APIs use references or values, no raw pointers exposed.

### Exception Safety

- Basic exception safety guaranteed
- Resources cleaned up on exception
- Use RAII throughout

## Performance Considerations

### 1. Connection Reuse

The API reuses HTTP connections (via libcurl):

```cpp
MessagingChannelApi api(...);  // Create once
for (int i = 0; i < 1000; i++) {
    api.send(...);  // Reuses connection
}
```

### 2. UDP for Performance

Use UDP for high-frequency, low-latency messaging:

```cpp
// Game loop (60 FPS)
for (int frame = 0; frame < 3600; frame++) {
    updateGameState();
    api.udpPush(state.toJson(), "*", sessionId);  // <1ms
    std::this_thread::sleep_for(std::chrono::milliseconds(16));
}
```

### 3. Batch Operations

Batch message retrieval:

```cpp
ReceiveConfig config;
config.limit = 100;  // Retrieve up to 100 messages
EventMessageResult result = api.receive(sessionId, config);
```

## Error Handling Patterns

### Connection Errors

```cpp
ConnectResponse resp = api.connect(...);
if (!resp.success) {
    std::cerr << "Connection failed: " << resp.message << std::endl;
    // Retry logic
}
```

### Send Errors

```cpp
if (!api.send(...)) {
    // Log error
    // Queue for retry
}
```

### Network Timeouts

```cpp
// HTTP operations use 40s timeout for long polling
// UDP operations use 3s timeout
EventMessageResult result = api.udpPull(sessionId, config);
if (result.messages.empty()) {
    // Timeout or no messages
}
```

## Integration Patterns

### Pattern 1: Simple Chat

```cpp
MessagingChannelApi api(...);
ConnectResponse resp = api.connect(...);

// Send
api.send(EventType::CHAT_TEXT, "Hello!", "*", resp.sessionId, false);

// Receive
ReceiveConfig config(resp.globalOffset, resp.localOffset, 10);
EventMessageResult result = api.receive(resp.sessionId, config);
```

### Pattern 2: Game Networking

```cpp
// Connect
MessagingChannelApi api(...);
ConnectResponse resp = api.connect(...);

// Game loop
while (running) {
    // Send state (UDP)
    api.udpPush(state.toJson(), "*", resp.sessionId);
    
    // Receive input (HTTP)
    EventMessageResult result = api.receive(resp.sessionId, config);
    
    // Process messages
    for (const auto& msg : result.messages) {
        processInput(msg);
    }
}
```

### Pattern 3: Event-Driven

```cpp
class GameClient {
    MessagingChannelApi api;
    std::string sessionId;
    
    void messageLoop() {
        ReceiveConfig config;
        while (running) {
            auto result = api.receive(sessionId, config);
            for (const auto& msg : result.messages) {
                handleMessage(msg);
            }
            config.globalOffset = result.globalOffset;
            config.localOffset = result.localOffset;
        }
    }
    
    void handleMessage(const EventMessage& msg) {
        switch (msg.type) {
            case EventType::GAME_STATE:
                updateGameState(msg.content);
                break;
            case EventType::CHAT_TEXT:
                displayChat(msg.from, msg.content);
                break;
            // ...
        }
    }
};
```

## Build System Integration

### CMake (Recommended)

```cmake
find_package(messaging-cpp-agent REQUIRED)
target_link_libraries(my_game PRIVATE messaging-cpp-agent)
```

### Manual Linking

```bash
g++ -std=c++17 main.cpp \
    -lmessaging-cpp-agent \
    -lcurl -lssl -lcrypto \
    -o my_game
```

### Static Linking

```cmake
set(BUILD_SHARED_LIBS OFF)
add_subdirectory(cpp-agent)
target_link_libraries(my_game PRIVATE messaging-cpp-agent)
```

## Testing

### Unit Tests

(Future: Add unit tests with Google Test)

```cpp
TEST(MessagingChannelApi, ConnectSuccess) {
    MessagingChannelApi api("http://test", "key");
    auto resp = api.connect("room", "pass", "agent");
    EXPECT_TRUE(resp.success);
}
```

### Integration Tests

Test against live server:

```bash
./build/examples/basic_chat_example https://hmdevonline.com/messaging-platform/api/v1/messaging-service test_key
```

## Future Enhancements

- [ ] Asynchronous API (callbacks/futures)
- [ ] WebSocket support
- [ ] Binary message format (Protocol Buffers)
- [ ] Compression support
- [ ] Automatic reconnection
- [ ] Message queuing
- [ ] WebRTC support

## See Also

- [README.md](../README.md) - User guide
- [QUICK_START.md](../QUICK_START.md) - Quick start guide
- [Examples](../examples/) - Code examples

