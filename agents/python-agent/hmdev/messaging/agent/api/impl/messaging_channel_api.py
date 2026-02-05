import json
import logging
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse
import os

import requests
from hmdev.messaging.agent.api.connection_channel_api import ConnectionChannelApi
from hmdev.messaging.agent.api.models import ConnectResponse, EventMessageResult, AgentInfo, ChannelState, ReceiveConfig
from hmdev.messaging.agent.util.http_client import HttpClient
from hmdev.messaging.agent.security.my_security import MySecurity
from hmdev.messaging.agent.api.impl.udp_client import UdpClient
from hmdev.messaging.agent.api.impl.udp_envelope import UdpEnvelope

# polling timeout in seconds
POLLING_TIMEOUT = 40
DEFAULT_UDP_PORT = 9999

logger = logging.getLogger(__name__)


class MessagingChannelApi(ConnectionChannelApi):
    PUBLIC_KEY = "/?action=get-pubkey"

    def __init__(self, remote_url: str, use_public_key: bool = False, udp_port: Optional[int] = None, developer_api_key: Optional[str] = None) -> None:
        self.remote_url = remote_url
        self.use_public_key = use_public_key
        self.client = HttpClient(remote_url)
        # Do not read DEFAULT_API_KEY from environment here. Caller/agent may provide developer_api_key.
        if developer_api_key:
            self.client.set_default_header('X-Api-Key', developer_api_key)

        self.channel_secret: Optional[str] = None
        # track readiness and current session
        self.ready_state: bool = False
        self.session_id: Optional[str] = None
        self.channel_state: Optional[ChannelState] = None
        # next per-channel offset for chained reads
        self.next_channel_offset: Optional[int] = None
        # default poll source for receive operations
        self.default_poll_source: str = "AUTO"

        # UDP setup based on remote URL host/port similar to Java
        host = "localhost"
        port = DEFAULT_UDP_PORT
        try:
            parsed = urlparse(remote_url)
            if parsed.hostname:
                host = parsed.hostname
            if parsed.port and parsed.port > 0:
                port = parsed.port
        except Exception:
            logger.warning("Unable to parse remoteUrl host/port (%s), defaulting to localhost:%s", remote_url, port)

        # Allow overriding UDP port via constructor, env var MESSAGING_UDP_PORT
        try:
            env_val = os.getenv("MESSAGING_UDP_PORT")
            chosen = udp_port if udp_port is not None else (int(env_val.strip()) if env_val and env_val.strip() else None)
            if chosen is not None:
                if 0 < int(chosen) <= 65535:
                    port = int(chosen)
                    logger.info("Using UDP port override: %s", port)
                else:
                    logger.warning("Ignoring invalid UDP port override: %s", chosen)
        except ValueError as nfe:
            logger.warning("Invalid UDP port override value; must be an integer: %s", nfe)

        self._udp_port = port
        self._udp_client = UdpClient(host, self._udp_port)

    def _url(self, action: str) -> str:
        # Align exactly with kafka-service controller paths
        return f"/{action}"

    def is_channel_ready(self) -> bool:
        if not self.ready_state or not self.session_id:
            logger.debug("Unable use channel operation, channel is not ready")
            return False
        return True

    def _create_channel(self, name: str, password: str) -> Optional[str]:
        try:
            payload = {"channelName": name, "channelPassword": password}
            txt = self.client.request("POST", self._url("create-channel"), json_body=payload)
            # Try to parse JSON with increased recursion limit if needed
            try:
                obj = json.loads(txt)
            except RecursionError:
                # If we hit recursion limit, the response is malformed or too deeply nested
                # Log truncated response and return None to fallback to connect with name/password
                txt_preview = txt[:200] if txt and len(txt) > 200 else txt
                logger.warning("create-channel returned deeply nested JSON (recursion error), preview: %s...", txt_preview)
                return None

            if isinstance(obj, dict) and str(obj.get('status')) == 'success':
                data = obj.get('data', {})
                if isinstance(data, dict):
                    return data.get('channelId')
        except RecursionError as re:
            logger.warning("create-channel failed with recursion error: %s", re)
        except Exception as e:
            logger.warning("create-channel failed: %s", e)
        return None

    def connect(self, channel_name: Optional[str], channel_password: Optional[str], agent_name: str, session_id: Optional[str] = None, channel_id: Optional[str] = None, enable_webrtc_relay: bool = False, api_key_scope: str = "private", poll_source: str = "AUTO") -> ConnectResponse:
        try:
            # set local secret only when we have name+key to derive it; otherwise secret remains None until PASSWORD_REPLY handled on agent side
            password_hash = None
            if channel_name and channel_password:
                self.channel_secret = MySecurity.derive_channel_secret(channel_name, channel_password)
                password_hash = MySecurity.hash(channel_password, self.channel_secret)

            payload: Dict[str, Any] = {}
            if channel_id:
                cid = channel_id
            else:
                # If channel_name+key provided derive secret and attempt create-channel to register the channel and get id
                if channel_name and channel_password:
                    # Create channel on server using channelName and passwordHash (protected password)
                    cid = self._create_channel(channel_name, password_hash)
                    # If create-channel fails (returns None), we'll proceed with just channelName/channelPassword
                else:
                    raise ValueError("Missing channelId or channelName+channelPassword for connect operation")

            # prefer sending channelId to server if known (only if not None)
            if cid:
                payload["channelId"] = cid
            if channel_name and password_hash:
                # keep backward compatible fields for servers expecting name/password
                payload["channelName"] = channel_name
                # Send hashed channel password (derive locally and send hash) to align with Java agent behavior
                payload["channelPassword"] = password_hash

            payload.update({
                "agentName": agent_name,
                "agentContext": self.create_agent_context(),
                "enableWebrtcRelay": enable_webrtc_relay,
                "apiKeyScope": api_key_scope or "private"
            })
            if session_id:
                payload["sessionId"] = session_id

            response_text = self.client.request("POST", self._url("connect"), json_body=payload)
            json_data = json.loads(response_text)

            if isinstance(json_data, dict) and str(json_data.get('status')) == 'success':
                data = json_data.get('data', {})
                session = None
                date = None
                state = None
                channel_id_resp = None
                if isinstance(data, dict):
                    session = data.get('sessionId') or data.get('session')
                    date = data.get('date')
                    # Check both 'state' (new) and 'metadata' (old) for backward compatibility
                    md = data.get('state') or data.get('metadata') or data.get('ChannelState')
                    if isinstance(md, dict):
                        state = ChannelState(topicName=md.get('topicName'), channelId=md.get('channelId'),
                                                   channelName=md.get('channelName'), channelPassword=md.get('channelPassword'))
                        channel_id_resp = state.channelId or data.get('channelId')

                self.ready_state = True
                self.session_id = session
                self.default_poll_source = poll_source or "AUTO"
                if isinstance(state, ChannelState):
                    self.channel_state = state
                return ConnectResponse(sessionId=session, channelId=channel_id_resp, date=date, state=state)

            if isinstance(json_data, dict):
                session = json_data.get('sessionId') or json_data.get('session')
                md = json_data.get('state') or json_data.get('metadata') or json_data.get('ChannelState')
                state = None
                if isinstance(md, dict):
                    state = ChannelState(topicName=md.get('topicName'), channelId=md.get('channelId'),
                                               channelName=md.get('channelName'), channelPassword=md.get('channelPassword'))
                    self.channel_state = state
                self.ready_state = True
                self.session_id = session
                self.default_poll_source = poll_source or "AUTO"
                return ConnectResponse(sessionId=session, channelId=(state.channelId if state else None), state=state)

            if isinstance(response_text, str) and response_text.strip():
                session = response_text.strip()
                self.ready_state = True
                self.session_id = session
                self.default_poll_source = poll_source or "AUTO"
                return ConnectResponse(sessionId=session)

        except Exception as ex:
            logger.error("Unable to connect to the channel: %s", ex)

        return ConnectResponse()

    def connect_with_channel_id(self, agent_name: str, channel_id: str, session_id: Optional[str] = None, enable_webrtc_relay: bool = False) -> ConnectResponse:
        """Connect using pre-computed channelId (no channel name/password needed)."""
        return self.connect(None, None, agent_name, session_id, channel_id, enable_webrtc_relay)

    def receive(self, session_id: str, receive_config: ReceiveConfig) -> Optional[EventMessageResult]:
        """HTTP-based message receive (pull) operation with receiveConfig."""
        try:
            payload = {
                "sessionId": session_id,
                "receiveConfig": {
                    "globalOffset": receive_config.globalOffset,
                    "localOffset": receive_config.localOffset,
                    "limit": receive_config.limit,
                    "pollSource": receive_config.pollSource or self.default_poll_source
                }
            }
            txt = self.client.request("POST", self._url("pull"), json_body=payload, timeout=POLLING_TIMEOUT)
            obj = json.loads(txt)
            if isinstance(obj, dict) and str(obj.get('status')) == 'success':
                data = obj.get('data', {})
                if not isinstance(data, dict):
                    return EventMessageResult(events=[], nextGlobalOffset=None)
                cipher_array = data.get('events', [])
                data_array: List[Dict[str, Any]] = []
                for item in cipher_array:
                    # reuse helper to verify & decrypt single event dict
                    if isinstance(item, dict):
                        self._verify_and_decrypt_message(item)
                    data_array.append(item)

                # Handle ephemeral events (short-term messages)
                ephemeral_array = data.get('ephemeralEvents', [])
                ephemeral_data_array: List[Dict[str, Any]] = []
                if ephemeral_array:
                    for item in ephemeral_array:
                        if isinstance(item, dict):
                            self._verify_and_decrypt_message(item)
                        ephemeral_data_array.append(item)

                return EventMessageResult(events=data_array, nextGlobalOffset=data.get('nextGlobalOffset'),
                                          nextLocalOffset=data.get('nextLocalOffset'),
                                          ephemeralEvents=ephemeral_data_array if ephemeral_data_array else None)
            if isinstance(obj, list):
                return EventMessageResult(events=obj, nextGlobalOffset=None)
        except requests.exceptions.Timeout:
            logger.warning("Receive request timed out")
            return EventMessageResult(events=[], nextGlobalOffset=None)
        except Exception as exception:
            logger.warning(exception)
            return None
        return None

    def connect_with_config(self, config: Dict[str, Any]) -> ConnectResponse:
        """Object-based connect for cleaner API (recommended approach)."""
        channel_name = config.get('channelName')
        channel_password = config.get('channelPassword')
        agent_name = config.get('agentName')
        session_id = config.get('sessionId')
        channel_id = config.get('channelId')
        enable_webrtc_relay = config.get('enableWebrtcRelay', False)
        api_key_scope = config.get('apiKeyScope', 'private')
        poll_source = config.get('pollSource', 'AUTO')

        return self.connect(channel_name, channel_password, agent_name, session_id, channel_id, enable_webrtc_relay, api_key_scope, poll_source)

    def get_active_agents(self, session_id: str) -> Optional[List[AgentInfo]]:
        params = {"sessionId": session_id}
        try:
            txt = self.client.request("POST", self._url("list-agents"), json_body=params)
            obj = json.loads(txt)
            data: List[Any] = []
            if isinstance(obj, dict) and str(obj.get('status')) == 'success':
                data = obj.get('data', [])
            agents: List[AgentInfo] = []
            for item in data:
                if isinstance(item, dict):
                    agents.append(AgentInfo(agentName=item.get('agentName', ''), date=item.get('date'), meta=item))
            return agents
        except Exception as e:
            logger.warning(e)
            return None

    def get_system_agents(self, session_id: str) -> Optional[List[AgentInfo]]:
        """Return only system agents (roles filtered server-side) via POST /list-system-agents."""
        try:
            payload = {"sessionId": session_id}
            txt = self.client.request("POST", self._url("list-system-agents"), json_body=payload)
            obj = json.loads(txt)
            data: List[Any] = []
            if isinstance(obj, dict) and str(obj.get('status')) == 'success':
                data = obj.get('data', [])
            agents: List[AgentInfo] = []
            for item in data:
                if isinstance(item, dict):
                    agents.append(AgentInfo(agentName=item.get('agentName', ''), date=item.get('date'), meta=item))
            return agents
        except Exception as e:
            logger.warning("get_system_agents failed: %s", e)
            return None

    def send(self, msg: str, to_agent: Optional[str], session_id: str, encrypted: Optional[bool] = True, event_type: Optional[str] = None, ephemeral: Optional[bool] = False) -> bool:
        """Generic send that handles legacy chat-text and generic event sends.
        - legacy callers: event_type is None -> send chat-text encrypted by default
        - event callers: supply event_type and set encrypted flag accordingly
        - ephemeral: if True, message bypasses Kafka/DB and is stored only in Redis cache (short-term)
        """
        payload = {
            "type": event_type or "chat-text",
            "to": to_agent,
            "encrypted": bool(encrypted),
            "content": (MySecurity.encrypt_and_sign(msg, self.channel_secret) if encrypted else msg),
            "sessionId": session_id
        }
        if ephemeral:
            payload["ephemeral"] = True
        try:
            txt = self.client.request("POST", self._url("push"), json_body=payload)
            obj = json.loads(txt)
            return isinstance(obj, dict) and str(obj.get('status')) == 'success'
        except Exception as e:
            logger.warning("send failed: %s", e)
            return False

    def send_event(self, type_name: str, content: str, to_agent: Optional[str], encrypted: bool, session_id: str, ephemeral: bool = False) -> bool:
        # Backwards compatible wrapper
        return self.send(content, to_agent, session_id, encrypted=encrypted, event_type=type_name, ephemeral=ephemeral)

    def send_raw_event(self, type_name: str, from_agent: str, to_agent: Optional[str], encrypted: bool, content: str, session_id: str) -> bool:
        return self.send(content, to_agent, session_id, encrypted=encrypted, event_type=type_name)

    def disconnect(self, session_id: str) -> bool:
        try:
            # close UDP client first
            try:
                self._udp_client.close()
            except Exception as e:
                logger.debug("Error while closing udp client: %s", e)
            payload = {"sessionId": session_id}
            txt = self.client.request("POST", self._url("disconnect"), json_body=payload)
            self.client.close_all()
            obj = json.loads(txt)
            self.ready_state = False
            self.session_id = None
            return isinstance(obj, dict) and str(obj.get('status')) == 'success'
        except Exception as e:
            logger.warning(e)
            return False

    # UDP operations
    def udp_push(self, msg: str, to_agent: Optional[str], session_id: str) -> bool:
        try:
            payload = {
                "type": "chat-text",
                "to": to_agent,
                "encrypted": True,
                "content": MySecurity.encrypt_and_sign(msg, self.channel_secret),
                "sessionId": session_id
            }
            env = UdpEnvelope("push", payload).to_dict()
            return self._udp_client.send(env)
        except Exception as e:
            logger.error("Exception for udp_push: %s", e)
            return False

    def udp_pull(self, session_id: str, offset_range: ReceiveConfig) -> Optional[EventMessageResult]:
        result = EventMessageResult(events=[], nextGlobalOffset=offset_range.globalOffset)
        try:
            payload = {
                "sessionId": session_id,
                "receiveConfig": {
                    "globalOffset": offset_range.globalOffset,
                    "limit": offset_range.limit,
                    "localOffset": offset_range.localOffset,
                    "pollSource": offset_range.pollSource or self.default_poll_source
                }
            }
            env = UdpEnvelope("pull", payload).to_dict()
            resp = self._udp_client.send_and_receive(env, 3000)
            if resp is None:
                logger.debug("No UDP response received for udp_pull (timeout)")
                return result
            # kafka-service UDP response: { status: "ok", result: { status: "success", data: {...} } }
            if isinstance(resp, dict) and resp.get('status') == 'ok':
                result_node = resp.get('result')
                if isinstance(result_node, dict) and result_node.get('status') == 'success':
                    data = result_node.get('data')
                    if isinstance(data, dict):
                        events = data.get('events', [])
                        for item in events:
                            if isinstance(item, dict):
                                self._verify_and_decrypt_message(item)

                        return EventMessageResult(events=events, nextGlobalOffset=data.get('nextGlobalOffset'), nextLocalOffset=data.get('nextLocalOffset'))
                else:
                    logger.warning("UDP pull non-success result: %s", result_node)
                    return result
            else:
                logger.warning("UDP pull returned non-ok response: %s", resp)
                return result
        except Exception as e:
            logger.error("Exception for udp_pull: %s", e)
        return result

    def create_agent_context(self) -> Dict[str, str]:
        """Create agent metadata map"""
        return {
            "agentType": "PYTHON-AGENT",
            "descriptor": "hmdev/messaging/agent/api/http/messaging_channel_api.py"
        }


    # Helper: verify and decrypt a single message dict in-place. Returns the dict for convenience.
    def _verify_and_decrypt_message(self, item: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if item.get("encrypted"):
                plain = MySecurity.decrypt_and_verify(item.get("content", ""), self.channel_secret)
                item["content"] = plain
                item["encrypted"] = False
        except Exception as e:
            logger.debug("Failed to decrypt event content: %s", e)
        return item
