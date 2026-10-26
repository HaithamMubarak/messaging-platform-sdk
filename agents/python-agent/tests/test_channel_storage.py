"""Channel storage, as the Python agent speaks it.

A local stand-in keeps what is written and answers in the shapes production
answered on 2026-10-26 (captured with a raw requests session against
/storage/*): the platform envelope for put/add/getList/keys/deleteByKey, raw
bytes plus X-Storage-* headers for get, "{}" with no X-Storage-Key for a
missing key, and 409 with a statusMessage for a write to an append-only key.

Run:  python -m unittest discover -s tests   (from agents/python-agent)
"""
import base64
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from hmdev.messaging.agent.api.impl.channel_storage import ChannelStorage, StorageError
from hmdev.messaging.agent.security.my_security import MySecurity

SESSION = "s-1"
STORE = {}      # key -> list of {content(b64), appendOnly, encrypted}, newest last
REQUESTS = []


def envelope(data, status=200, message=None):
    return status, {"status": "success" if status == 200 else "error", "statusMessage": message, "data": data}


def answer(endpoint, body):
    key = body.get("storageKey")
    versions = STORE.get(key, [])
    if body.get("sessionId") != SESSION:
        return envelope(None, 401, "Invalid session ID")
    if endpoint in ("put", "add"):
        locked = bool(versions) and versions[0]["appendOnly"]
        if endpoint == "put" and locked:
            return envelope(None, 409, "Storage key is append-only: " + key)
        row = {"content": body["content"], "encrypted": body["encrypted"],
               "appendOnly": locked or (not versions and bool(body.get("appendOnly")))}
        STORE[key] = (versions if endpoint == "add" else []) + [row]
        return envelope({"storageKey": key, "writtenBy": "ann", "appendOnly": row["appendOnly"], "operation": endpoint})
    if endpoint == "getList":
        listed = [{"id": i + 1, "content": v["content"], "writtenBy": "ann", "appendOnly": v["appendOnly"],
                   "version": 0, "createdAt": "2026-10-26T10:45:21.029+00:00"} for i, v in enumerate(versions)]
        return envelope({"storageKey": key, "versionCount": len(listed), "versions": listed[::-1]})
    if endpoint == "keys":
        return envelope({"keyCount": len(STORE), "keys": sorted(STORE)})
    if endpoint == "deleteByKey":
        if versions and versions[0]["appendOnly"]:
            return envelope(None, 409, "Storage key is append-only: " + key)
        STORE.pop(key, None)
        return envelope({"storageKey": key, "message": "Storage deleted", "versionsDeleted": len(versions)})
    return envelope(None, 404, "no such endpoint")


class StandIn(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 (http.server's name)
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        endpoint = self.path.rsplit("/", 1)[-1]
        REQUESTS.append((endpoint, body))
        if endpoint == "get":
            return self._get(body)
        status, reply = answer(endpoint, body)
        self._send(status, json.dumps(reply).encode(), {})

    def _get(self, body):
        versions = STORE.get(body.get("storageKey"))
        if not versions:
            return self._send(200, b"{}", {})
        v = versions[-1]
        self._send(200, base64.b64decode(v["content"]), {
            "X-Storage-Key": body["storageKey"], "X-Storage-Encrypted": str(v["encrypted"]).lower(),
            "X-Storage-Id": "2807", "X-Storage-Written-By": "ann",
            "X-Storage-Append-Only": str(v["appendOnly"]).lower(),
            "X-Storage-Metadata": '{"contentType":"application/json"}'})

    def _send(self, status, payload, headers):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


class ChannelStorageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), StandIn)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = "http://127.0.0.1:%d/api" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        STORE.clear()
        REQUESTS.clear()
        self.secret = MySecurity.derive_channel_secret("parity-room", "pw-123456")
        self.storage = self._storage(SESSION, self.secret)

    def _storage(self, session, secret):
        return ChannelStorage(self.url, session_id=lambda: session, channel_secret=lambda: secret)

    def test_a_value_round_trips_as_written(self):
        self.storage.put("board", {"turn": 3, "name": "Zoë"})
        endpoint, body = REQUESTS[-1]
        self.assertEqual(endpoint, "put")
        self.assertEqual(body["sessionId"], SESSION)
        self.assertEqual(json.loads(base64.b64decode(body["content"])), {"turn": 3, "name": "Zoë"})
        self.assertNotIn("appendOnly", body)
        entry = self.storage.get("board")
        self.assertEqual(entry.value, {"turn": 3, "name": "Zoë"})
        self.assertEqual(entry.written_by, "ann")
        self.assertEqual(entry.id, 2807)
        self.assertEqual(self.storage.get_list("board")[0].value, {"turn": 3, "name": "Zoë"})

    def test_plain_text_reads_back_as_text(self):
        self.storage.put("note", "hello, not json")
        self.assertEqual(self.storage.get("note").value, "hello, not json")

    def test_a_missing_key_is_none_not_an_empty_object(self):
        self.assertIsNone(self.storage.get("nothing"))
        self.storage.put("empty-object", {})
        self.assertEqual(self.storage.get("empty-object").value, {})
        self.assertEqual(self.storage.get_list("nothing"), [])

    def test_an_encrypted_value_is_ciphertext_on_the_wire(self):
        self.storage.put("secret", {"pin": 1234}, encrypted=True)
        wire = base64.b64decode(REQUESTS[-1][1]["content"]).decode()
        self.assertNotIn("1234", wire)
        self.assertEqual(MySecurity.decrypt_and_verify(wire, self.secret), '{"pin":1234}')
        self.assertTrue(REQUESTS[-1][1]["encrypted"])
        entry = self.storage.get("secret")
        self.assertEqual(entry.value, {"pin": 1234})
        self.assertTrue(entry.encrypted)

    def test_a_list_leaves_out_what_another_secret_wrote(self):
        self.storage.add("log", "mine", encrypted=True)
        self.storage.add("log", "plain")
        other = self._storage(SESSION, MySecurity.derive_channel_secret("parity-room", "other-pw"))
        self.assertEqual([e.value for e in other.get_list("log")], ["plain"])
        self.assertEqual([e.value for e in self.storage.get_list("log")], ["plain", "mine"])

    def test_the_latest_encrypted_value_refuses_another_secret(self):
        self.storage.put("secret", "x", encrypted=True)
        other = self._storage(SESSION, MySecurity.derive_channel_secret("parity-room", "other-pw"))
        with self.assertRaises(StorageError):
            other.get("secret")

    def test_encrypting_without_a_secret_refuses_instead_of_writing_clear(self):
        with self.assertRaises(StorageError):
            self._storage(SESSION, None).put("secret", "x", encrypted=True)
        self.assertEqual(REQUESTS, [])

    def test_an_append_only_key_refuses_put_and_delete(self):
        self.assertTrue(self.storage.add("log", "one", append_only=True)["appendOnly"])
        self.storage.add("log", "two")
        self.assertEqual(REQUESTS[-1][1].get("appendOnly"), None)
        for attempt in (lambda: self.storage.put("log", "x"), lambda: self.storage.delete_by_key("log")):
            with self.assertRaises(StorageError) as caught:
                attempt()
            self.assertTrue(caught.exception.append_only)
            self.assertEqual(str(caught.exception), "Storage key is append-only: log")
        self.assertEqual([e.value for e in self.storage.get_list("log")], ["two", "one"])

    def test_keys_and_delete(self):
        self.storage.put("a", 1)
        self.storage.add("b", 2)
        self.assertEqual(self.storage.keys(), ["a", "b"])
        self.assertEqual(self.storage.delete_by_key("a"), 1)
        self.assertEqual(self.storage.keys(), ["b"])

    def test_a_refused_session_raises_with_the_status(self):
        with self.assertRaises(StorageError) as caught:
            self._storage("stale", None).keys()
        self.assertEqual(caught.exception.http_status, 401)
        self.assertEqual(str(caught.exception), "Invalid session ID")

    def test_not_connected_raises_without_a_request(self):
        with self.assertRaises(StorageError):
            self._storage(None, None).get("a")
        self.assertEqual(REQUESTS, [])


if __name__ == "__main__":
    unittest.main()
