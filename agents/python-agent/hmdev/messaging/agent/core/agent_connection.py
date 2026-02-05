import logging
import threading
import re
from typing import Optional, List, Any
from uuid import uuid4
import json

from hmdev.messaging.agent.core.agent_connection_event_handler import AgentConnectionEventHandler
from hmdev.messaging.agent.util import session_recovery_utility as Sess
from hmdev.messaging.agent.util.utils import sleep
from hmdev.messaging.agent.api.connection_channel_api_factory import ConnectionChannelApiFactory
from hmdev.messaging.agent.api.models import ConnectResponse, EventMessageResult, AgentInfo, ReceiveConfig
from hmdev.messaging.agent.api.impl.messaging_channel_api import MessagingChannelApi
from hmdev.messaging.agent.security.my_security import MySecurity

logger = logging.getLogger(__name__)

# Mirror Java-agent constants
DEFAULT_RECEIVE_LIMIT = 20
PASSWORD_WAIT_TIMEOUT_SECONDS = 5


class AgentConnection:

    def __init__(self, api_url: str) -> None:
        # public-like attributes (match Java naming where useful)
        self.connection_time: Optional[float] = None
        self.agent_name: Optional[str] = None
        self.channel_id: Optional[str] = None
        self.channel_secret: Optional[str] = None
        # Starting point for reading (originalGlobalOffset, localOffset=0)
        self.initial_receive_config: Optional[ReceiveConfig] = None
        # Current state at connect time (actual globalOffset, localOffset)
        self.current_receive_config: Optional[ReceiveConfig] = None

        # internal/runtime state
        self._channel_api = ConnectionChannelApiFactory.get_connection_api(api_url)
        self._check_last_session = True
        self.enable_webrtc_relay = False  # Enable/disable WebRTC relay creation when connecting
        self._session_id: Optional[str] = None
        self._ready_state = False
        # Track channel credentials locally
        self._channel_name: Optional[str] = None
        self._channel_password: Optional[str] = None
        self._receive_thread: Optional[threading.Thread] = None
        # Key pair used for password request/reply encryption
        # stored as (private_obj, public_pem)
        self._key_pair: Optional[Any] = None
        # Pending private key/request id used by request_password helper
        self._pending_private_key = None
        self._pending_request_id: Optional[str] = None
        # Optional callable: (channel_id: str, requester_agent_name: str, requester_public_key_pem: str) -> bool
        # If callable returns True, the agent will send a PASSWORD_REPLY encrypted to the requester.
        self.password_request_handler = None

    # New constructor-like factory: accept optional developer_api_key
    @classmethod
    def with_api_key(cls, api_url: str, developer_api_key: Optional[str] = None):
        inst = cls(api_url)
        # Replace channel_api with one using developer_api_key
        inst._channel_api = ConnectionChannelApiFactory.get_connection_api(api_url, developer_api_key)
        return inst

    # --- Connection APIs (mirror Java overloads where practical) ---

    def connect(self, channel_name: str = None, channel_password: str = None, agent_name: str = None, **kwargs) -> bool:
        """
        Connect to a channel. Supports both parameter-based and dict-based configuration.

        Examples:
            # Legacy parameter-based (still supported):
            agent.connect("my-channel", "password", "player-1")

            # Dict-based (RECOMMENDED):
            agent.connect(config={
                "channelName": "my-channel",
                "channelPassword": "password",
                "agentName": "player-1",
                "apiKeyScope": "private",  # or "public" for testing
                "enableWebrtcRelay": False,
                "checkLastSession": True
            })

            # Or using keyword arguments:
            agent.connect(
                channelName="my-channel",
                channelPassword="password",
                agentName="player-1",
                apiKeyScope="private"
            )

        Args:
            channel_name: Channel name (legacy parameter)
            channel_password: Channel password (legacy parameter)
            agent_name: Agent name (legacy parameter)
            **kwargs: Additional config parameters (config dict, or individual params)

        Returns:
            bool: True if connected successfully
        """
        # Check if first parameter is a dict (config object)
        if isinstance(channel_name, dict):
            config = channel_name
            return self._connect_with_dict(config)

        # Check if 'config' kwarg was provided
        if 'config' in kwargs:
            return self._connect_with_dict(kwargs['config'])

        # Otherwise, treat as parameter-based call (legacy or kwargs)
        # Merge positional and keyword arguments
        if channel_name is None and 'channelName' in kwargs:
            channel_name = kwargs['channelName']
        if channel_password is None and 'channelPassword' in kwargs:
            channel_password = kwargs['channelPassword']
        if agent_name is None and 'agentName' in kwargs:
            agent_name = kwargs['agentName']

        # Extract optional parameters from kwargs
        channel_id = kwargs.get('channelId')
        api_key_scope = kwargs.get('apiKeyScope', 'private')
        enable_webrtc_relay = kwargs.get('enableWebrtcRelay', False)
        check_last_session = kwargs.get('checkLastSession', True)

        # Apply instance settings
        if 'enableWebrtcRelay' in kwargs:
            self.enable_webrtc_relay = enable_webrtc_relay
        if 'checkLastSession' in kwargs:
            self._check_last_session = check_last_session

        return self._connect_internal(channel_id, channel_name, channel_password, agent_name, api_key_scope)

    def _connect_with_dict(self, config: dict) -> bool:
        """Internal method to handle dict-based configuration."""
        channel_name = config.get('channelName')
        channel_password = config.get('channelPassword')
        agent_name = config.get('agentName')
        channel_id = config.get('channelId')
        api_key_scope = config.get('apiKeyScope', 'private')
        enable_webrtc_relay = config.get('enableWebrtcRelay', False)
        check_last_session = config.get('checkLastSession', True)

        # Apply instance settings
        self.enable_webrtc_relay = enable_webrtc_relay
        self._check_last_session = check_last_session

        return self._connect_internal(channel_id, channel_name, channel_password, agent_name, api_key_scope)

    def connect_with_channel_id(self, channel_id: str, agent_name: str, maybe_channel_name: Optional[str] = None) -> bool:
        """Compatibility wrapper: connect using a server-side channelId."""
        return self._connect_internal(channel_id, maybe_channel_name, None, agent_name, "private")

    def _connect_internal(self, channel_id: Optional[str], channel_name: Optional[str], channel_password: Optional[str], agent_name: str, api_key_scope: str = "private") -> bool:
        if self._ready_state and self._session_id is not None:
            raise Exception(f"Agent {agent_name} is already connected with session {self._session_id}")

        if self._session_id is None and self._check_last_session:
            # use channel_id when possible for session recovery, otherwise channel_name
            self._session_id = Sess.load_session_id(channel_id or channel_name)

        # remember provided channel name/password locally
        self.agent_name = agent_name
        self._channel_name = channel_name
        self._channel_password = channel_password

        # generate RSA key pair (private_obj, public_pem) similar to Java keyPair
        try:
            self._key_pair = MySecurity.rsa_generate()
        except Exception:
            # fallback: None is acceptable for most flows
            self._key_pair = None

        # call underlying channel API with apiKeyScope
        try:
            if channel_id is not None:
                resp: ConnectResponse = self._channel_api.connect(None, None, self.agent_name, self._session_id, channel_id, self.enable_webrtc_relay, api_key_scope)
            else:
                resp: ConnectResponse = self._channel_api.connect(channel_name, channel_password, self.agent_name, self._session_id, enable_webrtc_relay=self.enable_webrtc_relay, api_key_scope=api_key_scope)
        except Exception as e:
            logger.warning("Connect failed with exception: %s", e)
            return False

        if resp and resp.sessionId:
            self._session_id = resp.sessionId
            self.connection_time = resp.date if getattr(resp, 'date', None) is not None else None
            self._ready_state = True
            # store channel id if provided
            try:
                # Check both 'state' (new) and 'metadata' (old) for backward compatibility
                state = getattr(resp, 'state', None) or getattr(resp, 'metadata', None)
                self.channel_id = resp.channelId or (state.channelId if state else None)
            except Exception:
                self.channel_id = resp.channelId if getattr(resp, 'channelId', None) else None

            # initial receive config: represents the STARTING point (where to begin reading)
            # - globalOffset = originalGlobalOffset (where this channel instance started)
            # - localOffset = 0 (start from beginning of this instance)
            #
            # current_receive_config: represents the CURRENT state at connect time
            # - globalOffset = current globalOffset (where channel is NOW)
            # - localOffset = current localOffset (current position in instance)
            try:
                # Check both 'state' (new) and 'metadata' (old) for backward compatibility
                md = getattr(resp, 'state', None) or getattr(resp, 'metadata', None)

                # Use originalGlobalOffset to start from the beginning of the current channel instance
                ogo = getattr(md, 'originalGlobalOffset', None) if md is not None else None
                go = getattr(md, 'globalOffset', None) if md is not None else None
                lo = getattr(md, 'localOffset', None) if md is not None else None

                # Prefer originalGlobalOffset over globalOffset
                start_offset = ogo if ogo is not None else (go or 0)

                if go is not None or ogo is not None:
                    self.initial_receive_config = ReceiveConfig(
                        globalOffset=start_offset,
                        localOffset=0,
                        limit=DEFAULT_RECEIVE_LIMIT
                    )
                    self.current_receive_config = ReceiveConfig(
                        globalOffset=(go or 0),
                        localOffset=(lo or 0),
                        limit=DEFAULT_RECEIVE_LIMIT
                    )
                else:
                    self.initial_receive_config = ReceiveConfig(globalOffset=0, localOffset=0, limit=DEFAULT_RECEIVE_LIMIT)
                    self.current_receive_config = ReceiveConfig(globalOffset=0, localOffset=0, limit=DEFAULT_RECEIVE_LIMIT)
            except Exception:
                self.initial_receive_config = ReceiveConfig(globalOffset=0, localOffset=0, limit=DEFAULT_RECEIVE_LIMIT)
                self.current_receive_config = ReceiveConfig(globalOffset=0, localOffset=0, limit=DEFAULT_RECEIVE_LIMIT)

            # If we have channel credentials, derive the channel secret locally
            if self._channel_name is not None and self._channel_password is not None:
                try:
                    self.channel_secret = MySecurity.derive_channel_secret(self._channel_name, self._channel_password)
                except Exception:
                    self.channel_secret = None

                # also set channel secret on channel_api when supported
                if self.channel_secret is not None:
                    try:
                        if hasattr(self._channel_api, 'set_channel_secret'):
                            self._channel_api.set_channel_secret(self.channel_secret)
                        else:
                            setattr(self._channel_api, 'channel_secret', self.channel_secret)
                    except Exception:
                        pass

            # If secret not known attempt to request password asynchronously like older python behavior
            if self.channel_secret is None and getattr(self._channel_api, 'channel_secret', None) is None and getattr(self._channel_api, 'channel_password', None) is None:
                try:
                    # non-blocking short attempt
                    self.request_password(maybe_channel_name=channel_name, timeout_seconds=PASSWORD_WAIT_TIMEOUT_SECONDS)
                except Exception:
                    pass

            if self._session_id:
                Sess.save_session_id(channel_id or channel_name, self._session_id)
            logger.info("Connected to session %s", self._session_id)
            return True
        else:
            logger.warning("Connect failed: %s", resp)
            return False

    def disconnect(self) -> bool:
        if not self.is_ready():
            return False

        result: bool = self._channel_api.disconnect(self._session_id)

        if result:
            self._session_id = None
            self._ready_state = False
            # Clear any pending private key when disconnecting to avoid keeping sensitive key material alive
            self._pending_private_key = None
            self._pending_request_id = None
            self._key_pair = None

        return result

    # --- Receive / async loop ---
    def receive(self, offset_range: ReceiveConfig) -> Optional[EventMessageResult]:
        logger.debug("ConnectionChannel.receive: %s", offset_range)
        if not self.is_ready():
            return None

        resp = self._channel_api.receive(self._session_id, offset_range)
        if resp is None:
            return None

        # decrypt any encrypted events using derived channel_secret
        events = resp.events or []
        for ev in events:
            try:
                self._verify_and_decrypt_message(ev)
            except Exception:
                logger.debug("Failed to verify/decrypt an event")

        # auto-handle special event types
        try:
            self._check_auto_events(events)
        except Exception as e:
            logger.warning('check_auto_events raised: %s', e)

        return resp

    def receive_async(self, handler: AgentConnectionEventHandler) -> None:
        if self._receive_thread is None:
            # start with initial_receive_config if available
            self._receive_thread = threading.Thread(target=self._run_receive, args=(handler,), daemon=True)
            self._receive_thread.start()

    def _run_receive(self, handler: AgentConnectionEventHandler) -> None:
        offset_range = ReceiveConfig(globalOffset=0, localOffset=0, limit=DEFAULT_RECEIVE_LIMIT)
        if self.initial_receive_config:
            offset_range = ReceiveConfig(globalOffset=self.initial_receive_config.globalOffset or 0,
                                         localOffset=self.initial_receive_config.localOffset or 0,
                                         limit=self.initial_receive_config.limit or DEFAULT_RECEIVE_LIMIT)

        while self.is_ready():
            resp = self.receive(offset_range)
            if resp is None:
                sleep(0.5)
                continue

            # Process ephemeral events first (they are time-sensitive)
            ephemeral_events = getattr(resp, 'ephemeralEvents', None) or []
            if ephemeral_events:
                try:
                    handler.on_message_events(ephemeral_events)
                except Exception as e:
                    logger.warning('Handler raised exception on ephemeral events: %s', e)

            events = resp.events or []
            if events:
                # deliver to handler
                try:
                    handler.on_message_events(events)
                except Exception as e:
                    logger.warning('Handler raised exception: %s', e)

                # update offsets
                if getattr(resp, 'nextGlobalOffset', None) is not None:
                    offset_range.globalOffset = resp.nextGlobalOffset

                if getattr(resp, 'nextLocalOffset', None) is not None:
                    offset_range.localOffset = resp.nextLocalOffset

                sleep(0.5)

    # --- Sending helpers (Java-like names with pythonic snake_case preserved) ---
    def send_message(self, msg: str, destination: Optional[str] = "*", as_filter_regex: Optional[bool] = True) -> bool:
        if not self.is_ready():
            return False

        # If not using regex, escape the destination (similar to Pattern.quote in Java)
        dest = destination if as_filter_regex else re.escape(destination)

        try:
            # default legacy send uses chat-text semantics and encryption where possible
            encrypted = True if self.channel_secret else False
            result = self._channel_api.send(msg, dest, self._session_id, encrypted=encrypted)
            return bool(result)
        except Exception as e:
            logger.warning("Send failed: %s", e)
            return False

    # Java-compatible camelCase wrapper
    def sendMessage(self, *args, **kwargs):
        return self.send_message(*args, **kwargs)

    def udp_push_message(self, msg: str, destination: str) -> bool:
        """Send a message through the UDP bridge (fire-and-forget)."""
        if not self.is_ready():
            return False
        try:
            return bool(self._channel_api.udp_push(msg, destination, self._session_id))
        except Exception as e:
            logger.warning("udp_push_message failed: %s", e)
            return False

    def udpPushMessage(self, *args, **kwargs):
        return self.udp_push_message(*args, **kwargs)

    def udp_pull(self, offset_range: ReceiveConfig) -> Optional[EventMessageResult]:
        """Pull messages through the UDP bridge with a short timeout."""
        if not self.is_ready():
            return None
        try:
            return self._channel_api.udp_pull(self._session_id, offset_range)
        except Exception as e:
            logger.warning("udp_pull failed: %s", e)
            return None

    def udpPull(self, *args, **kwargs):
        return self.udp_pull(*args, **kwargs)

    def get_active_agents(self) -> Optional[List[AgentInfo]]:
        if not self.is_ready():
            return None

        try:
            resp = self._channel_api.get_active_agents(self._session_id)
            return resp
        except Exception as e:
            logger.warning("get_active_agents failed: %s", e)
            return None

    def set_check_last_session(self, check: bool) -> None:
        self._check_last_session = check

    # Provide Java-style isReady wrapper while keeping pythonic is_ready name
    def is_ready(self) -> bool:
        """Return True when the connection is ready and session id is present (matches Java isChannelReady)."""
        if not self._ready_state or self._session_id is None:
            logger.debug("Unable use channel operation, channel is not ready")
            return False
        else:
            return True

    def isReady(self):
        return self.is_ready()

    def is_host_agent(self) -> bool:
        """
        Determine if this agent is the "host" (agent with earliest connectionTime).
        Host is responsible for sending board state to new joiners.

        Returns:
            bool: True if this agent is the host, False otherwise
        """
        if not self.is_ready():
            return False

        agents_info = self.get_active_agents()
        if not agents_info or len(agents_info) == 0:
            return True  # Only agent, so is host

        # Find agent with earliest connectionTime
        earliest_agent = self.agent_name
        earliest_time = None

        for agent in agents_info:
            agent_name = getattr(agent, 'agentName', None) or getattr(agent, 'name', None)
            connection_time = getattr(agent, 'connectionTime', None)

            if agent_name == self.agent_name:
                earliest_time = connection_time

            if connection_time is not None:
                if earliest_time is None or connection_time < earliest_time:
                    earliest_time = connection_time
                    earliest_agent = agent_name

        is_host = earliest_agent == self.agent_name
        agent_names = [getattr(a, 'agentName', None) or getattr(a, 'name', 'Unknown') for a in agents_info]
        logger.info(f"[Host Check] Agents: {', '.join(agent_names)} | Host: {earliest_agent} (connectionTime: {earliest_time}) | I am {self.agent_name} | Is host: {is_host}")

        return is_host

    # Java-style camelCase alias
    def isHostAgent(self) -> bool:
        return self.is_host_agent()

    # --- Password request flow ---
    def request_password(self, maybe_channel_name: Optional[str] = None, timeout_seconds: int = 10) -> bool:
        # Use default timeout aligned with Java agent unless caller overrides
        if not self.is_ready() or not self._session_id:
            logger.warning("Cannot request password: connection not ready")
            return False

        if self._channel_password is not None:
            logger.debug("Channel password already known, skipping request_password")
            return True

        if not isinstance(self._channel_api, MessagingChannelApi):
            logger.warning("request_password requires MessagingChannelApi implementation")
            return False

        try:
            # use utility to generate RSA keypair and wait for reply
            from hmdev.messaging.agent.util import password_utils as PWU

            priv_key, pub_pem = PWU.generate_rsa_keypair()

            # store pending private key and request id for correlation
            request_id = str(uuid4())
            self._pending_private_key = priv_key
            self._pending_request_id = request_id

            # send password-request with JSON { requestId, publicKeyPem }
            req_payload = json.dumps({"requestId": request_id, "publicKeyPem": pub_pem})
            self._channel_api.send(req_payload, '*', self._session_id, encrypted=False, event_type='password-request')

            # wait for a PASSWORD_REPLY addressed to this agent and matching request id
            success = PWU.wait_for_password_reply(
                agent_name=self.agent_name,
                receive=lambda cfg: self.receive(cfg),
                private_key=priv_key,
                channel_api=self._channel_api,
                connection_time=self.connection_time,
                expected_request_id=request_id,
                maybe_channel_name=maybe_channel_name,
                timeout_seconds=timeout_seconds or PASSWORD_WAIT_TIMEOUT_SECONDS,
                poll_interval=0.4
            )

            # clear pending key/request id after attempt
            self._pending_private_key = None
            self._pending_request_id = None

            if success:
                # if password obtained, try to keep agent-local copy in sync with channel_api state
                try:
                    # channel_api may expose channel_secret or channel_password
                    try:
                        self._channel_password = getattr(self._channel_api, 'channel_password', self._channel_password)
                    except Exception:
                        pass
                    try:
                        self.channel_secret = getattr(self._channel_api, 'channel_secret', self.channel_secret)
                    except Exception:
                        pass
                except Exception:
                    pass

            return bool(success)

        except Exception as e:
            logger.warning("request_password flow failed: %s", e)
            self._pending_private_key = None
            self._pending_request_id = None

        return False

    # --- Helpers for event processing ---
    def _verify_and_decrypt_message(self, ev: Any) -> Any:
        try:
            encrypted = ev.get('encrypted') if isinstance(ev, dict) else getattr(ev, 'encrypted', False)
            if encrypted:
                plain = MySecurity.decrypt_and_verify(ev.get('content', ''), self.channel_secret)
                if plain is not None:
                    ev['content'] = plain
                    ev['encrypted'] = False
        except Exception as e:
            logger.debug("Failed to decrypt event content: %s", e)
        return ev

    def _check_auto_events(self, events: List[Any]) -> None:
        for ev in events:
            try:
                etype = ev.get('type') if isinstance(ev, dict) else getattr(ev, 'type', None)
                edate = ev.get('date') if isinstance(ev, dict) else getattr(ev, 'date', None)

                # PASSWORD_REQUEST handling
                if etype == 'password-request' and (self.connection_time is None or (edate is not None and edate > self.connection_time)):
                    self._handle_password_request(ev)

                # PASSWORD_REPLY handling
                if etype == 'password-reply' and (self.connection_time is None or (edate is not None and edate > self.connection_time)):
                    to_field = ev.get('to') if isinstance(ev, dict) else getattr(ev, 'to', None)
                    if to_field == self.agent_name:
                        self._handle_password_reply(ev)

                # WebRTC signaling passthrough is out of scope here but could be added similarly
            except Exception as e:
                logger.debug("Error in auto event processing: %s", e)

    def _handle_password_reply(self, ev: Any) -> None:
        # Only process if we have a pending private key
        try:
            content = ev.get('content') if isinstance(ev, dict) else getattr(ev, 'content', None)
            if not content or not self._pending_private_key:
                return

            # content may be JSON wrapper { requestId, cipher } or raw base64
            cipher_b64 = None
            try:
                parsed = json.loads(content)
                if isinstance(parsed, dict):
                    cipher_b64 = parsed.get('cipher') or parsed.get('content')
            except Exception:
                cipher_b64 = content

            if not cipher_b64:
                return

            try:
                plain = MySecurity.rsa_decrypt(self._pending_private_key, cipher_b64)
                dec = plain if isinstance(plain, str) else plain.decode('utf-8')

                channel_name = None
                channel_password = dec
                try:
                    p = json.loads(dec)
                    if isinstance(p, dict):
                        if p.get('channelPassword'):
                            channel_password = p.get('channelPassword')
                        if p.get('channelName'):
                            channel_name = p.get('channelName')
                except Exception:
                    pass

                if channel_name and not self._channel_name:
                    self._channel_name = channel_name

                self._channel_password = channel_password

                if self._channel_name and self._channel_password:
                    try:
                        secret = MySecurity.derive_channel_secret(self._channel_name, self._channel_password)
                        self.channel_secret = secret
                        if hasattr(self._channel_api, 'set_channel_secret'):
                            try:
                                self._channel_api.set_channel_secret(secret)
                            except Exception:
                                try:
                                    setattr(self._channel_api, 'channel_secret', secret)
                                except Exception:
                                    pass
                        else:
                            try:
                                setattr(self._channel_api, 'channel_secret', secret)
                            except Exception:
                                pass
                    except Exception as e:
                        logger.warning('Failed deriving channel secret from PASSWORD_REPLY: %s', e)
                else:
                    # try to set raw password
                    try:
                        if hasattr(self._channel_api, 'set_channel_password'):
                            self._channel_api.set_channel_password(channel_password)
                        else:
                            setattr(self._channel_api, 'channel_password', channel_password)
                    except Exception:
                        pass

            except Exception as e:
                logger.warning('Failed to process PASSWORD_REPLY: %s', e)
        except Exception as e:
            logger.debug('Error in _handle_password_reply: %s', e)

    def _handle_password_request(self, ev: Any) -> None:
        try:
            requester_agent = ev.get('from') if isinstance(ev, dict) else getattr(ev, 'from', None)
            requester_pub_raw = ev.get('content') if isinstance(ev, dict) else getattr(ev, 'content', None)
            requester_pub = None
            try:
                requester_pub = json.loads(requester_pub_raw).get('publicKeyPem')
            except Exception:
                requester_pub = None

            allowed = True
            try:
                if callable(self.password_request_handler):
                    ch_id = None
                    try:
                        md = getattr(self._channel_api, 'channel_state', None)
                        if md and hasattr(md, 'channelId'):
                            ch_id = getattr(md, 'channelId')
                    except Exception:
                        ch_id = None
                    allowed = bool(self.password_request_handler(ch_id, requester_agent, requester_pub))
            except Exception as ex:
                logger.warning('password_request_handler raised: %s', ex)

            if allowed and self._channel_password and self._channel_name and requester_pub:
                try:
                    payload = json.dumps({"channelName": self._channel_name, "channelPassword": self._channel_password})
                    cipher_b64 = MySecurity.rsa_encrypt(requester_pub, payload)
                    # send password-reply using generic send (event_type = 'password-reply')
                    self._channel_api.send(cipher_b64, requester_agent, self._session_id, encrypted=False, event_type='password-reply')
                except Exception as e:
                    logger.warning('Failed to send PASSWORD_REPLY: %s', e)
        except Exception as e:
            logger.debug('Error in _handle_password_request: %s', e)
