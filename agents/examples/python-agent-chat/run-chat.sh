#!/bin/bash
# Run Python Agent Chat Example
# This script installs dependencies and runs the chat example

echo "========================================"
echo "Python Agent Chat Example"
echo "========================================"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo "ERROR: Python is not installed or not in PATH"
        echo "Please install Python 3.7+ from https://www.python.org/"
        exit 1
    fi
    PYTHON_CMD="python"
else
    PYTHON_CMD="python3"
fi

echo "[1/2] Installing dependencies..."
echo ""
$PYTHON_CMD -m pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo ""
    echo "ERROR: Failed to install dependencies"
    exit 1
fi

echo ""
echo "[2/2] Starting Python Agent Chat..."
echo ""
echo "Usage: Run with default settings or pass arguments:"
echo "  --url           Messaging API URL"
echo "  --channel       Channel name (default: system001)"
echo "  --password      Channel password (default: 12345678)"
echo "  --agent-name    Agent display name"
echo "  --api-key       Developer API key"
echo ""
echo "Press Ctrl+C to exit"
echo ""

$PYTHON_CMD chat_example.py "$@"
