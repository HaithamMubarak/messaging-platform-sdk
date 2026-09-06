# A consumer of the INSTALLED package, and nothing else: no add_subdirectory,
# no include paths, no link lines beyond the exported target. If this builds
# and prints the right secret, the package works for a project that has never
# seen this source tree. Driven by tools/check-cpp-package.sh / .ps1.
cmake_minimum_required(VERSION 3.15)
project(messaging-cpp-agent-consumer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(messaging-cpp-agent CONFIG REQUIRED)

add_executable(messaging_consumer main.cpp)
target_link_libraries(messaging_consumer PRIVATE hmdev::messaging-cpp-agent)
