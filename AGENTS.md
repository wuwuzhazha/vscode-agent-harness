# Instructions for AI agents

This file is the deployment contract for AI coding agents. Follow it when a user asks
you to install one or more harnesses from this repository.

## Goal

Make the requested agent appear as a native Copilot Chat harness in the user's VS Code,
and prove it with `verify`. Do not reimplement the patch by hand.

## Ground rules

- Work from the repository root. All commands below are relative to it.
- **Do not commit or push.** The user did not ask for that unless they said so.
- **Do not edit VS Code files manually.** The installer plans and verifies every
  replacement in memory; a hand edit can leave the installation corrupt.
- **Do not silently install third-party agent binaries.** If a runtime is missing,
  stop and report the exact install command.
- One install is cumulative per VS Code commit. Do not try to remove a harness by
  omitting it from `--agent`.
- If any command fails, stop and report the command, exit code and relevant output.

## Procedure

### 1. Discover the environment

```bash
node bin/harness.mjs doctor --json
```

Parse the JSON:

- `vscode.appDir` — detected installation. If `null`, search for VS Code:
  - `--vscode <path>` where `<path>` is `resources/app` **or** the install root
  - `VSCODE_APP_DIR` environment variable
  - Windows: `%LOCALAPPDATA%\Programs\Microsoft VS Code`,
    `%ProgramFiles%\Microsoft VS Code`, and per-commit layouts
    `<install>\<commit>\resources\app`
- `vscode.tested` — must be `true` (1.147.x). If `false`, stop: the minified anchors
  are not validated for that build.
- `vscode.running` — record it; a restart will be required.
- `runtimes[]` — the selected agent must have `ok: true`.

If `doctor` reports `vscode: null`, do not guess a path; report what was searched and
ask for `--vscode`.

### 2. Resolve the requested agent

Map the user's wording to a manifest id:

| User says | id |
| --- | --- |
| Pi | `pi` |
| OMP, oh-my-pi | `omp` |
| ZCode, 智谱, GLM CLI | `zcode` |
| everything, all agents | `all` |

If the user did not name one, use `all`. Confirm the selection in your plan message.

### 3. Preview, then install

```bash
node bin/harness.mjs install --agent <id> --dry-run --json
node bin/harness.mjs install --agent <id> --yes
```

- `--dry-run` must report `changed` files (or `[]` when already installed) and no
  errors. If it throws, do not force anything.
- Use `--vscode <path>` if discovery found the wrong installation.
- Use `--skip-shim` only if the user explicitly manages
  `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT` themselves.
- The installer writes backups before patching. Do not delete
  `~/.vscode-harness/backups`.

### 4. Verify

```bash
node bin/harness.mjs verify --json
```

Require `ok: true`. Every check must pass:

- `agent-host`, `workbench`, `css` — canonical markers present
- `checksums` — `product.json` matches the patched files
- `shim` — `sdk.mjs` installed
- `sdk-root-env` — user-level variable points at the installed shim

If `sdk-root-env` fails, re-run `install` (without `--skip-shim`) and verify again.

### 5. Finish

Tell the user, in their language:

1. Which VS Code installation was patched and which agents were added.
2. That VS Code must be **fully quit and started again** (a reload is not enough,
   because the SDK root is read at process start). Start it from a new terminal or the
   Start Menu so the new environment variable is inherited.
3. How to roll back: `node bin/harness.mjs uninstall --yes`.
4. Any runtime caveats (for example ZCode needs its local Magpie router for the full
   model catalog, otherwise the shim falls back to `provider_config.json`).

Do not claim success based on `install` alone; success means `verify.ok === true`.

## Failure handling

| Symptom | Action |
| --- | --- |
| `VS Code installation not found` | Search the known layouts; retry with `--vscode`. Do not write to a guessed directory. |
| `This build is untested` | Stop. Ask the user whether to proceed on an unsupported version; do not promise a working patch. |
| `anchors not found` | The build differs. Do not hand-edit. Report the missing rule names from the error and the `doctor --json` output. |
| `Checksum verification failed` | Re-run `install`; if it persists, stop and report. Never edit `product.json` manually. |
| `zcode CLI found: false` | Set `ZCODE_CLI_PATH` to `.../ZCode/resources/glm/zcode.cjs`, or install ZCode. |
| `pi/omp not on PATH` | Report the binary name and the manifest's lookup paths (`PI_BIN`, `OMP_BIN`, `~/.pi/agent/bin`, `~/.bun/bin`). |
| `No models available` in VS Code | The process did not inherit `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT`. Quit VS Code fully (check Task Manager for `Code.exe`), start it from a new shell. |
| `installation appears to be corrupt` | Checksums are stale. Run `install` again; it recomputes only modified entries. |

## Do not

- Do not copy shim files into VS Code's `resources/app` (only `~/.vscode-harness/shim`).
- Do not run `git clean`, delete `~/.vscode-harness`, or purge backups without explicit
  permission.
- Do not modify `~/.zcode/v2/provider_config.json` yourself; the shim handles model
  selection and restores the file.
- Do not add agents to `agents/` to work around a missing runtime.

## Definition of done

- [ ] `doctor --json` detects the intended VS Code and the agent runtime.
- [ ] `install --agent <id> --yes` exits 0.
- [ ] `verify --json` exits 0 with `ok: true`.
- [ ] User was told to restart VS Code and how to roll back.
