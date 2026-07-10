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

# Install examples
install(TARGETS basic_chat_example game_integration_example udp_example
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}/examples
)
