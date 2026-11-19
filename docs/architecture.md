# Architecture

VS Code does not expose a public "add a chat provider" API for arbitrary CLIs. It does,
however, load its built-in Claude agent host through a module that can be redirected
with an environment variable, and that host registers providers in a table that is
encoded in JavaScript. This project uses both seams.

```
┌──────────────────────────── VS Code renderer ────────────────────────────┐
│ Copilot Chat UI                                                          │
│   • provider list / vendor labels / icons                                │
│   • model picker + permission mode picker                                │
│   • chat session (streaming, tool cards, native diff, Keep/Undo)         │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ agent host RPC
┌───────────────────────────────▼──────────────────────────────────────────┐
│ agentHostMain.js (patched)                                               │
│   • registers provider instances for pi / omp / zcode                    │
│   • keeps session storage, tombstones and saved chats provider-aware     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ Claude Agent SDK API
┌───────────────────────────────▼──────────────────────────────────────────┐
│ ~/.vscode-harness/shim/node_modules/@anthropic-ai/claude-agent-sdk/      │
│   sdk.mjs                                                                │
│     query(options)                                                       │
│       ├─ options.model starts with "zcode-" or PI_HARNESS=zcode          │
│       │    → zcodeQuery  → node zcode.cjs --output-format stream-json    │
│       └─ otherwise       → piQuery   → pi|omp --mode rpc (JSON-RPC)      │
└──────────────────────────────────────────────────────────────────────────┘
```

The environment variable read by the agent host is
`VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT`. It must point at a directory containing
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`. Only one root is supported, so
all backends live in one shim file and are routed at query time.

## Patch points in `agentHostMain.js`

| Location | What changes | Why |
| --- | --- | --- |
| Provider registration | Replaces `re.registerProvider(f.createInstance(Wk)),` with an IIFE that registers one provider per manifest, overrides `getDescriptor`, `resolveChatConfig`, `getAutonomousSessionConfig` | Adds the provider and its permission enum/default |
| `vS(r)` | Adds provider ids to the predicate | Without it the agent host treats the id as unknown |
| `tpt(r,i)` | Adds provider ids to the tombstone exclusion | Prevents provider sessions from being deleted as stale |
| `r.session.scheme===Ed` | Adds `||r.session.scheme==="<id>"` (parenthesized) | Saved-chat restore looks up the session scheme |
| `new Map([[Ed,...],[Ki,...]])` | Appends one store per provider | Saved chat persistence per harness |
| `["copilotcli","claude","codex"]` | Appends provider ids | Session storage identity allowlist (two occurrences) |
| `mI(r)` | Adds permission-mode values | Normalizes values received from the UI/config |
| `_fetchNativeModels` | Injects `t.env.PI_HARNESS = this.id` | Tags model-list requests so the shim knows which backend to ask |
| `fRt` model mapping | Prefixes ids/names for manifests with `models.prefixInHost` | Keeps `omp-` model ids distinct in the picker |
| `VFe` / `jFe` / call site | Propagates `modelGroupId` for non-Claude hosts | Prevents model grouping from leaking Claude metadata |

## Patch points in `workbench.desktop.main.js`

| Location | What changes | Why |
| --- | --- | --- |
| `Wge(s,o)` | Returns the manifest `displayName` | Group tab would otherwise say "Anthropic" |
| `GMt(s,o)` | Returns `{id:o}` for harness providers | Uses the harness codicon instead of the vendor icon |
| `oer(s)` | Maps `metadata.targetChatSessionType === "agent-host-<id>"` to `{id}` | Model chip under the input box |
| Chat session contribution | Adds `icon:e.provider==="<id>"?"$(<id>)":...` | Session list icon |
| `requiresCustomModels` / `supportsAutoModel` | Forces `requiresCustomModels:true` and disables auto model for harness providers | Enables the model picker menu item |
| `requiresCopilotSignIn` | Returns `false` for harness providers | No GitHub sign-in is needed for local CLIs |
| `workbench.desktop.main.css` | Appends `.codicon-<id>:before` mask rules | Ships the icon glyph without a font |

## Checksums

`product.json.checksums` maps paths under `out/` to base64 SHA-256. VS Code compares
them at startup and shows "installation appears to be corrupt" on a mismatch. The
installer recomputes only entries whose file it changed, preserving VS Code's original
formatting (tabs, trailing newline).

`agentHostMain.js` is not always listed; the installer handles its absence.

## Planning and write protocol

1. Read all four files.
2. Apply rules in memory. Each rule first looks for its canonical output; if present it
   reports "unchanged", which makes re-runs idempotent.
3. Verify that all canonical markers are present.
4. Only if there are no errors, write changed files and refresh checksums.
5. Re-verify checksums and the installation.

This ordering is why a version mismatch cannot leave a half-patched VS Code.

## The shim

`sdk.mjs` implements the subset of `@anthropic-ai/claude-agent-sdk` used by the agent
host: `query()`, `AbortError`, model listing, permission modes, session ids and the
message/stream event shapes.

- **Pi/OMP** — long-lived `--mode rpc` child, JSON-RPC requests (`set_model`,
  `set_thinking_level`, prompts), event translation. Pi and OMP differ in their
  settle event (`agent_settled` vs `agent_end`).
- **ZCode** — one child per turn, `--prompt`, `--cwd`, `--mode`, `--resume`,
  `--output-format stream-json`. `session.titleUpdated`, `turn.started`,
  `model.streaming`, `tool.updated`, `turn.completed` and the final `result` event are
  mapped onto Claude SDK messages.
- **Pi edit gate** — `pi-edit-gate.ts` delays Pi's Edit/Write tool calls by 750 ms so
  the harness can snapshot the pre-edit file before it changes. Without it the native
  diff can show an empty "before" side.
- **ZCode model selection** — ZCode has no `--model` flag. A new session resolves its
  model from `defaultModelSelection` in `~/.zcode/v2/provider_config.json`. The shim
  injects the selection under a serialized lock and restores the original file as soon
  as `turn.started` confirms the session was created. If another process rewrote the
  file in the meantime, only the injected field is rolled back.

## Trust boundaries

The installer runs with the user's privileges and writes to the VS Code installation,
so it is deliberately conservative: no network access, no remote code, no unpinned
dependencies, and backups before the first write. The only network call in the shim is
a `GET http://127.0.0.1:3425/v1/models` for the local Magpie catalog; agent CLI
processes make their own provider calls as usual.
