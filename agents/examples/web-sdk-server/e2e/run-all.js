#!/usr/bin/env node
/**
 * Run every suite and print one table.
 *
 * Each suite is a standalone script that prints "PASS (n)" and "FAIL (n)";
 * this only collects them, so a suite can always be run on its own while
 * working on it:
 *
 *     xvfb-run -a node suites/chat-test.js
 *
 * Where there is no xvfb-run (Windows), each suite runs with this node
 * directly, with E2E_NODE_REQUIRE preloaded if set (the ops repo's
 * scripts/use-edge.cjs, for a box with Edge and no bundled Chromium). It used
 * to call xvfb-run regardless, so off Linux every suite "crashed" unrun.
 *
 * E2E_AFTER_EACH: a shell command run after every suite. Against production
 * it deletes the rooms that suite left (ops scripts/nightly-e2e.cjs passes
 * cleanup_channels.py --created-after <start> --empty-only), because some 70
 * suites make more rooms than the demos' 50-room key holds.
 * E2E_JSON: a file to write the results to, one row per suite.
 */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { BASE } = require('./lib/harness');

// Grouped by what they cost: the sweeps are quick, the two-client suites are
// not, and the self-checks exist to prove the sweeps can fail.
const GROUPS = {
    'site sweeps': ['health.js', 'links.js', 'mobile.js', 'contrast.js', 'token-check.js',
                    'a11y.js', 'focus.js', 'icon-blank-test.js', 'responsive-test.js', 'lobby-test.js'],
    'self-checks': ['a11y-selfcheck.js', 'focus-selfcheck.js'],
    'apps': ['chat-test.js', 'wb-test.js', 'wb-history-test.js', 'shape-fidelity-test.js', 'collab-actions-test.js', 'persistence-test.js', 'handover-test.js', 'wb-room-test.js', 'wb-doodle-test.js', 'drop-room-test.js', 'drop-solo-test.js', 'call-room-test.js', 'call-solo-test.js', 'chat-room-test.js', 'chat-trio-test.js', 'second-speaker-test.js', 'chat-solo-test.js', 'chat-knock-test.js', 'hood-routes-test.js', 'ec-room-test.js', 'ec-storage-test.js', 'term-test.js', 'terminal-scrollback-test.js',
             'drop-test.js', 'drop-resume-test.js', 'drop-later-test.js', 'drop-mailbox-test.js', 'call-test.js', 'devpages-test.js', 'under-the-hood-test.js', 'evidence-chain-test.js'],
    // Chorus, Autocue, Nudge, Open Outcry and Pictionary are Party Arcade's now,
    // tested in apps/party-arcade/tests (hub phases 1 and 4).
    'games': ['chess-features-test.js', 'games-test.js', 'gavel-test.js', 'gavel-solo-test.js', 'air-hockey-test.js', 'air-hockey-trio-test.js', 'air-hockey-phone-test.js', 'gavel-trust-test.js', 'gavel-phone-test.js', 'chess-solo-test.js', 'chess-trust-test.js', 'chess-room-test.js'],
    'platform': ['tenancy-test.js', 'migration-test.js', 'reconnect-test.js', 'smoke-all.js', 'telemetry-test.js'],
    // Slow by nature — it waits out a presence TTL, so it is opt in rather than
    // ungated. Run with: npm test -- ghost
    'presence (opt in)': [],
    'mobile + security': ['injection-test.js',
                          'host-forgery-test.js', 'vote-privacy-test.js', 'chat-panel-trust-test.js'],
    'mechanisms': ['companion-test.js', 'attest-test.js', 'till-test.js', 'knock-test.js', 'vault-test.js', 'escrow-test.js', 'disk-sink-test.js', 'hooks-meter-test.js']
};

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
if (only.some(o => 'ghost'.includes(o) || o.includes('ghost'))) {
    GROUPS['presence (opt in)'] = ['ghost-departure.js'];
}
const rows = [];
let totalPass = 0, totalFail = 0, broken = 0, crashedCount = 0;

/** One suite's output: under xvfb-run where it exists, else with this node directly. */
function runSuite(full) {
    const opts = { encoding: 'utf8', timeout: 30 * 60 * 1000, stdio: 'pipe' };
    const direct = [...(process.env.E2E_NODE_REQUIRE ? ['-r', process.env.E2E_NODE_REQUIRE] : []), full];
    try {
        return process.platform === 'linux'
            ? execFileSync('xvfb-run', ['-a', '--server-args=-screen 0 1400x900x24', 'node', full], opts)
            : execFileSync(process.execPath, direct, opts);
    } catch (e) {
        return (e.stdout || '') + (e.stderr || '');
    }
}

/** E2E_AFTER_EACH, if set; its failure is reported, never fatal to the run. */
function afterEach(file) {
    if (!process.env.E2E_AFTER_EACH) return;
    try {
        execSync(process.env.E2E_AFTER_EACH, { stdio: 'pipe', timeout: 5 * 60 * 1000 });
    } catch (e) {
        console.log('  (after ' + file + ': E2E_AFTER_EACH failed: ' + String(e.message).split('\n')[0].slice(0, 80) + ')');
    }
}

console.log('site under test: ' + BASE + '\n');

for (const [group, files] of Object.entries(GROUPS)) {
    const run = files.filter(f => !only.length || only.some(o => f.includes(o)));
    if (!run.length) continue;
    console.log('— ' + group);
    for (const file of run) {
        const full = path.join(__dirname, 'suites', file);
        if (!fs.existsSync(full)) { console.log('  ' + file.padEnd(24) + 'missing'); continue; }
        const out = runSuite(full);
        afterEach(file);
        const p = /PASS \((\d+)\)/.exec(out), f = /FAIL \((\d+)\)/.exec(out);
        if (!p && !f) {
            // A suite that CRASHED must never read as a verdict. Taking the
            // last line of output used to print "Node.js v20.20.2" — the tail
            // of a stack trace — in the column where a result belongs, so a
            // suite that never ran looked exactly like one that passed.
            // Node's own markers only. Matching any "at x (file:1:2)" or
            // "Error:" line called health.js crashed when it was REPORTING a
            // page's stack trace, which is its job.
            const crashed = /triggerUncaughtException|MODULE_NOT_FOUND|^Node\.js v\d+/m.test(out);
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
if (process.env.E2E_JSON) {
    fs.writeFileSync(process.env.E2E_JSON, JSON.stringify({
        site: BASE, at: new Date().toISOString(), passed: totalPass, failed: totalFail, crashed: crashedCount,
        suites: rows.map(([file, pass, fail, note]) => ({ file, pass, fail, note })),
    }, null, 2));
}
// exitCode, not exit(): exit() drops stdout still buffered for a pipe (guidelines 6.10).
process.exitCode = totalFail || crashedCount ? 1 : 0;
