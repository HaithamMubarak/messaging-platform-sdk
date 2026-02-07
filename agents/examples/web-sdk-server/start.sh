#!/bin/bash
# Quick start script for Mini Games Server

set -e

echo "🎮 Mini Games Server - Quick Start"
echo "=================================="
echo ""

# Check if MESSAGING_API_KEY is set
if [ -z "$MESSAGING_API_KEY" ]; then
    echo "⚠️  MESSAGING_API_KEY not set"
    echo ""
    echo "For best security, set your API key:"
    echo "  export MESSAGING_API_KEY=your-key-here"
    echo ""
    echo "Continuing without API key (games will try anonymous access)..."
    echo ""
fi

# Check if messaging service is running
echo "📡 Checking messaging service..."
if curl -s -f http://localhost:8080/health > /dev/null 2>&1; then
    echo "✅ Messaging service is running"
else
    echo "❌ Messaging service not found at http://localhost:8080"
    echo ""
    echo "Please ensure the messaging service is running first."
    echo ""
    exit 1
fi

echo ""
echo "🚀 Starting Mini Games Server..."
echo ""

# Run the server
./gradlew bootRun

