# Python Agent Chat Example

Simple text chat example demonstrating Python Agent usage with the Messaging Platform SDK.

## Quick Start

Use the provided scripts to automatically install dependencies and run the example:

### Windows
```cmd
run-chat.bat
```

### Linux/Mac
```bash
chmod +x run-chat.sh
./run-chat.sh
```

The scripts will:
1. Check Python installation
2. Install all dependencies from `requirements.txt`
3. Launch the chat client

### Custom Connection
```bash
# Windows
run-chat.bat --channel my-channel --password mypass123

# Linux/Mac
./run-chat.sh --channel my-channel --password mypass123 --agent-name "MyBot"
```

## Configuration

This example supports multiple configuration methods (in order of precedence):

1. **Command-line arguments** (highest priority)
2. **`.env` file** in the services repository (`../../messaging-platform-services/.env`)
3. **`.env` file** in the current project
4. **Environment variables**
5. **Built-in defaults** (lowest priority)

### Using .env File (Recommended)

Create a `.env` file in your services repository or project root:

```bash
# Messaging Platform Configuration
MESSAGING_API_URL=https://hmdevonline.com/messaging-platform/api/v1/messaging-service
MESSAGING_API_KEY=your-api-key-here
DEFAULT_API_KEY=your-default-key-here
```

The example will automatically load these values.

### Using Command-Line Arguments

```bash
python chat_example.py \
  --url https://hmdevonline.com/messaging-platform/api/v1/messaging-service \
  --channel system001 \
  --password 12345678 \
  --agent-name python-agent001 \
  --api-key your-api-key
```

### Using Environment Variables

```bash
export MESSAGING_API_KEY=your-api-key-here
export MESSAGING_API_URL=https://hmdevonline.com/messaging-platform/api/v1/messaging-service
python chat_example.py
```

## Running the Example

### Using Scripts (Recommended)
```bash
# Windows
run-chat.bat

# Linux/Mac
./run-chat.sh
```

### Manual Method
```bash
cd agents/examples/python-agent-chat
pip install -r requirements.txt
python chat_example.py
```

## Getting an API Key

Visit the developer portal to create your API key:
- Production: https://hmdevonline.com/messaging-platform/dashboard
- Local: http://localhost:8084/developer/index.html

## Exit Command

Send `/python-agent:exit` in the chat to gracefully disconnect the agent.

## Requirements

```bash
pip install -r requirements.txt
```

Or if you've installed the SDK as a package:

```bash
pip install hmdev-messaging-agent
```
