// Private, read-only MCP bridge. Every connection is authenticated before any
// MCP process starts. Both ends of the SSH reverse forward MUST bind to loopback.
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = Number(process.env.RDC_GATEWAY_PORT || 17423);
const TOKEN_FILE = process.env.RDC_GATEWAY_TOKEN_FILE ||
  join(homedir(), '.chatgpt-desktop-agent', 'vps-gateway.token');
const CHILD = fileURLToPath(new URL('./web_safe.mjs', import.meta.url));
const MAX_CONNECTIONS = 2;
let active = 0;

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error('Invalid loopback gateway port');
}
const expected = Buffer.from(readFileSync(TOKEN_FILE, 'utf8').trim(), 'utf8');
if (expected.length < 32 || expected.length > 256) {
  throw new Error('Missing/invalid gateway authentication token');
}
const sameSecret = (raw) => {
  const received = Buffer.from(raw, 'utf8');
  return received.length === expected.length && timingSafeEqual(received, expected);
};
const server = createServer((socket) => {
  if (active >= MAX_CONNECTIONS) return socket.destroy();
  active += 1;
  let pending = Buffer.alloc(0);
  let child;
  let started = false;
  socket.setTimeout(5000, () => socket.destroy());
  socket.once('close', () => {
    active -= 1;
    if (child && !child.killed) child.kill();
  });
  function authenticate(chunk) {
    if (started) return;
    if (pending.length + chunk.length > 2048) return socket.destroy();
    pending = Buffer.concat([pending, chunk]);
    const end = pending.indexOf(10);
    if (end === -1) return;
    const line = pending.subarray(0, end).toString('utf8').replace(/\r$/, '');
    if (!line.startsWith('AUTH ') || !sameSecret(line.slice(5))) {
      return socket.destroy();
    }
    started = true;
    socket.removeListener('data', authenticate);
    socket.setTimeout(0);
    child = spawn(process.execPath, [CHILD], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: process.env,
    });
    child.once('error', () => socket.destroy());
    child.once('close', () => socket.end());
    child.stderr.on('data', () => { /* Do not leak MCP payloads or credentials. */ });
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    const firstPayload = pending.subarray(end + 1);
    if (firstPayload.length) child.stdin.write(firstPayload);
    pending = Buffer.alloc(0);
  }
  socket.on('data', authenticate);
});
server.on('error', err => {
  console.error('[gateway] Listen failure:', err.code || 'unknown');
  process.exitCode = 1;
});
server.listen(PORT, HOST, () => {
  console.error('[gateway] Read-only MCP gateway bound to loopback port ' + PORT);
});