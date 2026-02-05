@echo off
REM Build and Test Mini-Games Server with Babyfoot
REM Run this from the mini-games-server directory

echo ========================================
echo Building Mini-Games Server with Babyfoot
echo ========================================
echo.

REM Navigate to mini-games-server directory
cd /d "%~dp0"

echo [1/4] Cleaning previous build...
call gradlew clean
if errorlevel 1 (
    echo ERROR: Clean failed
    exit /b 1
)
echo.

echo [2/4] Copying resources from web-agent...
call gradlew copyWebAgentResources copyMiniGames
if errorlevel 1 (
    echo ERROR: Copy tasks failed
    exit /b 1
)
echo.

echo [3/4] Building project...
call gradlew build
if errorlevel 1 (
    echo ERROR: Build failed
    exit /b 1
)
echo.

echo [4/4] Verifying babyfoot files...
if exist "src\main\resources\generated\mini-games\babyfoot\index.html" (
    echo ✅ Babyfoot game files copied successfully
) else (
    echo ❌ ERROR: Babyfoot files not found!
    exit /b 1
)
echo.

echo ========================================
echo Build Complete!
echo ========================================
echo.
echo To run the server:
echo   gradlew bootRun
echo.
echo Or run the JAR:
echo   java -jar build\libs\mini-games-server.jar
echo.
echo Then navigate to:
echo   http://localhost:8080/
echo.
echo Games available:
echo   - Reaction Speed Battle
echo   - Quiz Battle
echo   - Real-Time Whiteboard
echo   - Babyfoot (NEW!)
echo.

pause

