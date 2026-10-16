// End-to-end smoke of the ACTUAL VPS MCP stdio bridge (not just its TCP target).
// Run on VPS with node ~/.config/rdc-workstation-harness/smoke_stdio.mjs.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn(process.execPath, [fileURLToPath(new URL('./stdio.mjs', import.meta.url))], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let pending = '', done = false, errors = '';
const timer = setTimeout(() => finish(new Error('Stdio MCP timeout')), 15000);
function send(value) {
  child.stdin.write(JSON.stringify(value) + '\n');
}
function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (error) {
    console.error('STDIO_GATEWAY_SMOKE_FAILED=' + error.message + ' ' + errors.slice(0, 120));
    process.exitCode = 1;
  }
  child.kill();
}
child.stderr.on('data', bytes => { errors += String(bytes).slice(0, 300); });
child.once('error', finish);
child.once('close', code => {
  if (!done) finish(new Error('Bridge closed early with code ' + code));
});
child.stdout.on('data', bytes => {
  pending += String(bytes);
  if (pending.length > 5e6) return finish(new Error('Oversize MCP response'));
  while (pending.includes('\n')) {
    const end = pending.indexOf('\n');
    const line = pending.slice(0, end).trim();
    pending = pending.slice(end + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { return finish(new Error('Invalid MCP JSON')); }
    if (m.error) return finish(new Error(JSON.stringify(m.error).slice(0, 140)));
    if (m.id === 1) {
      console.log('STDIO_GATEWAY_INITIALIZE=PASS');
      send({jsonrpc:'2.0',method:'notifications/initialized'});
      send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
    } else if (m.id === 2) {
      const names = (m.result?.tools || []).map(t => t.name).sort();
      const allowed = ['pc_active_window','pc_health','pc_look_window','pc_uia_tree','pc_windows'].sort();
      if (JSON.stringify(names) !== JSON.stringify(allowed)) return finish(new Error('Unsafe tool set'));
      console.log('STDIO_GATEWAY_TOOL_ALLOWLIST=PASS');
      send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'pc_health',arguments:{}}});
    } else if (m.id === 3) {
      let health;
      try { health = JSON.parse(m.result?.content?.[0]?.text || '{}'); } catch { return finish(new Error('Invalid health JSON')); }
      if (!(health.ok && health.ready)) return finish(new Error('Desktop Agent unhealthy'));
      console.log('STDIO_GATEWAY_PC_AGENT_HEALTH=PASS');
      finish();
    }
  }
});
send({jsonrpc:'2.0',id:1,method:'initialize',
  params:{protocolVersion:'2025-03-26',capabilities:{},
    clientInfo:{name:'vps-stdio-smoke',version:'1.0.0'}}});
