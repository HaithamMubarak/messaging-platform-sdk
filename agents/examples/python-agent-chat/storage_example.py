#!/usr/bin/env python3
"""
Channel storage with the Python agent: a key-value store the server keeps per
channel, with versions. Live, against a real server — needs a URL + API key.

It connects, then:
  1. puts an encrypted JSON value and reads it back (the server only sees ciphertext),
  2. adds two versions to an append-only log and lists them, newest first,
  3. shows that a put to the locked log is refused (409),
  4. lists the keys, and deletes the plain key.

RUN:
    python storage_example.py --url <URL> --api-key <KEY>
    (--url / --api-key also read from MESSAGING_API_URL / DEFAULT_API_KEY.)

Each run uses a fresh channel named <prefix>-<time>; delete it afterwards, e.g.
    python scripts/cleanup_channels.py --prefix '^parity-' --yes   (ops repo)

Exit code 0 = PASS, 1 = FAIL.
"""
import argparse
import os
import sys
import time

# Make the python-agent package importable when run directly from the repo.
_HERE = os.path.dirname(os.path.abspath(__file__))
_PY_AGENT = os.path.normpath(os.path.join(_HERE, "..", "..", "python-agent"))
if _PY_AGENT not in sys.path:
    sys.path.insert(0, _PY_AGENT)

from hmdev.messaging.agent.core.agent_connection import AgentConnection
from hmdev.messaging.agent.api.impl.channel_storage import StorageError


def _check(ok: bool, what: str) -> None:
    print(("  ✅ " if ok else "  ❌ ") + what)
    if not ok:
        print("\n  RESULT: ❌ FAIL")
        sys.exit(1)


def _exercise(storage) -> None:
    storage.put("settings", {"theme": "dark", "volume": 7}, encrypted=True)
    entry = storage.get("settings")
    _check(entry is not None and entry.value == {"theme": "dark", "volume": 7} and entry.encrypted,
           "put an encrypted value and read it back: %r" % (entry.value if entry else None))

    first = storage.add("audit", {"event": "opened"}, append_only=True)
    storage.add("audit", {"event": "closed"}, append_only=True)
    log = storage.get_list("audit")
    _check(first.get("appendOnly") is True and [e.value["event"] for e in log] == ["closed", "opened"],
           "append-only log, newest first, written by %s" % (log[0].written_by if log else None))

    try:
        storage.put("audit", "overwrite")
        _check(False, "a put to the append-only log should be refused")
    except StorageError as e:
        _check(e.append_only, "put to the locked log refused: %s" % e)

    _check(sorted(storage.keys()) == ["audit", "settings"], "keys: %s" % storage.keys())
    _check(storage.delete_by_key("settings") == 1 and storage.get("settings") is None,
           "deleted 'settings'; it now reads as None")


def main() -> None:
    p = argparse.ArgumentParser(description="Channel storage with the Python agent")
    p.add_argument("--url", default=os.environ.get("MESSAGING_API_URL",
                   "https://hmdevonline.com/messaging-platform/api/v1/messaging-service"))
    p.add_argument("--api-key", default=os.environ.get("DEFAULT_API_KEY") or os.environ.get("MESSAGING_API_KEY"))
    p.add_argument("--prefix", default="parity-storage-py")
    p.add_argument("--password", default="storage-example-pw")
    args = p.parse_args()
    if not args.api_key:
        print("Need --api-key (or DEFAULT_API_KEY in the environment).")
        sys.exit(1)

    channel = "%s-%d" % (args.prefix, int(time.time()))
    agent = AgentConnection.with_api_key(args.url, args.api_key)
    agent.set_check_last_session(False)
    print("Channel storage example — channel %s" % channel)
    _check(agent.connect(channel_name=channel, channel_password=args.password, agent_name="storage-py"),
           "connected")
    try:
        _exercise(agent.storage)
    finally:
        agent.disconnect()
    print("\n  RESULT: ✅ PASS")


if __name__ == "__main__":
    main()
