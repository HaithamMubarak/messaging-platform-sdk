cmake_minimum_required(VERSION 3.15)

# Basic chat example
add_executable(basic_chat_example basic_chat_example.cpp)
target_link_libraries(basic_chat_example PRIVATE messaging-cpp-agent)

# Game integration example
add_executable(game_integration_example game_integration_example.cpp)
target_link_libraries(game_integration_example PRIVATE messaging-cpp-agent)

# UDP example
add_executable(udp_example udp_example.cpp)
target_link_libraries(udp_example PRIVATE messaging-cpp-agent)

# WebRTC DataChannel test — pairs the SDK's WebRtcSignaling (pure signaling,
# no engine dependency) with a real libdatachannel PeerConnection. Optional:
# only built if libdatachannel is found, since it's a heavy third-party
# dependency the rest of the SDK doesn't need. Point CMake at an install of
# https://github.com/paullouisageneau/libdatachannel (built with
# -DUSE_GNUTLS=0 -DNO_MEDIA=1 -DNO_WEBSOCKET=1) via
# -DCMAKE_PREFIX_PATH=/path/to/libdatachannel/install, or -DLibDataChannel_DIR=...
find_package(LibDataChannel QUIET CONFIG)
if(LibDataChannel_FOUND)
    add_executable(webrtc_datachannel_test webrtc_datachannel_test.cpp)
    target_link_libraries(webrtc_datachannel_test PRIVATE messaging-cpp-agent LibDataChannel::LibDataChannel)
    install(TARGETS webrtc_datachannel_test RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}/examples)
else()
    message(STATUS "LibDataChannel not found — skipping webrtc_datachannel_test (see examples/CMakeLists.txt)")
endif()

# Install examples
install(TARGETS basic_chat_example game_integration_example udp_example
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}/examples
)
