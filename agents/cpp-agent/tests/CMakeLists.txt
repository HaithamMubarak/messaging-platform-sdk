# Security vectors shared with the JS, Python and Java agents. No test
# framework: the check is a handful of string comparisons, and a dependency
# here would be one more thing every CI image had to install.
add_executable(security_vectors_test security_vectors_test.cpp)
target_link_libraries(security_vectors_test PRIVATE hmdev::messaging-cpp-agent)
add_test(NAME security_vectors COMMAND security_vectors_test)

# Managed channels: agentKey is sent when set, absent otherwise, and never
# appears in the CPPAGENT_DEBUG dump. A local socket stands in for the service.
add_executable(managed_connect_test managed_connect_test.cpp)
target_link_libraries(managed_connect_test PRIVATE hmdev::messaging-cpp-agent)
if(WIN32)
    target_link_libraries(managed_connect_test PRIVATE ws2_32)
endif()
add_test(NAME managed_connect COMMAND managed_connect_test)
