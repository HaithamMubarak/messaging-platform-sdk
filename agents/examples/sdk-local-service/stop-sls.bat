@echo off
REM ============================================================================
REM SDK Local Service (SLS) Stop Script
REM ============================================================================
REM This script stops the SDK Local Service running on port 8088
REM ============================================================================

echo.
echo ========================================
echo SDK Local Service (SLS)
echo ========================================
echo Stopping service on port 8088...
echo.

REM Find process using port 8088
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8088 ^| findstr LISTENING') do (
    set PID=%%a
    goto :found
)

echo No process found on port 8088
pause
exit /b 0

:found
echo Found process with PID: %PID%
echo Terminating process...

taskkill /F /PID %PID%

if %errorlevel% == 0 (
    echo.
    echo ✓ Service stopped successfully
) else (
    echo.
    echo ✗ Failed to stop service
)

echo.
pause
