// Portable stdio launcher for the locally installed RDC Workstation Harness.
// Never binds an HTTP port or transports workstation credentials to GitHub.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32" || !process.env.LOCALAPPDATA) {
  console.error("[pc-agent-windows] Windows and LOCALAPPDATA are required.");
  process.exit(1);
}

const server = join(
  process.env.LOCALAPPDATA,
  "RdcWorkstationHarness",
  "desktop-agent",
  "mcp",
  "server.mjs"
);

if (!existsSync(server)) {
  console.error("[pc-agent-windows] Local MCP server not found. Install RDC Workstation Harness first.");
  process.exit(1);
}

const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  windowsHide: true,
  env: process.env
});

child.once("error", (error) => {
  console.error("[pc-agent-windows] Could not start local MCP server:", error.message);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exit(code ?? 1);
});
