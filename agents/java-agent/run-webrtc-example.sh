#!/bin/bash
# Quick Start Script for WebRTC Video Receiver Example
# This script runs the complete Java example for receiving WebRTC video

echo "========================================"
echo "WebRTC Video Receiver - Quick Start"
echo "========================================"
echo ""

# Check if we're in the right directory
if [ ! -f "build.gradle" ]; then
    echo "[ERROR] Must run from agents/java-agent directory"
    echo ""
    echo "Usage:"
    echo "  cd sdk/agents/java-agent"
    echo "  ./run-webrtc-example.sh"
    exit 1
fi

echo "Starting WebRTC Video Receiver Example..."
echo ""
echo "Instructions:"
echo "1. This will start the Java video receiver"
echo "2. Open webrtc-video-sender.html in your browser"
echo "3. Connect to channel: demo-webrtc"
echo "4. Start camera and stream to: java-video-receiver"
echo ""
echo "Press Ctrl+C to stop"
echo "========================================"
echo ""
echo "[DEBUG MODE ENABLED]"
echo "- JVM Debug Port: 5005 (remote debugging enabled)"
echo "- SLF4J Log Level: DEBUG"
echo "- GStreamer Debug: Enabled"
echo ""

# Run the example with DEBUG mode enabled
# Debug options:
#   -Dorg.slf4j.simpleLogger.defaultLogLevel=debug  - Enable DEBUG logging
#   -Dorg.slf4j.simpleLogger.showDateTime=true      - Show timestamps
#   -Dorg.slf4j.simpleLogger.dateTimeFormat=HH:mm:ss.SSS - Time format
#   -agentlib:jdwp=...                              - Enable remote debugging on port 5005
../../gradlew run -PmainClass=com.hmdev.messaging.agent.examples.WebRtcReceiverComplete \
    -Dorg.gradle.jvmargs="-Dorg.slf4j.simpleLogger.defaultLogLevel=debug -Dorg.slf4j.simpleLogger.showDateTime=true -Dorg.slf4j.simpleLogger.dateTimeFormat=HH:mm:ss.SSS -Dorg.slf4j.simpleLogger.showThreadName=true -Dorg.slf4j.simpleLogger.showLogName=true -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005"
