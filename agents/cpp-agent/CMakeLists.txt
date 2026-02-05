cmake_minimum_required(VERSION 3.15)
project(messaging-cpp-agent VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Options
option(BUILD_SHARED_LIBS "Build shared libraries" ON)
option(BUILD_EXAMPLES "Build example programs" ON)
option(BUILD_TESTS "Build tests" OFF)

# Find required dependencies
find_package(CURL REQUIRED)
find_package(OpenSSL REQUIRED)

# nlohmann_json - include as header-only or find_package
# For simplicity, we'll expect it to be installed
find_package(nlohmann_json 3.10 REQUIRED)

# Include directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CURL_INCLUDE_DIRS}
    ${OPENSSL_INCLUDE_DIR}
)

# Source files
set(AGENT_SOURCES
    src/data_models.cpp
    src/http_client.cpp
    src/messaging_channel_api.cpp
    src/udp_client.cpp
    src/security.cpp
    src/utils.cpp
)

# Header files (for IDE)
set(AGENT_HEADERS
    include/hmdev/messaging/api/connection_channel_api.h
    include/hmdev/messaging/api/messaging_channel_api.h
    include/hmdev/messaging/api/http_client.h
    include/hmdev/messaging/api/udp_client.h
    include/hmdev/messaging/agent/data_models.h
    include/hmdev/messaging/agent/security.h
    include/hmdev/messaging/util/utils.h
)

# Create library
add_library(messaging-cpp-agent ${AGENT_SOURCES} ${AGENT_HEADERS})

# Link libraries
target_link_libraries(messaging-cpp-agent
    PUBLIC
        CURL::libcurl
        OpenSSL::SSL
        OpenSSL::Crypto
        nlohmann_json::nlohmann_json
    PRIVATE
        pthread
)

# Set library properties
set_target_properties(messaging-cpp-agent PROPERTIES
    VERSION ${PROJECT_VERSION}
    SOVERSION 1
    PUBLIC_HEADER "${AGENT_HEADERS}"
)

# Install rules
include(GNUInstallDirs)

install(TARGETS messaging-cpp-agent
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    PUBLIC_HEADER DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/hmdev/messaging
)

# Build examples
if(BUILD_EXAMPLES)
    add_subdirectory(examples)
endif()

# Build tests
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

