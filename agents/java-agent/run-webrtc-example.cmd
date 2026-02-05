@echo off
REM Quick Start Script for WebRTC Video Receiver Example
REM This script runs the complete Java example for receiving WebRTC video

echo ========================================
echo WebRTC Video Receiver - Quick Start
echo ========================================
echo.

REM Check if we're in the right directory
if not exist "build.gradle" (
    echo [ERROR] Must run from agents\java-agent directory
    echo.
    echo Usage:
    echo   cd agents\java-agent
    echo   run-webrtc-example.cmd
    pause
    exit /b 1
)

echo Starting WebRTC Video Receiver Example...
echo.
echo Instructions:
echo 1. This will start the Java video receiver
echo 2. Open webrtc-video-sender.html in your browser
echo 3. Connect to channel: demo-webrtc
echo 4. Start camera and stream to: java-video-receiver
echo.
echo Press Ctrl+C to stop
echo ========================================
echo.
echo [DEBUG MODE ENABLED]
echo - JVM Debug Port: 5005 (remote debugging enabled)
echo - SLF4J Log Level: DEBUG
echo - GStreamer Debug: Enabled
echo.

REM Set GStreamer paths (if installed)
if exist "C:\gstreamer\1.0\msvc_x86_64\bin" (
    echo [INFO] GStreamer found, adding to PATH
    set PATH=C:\gstreamer\1.0\msvc_x86_64\bin;%PATH%
    set GST_PLUGIN_PATH=C:\gstreamer\1.0\msvc_x86_64\lib\gstreamer-1.0
    set GSTREAMER_1_0_ROOT_MSVC_X86_64=C:\gstreamer\1.0\msvc_x86_64

    REM Test GStreamer
    echo [INFO] Testing GStreamer installation...
    gst-launch-1.0 --version 2>nul
    if errorlevel 1 (
        echo [WARN] GStreamer in PATH but not working correctly
    ) else (
        echo [INFO] GStreamer is working correctly
    )
    echo.
) else (
    echo [WARN] GStreamer not found at C:\gstreamer\1.0\msvc_x86_64
    echo [WARN] Will run in signaling-only mode
    echo [INFO] See: GSTREAMER_WINDOWS_INSTALL.md for installation
    echo.
)

REM Run the example with DEBUG mode enabled
REM Debug options:
REM   -Dorg.slf4j.simpleLogger.defaultLogLevel=debug  - Enable DEBUG logging
REM   -Dorg.slf4j.simpleLogger.showDateTime=true      - Show timestamps
REM   -Dorg.slf4j.simpleLogger.dateTimeFormat=HH:mm:ss.SSS - Time format
REM   -agentlib:jdwp=...                              - Enable remote debugging on port 5005
call ..\..\gradlew.bat run -PmainClass=com.hmdev.messaging.agent.examples.WebRtcReceiverComplete ^
    -Dorg.gradle.jvmargs="-Dorg.slf4j.simpleLogger.defaultLogLevel=debug -Dorg.slf4j.simpleLogger.showDateTime=true -Dorg.slf4j.simpleLogger.dateTimeFormat=HH:mm:ss.SSS -Dorg.slf4j.simpleLogger.showThreadName=true -Dorg.slf4j.simpleLogger.showLogName=true -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005"

pause

