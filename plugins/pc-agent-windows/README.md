# PC Agent — Windows (ChatGPT / Codex plugin)

A desktop-only MCP plugin for the **local** Windows instance of [RDC Workstation Harness](../../README.md). It runs the already-installed `Desktop Agent` MCP proxy using Node.js and does not contain credentials, device identities, user-specific paths or externally exposed ports.

## Requirements

- Windows 10/11 with Node.js 18+ in PATH.
- RDC Workstation Harness installed for the current Windows user and running (Desktop Agent on loopback `127.0.0.1:17322`).
- ChatGPT Desktop or a local Codex client supporting stdio MCP plugins.

Install the harness using [installation instructions](../../docs/INSTALL_RU.md) and verify:

```powershell
pc-agent health
```

## Install from GitHub marketplace

```powershell
codex plugin marketplace add sidrez/rdc-workstation-harness
codex plugin list
codex plugin add pc-agent-windows@rdc-harness
```

Alternatively, in ChatGPT Desktop open **Plugins**, select the **RDC Workstation Harness** marketplace, then install **PC Agent — Windows**. Restart the desktop app if it does not detect a new marketplace or changed MCP tools.

## Verify

Call `desktop_health({})`, then `desktop_capabilities({})`. Available MCP tools include `desktop_health`, `desktop_capabilities`, `desktop_describe`, `desktop_look`, `desktop_action` and `desktop_send_file`.

**Security:** The plugin executes with the permissions of the local Windows user and can invoke privileged read/write/exec desktop actions. Install only on a trusted workstation, confirm impactful operations, and do not send local token files or remote desktop credentials to the chat or a Git repository. The launcher only reads the location of the locally installed proxy from `LOCALAPPDATA`; that proxy reads its own local authentication token.

**Web limitation:** This is a local stdio plugin. Importing its manifest from GitHub into a ChatGPT workspace does **not** make it runnable in ordinary ChatGPT web chats. For web access use the existing Remote Desktop Commander + `pc-agent` CLI path (see [ChatGPT web guide](../../docs/CHATGPT_RU.md)) or a separately reviewed Secure MCP Tunnel. Never expose ports 17321–17322 directly.
