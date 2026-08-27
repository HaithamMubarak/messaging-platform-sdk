/*
 * Every page, on a phone.
 *
 *     xvfb-run -a node suites/responsive-test.js
 *
 * `mobile.js` checks a hand-written list of 25 pages at one width. That list
 * goes stale the moment an app is added — none of the apps built most recently
 * were on it, and two of them were overflowing. This suite takes the pages
 * from the FILESYSTEM instead, so a new app is covered the day it lands.
 *
 * Two widths, because they fail differently: 390px is a normal modern phone,
 * and 320px is the width where a row that cannot shrink finally gives up.
 * Most of what this found lived only at 320.
 *
 * A page fails if it scrolls sideways or renders body text under 11px. Small
 * tap targets are counted and reported but not failed — the shared kit already
 * sizes the controls that matter, and a hard failure there would be noise.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { BASE, LAUNCH, results, gotoStable, waitForService } = require('../lib/harness');

const STATIC = path.join(__dirname, '..', '..', 'src', 'main', 'resources', 'static');
const WIDTHS = [390, 320];

/** Every shipped page, found rather than listed. */
function pages() {
    const out = [];
    const walk = (dir, rel) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, entry.name);
            const r = rel ? rel + '/' + entry.name : entry.name;
            if (entry.isDirectory()) {
                // Icon generators and error pages are not pages people browse to.
                if (['error', 'icons', 'lib', 'node_modules', 'images', 'css', 'js'].includes(entry.name)) continue;
                walk(abs, r);
            } else if (entry.name.endsWith('.html')) {
                out.push(r);
            }
        }
    };
    walk(STATIC, '');
    return out.sort();
}

const R = results();
function check(ok, label, extra) {
    if (!ok) console.log(`  FAIL  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, label + (extra ? '  — ' + extra : ''));
}

(async () => {
    await waitForService();
    const PAGES = pages();
    console.log(`\nResponsive — ${PAGES.length} pages x ${WIDTHS.join('/')}px  ${BASE}\n`);

    const browser = await chromium.launch(LAUNCH);
    let smallTaps = 0;

    try {
        for (const w of WIDTHS) {
            for (const p of PAGES) {
                const page = await browser.newPage({
                    viewport: { width: w, height: 844 },
                    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
                });
                let r;
                try {
                    await gotoStable(page, `${BASE}/${p}`, { waitUntil: 'domcontentloaded' });
                    await page.waitForTimeout(2000);
                    r = await page.evaluate(() => {
                        const de = document.documentElement;
                        let small = 0, tiny = 0, worst = null;
                        document.querySelectorAll('button,a,select,input,[role=button]').forEach(e => {
                            const b = e.getBoundingClientRect();
                            if (b.width < 2 || b.height < 2) return;
                            const cs = getComputedStyle(e);
                            if (cs.display === 'none' || cs.visibility === 'hidden') return;
                            if (b.height < 32 || b.width < 32) small++;
                        });
                        document.querySelectorAll('*').forEach(e => {
                            let hasText = false;
                            e.childNodes.forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) hasText = true; });
                            if (!hasText) return;
                            const cs = getComputedStyle(e);
                            if (cs.display === 'none' || cs.visibility === 'hidden') return;
                            const f = parseFloat(cs.fontSize);
                            if (f && f < 11) {
                                tiny++;
                                if (!worst || f < worst.size) {
                                    worst = { size: f, txt: (e.textContent || '').trim().slice(0, 30) };
                                }
                            }
                        });
                        // Name the widest thing sticking out, skipping anything
                        // inside a scroller — a code block is SUPPOSED to be
                        // wider than the phone; it just must not drag the page.
                        const inScroller = e => {
                            for (let a = e.parentElement; a; a = a.parentElement) {
                                const o = getComputedStyle(a).overflowX;
                                if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
                            }
                            return false;
                        };
                        let widest = null;
                        document.querySelectorAll('body *').forEach(e => {
                            const b = e.getBoundingClientRect();
                            if (!b.width || inScroller(e)) return;
                            const ov = Math.round(b.right - de.clientWidth);
                            if (ov > 2 && (!widest || ov > widest.ov)) {
                                widest = { ov, tag: e.tagName, cls: (e.className || '').toString().slice(0, 30) };
                            }
                        });
                        return { over: Math.max(0, de.scrollWidth - de.clientWidth), small, tiny, worst, widest };
                    });
                } catch (e) {
                    check(false, `${p} @${w} loads`, String(e.message || e).slice(0, 60));
                    await page.close();
                    continue;
                }

                smallTaps += r.small;
                check(r.over <= 2, `${p} @${w} does not scroll sideways`,
                    r.over ? `${r.over}px over — ${r.widest ? r.widest.tag + '.' + r.widest.cls : '?'}` : '');
                check(r.tiny === 0, `${p} @${w} has no text under 11px`,
                    r.worst ? `${r.worst.size}px "${r.worst.txt}"` : '');
                await page.close();
            }
        }
        console.log(`\n(${smallTaps} controls under 32px across all pages and widths — counted, not failed)`);
    } catch (err) {
        console.error('\nTEST THREW:', err && err.stack || err);
        check(false, 'the suite ran to the end');
    } finally {
        await browser.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
