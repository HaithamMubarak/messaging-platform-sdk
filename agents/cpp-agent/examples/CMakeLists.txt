cmake_minimum_required(VERSION 3.15)
)
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}/examples
install(TARGETS basic_chat_example game_integration_example udp_example
# Install examples

target_link_libraries(udp_example PRIVATE messaging-cpp-agent)
add_executable(udp_example udp_example.cpp)
# UDP example

target_link_libraries(game_integration_example PRIVATE messaging-cpp-agent)
add_executable(game_integration_example game_integration_example.cpp)
# Game integration example

target_link_libraries(basic_chat_example PRIVATE messaging-cpp-agent)
add_executable(basic_chat_example basic_chat_example.cpp)
# Basic chat example


