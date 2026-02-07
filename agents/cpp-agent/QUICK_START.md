# C++ Agent - Quick Start Guide

Get up and running with the C++ agent in 5 minutes.

> **📌 API Configuration Note:**  
> The examples below use the production messaging service: `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`  
> - This is a private messaging service managed by the platform (not publicly exposed for general use)
> - For local development, you can use `http://localhost:8080` if running your own local instance
> - The examples are configured with the production URL by default

## 1. Install Dependencies

### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install -y build-essential cmake libcurl4-openssl-dev libssl-dev nlohmann-json3-dev
```

### macOS
```bash
brew install cmake curl openssl nlohmann-json
```

## 2. Build the Library

```bash
cd cpp-agent
mkdir build && cd build
cmake -DBUILD_EXAMPLES=ON ..
make -j$(nproc)
```

## 3. Run Basic Example

```bash
# Run example with production service
./examples/basic_chat_example https://hmdevonline.com/messaging-platform/api/v1/messaging-service your_api_key test-room password123 player-1

# Or for local development (if you have a local service running)
# ./examples/basic_chat_example http://localhost:8080 your_api_key test-room password123 player-1
```

## 4. Integrate into Your Project

### CMakeLists.txt
```cmake
find_package(messaging-cpp-agent REQUIRED)

add_executable(my_game main.cpp)
target_link_libraries(my_game PRIVATE messaging-cpp-agent)
```

### main.cpp
```cpp
#include "hmdev/messaging/api/messaging_channel_api.h"

using namespace hmdev::messaging;

int main() {
    // Production messaging service URL (or use http://localhost:8080 for local development)
    MessagingChannelApi api("https://hmdevonline.com/messaging-platform/api/v1/messaging-service", "your_api_key");
    
    ConnectResponse resp = api.connect("my-room", "password", "player-1");
    if (resp.success) {
        api.send(EventType::CHAT_TEXT, "Hello from C++!", "*", resp.sessionId, false);
        api.disconnect(resp.sessionId);
    }
    
    return 0;
}
```

## 5. Build Your Project

```bash
mkdir build && cd build
cmake ..
make
./my_game
```

## Next Steps

- Read the [full README](README.md) for detailed API documentation
- Check out [examples](examples/) for more use cases
- See [Game Integration Guide](../../GAME-INTEGRATION-GUIDE.md) for game-specific patterns

## Common Issues

**"nlohmann/json not found"**
```bash
sudo apt-get install nlohmann-json3-dev
```

**"Connection refused"**
- Ensure messaging service is running on port 8080
- Check firewall settings

**"UDP port in use"**
```bash
export MESSAGING_UDP_PORT=9998
```

## API Key

Get your API key from the developer portal or use temporary keys for testing:
```bash
curl -X POST http://localhost:8080/temp-keys \
  -H "X-Api-Key: your_existing_key" \
  -H "Content-Type: application/json"
```

## Support

See [README.md](README.md) for full documentation and troubleshooting.

