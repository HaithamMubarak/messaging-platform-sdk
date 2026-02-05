# Simple UDP envelope model to mirror Java's UdpEnvelope
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class UdpEnvelope:
    action: str
    payload: Dict[str, Any]
    requestId: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        data = {
            "action": self.action,
            "payload": self.payload,
        }
        if self.requestId:
            data["requestId"] = self.requestId
        return data

