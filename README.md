# vscode-agent-harness

Install third-party coding agents as **native GitHub Copilot Chat harnesses** in VS Code.

Copilot Chat's agent host already speaks the Claude Agent SDK protocol. This project
uses that seam: it registers additional providers in VS Code's agent host, points the
SDK loader at a small compatibility shim, and translates the shim's calls to the real
agent process. The result is a first-class chat session — model picker, permission
modes, streaming text, tool calls, and VS Code's native diff/Keep/Undo — instead of a
terminal glued to the side.

> **Unofficial software, use at your own risk.** Not affiliated with Microsoft, GitHub,
> Anthropic, Pi, OMP or ZCode. This tool modifies your local VS Code installation. Read
> [DISCLAIMER.md](DISCLAIMER.md) and [Safety](#safety-and-rollback) first.

## Supported agents

| Agent | id | Backend | Models | Permission modes |
| --- | --- | --- | --- | --- |
| [Pi](https://github.com/badlogic/pi-mono) | `pi` | `pi --mode rpc` | `pi` model list | default, readOnly, noTools |
| OMP | `omp` | `omp --mode rpc` | `omp` model list | default, readOnly, autoApprove, noTools |
| [ZCode](https://zcode.zhipu.ai/) | `zcode` | `zcode --output-format stream-json` | Magpie catalog (`127.0.0.1:3425`) | edit, plan, yolo |

Agent definitions are data, not code: see [`agents/`](agents) and
[Adding an agent](docs/agents.md#adding-an-agent).

## Requirements

- **VS Code 1.147.x** (tested with 1.147.0, commit `8a14f0cc1b`). Other builds may
  have different minified anchors; the installer refuses to write a partial patch.
- **Node.js >= 20.11** on `PATH` (needed by the shim and the ZCode CLI).
- The agent binary you want to use:
  - Pi: `pi` on `PATH`, or `PI_BIN`
  - OMP: `omp` on `PATH`, or `OMP_BIN`
  - ZCode: ZCode desktop/CLI installed, or `ZCODE_CLI_PATH` pointing at `zcode.cjs`
- Windows is the primary tested platform. macOS/Linux discovery code exists but is
  not yet covered by CI.

## Quick start

```bash
git clone https://github.com/wuwuzhazha/vscode-agent-harness.git
cd vscode-agent-harness

# One agent
node bin/harness.mjs install --agent zcode --yes

# Everything
node bin/harness.mjs install --all --yes
```

Optional global CLI:

```bash
npm install -g .
vah install --agent zcode --yes
```

Then **quit VS Code completely** and start it again from a new process (Start Menu,
new terminal, or a fresh Explorer window). The installer sets
`VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT` at user level; an already-running VS Code will not
see it.

Verify at any time:

```bash
vah doctor
vah verify
```

## One-click AI deployment

Give this prompt to an AI coding agent that can run terminal commands on your machine.
It will discover VS Code, check the agent runtime, install, and verify.

```text
Read AGENTS.md in this repository and deploy the ZCode harness for me.

Follow the procedure exactly:
1. Run `node bin/harness.mjs doctor --json` and summarize the detected VS Code
   installation, supported version, shim and runtime status.
2. If the zcode runtime is missing, stop and tell me what to install.
3. Run `node bin/harness.mjs install --agent zcode --yes`.
4. Run `node bin/harness.mjs verify --json`. If it fails, diagnose and fix before
   reporting success.
5. Tell me whether I must restart VS Code, and how to roll back.

Do not modify unrelated files, do not commit or push, and do not ask me for paths that
you can discover yourself.
```

Replace `zcode` with `pi`, `omp`, or `all`. More templates (English/Chinese) are in
[docs/ai-deploy.md](docs/ai-deploy.md).

## CLI

```
vah <command> [options]

doctor            Inspect VS Code, patches, shim and agent runtimes
list              Show available agent manifests
install           Patch VS Code and install the shim (default: all agents)
verify            Check that the installation is complete
status            Show installer state
uninstall         Restore the original VS Code files

--agent <id|all>  Agent(s) to install, comma separated (default: all)
--vscode <dir>    Path to VS Code's resources/app (or install root)
--dry-run         Show what would change without writing
--yes             Do not ask for confirmation
--json            Machine-readable output
--skip-shim       Do not install the Claude SDK shim
--skip-terminal   Do not create terminal wrappers
--purge           With uninstall: also delete backups
```

Installs are **cumulative**: `install --agent zcode` keeps any harness already
recorded for that VS Code commit. `uninstall` restores all of them at once.

### Examples

```bash
vah doctor --json
vah install --agent zcode --dry-run
vah install --agent pi,omp --yes
vah verify
vah uninstall --yes
```

## How it works

1. **Provider registration** — `agentHostMain.js` gets an IIFE that creates one agent
   host provider per manifest, overrides its descriptor and chat config, and sets the
   permission enum.
2. **Identity** — the provider ids are added to the session predicate, tombstone
   check, session scheme, saved-chat store and storage allowlist.
3. **Workbench UI** — vendor labels, vendor icons, model-chip icons, the chat session
   icon, custom-model flags and the Copilot sign-in bypass are patched to recognize the
   new providers. SVG codicon rules are appended to the workbench stylesheet.
4. **SDK shim** — `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT` points at
   `~/.vscode-harness/shim`, whose `sdk.mjs` implements the Claude Agent SDK surface
   and spawns `pi`/`omp` JSON-RPC or the ZCode CLI.
5. **Checksums** — any change under `out/` invalidates `product.json.checksums`, which
   makes VS Code report a corrupt installation. The installer recomputes the affected
   entries and re-verifies.

The full patch map lives in [docs/architecture.md](docs/architecture.md).

## Safety and rollback

- Before writing, the installer snapshots the four files it can touch under
  `~/.vscode-harness/backups/<commit>/`. It never overwrites an existing snapshot.
- All rules are planned in memory and verified first. If any anchor is missing, nothing
  is written.
- `VAH_BACKUP_SEED=<dir>` seeds the snapshot from known-pristine `*.orig` files, useful
  when installing onto an already-patched VS Code.
- Roll back with:

  ```bash
  vah uninstall --yes
  ```

  This restores the snapshotted files, removes the shim and the user-level environment
  variable, and keeps backups. Add `--purge` to delete backups too.
- A VS Code update replaces the patched files and may remove the environment variable.
  Re-run `vah install` after updating; `vah doctor` tells you whether the patch is
  still present.

## Limitations

- The patch targets minified internals of a specific VS Code series. It is not an
  extension and cannot survive arbitrary VS Code updates without re-verification.
- No marketplace publishing: VS Code would reject an extension that rewrites its own
  installation.
- macOS may refuse to launch a modified, signed application bundle; Windows
  per-machine installs may require administrator rights.
- ZCode lacks a `--model` flag. The shim temporarily writes `defaultModelSelection` to
  `~/.zcode/v2/provider_config.json` before spawning a new session and restores the
  original file after the turn starts.
- ZCode's `build` and `guarded` modes require an interactive permission client and are
  not exposed; use `edit`, `plan` or `yolo`.

## Development

```bash
npm test
VAH_TEST_BACKUP_DIR=/path/to/pristine/backup npm test   # also patch real VS Code files
npm run check
```

No runtime dependencies. Tests use `node:test`.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and
[docs/troubleshooting.md](docs/troubleshooting.md).

## 中文说明

`vscode-agent-harness` 把 Pi、OMP、ZCode 等第三方编码 Agent 注册成 VS Code Copilot
Chat 的原生 harness：支持模型选择、权限模式、流式输出、工具调用和 VS Code 原生
Diff（Keep / Undo），而不是在侧边栏嵌一个终端。

一键部署：

```bash
node bin/harness.mjs install --agent zcode --yes
```

安装后必须**完全退出 VS Code 再重新启动**，因为
`VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT` 只对之后启动的进程生效。

也可以直接把 [AGENTS.md](AGENTS.md) 和下面这段提示词交给 AI：

```text
读取本仓库的 AGENTS.md，按其中流程部署 zcode harness：
先用 doctor --json 自动探测本机 VS Code 和运行时，再 install --agent zcode --yes，
最后 verify --json 并告诉我是否需要重启、如何回滚。不要修改无关文件，不要提交或推送。
```

安全说明：安装器只改 4 个文件，写入前会备份到 `~/.vscode-harness/backups/<commit>/`；
锚点不匹配时不会写入任何文件。卸载执行 `vah uninstall --yes` 即可恢复原文件。

## Disclaimer / 免责声明

**English.** This is unofficial software. It modifies your local VS Code installation,
sets a user-level environment variable, and may change your PATH. It is provided "AS IS",
without warranty of any kind, and used at your own risk. The author and contributors are
not liable for data loss, broken installations, security incidents, API costs, or
compliance issues.

Read the full terms in [DISCLAIMER.md](DISCLAIMER.md) and [LICENSE](LICENSE).

**中文。** 本项目为非官方软件，会修改本机 VS Code 安装目录、设置用户级环境变量，并可能
修改 PATH。软件按“现状”提供，不附带任何担保，使用风险自负。作者与贡献者不对数据丢失、
安装损坏、安全事件、模型费用或合规问题承担责任。

完整条款见 [DISCLAIMER.md](DISCLAIMER.md) 与 [LICENSE](LICENSE)。

## Legal and trademarks

This is an unofficial project, not affiliated with or endorsed by Microsoft, GitHub,
Anthropic, Pi, OMP or ZCode. It modifies a local VS Code installation and does not
redistribute VS Code or the Anthropic SDK. The shim is an independent compatibility layer;
see [NOTICE.md](NOTICE.md) for third-party notices.

You are responsible for complying with the licenses and terms that apply to your VS Code
installation and to the agent CLIs and model providers you use.

## License and copyright

MIT — Copyright (c) 2026 wuwuzhazha. See [LICENSE](LICENSE),
[DISCLAIMER.md](DISCLAIMER.md) and [NOTICE.md](NOTICE.md).
