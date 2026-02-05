@echo off
REM Run Python Agent Chat Example
REM This script installs dependencies and runs the chat example

echo ========================================
echo Python Agent Chat Example
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.7+ from https://www.python.org/
    pause
    exit /b 1
)

echo [1/2] Installing dependencies...
echo.
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo [2/2] Starting Python Agent Chat...
echo.
echo Usage: Run with default settings or pass arguments:
echo   --url           Messaging API URL
echo   --channel       Channel name (default: system001)
echo   --password      Channel password (default: 12345678)
echo   --agent-name    Agent display name
echo   --api-key       Developer API key
echo.
echo Press Ctrl+C to exit
echo.

python chat_example.py %*

pause
