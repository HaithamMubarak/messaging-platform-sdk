@echo off
REM ============================================================================
REM SDK Local Service (SLS) Startup Script
REM ============================================================================
REM This script starts the SDK Local Service on port 8088
REM The service provides:
REM   - Local command execution
REM   - SSH connection management
REM   - Terminal session management
REM   - TCP packet forwarding
REM ============================================================================

echo.
echo ========================================
echo SDK Local Service (SLS)
echo ========================================
echo Starting on port 8088...
echo.

cd /d "%~dp0"

REM Check if port 8088 is already in use
netstat -ano | findstr :8088 > nul
if %errorlevel% == 0 (
    echo WARNING: Port 8088 is already in use!
    echo Please stop the existing service first.
    pause
    exit /b 1
)

REM Start the service
java -jar build\libs\sdk-local-service.jar

pause
