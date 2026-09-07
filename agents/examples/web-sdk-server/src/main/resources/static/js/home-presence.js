/*
 * The landing page's one live moment: the people on this page right now.
 *
 * The platform demonstrating itself beats a screenshot of it. This connects
 * the visitor's browser to a real channel with the real SDK, the same way
 * every demo does — a short-lived key from this site's own server, never a
 * developer key — and draws who else is here. It loads AFTER the page, so
 * the hero paints first; if the key or the connection cannot be had, the
 * widget stays as the static caption and says nothing about it.
 */
(function () {
    'use strict';

    const CHANNEL = 'sdk-home-presence';
    const PASSWORD = 'everyone-is-welcome-here';
    const SCRIPTS = ['generated-web-agent-js/js/web-agent.libs.js', 'generated-web-agent-js/js/web-agent.js'];

    const root = document.getElementById('homePresence');
    if (!root) return;
    const count = root.querySelector('[data-presence-count]');
    const faces = root.querySelector('[data-presence-faces]');
    const rtt = root.querySelector('[data-presence-rtt]');

    function load(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    /** Two letters from an agent name, stable per name, never the whole name. */
    function initials(name) {
        const clean = String(name || '').replace(/[^a-z0-9]/gi, '');
        return (clean.slice(0, 1) + clean.slice(-1)).toUpperCase() || '··';
    }

    function paint(agents, me) {
        const others = agents.filter((a) => a !== me);
        const shown = agents.slice(0, 6);
        faces.textContent = '';
        shown.forEach((a) => {
            const b = document.createElement('b');
            b.className = 'home-presence__face' + (a === me ? ' is-you' : '');
            b.textContent = initials(a);
            b.title = a === me ? 'You' : 'Another visitor';
            faces.appendChild(b);
        });
        if (agents.length > shown.length) {
            const more = document.createElement('b');
            more.className = 'home-presence__face is-more';
            more.textContent = '+' + (agents.length - shown.length);
            faces.appendChild(more);
        }
        count.textContent = others.length === 0
            ? 'You are the only one reading this page right now.'
            : others.length === 1
                ? 'One other person is reading this page right now.'
                : others.length + ' other people are reading this page right now.';
        root.dataset.live = 'true';
    }

    async function start() {
        try {
            for (const s of SCRIPTS) await load(s);
            const config = await window.fetchAppConfig(300, false);
            if (!config || !config.apiKey) return;
            const me = 'visitor-' + Math.random().toString(36).slice(2, 8);
            const agent = new AgentConnection();
            const t0 = performance.now();
            let connected = false;
            agent.addEventListener('connect', (ev) => {
                if (!ev.response || ev.response.status !== 'success') return;
                connected = true;
                rtt.textContent = Math.round(performance.now() - t0) + ' ms to join';
                paint(agent.connectedAgents || [me], me);
            });
            agent.addEventListener('agent-connect', () => connected && paint(agent.connectedAgents || [], me));
            agent.addEventListener('agent-disconnect', () => connected && paint(agent.connectedAgents || [], me));
            agent.connect({
                api: config.messagingServiceUrl || config.apiUrl || (window.ApiConfig && ApiConfig.getMessagingServiceUrl()),
                apiKey: config.apiKey,
                channelName: CHANNEL, channelPassword: PASSWORD,
                agentName: me, autoReceive: true,
            });
            window.addEventListener('pagehide', () => { try { agent.disconnect(); } catch (_) { /* leaving */ } });
        } catch (_) {
            /* The caption stays static. A landing page must never look broken
               because a demo behind it could not connect. */
        }
    }

    if (document.readyState === 'complete') setTimeout(start, 800);
    else window.addEventListener('load', () => setTimeout(start, 800));
})();
