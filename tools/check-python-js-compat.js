// Exercise real SDK implementations, with Python imported from an installed consumer.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { MySecurity } = require('../agents/web-agent-js');
const python = process.argv[2];
if (!python) throw new Error('Pass the installed consumer Python executable.');
const probe = `
import json, sys
from hmdev.messaging.agent.security.my_security import MySecurity as S
rows = json.loads(sys.stdin.buffer.read().decode('utf-8'))
results = []
for row in rows:
    key = S.derive_channel_secret(row['channel'], row['password'])
    invalid = json.loads(row['sealed'])
    invalid['hash'] = '0' * 64
    results.append(dict(secret=key, passwordHash=S.hash(row['password'], key),
        decoded=S.decrypt_and_verify(row['sealed'], key),
        sealed=S.encrypt_and_sign(row['message'], key),
        tampered=S.decrypt_and_verify(json.dumps(invalid), key)))
print(json.dumps(results, ensure_ascii=True))
`;

async function main() {
    const messages = ['', 'ASCII message', 'שלום / مرحبا / 🕹️', 'before\0after', 'multi-block '.repeat(100)];
    const rows = [];
    for (const message of messages) {
        const channel = 'compat-חדר', password = 'test-كلمة';
        const secret = await MySecurity.deriveChannelSecret(channel, password);
        rows.push({ channel, password, secret, message, sealed: MySecurity.encryptAndSign(message, secret) });
    }
    const child = spawnSync(python, ['-I', '-c', probe], {
        input: JSON.stringify(rows), encoding: 'utf8', timeout: 30000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr);
    const results = JSON.parse(child.stdout);
    assert.equal(results.length, rows.length);
    rows.forEach((row, index) => {
        const result = results[index];
        assert.equal(result.secret, row.secret, 'channel secret');
        assert.equal(result.passwordHash, MySecurity.hash(row.password, row.secret), 'password hash');
        assert.equal(result.decoded, row.message, 'JS to Python, vector ' + index);
        assert.equal(MySecurity.decryptAndVerify(result.sealed, row.secret), row.message, 'Python to JS, vector ' + index);
        assert.equal(result.tampered, null, 'Python rejects invalid HMAC');
        const invalid = JSON.parse(result.sealed); invalid.hash = '0'.repeat(64);
        assert.equal(MySecurity.decryptAndVerify(invalid, row.secret), null, 'JS rejects invalid HMAC');
    });
    console.log('PYTHON/JS COMPATIBILITY PASSED: 5 bidirectional vectors, channel secrets, password hashes and tamper rejection');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
