"""Managed channels, as the Python agent sends them.

A managed channel admits only agents its owner registered, each with a key.
The agent must send agentKey with connect when given one, and nothing extra
when not (ordinary channels see the same payload as before). A local server
stands in for the messaging service and records each connect body.

Run:  python -m unittest discover -s tests   (from agents/python-agent)
"""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from hmdev.messaging.agent.api.impl.messaging_channel_api import MessagingChannelApi

KEY = "k-0123456789abcdef0123456789"
CONNECTS = []


class StandIn(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 (http.server's name)
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0)
        if self.path.split("?")[0].endswith("/connect"):
            CONNECTS.append(json.loads(body or b"{}"))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"unauthorized","statusMessage":"stand-in"}')

    def log_message(self, *args):
        pass


class ManagedConnectTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), StandIn)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        CONNECTS.clear()

    def test_a_managed_agent_sends_its_key(self):
        api = MessagingChannelApi(self.url, developer_api_key="temp-key")
        api.connect_with_config({"channelId": "room-1", "agentName": "u-ann", "agentKey": KEY})
        self.assertEqual(CONNECTS[-1].get("agentKey"), KEY)
        self.assertEqual(CONNECTS[-1].get("agentName"), "u-ann")

    def test_an_ordinary_agent_sends_no_key(self):
        api = MessagingChannelApi(self.url, developer_api_key="temp-key")
        api.connect_with_config({"channelId": "room-2", "agentName": "plain"})
        self.assertNotIn("agentKey", CONNECTS[-1])


if __name__ == "__main__":
    unittest.main()
