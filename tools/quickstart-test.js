// Execute the README's real message handler with hostile peer text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
const script = readme.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const handlers = {};
const rows = [];
function element(tag) {
    return {
        tag, children: [], textContent: '',
        append(...children) { this.children.push(...children); },
        set innerHTML(value) { throw new Error('Untrusted HTML sink used'); }
    };
}
const document = {
    createElement: element,
    createTextNode: text => ({ textContent: text }),
    getElementById: () => ({ append: row => rows.push(row) })
};
class AgentConnection {
    addEventListener(name, callback) { handlers[name] = callback; }
    connect(config) {
        assert.equal(config.apiKey, 'your-temporary-api-key');
    }
}
vm.runInNewContext(script, { document, AgentConnection });
const attack = '<img src=x onerror=alert(1)>';
handlers.message({ response: { data: [
    { type: 'connect', from: attack },
    { type: 'chat-text', from: attack, content: attack }
] } });
assert.equal(rows.length, 1);
assert.equal(rows[0].children[0].textContent, `${attack}: `);
assert.equal(rows[0].children[1].textContent, attack);
assert.equal(rows[0].children.length, 2);
console.log('PASS: README renders hostile sender/content as text and ignores notices');
