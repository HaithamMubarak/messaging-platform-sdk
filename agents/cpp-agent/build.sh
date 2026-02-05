#!/bin/bash
echo ""
echo "  sudo cmake --install build"
echo "To install system-wide:"
echo ""

fi
    echo "  ./build/examples/basic_chat_example http://localhost:8080 your_api_key"
    echo "Run example:"
    echo ""
    echo "  build/examples/udp_example"
    echo "  build/examples/game_integration_example"
    echo "  build/examples/basic_chat_example"
    echo "Examples:"
    echo ""
if [ "$BUILD_EXAMPLES" = "ON" ]; then

echo "Library: build/libmessaging-cpp-agent.so"
echo ""
echo -e "${GREEN}=== Build successful! ===${NC}"
echo ""
# Success

cmake --build . -- -j$(nproc)
echo -e "${BLUE}Building...${NC}"
# Build

    -DBUILD_TESTS=$BUILD_TESTS
    -DBUILD_EXAMPLES=$BUILD_EXAMPLES \
    -DCMAKE_BUILD_TYPE=$BUILD_TYPE \
cmake .. \
echo -e "${BLUE}Configuring CMake...${NC}"
# Configure

cd build
mkdir -p build
echo -e "${BLUE}Creating build directory...${NC}"
# Create build directory

fi
    rm -rf build
    echo -e "${BLUE}Cleaning build directory...${NC}"
if [ "$CLEAN_BUILD" = true ]; then
# Clean if requested

done
    esac
            ;;
            exit 1
            echo "Use --help for usage information"
            echo "Unknown option: $1"
        *)
            ;;
            exit 0
            echo "  --help          Show this help"
            echo "  --clean         Clean build directory first"
            echo "  --with-tests    Build tests"
            echo "  --no-examples   Don't build examples"
            echo "  --debug         Build in debug mode"
            echo "Options:"
            echo ""
            echo "Usage: $0 [OPTIONS]"
        --help)
            ;;
            shift
            CLEAN_BUILD=true
        --clean)
            ;;
            shift
            BUILD_TESTS="ON"
        --with-tests)
            ;;
            shift
            BUILD_EXAMPLES="OFF"
        --no-examples)
            ;;
            shift
            BUILD_TYPE="Debug"
        --debug)
    case $1 in
while [[ $# -gt 0 ]]; do

CLEAN_BUILD=false
BUILD_TESTS="OFF"
BUILD_EXAMPLES="ON"
BUILD_TYPE="Release"
# Parse arguments

fi
    exit 1
    echo -e "${RED}Please install missing dependencies and try again${NC}"
if [ "$DEPS_OK" = false ]; then

fi
    DEPS_OK=false
    echo -e "${RED}✗ openssl not found. Install: sudo apt-get install libssl-dev${NC}"
else
    echo -e "${GREEN}✓ openssl found${NC}"
if pkg-config --exists openssl; then

fi
    DEPS_OK=false
    echo -e "${RED}✗ libcurl not found. Install: sudo apt-get install libcurl4-openssl-dev${NC}"
else
    echo -e "${GREEN}✓ libcurl found${NC}"
if pkg-config --exists libcurl; then

echo -e "${BLUE}Checking libraries...${NC}"
# Check for libraries

check_command g++ || check_command clang++ || DEPS_OK=false
check_command cmake || DEPS_OK=false
DEPS_OK=true

}
    fi
        return 0
        echo -e "${GREEN}✓ $1 found${NC}"
    else
        return 1
        echo -e "${RED}Error: $1 is not installed${NC}"
    if ! command -v $1 &> /dev/null; then
check_command() {

echo -e "${BLUE}Checking dependencies...${NC}"
# Check dependencies

NC='\033[0m' # No Color
RED='\033[0;31m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
# Colors

echo "=== Building C++ Messaging Agent ==="

set -e

# Build script for C++ agent

