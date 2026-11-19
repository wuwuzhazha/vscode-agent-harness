# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | yes |

Only the latest release is maintained.

## What this tool does

`vscode-agent-harness` modifies the local VS Code installation:

- patches `agentHostMain.js`, `workbench.desktop.main.js` and
  `workbench.desktop.main.css`
- rewrites matching `product.json` checksums
- installs a Claude Agent SDK compatibility shim under `~/.vscode-harness/shim`
- sets the user-level environment variable `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT`
- optionally creates a terminal wrapper and adds `~/.vscode-harness/bin` to the user
  PATH

It runs with the user's privileges. There is no installer service, no elevation, no
network access, and no telemetry.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:
`Security` → `Advisories` → `Report a vulnerability`.

Maintainer: [@wuwuzhazha](https://github.com/wuwuzhazha).

Include:

- affected version and VS Code build
- steps to reproduce
- impact (for example arbitrary code execution, unintended file write, privilege
  escalation)
- any suggested fix

Do not open a public issue for an unpatched vulnerability. You will receive an
acknowledgement within 7 days.

## Threat model

In scope:

- A patch rule that writes outside the four declared files or the harness data
  directory.
- Path traversal in agent manifests (`searchGlobs`, terminal wrapper paths).
- Command injection through manifest fields, CLI arguments, environment variables or
  model ids.
- The shim leaking credentials, writing logs with secrets, or executing remote code.
- Checksum logic that could mask a corrupt installation.

Out of scope:

- Vulnerabilities in VS Code itself, Pi, OMP, ZCode, or model providers.
- The inherent risk of giving a coding agent shell access. Permission modes are
  documented; `yolo` / `autoApprove` are explicit user choices.
- Local attackers who can already modify the user's files or environment.

## Design constraints relevant to security

- The shim is bundled as plain source in `shim/` and copied locally; it never downloads
  code.
- The only network call in the shim is `http://127.0.0.1:3425/v1/models` for the local
  Magpie catalog, with a 5-second timeout.
- Agent CLIs are spawned without a shell on POSIX and with `windowsHide`; arguments are
  passed as an array. Model ids are stripped of the harness prefix before use.
- The ZCode backend edits `~/.zcode/v2/provider_config.json` transiently. It serializes
  access, writes with a lock, and rolls back only the injected field if another process
  changed the file.
- Logs go to `~/.vscode-harness/shim/shim.log`; prompts and file contents are not
  logged, but event types and model ids are.

## User guidance

- Review `git diff` before running an installer from an untrusted fork.
- Keep backups (`~/.vscode-harness/backups`) until you have verified the installation.
- Prefer `edit`/`plan` over `yolo` unless you understand the agent's tool access.
