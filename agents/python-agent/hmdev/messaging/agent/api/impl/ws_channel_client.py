import json
import logging
import threading
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlparse

import websocket

logger = logging.getLogger(__name__)


def _to_ws_url(http_base_url: str) -> str:
    parsed = urlparse(http_base_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    base = f"{scheme}://{parsed.netloc}{parsed.path}"
    return base.rstrip("/") + "/ws"


class WsChannelClient:
    """WebSocket transport mirroring the server's subscribe/pull/push/message
    protocol (see messaging-service's MessagingWebSocketHandler and the browser
    SDK's web-agent.js _websocketSend/_handleWebSocketMessage). AgentConnection
    uses this as an optional low-latency, push-driven alternative to HTTP
    polling: send/receive still go over the same session, but new messages
    arrive as unsolicited 'message' pushes instead of being polled for.
    """

    def __init__(self, http_base_url: str, session_id: str, on_push: Callable[[Dict[str, Any]], None]):
        self._url = _to_ws_url(http_base_url)
        self._session_id = session_id
        self._on_push = on_push
        self._ws: Optional["websocket.WebSocket"] = None
        self._send_lock = threading.Lock()
        self._reader_thread: Optional[threading.Thread] = None
        self._running = False

        self._next_message_id = 0
        self._id_lock = threading.Lock()
        self._pending: Dict[int, threading.Event] = {}
        self._responses: Dict[int, dict] = {}

        self._subscribed_event = threading.Event()
        self._subscribed_ok = False

    def is_open(self) -> bool:
        return self._ws is not None and self._running

    def connect(self, global_offset: int = 0, local_offset: int = 0, timeout: float = 5.0) -> bool:
        try:
            self._ws = websocket.create_connection(self._url, timeout=timeout)
            # create_connection's timeout applies to the underlying socket, not
            # just the handshake — left as-is, the reader thread's blocking
            # recv() would raise (and silently die) after `timeout` seconds of
            # socket idle, killing every pending request from then on. Reset to
            # blocking once the handshake is done; per-request timeouts are
            # enforced by the threading.Event.wait(timeout) in _request/connect.
            self._ws.settimeout(None)
        except Exception as e:
            logger.warning("WS connect failed (%s): %s", self._url, e)
            return False

        self._running = True
        self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
        self._reader_thread.start()

        try:
            self._send_raw({
                "action": "subscribe",
                "sessionId": self._session_id,
                "offset": global_offset or 0,
                "localOffset": local_offset or 0,
            })
        except Exception as e:
            logger.warning("WS subscribe send failed: %s", e)
            self.close()
            return False

        if not self._subscribed_event.wait(timeout):
            logger.warning("WS subscribe timed out")
            self.close()
            return False

        if not self._subscribed_ok:
            self.close()
        return self._subscribed_ok

    def _read_loop(self) -> None:
        while self._running:
            try:
                raw = self._ws.recv()
            except Exception as e:
                if self._running:
                    logger.debug("WS reader stopped: %s", e)
                break
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            try:
                self._dispatch(msg)
            except Exception as e:
                logger.warning("WS dispatch raised: %s", e)
        self._running = False
        # Wake up anyone still blocked waiting for a response — the socket is
        # gone, so those requests will never resolve otherwise.
        for ev in list(self._pending.values()):
            ev.set()

    def _dispatch(self, msg: dict) -> None:
        action = msg.get("action")
        if action == "subscribed":
            self._subscribed_ok = (msg.get("status") == "success")
            self._subscribed_event.set()
            return
        if action == "message":
            if msg.get("status") == "success" and msg.get("data"):
                self._on_push(msg.get("data") or {})
            return
        # pull/push responses (and any other correlated response) resolve by
        # messageId regardless of action.
        message_id = msg.get("messageId")
        if message_id is not None:
            ev = self._pending.get(message_id)
            if ev is not None:
                self._responses[message_id] = msg
                ev.set()
            return
        if action == "pong":
            return
        logger.debug("WS unhandled frame: %s", msg)

    def _send_raw(self, obj: dict) -> None:
        with self._send_lock:
            self._ws.send(json.dumps(obj))

    def _next_id(self) -> int:
        with self._id_lock:
            self._next_message_id += 1
            return self._next_message_id

    def _request(self, action: str, payload: dict, timeout: float) -> Optional[dict]:
        if not self.is_open():
            return None
        message_id = self._next_id()
        ev = threading.Event()
        self._pending[message_id] = ev
        frame = dict(payload)
        frame["action"] = action
        frame["sessionId"] = self._session_id
        frame["messageId"] = message_id
        try:
            self._send_raw(frame)
        except Exception as e:
            logger.warning("WS send failed for action=%s: %s", action, e)
            self._pending.pop(message_id, None)
            return None

        ok = ev.wait(timeout)
        self._pending.pop(message_id, None)
        resp = self._responses.pop(message_id, None)
        if not ok or resp is None:
            logger.warning("WS %s request timed out (messageId=%s)", action, message_id)
            return None
        return resp

    def pull(self, receive_config: dict, timeout: float = 10.0) -> Optional[dict]:
        """Send a 'pull' request over the socket. Returns the response's `data`
        dict ({events, ephemeralEvents, nextGlobalOffset, nextLocalOffset}) or
        None on timeout/failure."""
        resp = self._request("pull", {"receiveConfig": receive_config}, timeout)
        if resp is None or resp.get("status") != "success":
            return None
        return resp.get("data") or {}

    def push(self, event_type: str, to: Optional[str], content: str, encrypted: bool,
             custom_type: Optional[str] = None, ephemeral: bool = False, timeout: float = 10.0) -> bool:
        """Send a message over the socket. Returns True once the server acks
        the push (messageId echoed back with status=success)."""
        payload: Dict[str, Any] = {
            "type": event_type,
            "to": to or "*",
            "content": content,
            "encrypted": bool(encrypted),
        }
        if custom_type:
            payload["customType"] = custom_type
        if ephemeral:
            payload["ephemeral"] = True
        resp = self._request("push", payload, timeout)
        return bool(resp and resp.get("status") == "success")

    def close(self) -> None:
        self._running = False
        try:
            if self._ws is not None:
                self._ws.close()
        except Exception:
            pass
        self._ws = None
