#!/bin/bash
# Build script for C++ agent

set -e

echo "=== Building C++ Messaging Agent ==="

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check dependencies
echo -e "${BLUE}Checking dependencies...${NC}"

check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed${NC}"
        return 1
    else
        echo -e "${GREEN}✓ $1 found${NC}"
        return 0
    fi
}

DEPS_OK=true
check_command cmake || DEPS_OK=false
check_command g++ || check_command clang++ || DEPS_OK=false

# Check for libraries
echo -e "${BLUE}Checking libraries...${NC}"

if pkg-config --exists libcurl; then
    echo -e "${GREEN}✓ libcurl found${NC}"
else
    echo -e "${RED}✗ libcurl not found. Install: sudo apt-get install libcurl4-openssl-dev${NC}"
    DEPS_OK=false
fi

if pkg-config --exists openssl; then
    echo -e "${GREEN}✓ openssl found${NC}"
else
    echo -e "${RED}✗ openssl not found. Install: sudo apt-get install libssl-dev${NC}"
    DEPS_OK=false
fi

if [ "$DEPS_OK" = false ]; then
    echo -e "${RED}Please install missing dependencies and try again${NC}"
    exit 1
fi

# Parse arguments
BUILD_TYPE="Release"
BUILD_EXAMPLES="ON"
BUILD_TESTS="OFF"
CLEAN_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --debug)
            BUILD_TYPE="Debug"
            shift
            ;;
        --no-examples)
            BUILD_EXAMPLES="OFF"
            shift
            ;;
        --with-tests)
            BUILD_TESTS="ON"
            shift
            ;;
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --debug         Build in debug mode"
            echo "  --no-examples   Don't build examples"
            echo "  --with-tests    Build tests"
            echo "  --clean         Clean build directory first"
            echo "  --help          Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Clean if requested
if [ "$CLEAN_BUILD" = true ]; then
    echo -e "${BLUE}Cleaning build directory...${NC}"
    rm -rf build
fi

# Create build directory
echo -e "${BLUE}Creating build directory...${NC}"
mkdir -p build
cd build

# Configure
echo -e "${BLUE}Configuring CMake...${NC}"
cmake .. \
    -DCMAKE_BUILD_TYPE=$BUILD_TYPE \
    -DBUILD_EXAMPLES=$BUILD_EXAMPLES \
    -DBUILD_TESTS=$BUILD_TESTS

# Build
echo -e "${BLUE}Building...${NC}"
cmake --build . -- -j$(nproc)

# Success
echo ""
echo -e "${GREEN}=== Build successful! ===${NC}"
echo ""
echo "Library: build/libmessaging-cpp-agent.so"

if [ "$BUILD_EXAMPLES" = "ON" ]; then
    echo ""
    echo "Examples:"
    echo "  build/examples/basic_chat_example"
    echo "  build/examples/game_integration_example"
    echo "  build/examples/udp_example"
    echo ""
    echo "Run example:"
    echo "  ./build/examples/basic_chat_example https://hmdevonline.com/messaging-platform/api/v1/messaging-service your_api_key"
fi

echo ""
echo "To install system-wide:"
echo "  sudo cmake --install build"
echo ""
