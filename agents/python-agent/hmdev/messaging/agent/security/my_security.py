import base64
import hmac, hashlib
import json
import logging

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization

from hmdev.messaging.agent.security.aes_ctr import AesCtr

logger = logging.getLogger(__name__)


class MySecurity:
    """Static-like utility class for encryption, signing, and verification."""

    def __init__(self):
        raise RuntimeError("No instances allowed")

    @staticmethod
    def encrypt_and_sign(message: str, key: str) -> str:
        data = {
            "cipher": MySecurity.encrypt(message, key),
            "hash": MySecurity.hash(message, key),
        }
        return json.dumps(data)

    @staticmethod
    def decrypt_and_verify(cipher_msg_str: str, key: str) -> str | None:
        try:
            cipher_msg = json.loads(cipher_msg_str)
            message = MySecurity.decrypt(cipher_msg.get("cipher", ""), key)

            if message is None:
                return None

            if MySecurity.hash(message, key).strip() != cipher_msg.get("hash", "").strip():
                return None
            return message
        except Exception as e:
            logger.debug(f"decrypt_with_md5_auth error: {e}")
            return None

    # ------------------ AES CTR helper ------------------

    @staticmethod
    def encrypt(plain: str, key: str) -> str:
        try:
            return AesCtr.encrypt(plain, key, 128)
        except Exception as e:
            logger.debug(f"encrypt error: {e}")
            return ""

    @staticmethod
    def decrypt(cipher: str, key: str) -> str | None:
        try:
            return AesCtr.decrypt(cipher, key, 128)
        except Exception as e:
            logger.debug(f"decrypt error: {e}")
            return None

    # ------------------ RSA helpers ------------------
    @staticmethod
    def rsa_generate(key_size: int = 2048):
        """Generate RSA private key and return (private_key_obj, public_key_pem_str)."""
        priv = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
        pub_pem = priv.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode('utf-8')
        return priv, pub_pem

    @staticmethod
    def _load_public_key(key_str: str):
        s = key_str.strip()
        try:
            if "-----BEGIN" in s:
                # PEM
                return serialization.load_pem_public_key(s.encode('utf-8'), backend=default_backend())
            else:
                # try URL-safe base64 first, then regular base64
                try:
                    data = base64.urlsafe_b64decode(s + '==')
                except Exception:
                    data = base64.b64decode(s)
                return serialization.load_der_public_key(data, backend=default_backend())
        except Exception as e:
            logger.debug(f"_load_public_key error: {e}")
            raise

    @staticmethod
    def _load_private_key(key_str: str):
        s = key_str.strip()
        try:
            if "-----BEGIN" in s:
                # PEM
                return serialization.load_pem_private_key(s.encode('utf-8'), password=None, backend=default_backend())
            else:
                # try URL-safe base64 then regular base64
                try:
                    data = base64.urlsafe_b64decode(s + '==')
                except Exception:
                    data = base64.b64decode(s)
                return serialization.load_der_private_key(data, password=None, backend=default_backend())
        except Exception as e:
            logger.debug(f"_load_private_key error: {e}")
            raise

    @staticmethod
    def rsa_encrypt(public_key, plaintext: str) -> str:
        """Encrypt plaintext string with a public key.

        public_key may be either a PEM/base64 string or a public key object.
        Returns base64 ciphertext string.
        """
        try:
            if isinstance(public_key, str):
                pub = MySecurity._load_public_key(public_key)
            else:
                pub = public_key

            ct = pub.encrypt(
                plaintext.encode('utf-8'),
                padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
            )
            return base64.b64encode(ct).decode('ascii')
        except Exception as e:
            logger.debug(f"rsa_encrypt error: {e}")
            raise

    @staticmethod
    def rsa_decrypt(private_key, base64_cipher: str) -> str:
        """Decrypt base64 ciphertext with a private key.

        private_key may be either a PEM/base64 string or a private key object. Returns UTF-8 plaintext.
        """
        try:
            if isinstance(private_key, str):
                priv = MySecurity._load_private_key(private_key)
            else:
                priv = private_key

            ct = base64.b64decode(base64_cipher)
            plain = priv.decrypt(
                ct,
                padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
            )
            return plain.decode('utf-8')
        except Exception as e:
            logger.debug(f"rsa_decrypt error: {e}")
            raise

    # ------------------ Key derivation ------------------

    @staticmethod
    def derive_channel_secret(channel_name: str, password: str) -> str:
        combined = (channel_name + password).encode()
        salt = b"messaging-platform"  # must match JS
        iterations = 100_000
        key_length = 32  # 256 bits

        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=key_length,
            salt=salt,
            iterations=iterations,
            backend=default_backend(),
        )
        key_bytes = kdf.derive(combined)
        return 'channel_' + base64.urlsafe_b64encode(key_bytes).rstrip(b'=').decode('ascii')

    # ------------------ MD5 Hash ------------------

    @staticmethod
    def hash(msg: str, key_str: str) -> str:
        try:
            # return hashlib.sha256(msg.encode("utf-8")).hexdigest()
            return hmac.new(key_str.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()
        except Exception as e:
            logger.warning(f"hash error: {e}")
            return None
