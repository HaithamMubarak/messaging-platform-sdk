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

# Source files
set(AGENT_SOURCES
    src/data_models.cpp
    src/http_client.cpp
    src/messaging_channel_api.cpp
    src/webrtc_signaling.cpp
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
    include/hmdev/messaging/webrtc/webrtc_signaling.h
)

# Create library. Consumers link hmdev::messaging-cpp-agent, whether they
# add_subdirectory() this tree or find_package() an installed copy.
add_library(messaging-cpp-agent ${AGENT_SOURCES} ${AGENT_HEADERS})
add_library(hmdev::messaging-cpp-agent ALIAS messaging-cpp-agent)

include(GNUInstallDirs)

# Headers are found under include/ in the source tree and under the install
# prefix once installed; the imported CURL/OpenSSL/json targets carry their own.
target_include_directories(messaging-cpp-agent PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)

# Link libraries
target_link_libraries(messaging-cpp-agent
    PUBLIC
        CURL::libcurl
        OpenSSL::SSL
        OpenSSL::Crypto
        nlohmann_json::nlohmann_json
)

# Threading: portable. pthread is POSIX-only; Windows threading is built in.
find_package(Threads REQUIRED)
target_link_libraries(messaging-cpp-agent PRIVATE Threads::Threads)

# Set library properties
set_target_properties(messaging-cpp-agent PROPERTIES
    VERSION ${PROJECT_VERSION}
    SOVERSION 1
    EXPORT_NAME messaging-cpp-agent
    # On Windows a shared lib only emits a .lib import library if symbols are
    # exported; export them all so consumers (the examples) can link the DLL.
    WINDOWS_EXPORT_ALL_SYMBOLS ON
)

# Install rules
#
# The headers are installed as a directory so `#include
# "hmdev/messaging/api/messaging_channel_api.h"` resolves exactly as it does
# in the source tree. (PUBLIC_HEADER flattened every header into one folder,
# which broke every include in the installed copy and silently dropped
# webrtc/webrtc_signaling.h, which was never in the list.)
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

install(TARGETS messaging-cpp-agent
    EXPORT messaging-cpp-agentTargets
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)

# The package a consumer's find_package(messaging-cpp-agent CONFIG) loads:
# exported targets, the dependencies they need re-found, and a version file.
# tools/check-cpp-package.sh proves it works from a clean prefix.
include(CMakePackageConfigHelpers)
set(PACKAGE_CMAKE_DIR ${CMAKE_INSTALL_LIBDIR}/cmake/messaging-cpp-agent)

install(EXPORT messaging-cpp-agentTargets
    NAMESPACE hmdev::
    DESTINATION ${PACKAGE_CMAKE_DIR}
)

configure_package_config_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/cmake/messaging-cpp-agentConfig.cmake.in
    ${CMAKE_CURRENT_BINARY_DIR}/messaging-cpp-agentConfig.cmake
    INSTALL_DESTINATION ${PACKAGE_CMAKE_DIR}
)

write_basic_package_version_file(
    ${CMAKE_CURRENT_BINARY_DIR}/messaging-cpp-agentConfigVersion.cmake
    VERSION ${PROJECT_VERSION}
    COMPATIBILITY SameMajorVersion
)

install(FILES
    ${CMAKE_CURRENT_BINARY_DIR}/messaging-cpp-agentConfig.cmake
    ${CMAKE_CURRENT_BINARY_DIR}/messaging-cpp-agentConfigVersion.cmake
    DESTINATION ${PACKAGE_CMAKE_DIR}
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
