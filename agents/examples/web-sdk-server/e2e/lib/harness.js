/**
 * Shared setup for the browser suites.
 *
 * Everything that used to be hardcoded to one machine lives here: where the
 * site is served, where screenshots go, and how Chromium is launched.
 */
const path = require('path');
const fs = require('fs');

/** The site under test. Override with SDK_BASE_URL to point at a deployment. */
const BASE = (process.env.SDK_BASE_URL || 'http://localhost:8084').replace(/\/$/, '');

/** Where screenshots land. Created on demand; git ignores it. */
const SHOTS = process.env.SDK_SHOT_DIR || path.join(__dirname, '..', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

/**
 * Chromium needs a real GPU path for the WebGL apps, and headless cannot
 * create a context — so these run headed, which on a server means under
 * xvfb-run. See the README.
 */
const LAUNCH = {
    headless: false,
    args: [
        '--no-sandbox',
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader'
    ]
};

/** Media suites need a camera and microphone that do not exist on a server. */
const LAUNCH_WITH_FAKE_MEDIA = {
    ...LAUNCH,
    args: [...LAUNCH.args, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
};

/** A tally that prints the way every suite here reports. */
function results() {
    const pass = [], fail = [];
    return {
        pass, fail,
        check: (ok, what) => (ok ? pass : fail).push(what),
        report() {
            console.log('\nPASS (' + pass.length + ')');
            pass.forEach(x => console.log('  ✓ ' + x));
            console.log('\nFAIL (' + fail.length + ')');
            fail.forEach(x => console.log('  ✗ ' + x));
            return fail.length;
        }
    };
}

module.exports = { BASE, SHOTS, LAUNCH, LAUNCH_WITH_FAKE_MEDIA, results };
