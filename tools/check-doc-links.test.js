const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-links-'));
try {
    fs.mkdirSync(path.join(root, 'tools'));
    const script = path.join(root, 'tools/check-doc-links.js');
    fs.copyFileSync(path.join(__dirname, 'check-doc-links.js'), script);
    fs.writeFileSync(path.join(root, 'USER-GUIDE.md'), '[Web](WEB-AGENT-GUIDE.md)');
    fs.writeFileSync(path.join(root, 'WEB-AGENT-GUIDE.md'), '# Web');
    const check = () => spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(check().status, 0, 'build-time copy resolves to its source');
    fs.unlinkSync(path.join(root, 'WEB-AGENT-GUIDE.md'));
    assert.equal(check().status, 1, 'missing canonical source must fail');
    fs.writeFileSync(path.join(root, 'USER-GUIDE.md'), '[Missing](missing.md)');
    assert.equal(check().status, 1, 'ordinary broken links still fail');
    console.log('PASS: source-backed docs resolve; missing sources and ordinary links fail');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
