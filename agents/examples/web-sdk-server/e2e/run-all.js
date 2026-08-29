#!/usr/bin/env node
/**
 * Run every suite and print one table.
 *
 * Each suite is a standalone script that prints "PASS (n)" and "FAIL (n)";
 * this only collects them, so a suite can always be run on its own while
 * working on it:
 *
 *     xvfb-run -a node suites/chat-test.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { BASE } = require('./lib/harness');

// Grouped by what they cost: the sweeps are quick, the two-client suites are
// not, and the self-checks exist to prove the sweeps can fail.
const GROUPS = {
    'site sweeps': ['health.js', 'links.js', 'mobile.js', 'contrast.js', 'token-check.js',
                    'a11y.js', 'focus.js', 'icon-blank-test.js', 'responsive-test.js'],
    'self-checks': ['a11y-selfcheck.js', 'focus-selfcheck.js'],
    'apps': ['chat-test.js', 'wb-test.js', 'wb-history-test.js', 'shape-fidelity-test.js', 'collab-actions-test.js', 'persistence-test.js', 'handover-test.js', 'term-test.js', 'terminal-scrollback-test.js', 'cloud-test.js',
             'drop-test.js', 'drop-resume-test.js', 'undriven-test.js', 'devpages-test.js', 'coreloop-test.js', 'pulse-moderation-test.js', 'dead-drop-test.js', 'under-the-hood-test.js', 'rewind-test.js', 'evidence-chain-test.js', 'persistence-apps-test.js'],
    'games': ['bp-chrome-test.js', 'pict-test.js', 'chess-features-test.js', 'games-test.js',
              'games-sync-test.js', 'tier2-test.js', 'outcry-test.js',
              'party-games-test.js'],
    'platform': ['tenancy-test.js', 'migration-test.js', 'reconnect-test.js', 'smoke-all.js', 'telemetry-test.js'],
    // Slow by nature — it waits out a presence TTL, so it is opt in rather than
    // ungated. Run with: npm test -- ghost
    'presence (opt in)': [],
    'mobile + security': ['touch-play-test.js', 'injection-test.js', 'forgery-test.js',
                          'host-forgery-test.js']
};

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
if (only.some(o => 'ghost'.includes(o) || o.includes('ghost'))) {
    GROUPS['presence (opt in)'] = ['ghost-departure.js'];
}
const rows = [];
let totalPass = 0, totalFail = 0, broken = 0, crashedCount = 0;

console.log('site under test: ' + BASE + '\n');

for (const [group, files] of Object.entries(GROUPS)) {
    const run = files.filter(f => !only.length || only.some(o => f.includes(o)));
    if (!run.length) continue;
    console.log('— ' + group);
    for (const file of run) {
        const full = path.join(__dirname, 'suites', file);
        if (!fs.existsSync(full)) { console.log('  ' + file.padEnd(24) + 'missing'); continue; }
        let out = '';
        try {
            out = execFileSync('xvfb-run', ['-a', '--server-args=-screen 0 1400x900x24',
                'node', full], { encoding: 'utf8', timeout: 30 * 60 * 1000, stdio: 'pipe' });
        } catch (e) {
            out = (e.stdout || '') + (e.stderr || '');
        }
        const p = /PASS \((\d+)\)/.exec(out), f = /FAIL \((\d+)\)/.exec(out);
        if (!p && !f) {
            // A suite that CRASHED must never read as a verdict. Taking the
            // last line of output used to print "Node.js v20.20.2" — the tail
            // of a stack trace — in the column where a result belongs, so a
            // suite that never ran looked exactly like one that passed.
            const crashed = /triggerUncaughtException|^\s*at .*\(.*:\d+:\d+\)|Error:|MODULE_NOT_FOUND/m.test(out);
            if (crashed) {
                const why = (/(?:Error|error):?\s*([^\n]+)/.exec(out) || [, 'see output'])[1];
                console.log('  ' + file.padEnd(24) + 'CRASHED — did not run  (' + why.slice(0, 40) + ')');
                rows.push([file, null, null, 'crashed']);
                crashedCount++;
                continue;
            }
            // Sweeps that report in prose rather than a tally.
            const verdict = out.trim().split('\n').filter(Boolean).pop() || 'no output';
            console.log('  ' + file.padEnd(24) + verdict.slice(0, 60));
            rows.push([file, null, null, verdict]);
            continue;
        }
        const pass = p ? Number(p[1]) : 0, fail = f ? Number(f[1]) : 0;
        totalPass += pass; totalFail += fail;
        if (fail) broken++;
        console.log('  ' + file.padEnd(24) + String(pass).padStart(4) + ' pass  ' +
            (fail ? String(fail).padStart(3) + ' FAIL' : '        ') +
            (fail ? '\n' + out.split('\n').filter(l => l.includes('✗')).map(l => '      ' + l.trim()).join('\n') : ''));
        rows.push([file, pass, fail, null]);
    }
}

console.log('\n' + totalPass + ' assertions passed, ' + totalFail + ' failed, across ' +
    rows.length + ' suites' + (broken ? ' (' + broken + ' with failures)' : '') +
    (crashedCount ? ' — ' + crashedCount + ' CRASHED and proved nothing' : ''));
process.exit(totalFail || crashedCount ? 1 : 0);
