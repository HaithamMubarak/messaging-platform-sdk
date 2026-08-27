/*
 * Does the PUBLISHED package work?
 *
 *     node test/pack.test.js
 *
 * smoke.test.js exercises the sources in this directory, which is a different
 * question. `files` in package.json is an allowlist, so a module that exists
 * here can be absent from the tarball — the package then installs and throws
 * MODULE_NOT_FOUND on the first require, while every test in the repo passes.
 *
 * That is not hypothetical: `index.js` requires `./node-xhr.js`, which was not
 * in the allowlist. So this test packs the tarball, installs it into a
 * throwaway project, and uses it the way an adopter would.
 *
 * Everything here is dependency-free on purpose. `npm test` should not need a
 * network install to tell you whether the package is publishable. The one
 * optional step (tsc) runs only if TypeScript happens to be resolvable.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG = path.join(__dirname, '..');
const pass = [], fail = [], skip = [], warn = [];
const check = (ok, what) => (ok ? pass : fail).push(what);

function run(cmd, args, cwd) {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Run a snippet against the INSTALLED package and capture everything it prints. */
function inConsumer(tmp, source, esm) {
    const file = path.join(tmp, esm ? 'probe.mjs' : 'probe.cjs');
    fs.writeFileSync(file, source);
    const out = execFileSync(process.execPath, [file],
        { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out;
}

let tmp, tarball;
try {
    const packed = run('npm', ['pack', '--silent'], PKG).trim().split('\n').pop();
    tarball = path.join(PKG, packed);
    check(fs.existsSync(tarball), 'npm pack produces a tarball');

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-agent-pack-'));
    fs.writeFileSync(path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'pack-test', version: '1.0.0', private: true }, null, 2));
    run('npm', ['install', '--no-audit', '--no-fund', tarball], tmp);
    check(true, 'the tarball installs into a clean project');

    const root = path.join(tmp, 'node_modules', '@messaging-platform', 'web-agent-js');

    // ---- 1. both entry points load, and say nothing ----------------------
    //
    // An import that prints is the first thing an adopter sees in their
    // terminal. It also used to mean the SDK had registered browser lifecycle
    // handlers under Node, because a stub `document` and Node's own
    // globalThis.addEventListener made it look like a browser.
    const cjsOut = inConsumer(tmp,
        "const m = require('@messaging-platform/web-agent-js');\n" +
        "if (!m.AgentConnection) { console.error('NO AgentConnection'); process.exit(1); }\n", false);
    check(cjsOut === '', 'require() prints nothing' + (cjsOut ? ` — got ${JSON.stringify(cjsOut.slice(0, 60))}` : ''));

    const esmOut = inConsumer(tmp,
        "import * as m from '@messaging-platform/web-agent-js';\n" +
        "if (!m.AgentConnection) { console.error('NO AgentConnection'); process.exit(1); }\n", true);
    check(esmOut === '', 'import prints nothing' + (esmOut ? ` — got ${JSON.stringify(esmOut.slice(0, 60))}` : ''));

    // ---- 2. the two entry points agree ----------------------------------
    const keys = src => inConsumer(tmp, src, src.includes('import ')).trim();
    const cjsKeys = keys("const m=require('@messaging-platform/web-agent-js');" +
        "process.stdout.write(Object.keys(m).sort().join(','))").split(',');
    const esmKeys = keys("import * as m from '@messaging-platform/web-agent-js';" +
        "process.stdout.write(Object.keys(m).sort().join(','))").split(',');
    check(cjsKeys.includes('AgentConnection'), 'require() exposes AgentConnection');
    check(esmKeys.includes('AgentConnection'), 'import exposes AgentConnection');
    check(cjsKeys.every(k => esmKeys.includes(k)), 'both entry points expose the same API');

    // ---- 3. the documented API is the real API ---------------------------
    //
    // The README once documented `Agent.create()` and `Game.create()`, which
    // exist nowhere in this repository. Types are the machine-checkable half of
    // that promise, so every name index.d.ts declares must exist at runtime.
    const dts = fs.readFileSync(path.join(root, 'index.d.ts'), 'utf8');
    const declared = [...dts.matchAll(/export\s+declare\s+(?:class|const|function)\s+(\w+)/g)].map(m => m[1]);
    check(declared.length > 0, 'index.d.ts declares a public surface');
    const undeclared = declared.filter(n => !cjsKeys.includes(n));
    check(undeclared.length === 0,
        `every type the package declares exists at runtime${undeclared.length ? ' — MISSING ' + undeclared.join(', ') : ''}`);

    // ---- 4. nothing the entry point needs was left out of the tarball ----
    const entry = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    const needed = [...entry.matchAll(/require\('(\.\/[^']+)'\)/g)].map(m => m[1]);
    const missing = needed.filter(rel => !fs.existsSync(path.join(root, rel)));
    check(missing.length === 0,
        `every local file index.js requires is shipped${missing.length ? ' — MISSING ' + missing.join(', ') : ''}`);

    // ---- 5. the browser files stay browser files -------------------------
    //
    // The mirror of the bug above: a Node builtin leaking into a file meant for
    // a <script> tag breaks every bundler target and every plain script user.
    // The vendored crypto bundle carries the usual dual-environment UMD dance —
    // `typeof require === 'function'` inside a try/catch — which never runs from
    // a <script> tag. That is not a defect to block a publish on, but a bundler
    // user may still see a "can't resolve 'crypto'" warning, so it is reported
    // rather than swallowed. An UNGUARDED builtin require would be a real bug.
    const BUILTINS = ['fs', 'path', 'crypto', 'http', 'https', 'net', 'os', 'child_process'];
    for (const f of fs.readdirSync(path.join(root, 'js'))) {
        const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
        for (const b of BUILTINS) {
            const re = new RegExp(`require\\(['"]${b}['"]\\)`, 'g');
            if (!re.test(src)) continue;
            const guarded = /typeof\s+require\s*==/.test(src);
            if (guarded) warn.push(`${f} requires '${b}' behind a UMD guard — bundler users may need a fallback`);
            else check(false, `${f} requires the Node builtin '${b}' unguarded`);
        }
    }

    // ---- 6. the manifest promises only what it ships ---------------------
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    check(!!manifest.exports && !!manifest.types, 'the manifest declares exports and types');
    check(fs.existsSync(path.join(root, 'README.md')), 'the README ships');
    const globs = (manifest.files || []).filter(f => !f.includes('*'));
    const absent = globs.filter(f => !fs.existsSync(path.join(root, f)));
    check(absent.length === 0,
        `every plain path in "files" is really there${absent.length ? ' — ' + absent.join(', ') : ''}`);

    // ---- 7. optional: real type-checking, when TypeScript is around ------
    let tsc = null;
    try { tsc = require.resolve('typescript/bin/tsc'); } catch (_) { /* not installed */ }
    if (tsc) {
        fs.writeFileSync(path.join(tmp, 'consumer.ts'),
            "import { AgentConnection } from '@messaging-platform/web-agent-js';\n" +
            "const a = new AgentConnection();\n" +
            "a.connect({ api: 'x', channelName: 'c', channelPassword: 'p', agentName: 'n' });\n");
        try {
            run(process.execPath, [tsc, '--noEmit', '--strict', '--moduleResolution', 'node16',
                '--module', 'node16', 'consumer.ts'], tmp);
            check(true, 'a TypeScript consumer type-checks against the shipped .d.ts');
        } catch (e) {
            check(false, 'a TypeScript consumer type-checks — ' +
                String((e.stdout || e.message || '')).split('\n')[0].slice(0, 80));
        }
    } else {
        skip.push('TypeScript type-check (typescript not installed here)');
    }
} catch (err) {
    fail.push('the test ran to the end — ' + String(err.message || err).split('\n')[0]);
} finally {
    if (tarball) fs.rmSync(tarball, { force: true });
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}

pass.forEach(p => console.log('  ok   ' + p));
skip.forEach(s => console.log('  skip ' + s));
warn.forEach(w => console.log('  warn ' + w));
fail.forEach(f => console.log('  FAIL ' + f));
console.log(fail.length ? `\n${fail.length} failed` : '\nall passed');
process.exit(fail.length ? 1 : 0);
