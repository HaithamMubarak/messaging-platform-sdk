"""Build an sdist and wheel, then install each into a fresh consumer environment."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import venv


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "agents" / "python-agent"
PROBE = r'''
import importlib
import importlib.metadata as metadata
from pathlib import Path
import pkgutil
import sys
import hmdev
from hmdev.messaging.agent.security.my_security import MySecurity
from hmdev.messaging.agent.api.impl.ws_channel_client import WsChannelClient

assert Path(hmdev.__file__).resolve().is_relative_to(Path(sys.prefix).resolve()), "import escaped consumer"
for module in pkgutil.walk_packages(hmdev.__path__, hmdev.__name__ + "."):
    importlib.import_module(module.name)
requires = metadata.requires("hmdev-messaging-agent") or []
for dependency in ("requests", "cryptography", "pycryptodome", "websocket-client"):
    assert any(item.startswith(dependency) for item in requires), "missing dependency: " + dependency
message = "installed consumer: שלום / مرحبا / 🕹️"
sealed = MySecurity.encrypt_and_sign(message, "package-test-key")
assert MySecurity.decrypt_and_verify(sealed, "package-test-key") == message
assert MySecurity.decrypt_and_verify(sealed, "wrong-key") is None
print("Installed package imports, dependencies and crypto passed")
'''


def run(*args, cwd):
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)
    environment.pop("PYTHONHOME", None)
    subprocess.run([str(arg) for arg in args], cwd=cwd, env=environment, check=True)


def environment(directory):
    venv.EnvBuilder(with_pip=True).create(directory)
    return directory / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def verify(artifact, directory):
    python = environment(directory)
    run(python, "-m", "pip", "install", artifact, cwd=directory)
    run(python, "-m", "pip", "check", cwd=directory)
    run(python, "-I", "-c", PROBE, cwd=directory)
    command = python.parent / ("hmdev-agent.exe" if os.name == "nt" else "hmdev-agent")
    run(command, "--help", cwd=directory)
    run("node", ROOT / "tools" / "check-python-js-compat.js", python, cwd=directory)


def main():
    with tempfile.TemporaryDirectory(prefix="hmdev-python-release-") as temporary:
        work = Path(temporary)
        python = environment(work / "builder")
        run(python, "-m", "pip", "install", "build", cwd=work)
        # Default build builds the wheel FROM the sdist: omitted source files fail here.
        run(python, "-m", "build", "--outdir", work / "dist", SOURCE, cwd=work)
        artifacts = sorted((work / "dist").iterdir())
        assert len(artifacts) == 2 and {p.suffix for p in artifacts} == {".whl", ".gz"}
        for index, artifact in enumerate(artifacts):
            verify(artifact, work / ("consumer-" + str(index)))
        print("PYTHON PACKAGE CHECK PASSED: clean sdist and wheel consumers, CLI and dependency checks")


if __name__ == "__main__":
    main()
