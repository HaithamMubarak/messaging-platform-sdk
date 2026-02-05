import argparse
import logging
import signal
import threading
import time

from hmdev.messaging.agent.core.local_tcp_server import LocalTcpServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


class Agent:
    """
    Minimal agent entrypoint that only manages the local TCP control server.
    """

    def __init__(self, tcp_port: int = 7071):
        self.tcp_port = tcp_port
        self.tcp_server = None
        self._stop_event = threading.Event()

    def start_tcp_server(self):
        logging.info("Starting Local TCP control server on localhost:%d", self.tcp_port)
        # LocalTcpServer is expected to provide start() and stop() methods.
        # It previously accepted an agent instance; this entrypoint intentionally
        # starts the server without wiring to a messaging agent.
        self.tcp_server = LocalTcpServer(self.tcp_port, None)
        self.tcp_server.start()

    def stop(self):
        logging.info("Stopping Agent and TCP server")
        if self.tcp_server:
            try:
                self.tcp_server.stop()
            except Exception:
                logging.exception("Error while stopping TCP server")
        self._stop_event.set()

    def wait_for_stop(self):
        # simple loop to keep process alive until signal
        while not self._stop_event.wait(timeout=1.0):
            time.sleep(0.01)


def main():
    parser = argparse.ArgumentParser(description="Python Agent - TCP control server only")
    parser.add_argument("--tcp-server", action="store_true", help="Run local TCP control server")
    parser.add_argument("--tcp-port", type=int, default=7071, help="Local TCP control port (default: 7071)")
    args = parser.parse_args()

    if not args.tcp_server:
        print("This entrypoint only implements the local TCP control server. Use --tcp-server to run it.")
        return

    agent = Agent(tcp_port=args.tcp_port)

    def _shutdown_handler(signum, frame):
        logging.info("Received shutdown signal (%s), stopping...", signum)
        agent.stop()

    signal.signal(signal.SIGINT, _shutdown_handler)
    signal.signal(signal.SIGTERM, _shutdown_handler)

    try:
        agent.start_tcp_server()
        agent.wait_for_stop()
    finally:
        agent.stop()
        logging.info("Agent stopped.")


if __name__ == "__main__":
    main()

