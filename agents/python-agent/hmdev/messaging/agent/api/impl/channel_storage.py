"""Channel storage: a key-value store kept by the server, per channel, with versions.

The Python half of the JS agent's ``storage*`` methods, on the same endpoints
(``<api>/storage/put|add|get|getList|keys|values|deleteByKey``):

- ``put`` replaces every version of a key; ``add`` appends one. An ``add`` with
  ``append_only=True`` on a NEW key locks it: put and delete on it are then
  refused (409) for everyone, this session included.
- Values go over the wire as base64 of their UTF-8 text. A dict, list, number
  or bool is written as JSON and read back parsed; a str is written as is and
  read back as text (or parsed, when it happens to be JSON, as the JS agent does).
- ``encrypted=True`` stores ``MySecurity.encrypt_and_sign(text, channel_secret)``,
  the same envelope the JS agent writes, so either agent reads the other's values.
  Unlike the JS agent, asking to encrypt without a channel secret RAISES rather
  than storing the value in clear.

Failures raise :class:`StorageError`, so a failed read is never mistaken for an
empty one. A key with nothing stored reads as ``None`` (``get``) or ``[]``
(``get_list``).
"""
import base64
import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

import requests

from hmdev.messaging.agent.security.my_security import MySecurity

logger = logging.getLogger(__name__)

STORAGE_TIMEOUT_SECONDS = 30


class StorageError(Exception):
    """A storage call the server refused, or that never reached it.

    ``http_status`` is the server's status (None for a network failure), and
    ``append_only`` is True for a 409: the key is locked by an append-only add.
    """

    def __init__(self, message: str, http_status: Optional[int] = None) -> None:
        super().__init__(message)
        self.http_status = http_status
        self.append_only = http_status == 409


@dataclass
class StorageEntry:
    """One stored version, decoded to what was written.

    ``written_by`` is the agent name the writing session was connected under,
    stamped by the server; a name inside ``value`` is only the writer's claim.
    """
    value: Any
    written_by: Optional[str] = None
    append_only: bool = False
    encrypted: bool = False
    id: Optional[int] = None
    version: Optional[int] = None
    created_at: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


def _parse(text: str) -> Any:
    """A stored value as the app wrote it: JSON parsed back, anything else as text."""
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return text


def _as_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, str):
        return value
    # Compact, raw UTF-8: the same text JSON.stringify writes, so sizes and hashes agree.
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _is_envelope(text: str) -> bool:
    parsed = _parse(text)
    return isinstance(parsed, dict) and "cipher" in parsed and "hash" in parsed


class ChannelStorage:
    """Storage calls for one connection; get it from ``AgentConnection.storage``."""

    def __init__(self, api_url: str, session_id: Callable[[], Optional[str]],
                 channel_secret: Callable[[], Optional[str]], timeout: int = STORAGE_TIMEOUT_SECONDS) -> None:
        self._base = api_url.rstrip("/") + "/storage/"
        self._session_id = session_id
        self._channel_secret = channel_secret
        self._timeout = timeout

    # ---- writes ---------------------------------------------------------

    def put(self, key: str, value: Any, encrypted: bool = False,
            metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Replace every version of ``key``; answers the server's record of the write."""
        return self._write("put", key, value, encrypted, metadata, append_only=False)

    def add(self, key: str, value: Any, encrypted: bool = False,
            metadata: Optional[Dict[str, Any]] = None, append_only: bool = False) -> Dict[str, Any]:
        """Append a version of ``key``. The answer's ``appendOnly`` says whether the key is locked."""
        return self._write("add", key, value, encrypted, metadata, append_only)

    def delete_by_key(self, key: str) -> int:
        """Delete every version of ``key``; answers how many were deleted."""
        return int(self._post_json("deleteByKey", {"storageKey": key}).get("versionsDeleted", 0))

    def _write(self, endpoint: str, key: str, value: Any, encrypted: bool,
               metadata: Optional[Dict[str, Any]], append_only: bool) -> Dict[str, Any]:
        text = _as_text(value)
        if encrypted:
            secret = self._channel_secret()
            if not secret:
                raise StorageError("Encryption needs the channel secret; connect with the channel password")
            text = MySecurity.encrypt_and_sign(text, secret)
        payload = {
            "storageKey": key,
            "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
            "encrypted": bool(encrypted),
            "metadata": metadata or {"contentType": "application/json"},
        }
        if append_only:
            payload["appendOnly"] = True
        return self._post_json(endpoint, payload)

    # ---- reads ----------------------------------------------------------

    def get(self, key: str) -> Optional[StorageEntry]:
        """The latest version of ``key``, or None when nothing is stored under it."""
        r = self._post("get", {"storageKey": key})
        if r.status_code != 200:
            raise self._failure(r)
        # A missing key is a 200 with "{}"; only a stored value carries X-Storage-Key.
        if not r.headers.get("X-Storage-Key"):
            return None
        text = r.content.decode("utf-8")
        encrypted = r.headers.get("X-Storage-Encrypted") == "true"
        if encrypted:
            text = self._decrypt(text)
            if text is None:
                raise StorageError("Stored value of %r is encrypted under another channel secret" % key)
        return StorageEntry(
            value=_parse(text),
            written_by=r.headers.get("X-Storage-Written-By"),
            append_only=r.headers.get("X-Storage-Append-Only") == "true",
            encrypted=encrypted,
            id=int(r.headers["X-Storage-Id"]) if r.headers.get("X-Storage-Id") else None,
            version=int(r.headers["X-Storage-Version"]) if r.headers.get("X-Storage-Version") else None,
            metadata=_parse(r.headers["X-Storage-Metadata"]) if r.headers.get("X-Storage-Metadata") else None,
        )

    def get_list(self, key: str) -> List[StorageEntry]:
        """Every version of ``key``, NEWEST FIRST, decrypted where they were encrypted.

        A version this connection cannot decrypt (written under another channel
        password) is left out rather than returned as ciphertext.
        """
        versions = self._post_json("getList", {"storageKey": key}).get("versions") or []
        entries = []
        for v in versions:
            entry = self._list_entry(v)
            if entry is not None:
                entries.append(entry)
        return entries

    def keys(self) -> List[str]:
        """Every storage key of the channel."""
        return list(self._post_json("keys", {}).get("keys") or [])

    def values(self) -> List[Dict[str, Any]]:
        """Metadata (not content) of the latest version of every key."""
        return list(self._post_json("values", {}).get("values") or [])

    def _list_entry(self, v: Dict[str, Any]) -> Optional[StorageEntry]:
        text = base64.b64decode(v.get("content") or "").decode("utf-8")
        # getList carries no encrypted flag, so an envelope is recognised by its shape.
        encrypted = _is_envelope(text)
        if encrypted:
            text = self._decrypt(text)
            if text is None:
                return None
        return StorageEntry(
            value=_parse(text),
            written_by=v.get("writtenBy"),
            append_only=bool(v.get("appendOnly")),
            encrypted=encrypted,
            id=v.get("id"),
            version=v.get("version"),
            created_at=v.get("createdAt"),
            metadata=v.get("metadata"),
        )

    def _decrypt(self, envelope: str) -> Optional[str]:
        secret = self._channel_secret()
        return MySecurity.decrypt_and_verify(envelope, secret) if secret else None

    # ---- transport ------------------------------------------------------

    def _post(self, endpoint: str, body: Dict[str, Any]) -> requests.Response:
        session_id = self._session_id()
        if not session_id:
            raise StorageError("The channel is not ready.")
        try:
            return requests.post(self._base + endpoint, json=dict(body, sessionId=session_id),
                                 timeout=self._timeout)
        except requests.RequestException as e:
            raise StorageError("Network error: %s" % e) from e

    def _post_json(self, endpoint: str, body: Dict[str, Any]) -> Dict[str, Any]:
        """POST and unwrap the platform envelope {status, statusMessage, data}."""
        r = self._post(endpoint, body)
        if r.status_code != 200:
            raise self._failure(r)
        try:
            return r.json().get("data") or {}
        except ValueError as e:
            raise StorageError("Invalid response from storage/%s" % endpoint, r.status_code) from e

    @staticmethod
    def _failure(r: requests.Response) -> StorageError:
        """A non-200 answer; the server's own sentence when it sent one."""
        message = r.text or r.reason
        try:
            message = r.json().get("statusMessage") or message
        except ValueError:
            pass
        return StorageError(message, r.status_code)
