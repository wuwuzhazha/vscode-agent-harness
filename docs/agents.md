# Agent manifests

An agent is a JSON file in [`agents/`](../agents). The installer loads every manifest,
sorts by `order` then `id`, and derives all patch strings from them. Adding an agent
requires no changes to the patch rules.

## Schema

```jsonc
{
  "id": "zcode",                    // provider id; used in sessions, URLs and CSS
  "displayName": "ZCode",           // vendor label and picker text
  "description": "ZCode CLI ...",   // shown in the provider descriptor
  "backend": "zcode-cli",           // pi-rpc | omp-rpc | zcode-cli
  "order": 3,                       // display order; lower comes first
  "icon": {
    "codicon": "zcode",             // CSS class name and $(zcode) icon id
    "svg": "%3Cpath d='...'/%3E"    // inner SVG, URL-encoded, 16x16 viewBox
  },
  "permissionMode": {
    "fallback": true,               // optional; final ternary branch
    "default": "edit",
    "autonomous": "edit",           // value used for autonomous sessions
    "options": [
      {
        "value": "edit",            // stored in config and sent to the shim
        "label": "Edit（默认）",     // picker label
        "description": "..."        // picker description
      }
    ]
  },
  "models": {
    "catalog": "magpie",            // informational; shim owns the real list
    "prefix": "zcode-",             // model id prefix understood by the shim
    "prefixInHost": false           // true: VS Code adds the prefix (OMP)
  },
  "terminal": {                     // optional terminal entry
    "command": "zcode",
    "searchGlobs": ["%LOCALAPPDATA%/Programs/ZCode/resources/glm/zcode.cjs"]
  },
  "notes": ["..."]                  // shown by maintainers; not patched
}
```

### `permissionMode`

The values are written into the chat config schema and the `mI` normalizer. A value is
passed to the shim as `options.permissionMode`.

| Agent | value | Effect |
| --- | --- | --- |
| pi | `default` | Pi's default tool set |
| pi | `readOnly` | `--tools read,grep,find,ls` |
| pi | `noTools` | `--no-tools` |
| omp | `default` | OMP's default tool set |
| omp | `readOnly` | `--tools read,grep,glob` |
| omp | `autoApprove` | `--auto-approve` |
| omp | `noTools` | `--no-tools` |
| zcode | `edit` | `--mode edit`: auto-accept edits, run Bash |
| zcode | `plan` | `--mode plan`: read-only planning |
| zcode | `yolo` | `--mode yolo`: skip permission prompts |

ZCode `build` and `guarded` need an interactive permission client; headless calls fail
with "No permission client configured", so they are not exposed.

`fallback` marks the spec used for provider ids that are not in the manifest set. Keep
it on exactly one manifest; partial installs fall back to their last agent.

### `models`

- `prefix` is the shim-side namespace. ZCode returns `zcode-<magpie-id>`; the shim
  strips it before invoking the CLI.
- `prefixInHost: true` makes VS Code add the prefix in `fRt` (used by OMP, whose
  native ids can collide with Claude ids). ZCode manages its own prefix in the shim,
  so it stays `false`.
- `catalog` documents where the list comes from. The shim currently supports:
  - `pi` — `pi --list-models`
  - `omp` — `omp --list-models` (JSON)
  - `magpie` — `http://127.0.0.1:3425/v1/models`, falling back to
    `~/.zcode/v2/provider_config.json`

## Adding an agent

1. **Create a manifest** in `agents/<id>.json`. Use an id that is safe in a CSS class
   (`^[a-z][a-z0-9-]*$`) and encode the SVG fragment.
2. **Pick an existing backend** if the CLI already has a shim implementation:
   - `pi-rpc` — Pi JSON-RPC (`--mode rpc`)
   - `omp-rpc` — OMP JSON-RPC
   - `zcode-cli` — ZCode stream-json
3. **Or add a backend** (requires code):
   - Implement `xyzQuery(params)` in `shim/sdk.mjs`.
   - Route to it from `query(params)`, ideally via the `PI_HARNESS` env tag injected by
     `_fetchNativeModels`, with a model-prefix fallback.
   - Add the backend id to `BACKENDS` in [`src/agents.mjs`](../src/agents.mjs).
   - Document the event mapping in [architecture.md](architecture.md).
4. **Add tests** if the backend is new. At minimum, extend
   `test/patch.test.mjs` to install the agent alone and assert its provider block.
5. **Update the README table** and `docs/troubleshooting.md`.
6. Run:

   ```bash
   npm test
   node bin/harness.mjs install --agent <id> --dry-run
   ```

Rules:

- Do not hard-code absolute paths in the manifest beyond a documented fallback;
  `searchGlobs` supports `%VAR%` expansion.
- Do not set `fallback` on more than one manifest.
- Do not reuse an id used by a built-in provider (`claude`, `codex`, `copilotcli`).
- Icons must be monochrome shapes that work with `currentColor` masks; no external
  images.

## Why generated strings instead of per-agent patches

The workbench and agent host are minified single-line bundles. Patching them with one
hand-written replacement per agent would multiply anchors and make idempotency fragile.
Instead, every rule computes a canonical region from the manifest list and either
detects it (no-op) or replaces the whole region. That is why:

- installing a second agent rewrites the provider block instead of adding a second one;
- removing an agent is possible by uninstalling/restoring, not by deleting a manifest;
- a rule that cannot find its anchor fails the whole run before writing.
