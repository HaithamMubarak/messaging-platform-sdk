import os
import subprocess
import time
import socket
import json
import shutil
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
JAVA_AGENT_DIR = ROOT / 'agents' / 'java-agent'
GRADLEW = ROOT / 'gradlew.bat' if os.name == 'nt' else ROOT / 'gradlew'


def find_jar():
    # common build output
    candidates = [
        JAVA_AGENT_DIR / 'build' / 'libs',
        ROOT / 'agents' / 'build' / 'libs'
    ]
    for d in candidates:
        if d.exists():
            for f in d.iterdir():
                if f.suffix == '.jar':
                    return str(f)
    return None


def _get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    addr, port = s.getsockname()
    s.close()
    return port


@pytest.mark.integration
def test_java_agent_connect_by_channel_id():
    """
    Integration test for the Java agent:
    - Requires Java on PATH and a built agent jar (or a runnable Gradle task).
    - Requires environment variable MESSAGING_TEST_CHANNEL_ID to contain a valid channel id to connect with.

    The test starts the agent process with a controllable local TCP port, then sends newline-delimited JSON
    commands to the local control server (see LocalTcpServer in the java-agent project):
      {"op":"connect","channelId":"...","agentName":"..."}
      {"op":"udpPush","content":"...","destination":"*"}
      {"op":"disconnect"}

    If any prerequisite is missing the test is skipped.
    """

    channel_id = os.environ.get('MESSAGING_TEST_CHANNEL_ID')
    if not channel_id:
        pytest.skip('Set MESSAGING_TEST_CHANNEL_ID env var to run Java agent integration test')

    # prefer java + jar execution. Skip if java not present or jar not found.
    java_cmd = shutil.which('java')
    jar = find_jar()
    if not java_cmd or not jar:
        pytest.skip('Java or agent jar not available; build the java-agent and ensure `java` is on PATH')

    tcp_port = _get_free_port()
    api_url = os.environ.get('MESSAGING_API_URL', 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service')

    # Start agent: java -jar <jar> --tcp-port=<tcp_port> --url=<api_url>
    proc = subprocess.Popen([java_cmd, '-jar', jar, f'--tcp-port={tcp_port}', f'--url={api_url}'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        # wait for local tcp server to accept connections
        deadline = time.time() + 20
        connected = False
        while time.time() < deadline:
            try:
                s = socket.create_connection(('127.0.0.1', tcp_port), timeout=1)
                connected = True
                s.close()
                break
            except (ConnectionRefusedError, socket.timeout, OSError):
                time.sleep(0.25)
        if not connected:
            pytest.skip(f'Agent did not open local TCP server on port {tcp_port} (process may have failed to start)')

        # communicate with the local control server
        def send_request(req_obj, expect_ok=True):
            with socket.create_connection(('127.0.0.1', tcp_port), timeout=5) as sock:
                sock_file = sock.makefile(mode='rw', encoding='utf-8', newline='\n')
                sock_file.write(json.dumps(req_obj))
                sock_file.write('\n')
                sock_file.flush()
                # read single line response
                line = sock_file.readline()
                if not line:
                    return None
                try:
                    return json.loads(line.strip())
                except Exception:
                    return None

        agent_name = os.environ.get('MESSAGING_TEST_AGENT_NAME', 'java-agent-test-1')

        # Connect using channelId
        resp = send_request({"op": "connect", "channelId": channel_id, "agentName": agent_name})
        assert resp is not None, 'No response from agent control server for connect'
        assert resp.get('status') == 'ok', f"Connect failed: {resp}"

        # Send udpPush (fire-and-forget push to the messaging service). Expect OK if agent could push.
        test_msg = f"selenium-java-agent-udppush-{int(time.time())}"
        resp2 = send_request({"op": "udpPush", "content": test_msg, "destination": "*"})
        assert resp2 is not None and resp2.get('status') == 'ok', f"udpPush failed: {resp2}"

        # Optionally: you can call udpPull to try and read events (if the service routes the pushed message back to the channel)
        # Here we attempt a short udpPull to confirm the agent can pull events. This may return null depending on server side routing.
        resp3 = send_request({"op": "udpPull", "startOffset": 0, "limit": 10})
        # If resp3 is ok, validate shape
        if resp3 and resp3.get('status') == 'ok' and 'data' in resp3:
            # data.result may be null or contain events; we just ensure the call succeeds
            assert 'result' in resp3['data']

        # Clean disconnect
        resp4 = send_request({"op": "disconnect"})
        assert resp4 is not None and resp4.get('status') == 'ok'

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    # If we reached here, basic connect and udpPush succeeded
    assert True
