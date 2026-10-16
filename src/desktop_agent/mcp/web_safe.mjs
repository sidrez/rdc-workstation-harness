// Read-only web exposure for a trusted single-user Windows workstation.
// Run only through OpenAI Secure MCP Tunnel. No raw desktop_action/exec,
// clipboard, browser cookies, unrestricted files, or physical input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const home = process.env.USERPROFILE || os.homedir();
const tokenFile = path.join(process.env.RDC_HARNESS_TOKEN_DIR || path.join(home, '.chatgpt-desktop-agent'), 'desktop.token');
const port = Number(process.env.DESKTOP_AGENT_PORT || 17322);
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function request(method, route, body = null) {
  return new Promise((resolve, reject) => {
    const encoded = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const headers = {};
    if (encoded) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = String(encoded.length);
      headers['X-Desktop-Agent-Token'] = fs.readFileSync(tokenFile, 'utf8').trim();
    }
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers, timeout: 12000 }, res => {
      let chunks = []; let length = 0;
      res.on('data', c => {
        length += c.length;
        if (length > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Response larger than allowed limit'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode >= 400) return reject(new Error(value.error || 'Desktop Agent error'));
          resolve(value);
        } catch (err) { reject(new Error('Invalid local Desktop Agent response')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Local Desktop Agent timed out')));
    req.on('error', reject);
    if (encoded) req.write(encoded);
    req.end();
  });
}
function result(value) {
  return {content: [{type: 'text', text: JSON.stringify(value)}]};
}
function failure(err) {
  return {isError: true, content: [{type:'text', text:JSON.stringify({ok:false, error:String(err.message || 'Operation failed')})}]};
}
async function safeRequest(method, route, body = null, image = false) {
  try {
    const response = await request(method, route, body);
    const img = response?.result?.image;
    if (!image || !img?.data) return result(response);
    if (img.data.length > 6 * 1024 * 1024) return failure(new Error('Image too large'));
    const {image: omitted, ...metadata} = response.result;
    return {content: [
      {type:'image', data:img.data, mimeType:img.mime_type || 'image/jpeg'},
      {type:'text', text:JSON.stringify({ok:true, result:metadata})}
    ]};
  } catch (err) { return failure(err); }
}
const server = new McpServer({name:'pc-agent-web-readonly',version:'0.1.0'});
server.registerTool('pc_health', {
  title:'PC Agent health',
  description:'Read-only: verify local Windows agent readiness without performing any workstation action.',
  inputSchema:z.object({})
}, async () => safeRequest('GET','/health'));

server.registerTool('pc_windows', {
  title:'List Windows',
  description:'Read-only: list open Windows desktop windows. Window titles may contain private information.',
  inputSchema:z.object({title_re:z.string().min(1).max(100).optional()})
}, async ({title_re}) => safeRequest('POST','/action',{action:'windows', ...(title_re ? {title_re} : {})}));

server.registerTool('pc_active_window', {
  title:'Active Window',
  description:'Read-only: identify the foreground window without changing focus.',
  inputSchema:z.object({})
}, async () => safeRequest('POST','/action',{action:'active_window'}));

server.registerTool('pc_uia_tree', {
  title:'Inspect Window Controls',
  description:'Read-only: inspect UI Automation tree of one explicitly named window. Cannot click or type.',
  inputSchema:z.object({
    window_title_re:z.string().min(1).max(100),
    depth:z.number().int().min(0).max(5).default(3),
    limit:z.number().int().min(1).max(200).default(100)
  })
}, async ({window_title_re,depth,limit}) => safeRequest('POST','/action',{
  action:'uia_tree',window:{title_re:window_title_re},depth,limit
}));

server.registerTool('pc_look_window', {
  title:'Inspect Window Image',
  description:'Read-only: capture only the named window as an MCP image. No full-desktop capture is exposed.',
  inputSchema:z.object({
    window_title_re:z.string().min(1).max(100),
    max_side:z.number().int().min(300).max(1280).default(1024)
  })
}, async ({window_title_re,max_side}) => safeRequest('POST','/action',{
  action:'look',window:{title_re:window_title_re},max_side
}, true));

await server.connect(new StdioServerTransport());
