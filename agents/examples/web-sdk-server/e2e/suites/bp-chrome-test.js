/**
 * BlockParty chrome, tested the only way this class of change can be.
 *
 * Swapping an emoji for an <svg> in an element that some JS later assigns
 * `textContent` leaves a control that is still clickable and shows nothing.
 * That survives syntax checks, console-error checks and a screenshot of the
 * arrival state — it only appears after the state changes. So every control
 * below is pressed, and then asked whether it still has something to show.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT = SHOTS + '/';
const ROOM = 'bpc' + Math.floor(Math.random() * 99999);

const pass = [], fail = [];
const check = (ok, what) => (ok ? pass : fail).push(what);

/** A control is "showing something" if it has an icon, or any visible text. */
const SHOWS = `(el) => {
    if (!el) return { missing: true };
    const svg = el.querySelector('svg use, use');
    const href = svg ? (svg.getAttribute('href') || svg.getAttribute('xlink:href')) : null;
    const text = (el.textContent || '').replace(/\\s+/g, '');
    const r = el.getBoundingClientRect();
    return { href, text, empty: !href && !text, w: Math.round(r.width), h: Math.round(r.height) };
}`;

(async () => {
    const b = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
    });
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    p.setDefaultTimeout(120000);
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.split('\n')[0].slice(0, 110)));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 110)); });

    await p.goto(BASE + '/apps/mini-games/blockparty/play.html?debug', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 30000 });
    await p.fill('#usernameInput', 'Mapper');
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForTimeout(11000);

    const state = async (id) => p.evaluate(
        new Function('id', `return (${SHOWS})(document.getElementById(id));`), id);

    // --- every tier-2 control, before and after the state change ------------
    const CASES = [
        ['soundBtn',      'toggle sound',        () => document.getElementById('soundBtn').click()],
        ['lockBtn',       'lock the world',      () => document.getElementById('lockBtn').click()],
        ['modeBtn',       'toggle earth mode',   () => document.getElementById('modeBtn').click()],
        ['fpsBtn',        'press walk',          () => document.getElementById('fpsBtn').click()],
        ['mapBtn',        'open the minimap',    () => document.getElementById('mapBtn').click()],
        ['worldBtn',      'open worlds & room',  () => document.getElementById('worldBtn').click()]
    ];

    for (const [id, label, act] of CASES) {
        const before = await state(id);
        if (before.missing) { check(false, `#${id} does not exist`); continue; }
        check(!before.empty, `#${id} shows something before ${label} (${before.href || before.text})`);
        try { await p.evaluate(act); } catch (e) { /* some need a mode */ }
        await p.waitForTimeout(1400);
        const after = await state(id);
        check(!after.empty,
            `#${id} still shows something after ${label} (${after.href || after.text || 'NOTHING'})`);
        // put it back
        try { await p.evaluate(act); } catch (e) {}
        await p.waitForTimeout(700);
    }

    // --- the sound button twice, since it has two write sites ---------------
    await p.evaluate(() => document.getElementById('soundBtn').click());
    await p.waitForTimeout(600);
    await p.evaluate(() => document.getElementById('soundBtn').click());
    await p.waitForTimeout(600);
    const snd = await state('soundBtn');
    check(!snd.empty, `#soundBtn survives a second toggle (${snd.href || snd.text || 'NOTHING'})`);

    // --- minimap travel, armed --------------------------------------------
    await p.evaluate(() => { const b = document.getElementById('mapBtn'); if (b) b.click(); });
    await p.waitForTimeout(2000);
    const travelBefore = await state('minimapTravel');
    if (!travelBefore.missing) {
        check(!travelBefore.empty, `#minimapTravel shows something (${travelBefore.href || travelBefore.text})`);
        await p.evaluate(() => { const t = document.getElementById('minimapTravel'); if (t) t.click(); });
        await p.waitForTimeout(1400);
        const travelAfter = await state('minimapTravel');
        check(!travelAfter.empty,
            `#minimapTravel still shows something once armed (${travelAfter.href || travelAfter.text || 'NOTHING'})`);
    }
    await p.screenshot({ path: OUT + 'bp-minimap.png' });

    // --- the whole page: nothing blank that should not be ------------------
    const blanks = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll('button, .btn, .tool-btn, .pill').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width < 8 || r.height < 8) return;
            if (getComputedStyle(el).visibility === 'hidden') return;
            const hasIcon = !!el.querySelector('svg use, img, canvas');
            const hasText = (el.textContent || '').trim().length > 0;
            if (!hasIcon && !hasText) out.push(el.id || el.className || el.tagName);
        });
        return out;
    });
    check(blanks.length === 0, `no visible control is blank (${blanks.slice(0, 6).join(', ') || 'clean'})`);

    // --- emoji count, and the instructions still matching -------------------
    // What is left must be only what was deliberately left: the two state
    // glyphs that cycle (ground style, vehicle), the out-of-scope close mark,
    // and the tier-3 map data — the `emoji:` field on every built-in map,
    // which is content in the same class as the map names.
    const emoji = await p.evaluate(() =>
        (document.body.innerText.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []));
    const DELIBERATE = new Set([
        '\u{1F6E3}', '\u{1F30A}', '\u2B1C',                      // #groundBtn, three states
        '\u{1F6B6}', '\u{1F6F9}', '\u{1F6B2}',                   // #vehicleBtn, three states
        '\u2715', '\u2716', '\u274C',                            // close marks, out of scope
        '\u{1F3D8}', '\u{1F3D9}', '\u{1F333}', '\u{1F3F0}', '\u2693',
        '\u{1F69C}', '\u{1F332}', '\u{1F3C1}', '\u{1F680}', '\u2744',
        '\u{1F573}', '\u{1F3E1}', '\u{1F5DD}', '\u{1F3E2}', '\u{1F3EC}',
        '\u{1F3EB}', '\u{1F3E5}', '\u2708'                        // tier 3: the map table
    ]);
    const stray = emoji.filter(e => !DELIBERATE.has(e));
    check(stray.length === 0,
        `only the deliberate emoji remain (${emoji.length} total, ${stray.length} unaccounted${stray.length ? ': ' + stray.join(' ') : ''})`);

    await p.screenshot({ path: OUT + 'bp-chrome.png' });

    console.log('\nPASS (' + pass.length + ')');
    pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')');
    fail.forEach(x => console.log('  ✗ ' + x));
    console.log('\nconsole errors (' + [...new Set(errs)].length + ')');
    [...new Set(errs)].slice(0, 8).forEach(e => console.log('  ! ' + e));
    await b.close();
})();
