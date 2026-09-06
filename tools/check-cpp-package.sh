#!/usr/bin/env bash
# Build the C++ agent, run its tests, install it to a throwaway prefix, then
# build a consumer that knows only find_package() against that prefix.
#
# Extra arguments are passed to both cmake configures (a vcpkg toolchain, say).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
AGENT="$ROOT/agents/cpp-agent"
# The secret the consumer must print; see agents/cpp-agent/tests/security_vectors_test.cpp.
EXPECTED_SECRET="channel_Ck3KugJN7TGNR7R5wy5fhW7cB0K6b90sGaJJdonFK6A"

WORK=$(mktemp -d -t hmdev-cpp-release-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

cmake -S "$AGENT" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=ON -DBUILD_EXAMPLES=OFF "$@"
cmake --build "$WORK/build" --config Release
ctest --test-dir "$WORK/build" -C Release --output-on-failure
cmake --install "$WORK/build" --config Release --prefix "$WORK/prefix"

test -f "$WORK/prefix/include/hmdev/messaging/webrtc/webrtc_signaling.h" \
    || { echo "installed headers lost their directory layout"; exit 1; }

cmake -S "$AGENT/consumer" -B "$WORK/consumer" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH="$WORK/prefix" "$@"
cmake --build "$WORK/consumer" --config Release

# The shared library lives in the prefix, which no loader knows about yet.
ACTUAL=$(LD_LIBRARY_PATH="$WORK/prefix/lib:${LD_LIBRARY_PATH:-}" \
         DYLD_LIBRARY_PATH="$WORK/prefix/lib:${DYLD_LIBRARY_PATH:-}" \
         "$WORK/consumer/messaging_consumer")
if [ "$ACTUAL" != "$EXPECTED_SECRET" ]; then
    echo "consumer printed '$ACTUAL', expected '$EXPECTED_SECRET'"
    exit 1
fi
echo "CPP PACKAGE CHECK PASSED: build, ctest, install and find_package consumer printed $ACTUAL"
