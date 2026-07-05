// ============================================================================
// demo-kit.js — small shared UX helpers for the SDK demos (plain script).
// Pairs with css/demos-pro.css. Exposes window.DemoKit.
//   DemoKit.toast(msg, type)      bottom-right toast ('ok'|'err'|'warn'|'info')
//   DemoKit.copy(text, btnEl)     clipboard copy with button feedback
//   DemoKit.relTime(ts)           "just now" / "3m ago" / "2h ago"
//   DemoKit.escape(str)           HTML-escape for safe innerHTML
//   DemoKit.pop(el)               one-shot attention pop animation
// ============================================================================
(function () {
    'use strict';

    let toastHost = null;
    function ensureToastHost() {
        if (!toastHost) {
            toastHost = document.createElement('div');
            toastHost.className = 'pro-toasts';
            document.body.appendChild(toastHost);
        }
        return toastHost;
    }

    const ICONS = { ok: '✅', err: '⛔', warn: '⚠️', info: 'ℹ️' };

    const DemoKit = {
        toast(msg, type = 'info', ms = 3200) {
            const host = ensureToastHost();
            const el = document.createElement('div');
            el.className = 'pro-toast' + (type !== 'info' ? ` pro-toast--${type}` : '');
            el.innerHTML = `<span aria-hidden="true">${ICONS[type] || ICONS.info}</span><span></span>`;
            el.lastChild.textContent = msg;
            host.appendChild(el);
            const kill = () => {
                el.classList.add('pro-toast--leaving');
                setTimeout(() => el.remove(), 220);
            };
            const timer = setTimeout(kill, ms);
            el.addEventListener('click', () => { clearTimeout(timer); kill(); });
            return el;
        },

        async copy(text, btnEl) {
            try {
                await navigator.clipboard.writeText(text);
            } catch (e) {
                // Fallback for insecure contexts / older browsers.
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch (_) {}
                ta.remove();
            }
            if (btnEl) {
                const prev = btnEl.textContent;
                btnEl.classList.add('pro-copy--done');
                btnEl.textContent = '✓ Copied';
                setTimeout(() => {
                    btnEl.classList.remove('pro-copy--done');
                    btnEl.textContent = prev;
                }, 1400);
            }
            this.toast('Copied to clipboard', 'ok', 1600);
        },

        relTime(ts) {
            const s = Math.max(0, (Date.now() - ts) / 1000);
            if (s < 5) return 'just now';
            if (s < 60) return `${s | 0}s ago`;
            if (s < 3600) return `${(s / 60) | 0}m ago`;
            if (s < 86400) return `${(s / 3600) | 0}h ago`;
            return `${(s / 86400) | 0}d ago`;
        },

        escape(str) {
            const d = document.createElement('div');
            d.textContent = str == null ? '' : String(str);
            return d.innerHTML;
        },

        pop(el) {
            if (!el) return;
            el.classList.remove('pro-pop');
            void el.offsetWidth;   // reflow to restart the animation
            el.classList.add('pro-pop');
        },
    };

    window.DemoKit = DemoKit;
})();
