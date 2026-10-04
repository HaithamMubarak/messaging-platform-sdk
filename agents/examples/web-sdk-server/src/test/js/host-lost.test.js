/**
 * The room that loses its host reports it once, whatever order the joiner learned who was here.
 *
 * telemetry-test.js's host_lost check went red in some join timings (2026-10-04). The cause:
 * on connect a client records wasHost = isHost() from the agent list it has at that moment.
 * If the real host is not in that list yet, the joiner believes it is the host and latches
 * wasHost = true. The host's arrival (agent-connect) never re-checked, only a departure did,
 * so when the host later left there was no "was not host -> is host" edge and host_lost was
 * never sent. This drives UserConnectionBase's real handlers with a fake channel, both orders.
 */
const assert = require('assert');
const path = require('path');

const beacons = [];
global.window = global.window || {};
window.SdkTelemetry = { record: (event) => beacons.push(event), useBase() {} };
const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const { UserConnectionBase } = require(path.join(STATIC, 'js', 'UserConnectionBase.js'));
console.log = () => {};   // the class narrates every event; the checks below speak for themselves

let failed = 0;
async function check(name, fn) {
    try { await fn(); process.stdout.write('  ok   ' + name + '\n'); }
    catch (e) { failed++; process.stdout.write('  FAIL ' + name + ' -- ' + e.message + '\n'); }
}

/** A channel whose host is the first agent listed, as the real election is for one app. */
function fakeChannel(agents) {
    const on = {};
    return {
        agents,
        addEventListener: (type, fn) => { (on[type] = on[type] || []).push(fn); },
        fire: (type, ev) => (on[type] || []).forEach((fn) => fn(ev)),
        get connectedAgents() { return this.agents.slice(); },
        isHostAgent(name) { return this.agents[0] === (name || 'Peer'); },
    };
}

function joiner(channel) {
    const c = Object.create(UserConnectionBase.prototype);
    Object.assign(c, { username: 'Peer', options: {}, wasHost: false, channel, connected: true });
    c._syncAgentsBadge = () => {};
    c.updateHostIndicator = () => {};
    c._setupChannelEvents();
    return c;
}

const settle = () => new Promise((r) => setTimeout(r, 200));   // agent-disconnect re-checks after 100 ms

async function hostLeaves(firstList) {
    beacons.length = 0;
    const channel = fakeChannel(firstList);
    joiner(channel);
    channel.fire('connect', { response: { status: 'success' } });
    if (!firstList.includes('Host')) {          // the host's presence arrives after connect
        channel.agents = ['Host', 'Peer'];
        channel.fire('agent-connect', { agentName: 'Host' });
        await settle();
    }
    channel.agents = ['Peer'];
    channel.fire('agent-disconnect', { agentName: 'Host' });
    await settle();
    return beacons.filter((e) => e === 'host_lost').length;
}

(async () => {
    await check('the host already listed at connect: its departure is reported once', async () => {
        assert.strictEqual(await hostLeaves(['Host', 'Peer']), 1);
    });
    await check('the host listed only after connect: its departure is still reported once', async () => {
        assert.strictEqual(await hostLeaves(['Peer']), 1);
    });
    process.stdout.write(failed ? '\n' + failed + ' failed\n' : '\nall passed\n');
    process.exitCode = failed ? 1 : 0;
})();
