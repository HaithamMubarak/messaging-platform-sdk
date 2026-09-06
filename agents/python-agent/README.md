# Messaging Platform Python agent

Python 3.10 or newer is required (the runtime uses Python 3.10 union annotations).
The package includes the channel API, HTTP/WebSocket/UDP helpers, cryptographic
helpers and a local TCP-control entry point.

From this directory, install into a virtual environment with `python -m pip
install .`. Run `hmdev-agent --help` for the TCP-only command's options. This
command is not a complete chat client; the example is `python -m hmdev.chat_example
--help`. No production connection is needed to print help.

## Release verification

From the repository root run `python tools/check-python-package.py`. It builds
the source archive and a wheel from that archive, then installs each into its
own temporary environment outside the checkout. It verifies module imports,
declared dependencies, the CLI and authenticated-encryption round trips. The
check downloads build/runtime dependencies and cleans up its own environments.
It does not publish a package or contact a messaging service.

Both `requirements.txt` and this README are mandatory source-archive inputs.
An incomplete archive must fail to build instead of producing a wheel with
silently missing dependencies. CI checks Python 3.10 and 3.12 on Linux and Windows.
Cross-language protocol and real-network tests are separate release gates.
