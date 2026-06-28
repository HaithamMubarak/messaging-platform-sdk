#!/usr/bin/env python3
"""
ai_channel_agent.py

An AI-powered messaging agent that connects to a channel and responds to
messages using Claude AI (Anthropic SDK).

How it works:
  1. Connects to a channel with the Python messaging SDK
  2. Listens for incoming messages via receive_async
  3. Sends each message to Claude for processing
  4. Publishes Claude's reply back to the channel

Usage:
    python3 ai_channel_agent.py [options]

Required env vars (or pass as flags):
    MESSAGING_API_URL    — messaging service URL
    MESSAGING_API_KEY    — developer API key
    ANTHROPIC_API_KEY    — Anthropic API key

Options:
    --url            Messaging service URL
    --key            Developer API key (messaging)
    --anthropic-key  Anthropic API key
    --channel        Channel name             (default: ai-channel)
    --password       Channel password         (default: mypassword)
    --agent          Agent name               (default: claude-ai)
    --scope          API key scope: private|public (default: private)
    --model          Claude model ID          (default: claude-sonnet-4-6)
    --system         System prompt file path or inline text
    --history        Keep N turns of conversation history (default: 10)
    --no-context     Disable conversation history (stateless mode)
    --verbose        Print full message events
    --debug          Enable debug logging

Examples:
    export ANTHROPIC_API_KEY=sk-ant-...
    export MESSAGING_API_KEY=your-messaging-key
    python3 ai_channel_agent.py --channel myroom --password secret123 --agent claude-bot

    # Custom system prompt from file
    python3 ai_channel_agent.py --channel myroom --password s3cr3t --system ./my-system-prompt.txt

    # Stateless mode — every message treated independently
    python3 ai_channel_agent.py --channel myroom --password s3cr3t --no-context
"""

import argparse
import logging
import os
import signal
import sys
import time
from collections import deque
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_MESSAGING_URL = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service"
DEFAULT_MODEL         = "claude-sonnet-4-6"
DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful AI assistant embedded in a real-time messaging channel. "
    "Keep replies concise and conversational. "
    "When someone asks a question, answer it directly. "
    "You are aware that multiple users may be in the channel."
)
MAX_HISTORY_TURNS     = 10
IGNORED_EVENT_TYPES   = {"agent-connect", "agent-disconnect", "ping", "pong"}

# Candidate paths for the services repo .env file, checked in order
_SERVICES_ENV_CANDIDATES = [
    # Relative to this script's location (scripts/ → sdk root → sibling services repo)
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "..", "messaging-platform-services", ".env"),
    # Common monorepo layout
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "..", "..", "messaging-platform-services", ".env"),
]


# ── .env loader ──────────────────────────────────────────────────────────────

def parse_dotenv(path: str) -> Dict[str, str]:
    """Parse a .env file into a dict, ignoring comments and blank lines."""
    result: Dict[str, str] = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, _, val = line.partition("=")
                result[key.strip()] = val.strip().strip('"').strip("'")
    except OSError:
        pass
    return result


def find_services_env(explicit_path: Optional[str] = None) -> Tuple[Dict[str, str], Optional[str]]:
    """
    Find and parse the services repo .env.
    Priority: explicit --env-file arg > SERVICES_ENV_FILE env var > auto-discovery candidates.
    Returns (parsed_dict, resolved_path_or_None).
    """
    candidates = []
    if explicit_path:
        candidates.append(explicit_path)
    env_file_from_env = os.environ.get("SERVICES_ENV_FILE")
    if env_file_from_env:
        candidates.append(env_file_from_env)
    candidates.extend(_SERVICES_ENV_CANDIDATES)

    for path in candidates:
        path = os.path.normpath(path)
        if os.path.isfile(path):
            return parse_dotenv(path), path

    return {}, None


# ── Logging ───────────────────────────────────────────────────────────────────

def setup_logging(debug: bool) -> None:
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    # Silence noisy libraries unless debug mode
    if not debug:
        logging.getLogger("urllib3").setLevel(logging.WARNING)
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("anthropic").setLevel(logging.WARNING)
        logging.getLogger("hmdev").setLevel(logging.WARNING)

log = logging.getLogger(__name__)


# ── Anthropic helper ──────────────────────────────────────────────────────────

class ClaudeClient:
    """Thin wrapper around the Anthropic SDK."""

    def __init__(self, api_key: str, model: str, system: str, max_history: int):
        try:
            import anthropic
            self._client  = anthropic.Anthropic(api_key=api_key)
        except ImportError:
            log.error("anthropic package not found. Install it with: python3 -m pip install anthropic --break-system-packages")
            sys.exit(1)

        self.model       = model
        self.system      = system
        self.max_history = max_history
        # deque of {"role": "user"|"assistant", "content": str}
        self._history: deque = deque()

    def chat(self, user_input: str, from_agent: Optional[str] = None) -> str:
        """Send a message to Claude and return the response text."""
        content = f"[{from_agent}]: {user_input}" if from_agent else user_input

        self._history.append({"role": "user", "content": content})
        if len(self._history) > self.max_history * 2:
            # Drop oldest turn (2 messages per turn)
            self._history.popleft()
            self._history.popleft()

        messages = list(self._history)

        try:
            response = self._client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=self.system,
                messages=messages,
            )
            reply = response.content[0].text
            self._history.append({"role": "assistant", "content": reply})
            return reply

        except Exception as e:
            log.error("Claude API error: %s", e)
            # Remove the user message we just added so history stays consistent
            self._history.pop()
            return f"[AI error: {e}]"

    def chat_stateless(self, user_input: str, from_agent: Optional[str] = None) -> str:
        """Single-turn chat with no conversation history."""
        content = f"[{from_agent}]: {user_input}" if from_agent else user_input
        try:
            response = self._client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=self.system,
                messages=[{"role": "user", "content": content}],
            )
            return response.content[0].text
        except Exception as e:
            log.error("Claude API error: %s", e)
            return f"[AI error: {e}]"


# ── Message handler ───────────────────────────────────────────────────────────

class AIMessageHandler:
    """
    AgentConnectionEventHandler implementation.
    Receives message events, filters them, passes to Claude, and replies.
    """

    def __init__(
        self,
        agent,          # AgentConnection instance
        claude: ClaudeClient,
        agent_name: str,
        stateless: bool,
        verbose: bool,
    ):
        self.agent      = agent
        self.claude     = claude
        self.agent_name = agent_name
        self.stateless  = stateless
        self.verbose    = verbose

    def on_message_events(self, message_events: List[Dict[str, Any]]) -> None:
        for event in message_events:
            try:
                self._handle_event(event)
            except Exception as e:
                log.warning("Error handling event: %s | event=%s", e, event)

    def _handle_event(self, event: Dict[str, Any]) -> None:
        from_agent = event.get("from") or event.get("fromAgent") or "unknown"
        content    = event.get("content") or ""
        msg_type   = event.get("type") or ""

        if self.verbose:
            log.debug("EVENT: %s", event)

        # Skip own messages (avoid infinite loops)
        if from_agent == self.agent_name:
            return

        # Skip non-chat events
        if msg_type in IGNORED_EVENT_TYPES:
            log.info("[presence] %s: %s", msg_type, from_agent)
            return

        if not content.strip():
            log.debug("Skipping empty message from %s", from_agent)
            return

        log.info("[%s] %s: %s", msg_type or "msg", from_agent, content[:200])

        # Get Claude's response
        if self.stateless:
            reply = self.claude.chat_stateless(content, from_agent=from_agent)
        else:
            reply = self.claude.chat(content, from_agent=from_agent)

        log.info("[claude -> %s]: %s", from_agent, reply[:200])

        # Send reply targeted at the sender
        sent = self.agent.send_message(reply, destination=from_agent)
        if not sent:
            log.warning("send_message returned False — may not have reached %s", from_agent)


# ── Main ──────────────────────────────────────────────────────────────────────

def load_system_prompt(value: Optional[str]) -> str:
    """Load system prompt from file path or return as literal string."""
    if not value:
        return DEFAULT_SYSTEM_PROMPT
    if os.path.isfile(value):
        with open(value) as f:
            return f.read().strip()
    return value.strip()


def main():
    parser = argparse.ArgumentParser(
        description="AI-powered messaging channel agent (Claude + messaging SDK)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--url",           default=None, help="Messaging service URL (default: auto from services .env or MESSAGING_API_URL)")
    parser.add_argument("--key",           default=None, help="Messaging developer API key (default: auto from services .env DEFAULT_API_KEY)")
    parser.add_argument("--anthropic-key", default=None, help="Anthropic API key (default: ANTHROPIC_API_KEY env var)")
    parser.add_argument("--env-file",      default=None, help="Path to services repo .env file (auto-discovered if not set)")
    parser.add_argument("--channel",       default="ai-channel",  help="Channel name")
    parser.add_argument("--password",      default="mypassword",  help="Channel password")
    parser.add_argument("--agent",         default="claude-ai",   help="Agent name in the channel")
    parser.add_argument("--scope",         default="private",     choices=["private", "public"])
    parser.add_argument("--model",         default=DEFAULT_MODEL, help="Claude model ID")
    parser.add_argument("--system",        default=None,          help="System prompt text or path to .txt file")
    parser.add_argument("--history",       default=MAX_HISTORY_TURNS, type=int, help="Conversation turns to keep")
    parser.add_argument("--no-context",    action="store_true",   help="Stateless mode — no history")
    parser.add_argument("--verbose",       action="store_true",   help="Print raw message events")
    parser.add_argument("--debug",         action="store_true",   help="Enable debug logging")

    args = parser.parse_args()
    setup_logging(args.debug)

    # ── Load services .env for defaults ───────────────────────────────────────
    services_env, services_env_path = find_services_env(args.env_file)
    if services_env_path:
        log.info("Loaded services .env from: %s", services_env_path)
    else:
        log.debug("No services .env found — using env vars and defaults only")

    # ── Resolve config (priority: CLI arg > env var > services .env > hardcoded) ─
    messaging_url = (
        args.url
        or os.environ.get("MESSAGING_API_URL")
        or services_env.get("MESSAGING_API_URL")
        or DEFAULT_MESSAGING_URL
    )
    messaging_key = (
        args.key
        or os.environ.get("MESSAGING_API_KEY")
        or services_env.get("DEFAULT_API_KEY")
        or ""
    )
    anthropic_key = (
        args.anthropic_key
        or os.environ.get("ANTHROPIC_API_KEY")
        or ""
    )
    system_prompt = load_system_prompt(args.system)

    if messaging_key:
        src = "CLI" if args.key else ("MESSAGING_API_KEY" if os.environ.get("MESSAGING_API_KEY") else "services .env DEFAULT_API_KEY")
        log.info("Messaging API key loaded from: %s", src)
    else:
        log.warning("No messaging API key found — channel must allow anonymous access.")

    if not anthropic_key:
        log.error("Anthropic API key not set. Use --anthropic-key or set ANTHROPIC_API_KEY env var.")
        sys.exit(1)

    log.info("═══════════════════════════════════════════════")
    log.info("  AI Channel Agent starting")
    log.info("  Channel  : %s", args.channel)
    log.info("  Agent    : %s", args.agent)
    log.info("  Model    : %s", args.model)
    log.info("  Mode     : %s", "stateless" if args.no_context else f"conversational (history={args.history})")
    log.info("═══════════════════════════════════════════════")

    # ── Build Claude client ───────────────────────────────────────────────────
    claude = ClaudeClient(
        api_key=anthropic_key,
        model=args.model,
        system=system_prompt,
        max_history=args.history,
    )
    log.info("Claude client initialized (model=%s)", args.model)

    # ── Import Python SDK ─────────────────────────────────────────────────────
    try:
        sdk_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "agents", "python-agent"
        )
        if sdk_path not in sys.path:
            sys.path.insert(0, sdk_path)

        from hmdev.messaging.agent.core.agent_connection import AgentConnection
        from hmdev.messaging.agent.core.agent_connection_event_handler import AgentConnectionEventHandler
    except ImportError as e:
        log.error("Could not import Python messaging SDK: %s", e)
        log.error("Make sure you're running from the messaging-platform-sdk root directory.")
        log.error("Or install it: pip install -e agents/python-agent")
        sys.exit(1)

    # ── Connect to channel ────────────────────────────────────────────────────
    log.info("Connecting to channel '%s'...", args.channel)

    if messaging_key:
        agent = AgentConnection.with_api_key(api_url=messaging_url, developer_api_key=messaging_key)
    else:
        agent = AgentConnection(api_url=messaging_url)

    ok = agent.connect(config={
        "channelName":      args.channel,
        "channelPassword":  args.password,
        "agentName":        args.agent,
        "apiKeyScope":      args.scope,
        "pollSource":       "AUTO",
    })

    if not ok:
        log.error("connect() failed. Check URL, API key, channel name, and password.")
        sys.exit(1)

    log.info("Connected! Session: %s", agent._session_id)
    log.info("Listening for messages... (Ctrl+C to exit)")

    # ── Announce presence ─────────────────────────────────────────────────────
    intro = f"Hello! I'm {args.agent}, an AI assistant powered by Claude. Ask me anything!"
    agent.send_message(intro)

    # ── Wire up the async handler ─────────────────────────────────────────────
    dispatcher = AIMessageHandler(
        agent=agent,
        claude=claude,
        agent_name=args.agent,
        stateless=args.no_context,
        verbose=args.verbose,
    )

    # Subclass the abstract handler inside main() so we capture `dispatcher`
    class _HandlerBridge(AgentConnectionEventHandler):
        def on_message_events(self, message_events: List[Dict[str, Any]]) -> None:
            dispatcher.on_message_events(message_events)

    agent.receive_async(_HandlerBridge())

    # ── Keep-alive until interrupted ──────────────────────────────────────────
    def on_exit(sig, frame):
        log.info("Shutting down...")
        try:
            agent.send_message(f"{args.agent} is going offline. Goodbye!")
        except Exception:
            pass
        agent.disconnect()
        log.info("Disconnected.")
        sys.exit(0)

    signal.signal(signal.SIGINT,  on_exit)
    signal.signal(signal.SIGTERM, on_exit)

    while agent.is_ready():
        time.sleep(1)

    log.warning("Agent is no longer ready — exiting.")


if __name__ == "__main__":
    main()
