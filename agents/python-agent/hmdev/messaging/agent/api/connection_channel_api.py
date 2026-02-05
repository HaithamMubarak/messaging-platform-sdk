from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any

from hmdev.messaging.agent.api.models import ConnectResponse, EventMessageResult, AgentInfo, ReceiveConfig


class ConnectionChannelApi(ABC):
    @abstractmethod
    def connect(self, channel_name: Optional[str], channel_key: Optional[str], agent_name: str, session_id: Optional[str] = None, channel_id: Optional[str] = None, enable_webrtc_relay: bool = False, api_key_scope: str = "private") -> ConnectResponse:
        """Generic connect: supply channelName+channelKey or channelId (prefer channel_id when provided).

        Args:
            channel_name: Channel name (optional if channel_id provided)
            channel_key: Channel password (optional if channel_id provided)
            agent_name: Agent identifier
            session_id: Session ID for reconnection (optional)
            channel_id: Pre-computed channel ID (optional)
            enable_webrtc_relay: Enable WebRTC relay for the channel
            api_key_scope: 'private' (default) for isolated channels per API key, 'public' for shared channels
        """
        ...

    @abstractmethod
    def connect_with_config(self, config: Dict[str, Any]) -> ConnectResponse:
        """Object-based connect for cleaner API (recommended approach).

        Args:
            config: Dictionary with keys: channelName, channelPassword, agentName, sessionId (optional),
                   channelId (optional), enableWebrtcRelay (optional), apiKeyScope (optional, default='private')
        """
        ...

    @abstractmethod
    def send_event(self, type_name: str, content: str, to_user: Optional[str], encrypted: bool, session_id: str) -> bool:
        """Optional explicit event send wrapper (compatibility with Java naming)."""
        ...

    @abstractmethod
    def send_raw_event(self, type_name: str, from_user: str, to_user: Optional[str], encrypted: bool, content: str, session_id: str) -> bool:
        """Optional raw event sender preserving 'from' field."""
        ...

    @abstractmethod
    def disconnect(self, session_id: str) -> bool:
        ...

    # UDP bridge operations via the kafka-service UDP listener
    @abstractmethod
    def udp_push(self, msg: str, to_user: Optional[str], session_id: str) -> bool:
        ...

    @abstractmethod
    def udp_pull(self, session_id: str, receive_config: ReceiveConfig) -> Optional[EventMessageResult]:
        ...
