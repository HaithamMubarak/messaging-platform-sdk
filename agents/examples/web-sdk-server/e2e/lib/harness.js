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

/**
 * Wait until the site is actually being served.
 *
 * This box rebuilds and restarts web-sdk-service for other work, so a suite
 * can start against a container that is mid-restart. Without this a run dies
 * on `page.goto` with ERR_SOCKET_NOT_CONNECTED and reports nothing useful.
 */
async function waitForService(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 120000);
    while (Date.now() < deadline) {
        try {
            const r = await fetch(BASE + '/app/api/health');
            if (r.ok) return true;
        } catch (_) { /* not up yet */ }
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

/**
 * Navigate, surviving a restart that lands between two page loads. Suites
 * should use this rather than page.goto so one blip does not end the run.
 */
async function gotoStable(page, url, opts) {
    try {
        return await page.goto(url, opts || { waitUntil: 'domcontentloaded' });
    } catch (e) {
        await waitForService();
        return page.goto(url, opts || { waitUntil: 'domcontentloaded' });
    }
}

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

module.exports = { BASE, SHOTS, LAUNCH, LAUNCH_WITH_FAKE_MEDIA, results, waitForService, gotoStable };
