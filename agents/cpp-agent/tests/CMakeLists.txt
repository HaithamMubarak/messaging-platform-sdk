# Security vectors shared with the JS, Python and Java agents. No test
# framework: the check is a handful of string comparisons, and a dependency
# here would be one more thing every CI image had to install.
add_executable(security_vectors_test security_vectors_test.cpp)
target_link_libraries(security_vectors_test PRIVATE hmdev::messaging-cpp-agent)
add_test(NAME security_vectors COMMAND security_vectors_test)
