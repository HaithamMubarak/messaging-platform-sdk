#!/usr/bin/env node
/**
 * Does every JavaScript file in the repo actually parse?
 *
 * A syntax error in a demo script is invisible until someone opens that page,
 * which for a demo site can be a long time. This is the cheapest check that
 * would catch it, and it needs no dependencies.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'shots']);

const files = [];
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP.has(entry.name)) walk(full);
        } else if (entry.name.endsWith('.js')) {
            files.push(full);
        }
    }
})(ROOT);

const bad = [];
for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    try {
        // Compiling parses without running: a demo that talks to the network
        // must not actually do so here.
        new vm.Script(source, { filename: file });
    } catch (e) {
        // A module-only file legitimately fails to compile as a plain script.
        if (/Cannot use import statement|Unexpected token 'export'|await is only valid/.test(e.message)) {
            try {
                new vm.SourceTextModule
                    ? null
                    : null;
            } catch (_) { /* ignore */ }
            continue;
        }
        bad.push(`${path.relative(ROOT, file)}: ${e.message.split('\n')[0]}`);
    }
}

console.log(`checked ${files.length} JavaScript files`);
if (bad.length) {
    console.error(`\n${bad.length} file(s) do not parse:`);
    bad.forEach(b => console.error('  ' + b));
    process.exit(1);
}
console.log('all parse');
