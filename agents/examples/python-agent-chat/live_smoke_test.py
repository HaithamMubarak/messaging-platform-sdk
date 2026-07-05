#!/usr/bin/env python3
"""
Live two-agent messaging smoke test for the Python agent SDK.

Verifies end-to-end that nothing is broken: two independent agents connect to a
fixed channel, discover each other, and a message sent by one is received by the
other (both directions). No WebRTC. Real server — needs a URL + API key.

RUN:
    python live_smoke_test.py --url <URL> --api-key <KEY>
    (--url / --api-key also read from MESSAGING_API_URL / DEFAULT_API_KEY env.)

Exit code 0 = PASS, 1 = FAIL. Prints a clear banner either way.
"""
import argparse
import os
import sys
import threading
import time
from typing import Any, Dict, List

# Make the python-agent package importable when run directly from the repo.
_HERE = os.path.dirname(os.path.abspath(__file__))
_PY_AGENT = os.path.normpath(os.path.join(_HERE, "..", "..", "python-agent"))
if _PY_AGENT not in sys.path:
    sys.path.insert(0, _PY_AGENT)

from hmdev.messaging.agent.core.agent_connection import AgentConnection
from hmdev.messaging.agent.core.agent_connection_event_handler import AgentConnectionEventHandler


class _Watcher(AgentConnectionEventHandler):
    """Fires `hit` when a message with exactly `want` (sent after connect) arrives;
    optionally sends `reply` back through `conn` on the first hit."""
    def __init__(self, conn: AgentConnection, want: str, hit: threading.Event,
                 reply: str = None) -> None:
        self._conn = conn
        self._want = want
        self._hit = hit
        self._reply = reply
        self._replied = False

    def on_message_events(self, message_events: List[Dict[str, Any]]) -> None:
        conn_time = getattr(self._conn, "connection_time", 0) or 0
        for ev in message_events:
            content = ev.get("content")
            if (ev.get("date") or 0) > conn_time and isinstance(content, str) \
                    and content.strip() == self._want:
                self._hit.set()
                if self._reply and not self._replied:
                    self._replied = True
                    self._conn.send_message(self._reply)


def _fail(msg: str) -> None:
    print("\n  RESULT: ❌ FAIL — " + msg)
    print("================================================")
    sys.exit(1)


def _pass() -> None:
    print("\n  RESULT: ✅ PASS — two agents connected and exchanged messages both ways.")
    print("================================================")
    sys.exit(0)


def main() -> None:
    p = argparse.ArgumentParser(description="Python agent live messaging smoke test")
    p.add_argument("--url", default=os.environ.get(
        "MESSAGING_API_URL",
        "https://hmdevonline.com/messaging-platform/api/v1/messaging-service"))
    p.add_argument("--api-key", default=os.environ.get("DEFAULT_API_KEY")
                   or os.environ.get("MESSAGING_API_KEY") or "")
    # ONE fixed channel, reused every run — a per-run channel would burn the
    # developer's channel-unit quota (Free plan = 50). A nonce disambiguates runs.
    p.add_argument("--channel", default="smoke-test-py")
    args = p.parse_args()
    if not args.api_key:
        _fail("no API key — pass --api-key=... or set DEFAULT_API_KEY")

    password = "smoke-pw"
    nonce = format(time.time_ns(), "x")
    ping, pong = "PING:" + nonce, "PONG:" + nonce
    print("========== PYTHON AGENT LIVE SMOKE TEST ==========")
    print("  url=" + args.url)
    print("  channel=%s  nonce=%s" % (args.channel, nonce))

    alice = AgentConnection.with_api_key(args.url, args.api_key)
    bob = AgentConnection.with_api_key(args.url, args.api_key)
    bob_got_ping = threading.Event()
    alice_got_pong = threading.Event()
    try:
        if not alice.connect(args.channel, password, "smoke-alice", apiKeyScope="public"):
            _fail("alice failed to connect (see log above — e.g. quota or auth)")
        if not bob.connect(args.channel, password, "smoke-bob", apiKeyScope="public"):
            _fail("bob failed to connect")
        print("  ✔ both agents connected")

        # Presence — informational (roster is eventually consistent).
        seen = alice.get_active_agents()
        names = [a.get("agentName") if isinstance(a, dict) else getattr(a, "agentName", a) for a in seen]
        print("  active agents seen by alice: %s%s" % (
            names, "  (⚠ peer not listed yet — informational)" if len(seen) < 2 else ""))

        bob.receive_async(_Watcher(bob, ping, bob_got_ping, reply=pong))
        alice.receive_async(_Watcher(alice, pong, alice_got_pong))

        time.sleep(1.5)  # let both receive loops spin up
        print("  → alice sends: " + ping)
        if not alice.send_message(ping):
            _fail("alice.send_message returned False")

        if not bob_got_ping.wait(timeout=20):
            _fail("bob never received the ping (A→B delivery broken)")
        print("  ✔ bob received: " + ping)
        if not alice_got_pong.wait(timeout=20):
            _fail("alice never received the pong (B→A delivery broken)")
        print("  ✔ alice received: " + pong)
        _pass()
    finally:
        try:
            alice.disconnect()
        except Exception:
            pass
        try:
            bob.disconnect()
        except Exception:
            pass


if __name__ == "__main__":
    main()
