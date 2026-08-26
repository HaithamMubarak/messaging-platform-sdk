/**
 * Where does the host's read cursor go while a room fills up?
 * Watches _last_receive_range while attendees join and answer.
 */
const sdk = require('/root/dev/messaging/messaging-platform-sdk/agents/web-agent-js/index.js');
const http = require('http');
const API = 'http://127.0.0.1:8082/messaging-platform/api/v1/messaging-service';
const ROOM = 'cur-' + Date.now().toString(36);
const KEY = 'k' + Math.random().toString(36).slice(2, 10);

function key() {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ ttlSeconds: 300 });
    const r = http.request({ method:'POST', hostname:'localhost', port:8084, path:'/app/api/config',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} }, (x) => {
      let d=''; x.on('data',c=>d+=c); x.on('end',()=>{ try { res(JSON.parse(d).data.apiKey); } catch(e){ rej(e);} });
    });
    r.on('error', rej); r.write(body); r.end();
  });
}
function connect(a, n, k) {
  return new Promise((res, rej) => {
    const t = setTimeout(()=>rej(new Error('timeout')), 45000);
    a.addEventListener('connect', ev => {
      if (ev && ev.response && ev.response.status === 'error') { clearTimeout(t); return rej(new Error(ev.response.statusMessage)); }
      clearTimeout(t); res();
    });
    a.connect({ api: API, apiKey: k, channelName: ROOM, channelPassword: KEY, agentName: n, autoReceive: true });
  });
}
(async () => {
  const k0 = await key();
  const host = new sdk.AgentConnection({});
  let seen = 0, batches = 0;
  host.addEventListener('message', ev => {
    const items = (ev && ev.response && ev.response.data) || [];
    batches++;
    items.forEach(i => { try { if (JSON.parse(i.content||'{}').type === 'ans') seen++; } catch(e){} });
  });
  await connect(host, 'Organiser', k0);

  const track = setInterval(() => {
    const r = host._last_receive_range || {};
    console.log(`t=${Date.now()%100000} cursor g=${r.globalOffset} l=${r.localOffset} limit=${r.limit} batches=${batches} answers=${seen}`);
  }, 3000);

  const agents = [];
  for (let w = 0; w < 3; w++) {
    const kw = await key();
    await Promise.all(Array.from({length:10}, (_, j) => {
      const a = new sdk.AgentConnection({}); agents.push(a);
      return connect(a, `A${w*10+j}`, kw).then(()=>{a._ok=true;}).catch(()=>{});
    }));
    console.log(`--- wave ${w+1} done, connected ${agents.filter(a=>a._ok).length} ---`);
  }

  console.log('--- everyone answers now ---');
  agents.filter(a=>a._ok).forEach(a => {
    try { a.sendMessage({ content: JSON.stringify({type:'ans'}), to:'Organiser', customType:'probe' }); } catch(e){}
  });

  await new Promise(r => setTimeout(r, 20000));
  clearInterval(track);
  const r = host._last_receive_range || {};
  console.log(`FINAL cursor g=${r.globalOffset} l=${r.localOffset} | batches=${batches} answers seen=${seen} of ${agents.filter(a=>a._ok).length}`);
  process.exit(0);
})();
