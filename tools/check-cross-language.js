// Every agent must seal and open the same bytes: the JavaScript agent is the
// reference, each other language is a probe that reads JSON rows on stdin and
// answers with {secret, passwordHash, decoded, sealed, tampered}, and every
// pair of probes is then checked against each other (sealed by one, opened by
// the other). Usage:
//
//   node tools/check-cross-language.js --python <venv python> --java [<installDist lib dir>]
//
// The Java probe is com.hmdev.messaging.common.security.SecurityVectors on the
// classpath `./gradlew :agents:java-agent:installDist` produces.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { MySecurity } = require('../agents/web-agent-js');

const CHANNEL = 'compat-חדר', PASSWORD = 'test-كلمة';
const MESSAGES = ['', 'ASCII message', 'שלום / مرحبا / 🕹️', 'before\0after', 'multi-block '.repeat(100)];
const JAVA_LIB_DIR = path.join(__dirname, '..', 'agents', 'java-agent', 'build', 'install', 'java-agent', 'lib');

const PYTHON_PROBE = `
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

// name -> how to start the probe, given the CLI value for that language.
const PROBES = {
    python: {
        label: 'PYTHON',
        command: python => [python, ['-I', '-c', PYTHON_PROBE]],
    },
    java: {
        label: 'JAVA',
        command: libDir => ['java', ['-cp', path.join(libDir || JAVA_LIB_DIR, '*'),
            'com.hmdev.messaging.common.security.SecurityVectors']],
    },
};

async function referenceRows() {
    const rows = [];
    for (const message of MESSAGES) {
        const secret = await MySecurity.deriveChannelSecret(CHANNEL, PASSWORD);
        rows.push({ channel: CHANNEL, password: PASSWORD, secret, message, sealed: MySecurity.encryptAndSign(message, secret) });
    }
    return rows;
}

function runProbe(name, value, rows) {
    const [command, args] = PROBES[name].command(value);
    const child = spawnSync(command, args, { input: JSON.stringify(rows), encoding: 'utf8', timeout: 60000 });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, name + ' probe failed:\n' + child.stderr);
    const results = JSON.parse(child.stdout);
    assert.equal(results.length, rows.length, name + ' answered the wrong number of rows');
    return results;
}

function assertAgainstReference(name, rows, results) {
    const label = PROBES[name].label;
    rows.forEach((row, index) => {
        const result = results[index];
        assert.equal(result.secret, row.secret, label + ' channel secret');
        assert.equal(result.passwordHash, MySecurity.hash(row.password, row.secret), label + ' password hash');
        assert.equal(result.decoded, row.message, 'JS to ' + label + ', vector ' + index);
        assert.equal(MySecurity.decryptAndVerify(result.sealed, row.secret), row.message, label + ' to JS, vector ' + index);
        assert.equal(result.tampered, null, label + ' rejects invalid HMAC');
        const invalid = JSON.parse(result.sealed); invalid.hash = '0'.repeat(64);
        assert.equal(MySecurity.decryptAndVerify(invalid, row.secret), null, 'JS rejects invalid HMAC');
    });
    console.log(label + '/JS COMPATIBILITY PASSED: ' + rows.length + ' bidirectional vectors, channel secrets, password hashes and tamper rejection');
}

// Rows sealed by `from`, opened by `to` — the pair JS never sits between.
function assertCrossPair(from, to, values, rows, fromResults) {
    const crossRows = rows.map((row, index) => ({ ...row, sealed: fromResults[index].sealed }));
    const results = runProbe(to, values[to], crossRows);
    rows.forEach((row, index) => {
        assert.equal(results[index].decoded, row.message, PROBES[from].label + ' to ' + PROBES[to].label + ', vector ' + index);
        assert.equal(results[index].tampered, null, PROBES[to].label + ' rejects tampered ' + PROBES[from].label + ' envelope');
    });
    console.log(PROBES[from].label + ' to ' + PROBES[to].label + ' PASSED: ' + rows.length + ' vectors');
}

// values: { python: '<exe>', java: '<lib dir>' } — only the languages present run.
async function main(values) {
    const names = Object.keys(PROBES).filter(name => name in values);
    if (names.length === 0) throw new Error('Nothing to check: pass --python <exe> and/or --java [<lib dir>].');
    const rows = await referenceRows();
    const results = {};
    for (const name of names) {
        results[name] = runProbe(name, values[name], rows);
        assertAgainstReference(name, rows, results[name]);
    }
    for (const from of names) {
        for (const to of names) {
            if (from !== to) assertCrossPair(from, to, values, rows, results[from]);
        }
    }
    console.log('CROSS-LANGUAGE CHECK PASSED: JS, ' + names.map(name => PROBES[name].label).join(', ') + ' agree on secrets, hashes and sealed messages');
}

function parseArguments(argv) {
    const values = {};
    for (let index = 0; index < argv.length; index++) {
        const name = argv[index].replace(/^--/, '');
        if (!(name in PROBES)) throw new Error('Unknown option ' + argv[index]);
        const next = argv[index + 1];
        values[name] = next && !next.startsWith('--') ? argv[++index] : undefined;
        if (name === 'python' && !values[name]) throw new Error('--python needs the consumer Python executable');
    }
    if ('java' in values && !fs.existsSync(values.java || JAVA_LIB_DIR)) {
        throw new Error('Java lib dir not found (run ./gradlew :agents:java-agent:installDist): ' + (values.java || JAVA_LIB_DIR));
    }
    return values;
}

module.exports = { main };

if (require.main === module) {
    main(parseArguments(process.argv.slice(2))).catch(error => { console.error(error); process.exitCode = 1; });
}
