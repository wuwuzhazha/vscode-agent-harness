# Deploy with an AI agent

The repository is designed to be handed to an AI coding agent with terminal access.
[`AGENTS.md`](../AGENTS.md) is the authoritative procedure; this page provides
copy-paste prompts and the expected machine-readable outputs.

## Prerequisites for the AI

- The repository is available locally (clone it or point the AI at the folder).
- It can run `node`, and the user has permission to modify their VS Code installation.
- It can read `AGENTS.md`. If your AI tool does not load that file automatically, paste
  the prompt below together with the file content.

## Prompt — one agent (Chinese)

```text
读取本仓库的 AGENTS.md，按其中流程为我部署 ZCode harness。

要求：
1. 先运行 `node bin/harness.mjs doctor --json`，自动探测本机 VS Code（包括
   `resources/app` 和按 commit 分目录的安装），并汇报版本、是否受支持、运行时状态。
2. 如果 zcode 运行时缺失，停下来告诉我需要安装什么，不要擅自安装第三方软件。
3. 执行 `node bin/harness.mjs install --agent zcode --yes`。
4. 执行 `node bin/harness.mjs verify --json`。如果失败，先诊断修复，不要直接说成功。
5. 最后告诉我：改了哪些文件、是否需要完全重启 VS Code、如何回滚。

不要修改无关文件，不要提交或推送，不要让我手工提供你能自行探测到的路径。
```

## Prompt — one agent (English)

```text
Read AGENTS.md in this repository and deploy the OMP harness for me.

Follow the procedure exactly:
1. Run `node bin/harness.mjs doctor --json` and report the detected VS Code
   installation, whether the version is supported, and the runtime status.
2. If the omp runtime is missing, stop and tell me what to install. Do not install
   third-party software on your own.
3. Run `node bin/harness.mjs install --agent omp --yes`.
4. Run `node bin/harness.mjs verify --json`. If it fails, diagnose and fix it before
   reporting success.
5. Finally, tell me which files changed, whether I must fully restart VS Code, and how
   to roll back.

Do not modify unrelated files, do not commit or push, and do not ask me for paths you
can discover yourself.
```

## Prompt — all agents

```text
Read AGENTS.md and deploy all available harnesses (pi, omp, zcode) into my local
VS Code. Use doctor --json to discover the installation, install with --all --yes,
then verify --json. Report any agent whose runtime is missing instead of installing it.
Finish with restart and rollback instructions.
```

## What the AI should observe

`doctor --json`:

```json
{
  "vscode": {
    "appDir": "D:\\Microsoft VS Code\\8a14f0cc1b\\resources\\app",
    "version": "1.147.0",
    "tested": true,
    "running": true
  },
  "patched": { "agentHost": true, "workbench": true, "css": true },
  "checksums": { "ok": true },
  "shim": { "installed": true, "envValue": "C:\\Users\\me\\.vscode-harness\\shim" },
  "runtimes": [{ "id": "zcode", "ok": true }],
  "ok": true,
  "problems": []
}
```

`install --dry-run --json` must contain `"ok": true` and either a list of files under
`"changed"` or an empty list when the installation is already current.

`verify --json` must end with `"ok": true` and every entry in `checks` must have
`"ok": true`.

## Guardrails the AI must respect

- A failed anchor is a version mismatch, not an invitation to hand-edit minified code.
- `install` is cumulative per VS Code commit; do not use it to remove an agent.
- Backups live in `~/.vscode-harness/backups`; do not delete them.
- The user must fully restart VS Code. A window reload does not pick up
  `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT`.
- Never edit `product.json` checksums manually; `install` does it correctly.

## Minimal prompt if the AI cannot read files

```text
You are deploying vscode-agent-harness. Work in the repository root and run these
commands in order, stopping on the first failure:

node bin/harness.mjs doctor --json
node bin/harness.mjs install --agent zcode --yes
node bin/harness.mjs verify --json

If doctor does not find VS Code, retry with `--vscode <install-root>`; do not guess.
Report the detected VS Code path, the changed files, the verify result, and tell me to
fully quit and restart VS Code. Rollback is `node bin/harness.mjs uninstall --yes`.
```
