import json
import logging
import socket
import threading
from typing import Optional

from hmdev.messaging.agent.core.agent_connection import AgentConnection
from hmdev.messaging.agent.api.models import ReceiveConfig

logger = logging.getLogger(__name__)


class LocalTcpServer:
    """
    Simple newline-delimited JSON TCP server for local game/agent integration.
    Supported ops:
      - connect: {"op":"connect","channel","password","agentName"}
      - disconnect: {"op":"disconnect"}
      - udpPush: {"op":"udpPush","content","destination"}
      - udpPull: {"op":"udpPull","startOffset", "limit"}
    """

    def __init__(self, port: int, agent: AgentConnection) -> None:
        self._port = port
        self._agent = agent
        self._sock: Optional[socket.socket] = None
        self._accept_thread: Optional[threading.Thread] = None
        self._running = False

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", self._port))
        self._sock.listen(8)
        self._accept_thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._accept_thread.start()
        logger.info("Local TCP server started on localhost:%s", self._port)

    def stop(self) -> None:
        self._running = False
        try:
            if self._sock:
                self._sock.close()
        except Exception:
            pass
        logger.info("Local TCP server stopped")

    def _accept_loop(self) -> None:
        assert self._sock is not None
        while self._running:
            try:
                client_sock, _ = self._sock.accept()
                t = threading.Thread(target=self._handle_client, args=(client_sock,), daemon=True)
                t.start()
            except OSError:
                break
            except Exception as e:
                logger.debug("Local TCP accept error: %s", e)

    def _handle_client(self, client_sock: socket.socket) -> None:
        with client_sock:
            try:
                f_in = client_sock.makefile("r", encoding="utf-8", newline="\n")
                f_out = client_sock.makefile("w", encoding="utf-8", newline="\n")
                for line in f_in:
                    line = line.strip()
                    if not line:
                        continue
                    resp = self._process_line(line)
                    f_out.write(resp + "\n")
                    f_out.flush()
            except Exception as e:
                logger.debug("Local TCP client error: %s", e)

    def _ok(self, data=None) -> str:
        return json.dumps({"status": "ok", **({"data": data} if data is not None else {})})

    def _err(self, message: str) -> str:
        return json.dumps({"status": "error", "message": message})

    def _process_line(self, line: str) -> str:
        try:
            req = json.loads(line)
            op = req.get("op")
            if op == "connect":
                ch = req.get("channel")
                pw = req.get("password")
                name = req.get("agentName")
                ok = self._agent.connect(ch, pw, name)
                return self._ok() if ok else self._err("connect failed")
            elif op == "disconnect":
                ok = self._agent.disconnect()
                return self._ok() if ok else self._err("disconnect failed")
            elif op == "udpPush":
                content = req.get("content", "")
                dest = req.get("destination", "*")
                ok = self._agent.udp_push_message(content, dest)
                return self._ok() if ok else self._err("udpPush failed")
            elif op == "udpPull":
                start = int(req.get("startOffset", 0))
                limit = int(req.get("limit", 10))
                range_obj = ReceiveConfig(globalOffset=start, localOffset=None, limit=limit)
                res = self._agent.udp_pull(range_obj)
                return self._ok({"result": (res.__dict__ if res else None)})
            else:
                return self._err(f"unknown op: {op}")
        except Exception as e:
            return self._err(f"bad request: {e}")
