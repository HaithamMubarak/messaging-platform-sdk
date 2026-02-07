# Java Agent Chat Example

Simple text chat example demonstrating Java Agent usage with the Messaging Platform SDK.

## Configuration

This example supports multiple configuration methods (in order of precedence):

1. **Command-line arguments** (highest priority)
2. **`.env` file** in the current project
3. **Environment variables**
4. **Built-in defaults** (lowest priority)

### Using .env File (Recommended)

Create a `.env` file in your project root:

```bash
# Messaging Platform Configuration
MESSAGING_API_URL=https://hmdevonline.com/messaging-platform/api/v1/messaging-service
MESSAGING_API_KEY=your-api-key-here
DEFAULT_API_KEY=your-default-key-here
```

The example will automatically load these values.

### Using Command-Line Arguments

```bash
./gradlew run --args="--url=https://hmdevonline.com/messaging-platform/api/v1/messaging-service --channel=system001 --password=12345678 --agent-name=java-agent001 --api-key=your-api-key"
```

### Using Environment Variables

```bash
export MESSAGING_API_KEY=your-api-key-here
export MESSAGING_API_URL=https://hmdevonline.com/messaging-platform/api/v1/messaging-service
./gradlew run
```

## Running the Example

```bash
cd agents/examples/java-agent-chat
./gradlew run
```

## Getting an API Key

Visit the developer portal to create your API key:
- Production: https://hmdevonline.com/messaging-platform/dashboard
- Local: http://localhost:8084/developer/index.html

## Exit Command

Send `/java-agent:exit` in the chat to gracefully disconnect the agent.
