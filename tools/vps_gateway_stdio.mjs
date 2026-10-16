// Linux/VPS stdio client for a private SSH reverse-forwarded read-only MCP gateway.
// No desktop-agent token or workstation command execution is ever exposed here.
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOST = '127.0.0.1';
const PORT = Number(process.env.RDC_GATEWAY_PORT || 17423);
const TOKEN_FILE = process.env.RDC_GATEWAY_TOKEN_FILE ||
  join(homedir(), '.config', 'rdc-workstation-harness', 'gateway.token');
const token = readFileSync(TOKEN_FILE, 'utf8').trim();
if (token.length < 32 || token.length > 256) {
  throw new Error('Invalid VPS gateway token');
}
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error('Invalid VPS gateway port');
}
const socket = connect({host: HOST, port: PORT});
socket.once('connect', () => {
  socket.write('AUTH ' + token + '\n');
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
socket.once('error', err => {
  console.error('[gateway-stdio] Private gateway unavailable:', err.code || 'unknown');
  process.exitCode = 1;
});
socket.once('close', () => process.stdin.unpipe(socket));
process.stdin.once('error', () => socket.destroy());