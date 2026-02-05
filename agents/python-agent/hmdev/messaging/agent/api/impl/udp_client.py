import json
import logging
import socket
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class UdpClient:
    def __init__(self, host: str, port: int) -> None:
        self.server_addr = (host, port)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # bind to ephemeral local port automatically
        self.sock.settimeout(None)  # blocking by default

    def close(self) -> None:
        try:
            self.sock.close()
        except Exception as e:
            logger.debug("UDP client close error: %s", e)

    def send(self, envelope: Dict[str, Any]) -> bool:
        try:
            payload = json.dumps(envelope).encode("utf-8")
            self.sock.sendto(payload, self.server_addr)
            return True
        except Exception as e:
            logger.error("UDP send error: %s", e)
            return False

    def send_and_receive(self, envelope: Dict[str, Any], timeout_ms: int) -> Optional[Dict[str, Any]]:
        try:
            payload = json.dumps(envelope).encode("utf-8")
            self.sock.sendto(payload, self.server_addr)
            # wait for single reply
            self.sock.settimeout(max(0.001, timeout_ms / 1000.0))
            buf, _ = self.sock.recvfrom(64 * 1024)
            text = buf.decode("utf-8", errors="replace")
            return json.loads(text)
        except socket.timeout:
            return None
        except Exception as e:
            logger.error("UDP send_and_receive error: %s", e)
            return None
        finally:
            try:
                self.sock.settimeout(None)
            except Exception:
                pass

