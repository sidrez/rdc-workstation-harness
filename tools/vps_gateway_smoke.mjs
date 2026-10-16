// Run on VPS after the private loopback SSH forward is established:
// node /root/.config/rdc-workstation-harness/smoke.mjs
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const token = readFileSync(process.env.RDC_GATEWAY_TOKEN_FILE ||
  join(homedir(), '.config', 'rdc-workstation-harness', 'gateway.token'), 'utf8').trim();
const port = Number(process.env.RDC_GATEWAY_PORT || 17423);
const deadline = setTimeout(() => fail('Timeout'), 13000);
let finished = false;
// Negative auth check: wrong token must not reach MCP or receive data.
await new Promise((resolve, reject) => {
  const rejected = connect({host:'127.0.0.1', port});
  let gotResponse = false, settled = false;
  const done = (error) => {
    if (settled) return;
    settled = true;
    rejected.destroy();
    if (error) reject(error); else resolve();
  };
  rejected.setTimeout(3500, () => done(new Error('Unauthorized client not rejected')));
  rejected.once('connect', () => rejected.write('AUTH deliberately-invalid-token\n'));
  rejected.on('data', () => { gotResponse = true; });
  rejected.on('error', err => {
    if (err.code === 'ECONNRESET' && !gotResponse) done();
    else done(err);
  });
  rejected.on('close', () => {
    if (gotResponse) done(new Error('Unauthenticated response received')); else done();
  });
});
console.log('BAD_AUTH_REJECTED=PASS');
const connection = connect({host: '127.0.0.1', port});
let data = '';
function fail(why) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  console.error('GATEWAY_SMOKE_FAILED=' + why);
  connection.destroy();
  process.exitCode = 1;
}
const send = (obj) => connection.write(JSON.stringify(obj) + '\n');
connection.once('connect', () => {
  connection.write('AUTH ' + token + '\n');
  send({jsonrpc:'2.0', id:1, method:'initialize',
    params:{protocolVersion:'2025-03-26', capabilities:{},
      clientInfo:{name:'vps-gateway-smoke',version:'1.0.0'}}});
});
connection.on('error', err => fail(err.code || 'Connection error'));
connection.on('close', () => {
  if (!finished) fail('Closed before health response');
});
connection.on('data', chunk => {
  data += chunk.toString('utf8');
  if (data.length > 5e6) return fail('Oversized MCP response');
  while (data.includes('\n')) {
    const pos = data.indexOf('\n'), raw = data.slice(0,pos);
    data = data.slice(pos+1);
    let response;
    try { response = JSON.parse(raw); } catch { return fail('Invalid JSON response'); }
    if (response.error) return fail(JSON.stringify(response.error).slice(0,150));
    if (response.id === 1) {
      console.log('MCP_INITIALIZE=PASS');
      send({jsonrpc:'2.0',method:'notifications/initialized'});
      send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
    } else if (response.id === 2) {
      const tools = (response.result?.tools || []).map(x=>x.name).sort();
      const expected = ['pc_active_window','pc_health','pc_look_window','pc_uia_tree','pc_windows'].sort();
      if (JSON.stringify(tools) !== JSON.stringify(expected)) return fail('Wrong MCP tool set');
      console.log('MCP_READONLY_TOOL_SET=PASS');
      send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'pc_health',arguments:{}}});
    } else if (response.id === 3) {
      if (response.result?.isError) return fail('Desktop health error');
      let result;
      try { result=JSON.parse(response.result?.content?.[0]?.text||'{}'); } catch { return fail('Bad desktop health'); }
      if (!(result.ok && result.ready)) return fail('Desktop Agent reports not ready');
      console.log('PC_AGENT_HEALTH_FROM_GATEWAY=PASS');
      finished = true;
      clearTimeout(deadline);
      connection.end();
    }
  }
});
