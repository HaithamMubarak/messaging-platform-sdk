from dataclasses import dataclass
from typing import List, Optional, Any, Dict


@dataclass
class ChannelState:
    """Channel state containing runtime configuration and offset tracking."""
    topicName: Optional[str] = None
    channelId: Optional[str] = None
    channelName: Optional[str] = None
    channelPassword: Optional[str] = None
    globalOffset: Optional[int] = None
    localOffset: Optional[int] = None
    originalGlobalOffset: Optional[int] = None
    originalLocalOffset: Optional[int] = None


@dataclass
class ConnectResponse:
    sessionId: Optional[str] = None
    channelId: Optional[str] = None
    date: Optional[float] = None
    state: Optional[ChannelState] = None


@dataclass
class ReceiveConfig:
    # JSON field names are globalOffset, localOffset, limit â€” keep those names so conversion is straightforward
    globalOffset: Optional[int] = None
    localOffset: Optional[int] = None
    limit: Optional[int] = None
    # Optional poll source: 'CACHE', 'KAFKA', or 'AUTO' (default AUTO)
    pollSource: Optional[str] = "AUTO"


@dataclass
class EventMessageResult:
    events: List[Dict[str, Any]]
    nextGlobalOffset: Optional[int] = None
    nextLocalOffset: Optional[int] = None
    ephemeralEvents: Optional[List[Dict[str, Any]]] = None


@dataclass
class AgentInfo:
    agentName: str
    date: Optional[float] = None
    meta: Optional[Dict[str, Any]] = None
