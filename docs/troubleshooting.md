# Troubleshooting

Start with:

```bash
vah doctor
```

`doctor` exits non-zero and lists `problems` when something is missing. Use
`vah verify --json` when you need per-check detail.

## The harness does not appear in VS Code

**Symptom:** no Pi/OMP/ZCode chat session type; `doctor` says `patched: false`.

1. Confirm the installation is supported: `doctor` must report VS Code 1.147.x and
   `tested: true`.
2. Re-run `vah install --agent <id> --yes`. The installer refuses to write if an anchor
   is missing; do not hand-edit the bundle.
3. Fully quit VS Code (check Task Manager / Activity Monitor for `Code.exe`) and start
   it again.

If the installer reports `anchors not found`, the VS Code build differs from the tested
one. Report the rule names and the `doctor --json` output in an issue.

## `No models available`

**Symptom:** the chat opens but the model picker is empty, or the host cannot load the
Claude SDK.

The agent host process did not inherit `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT`.

```bash
# Windows (new shells only)
echo %VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT%
# PowerShell
$env:VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT

# macOS / Linux
echo $VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT
```

Expected value: `<home>/.vscode-harness/shim`. The file
`<root>/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` must exist.

Fixes:

- Run `vah install --agent <id> --yes` again (it reinstalls the shim and sets the
  variable).
- On Windows, `setx` only affects processes started afterwards. Restart Explorer or log
  out/in if VS Code launched from the taskbar still lacks the variable.
- Start VS Code from a **new** terminal, or from the Start Menu.
- On macOS, GUI apps do not read shell rc files; the installer also runs
  `launchctl setenv`. You may need `launchctl setenv` after a reboot, or start VS Code
  from a shell that exports the variable.

## `installation appears to be corrupt`

`product.json.checksums` no longer matches files under `out/`. This happens after a
manual edit or a partially interrupted patch.

```bash
vah install --agent <id> --yes
vah verify
```

The installer recomputes only the entries for files it touches. Never edit
`product.json` by hand.

## Pi/OMP chat starts but tools fail immediately

Check the shim log:

```bash
# Windows
type %USERPROFILE%\.vscode-harness\shim\shim.log
# macOS / Linux
tail -n 100 ~/.vscode-harness/shim/shim.log
```

Common causes:

- Binary not found: set `PI_BIN` / `OMP_BIN` to the full path, or add the directory to
  `PATH`. The shim also looks in `~/.pi/agent/bin`, `~/.bun/bin`,
  `%APPDATA%\npm` and `~/.local/bin`.
- Permission mode `readOnly` is working as intended (`--tools read,grep,...`).
- `autoApprove` only exists for OMP.

## ZCode shows only `ZCode (default)`

The shim could not read the Magpie catalog and fell back to a placeholder.

1. Confirm the local router is up. The token (if any) is stored in ZCode's own
   `~/.zcode/v2/provider_config.json`, under the Magpie provider rule's
   `config.access.apiKey`; do not copy it into scripts or issues.

   ```bash
   curl -H "Authorization: Bearer $MAGPIE_TOKEN" http://127.0.0.1:3425/v1/models
   ```

   A JSON body with `data[]` is expected. The shim reads the token and base URL from
   that config automatically; `MAGPIE_BASE_URL` and `MAGPIE_TOKEN` override them.
2. If Magpie is not running, ZCode still works: the shim falls back to
   `~/.zcode/v2/provider_config.json` (`providerModelRules`). Start ZCode desktop once
   so the file exists.
3. Restart VS Code to refresh the catalog cache (5 minutes).

## ZCode tools are denied: "No permission client configured"

ZCode headless only supports:

- `edit` — edits are auto-accepted and Bash runs
- `plan` — read-only
- `yolo` — everything allowed

`build` and `guarded` require an interactive permission client and are intentionally
not exposed. Choose another mode in the picker.

## ZCode model selection does not stick

ZCode has no `--model` flag. The shim writes `defaultModelSelection` into
`~/.zcode/v2/provider_config.json` before starting a **new** session and restores the
file once `turn.started` arrives.

- Switching the model mid-conversation starts a new CLI session on the next turn. The
  current session keeps its original model.
- If the ZCode desktop app rewrites the config at the same moment, the shim only rolls
  back the field it injected. Verify the file is still valid JSON; if not, fix it from a
  ZCode-side backup.
- `ZCODE_CLI_PATH` overrides CLI discovery. It must point at `zcode.cjs`, not at the
  desktop executable.

## Native diff is empty or missing

- Pi: the shim uses `pi-edit-gate.ts` to delay Edit/Write by 750 ms so the harness can
  snapshot the "before" contents. If the file is huge or on a slow network share, the
  snapshot may still lose the race; increase the delay in the shim if needed.
- ZCode: diff is driven by `tool.updated` events and needs no delay.
- If Keep/Undo does nothing, ensure the chat session is targeting your workspace folder
  and not a temporary directory.

## Terminal command `zcode` is missing

```bash
vah install --agent zcode --yes
```

The installer reuses an existing `zcode` command. If none exists, it writes a wrapper
to `~/.vscode-harness/bin` and appends that directory to the **user** PATH. Open a new
terminal for the change to apply.

If `zcode` resolves but points at a stale path, remove the old wrapper and re-run
`vah install --agent zcode --yes`, or set `ZCODE_CLI_PATH`.

## Uninstall

```bash
vah uninstall --yes
```

This restores the four snapshotted files, removes the shim, removes the user-level
environment variable and the terminal wrapper. Backups are kept for inspection; add
`--purge` to delete them.

If no state file exists but you know the installation:

```bash
vah uninstall --vscode "D:\Microsoft VS Code\8a14f0cc1b\resources\app" --yes
```

Restore requires a backup under `~/.vscode-harness/backups/<commit>/`. If it is missing,
reinstall VS Code or use the VS Code installer's repair function.

## Reporting a bug

Include:

- `vah doctor --json`
- `vah verify --json`
- OS, VS Code version and commit (`code --version`)
- the agent CLI version (`pi --version`, `omp --version`, `zcode --version`)
- relevant `shim.log` lines (redact paths if needed)
