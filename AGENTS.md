# AGENTS.md — instructions for coding agents

These rules apply to the entire repository, including Codex and other agents.

## README is a mandatory part of EVERY functional change
- Every functional change MUST update the root README.md in the same commit.
- Keep the "Что входит" feature inventory, architecture, client support, security,
  installation, update instructions and verification commands current.
- Document added/changed scripts, flags, defaults and their runnable usage.
  Do not include personal paths, hostnames, usernames, secrets or device IDs.
- Update relevant docs/ pages and README links. Remove obsolete descriptions.
- For user-facing functionality bump VERSION and update CHANGELOG.md.
- If a feature is not tested end-to-end, mark it as unverified. Distinguish
  syntax/local Windows/VPS/ChatGPT/OpenAI verification explicitly.
- New transports and tools need tests of safety boundaries and negative cases.

## Security invariants
- Desktop Agent and Browser Bridge always bind ONLY to 127.0.0.1.
- VPS integration must use the 5-tool read-only MCP facade. Never forward the
  original privileged desktop_action, command execution, arbitrary file access,
  clipboard, cookies, unrestricted screen capture or physical input to VPS.
- SSH forwarding must bind loopback at both endpoints. Store auth tokens and
  SSH host information locally, not in the public repository or stdout.
- Do not use gateway/proxy paths to bypass third-party regional/access denials.
- Never move/click the mouse, change window focus or send keys during background
  deployment/testing. Prefer command line and API-based operations.
- Do not restart Remote Desktop Commander or rotate its identity without a
  specific user instruction. Preserve runtime tokens and browser profiles.

## Workflow and definition of done
1. Inspect main HEAD, working tree, architecture, relevant docs and tests.
2. Implement a minimal change; update README.md + docs + CHANGELOG.md + VERSION
   for user-visible features, all in the same change.
3. Run applicable automated tests and smoke tests. For gateway changes, test
   rejected authentication, exact allowed tool set and read-only health flow.
4. Check staged diff for secrets, absolute personal paths and permission widening.
5. Report which tests passed and which integration layers remain blocked.
6. Push to main directly only when specifically requested; otherwise follow
   the repo's normal contribution process.
7. GitHub commits do not update the installed PC Agent on their own. Apply the
   official updater or safely sync changed modules and verify the runtime.

Do not claim a feature fully operational if only local tests passed.