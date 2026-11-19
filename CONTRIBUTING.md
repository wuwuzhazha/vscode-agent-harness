# Contributing

Thanks for improving `vscode-agent-harness`.

## Development setup

- Node.js >= 20.11
- VS Code 1.147.x for end-to-end runs (optional for most changes)
- No runtime dependencies; do not add one without a strong reason

```bash
git clone https://github.com/wuwuzhazha/vscode-agent-harness.git
cd vscode-agent-harness
npm test
node bin/harness.mjs list
```

To exercise the rules against real pristine bundles, point the optional test at a
directory containing the four `*.orig` files:

```bash
VAH_TEST_BACKUP_DIR=/path/to/backup npm test
```

Expected names: `agentHostMain.js.orig`, `workbench.desktop.main.js.orig`,
`workbench.desktop.main.css.orig`, `product.json.orig`.

## What to change

| Area | Location |
| --- | --- |
| Add or tune an agent | `agents/*.json` (see [docs/agents.md](docs/agents.md)) |
| Canonical generated strings | `src/patch/canonical.mjs` |
| New patch point | `src/patch/agent-host.mjs`, `src/patch/workbench.mjs`, `src/patch/css.mjs` |
| Patch application / checksums | `src/patch/index.mjs`, `src/checksums.mjs` |
| Shim backends | `shim/sdk.mjs` |
| CLI | `src/cli.mjs`, `src/install.mjs` |
| Docs | `README.md`, `docs/`, `AGENTS.md` |

## Rules for patch changes

1. **Idempotency is mandatory.** A rule must detect its own canonical output and return
   `changed: false`. Add a test that runs the patcher twice.
2. **Plan before writing.** Do not write a file until every rule matched and the
   canonical markers verify. `src/patch/index.mjs` enforces this; keep it that way.
3. **No manual checksum edits.** Always go through `updateChecksums()`.
4. **Keep anchors narrow.** Match the smallest unique region; prefer whole-region
   replacement over many tiny string substitutions.
5. **Support the pristine form and older patch generations.** Fixtures in
   `test/fixtures/` contain the pristine anchors; older forms are covered with
   `replaceVariant`.
6. **Do not add absolute user paths** to manifests, shim or source. Use environment
   variables and documented candidates.

## Shim changes

- Preserve the public shape: `query()`, `AbortError`, model listing, permission modes,
  session ids, streaming events.
- Log through the existing `log()` helper; never write to stdout (the agent host reads
  it).
- Keep all backends in one file and route in `query()`. The environment variable accepts
  a single SDK root.
- Do not make the shim fetch remote code. The only allowed network call is the local
  Magpie catalog.

## Tests

- `test/canonical.test.mjs` — generated strings
- `test/patch.test.mjs` — rule application, idempotency, single-agent installs
- `test/checksums.test.mjs` — checksum repair
- CI runs on Linux and Windows with Node 20 and 22.

Add a test for every behavior change. UI-only documentation changes do not need one.

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(agents): add Aider harness
fix(zcode): restore model selection after a config rewrite
docs: clarify restart requirement
test: cover single-agent install
```

Keep commits focused. Do not include generated logs, backups, or local paths.

## Pull request checklist

- [ ] `npm test` passes
- [ ] `npm run check` passes
- [ ] New behavior has a test (or a documented reason it cannot)
- [ ] README / docs updated for user-visible changes
- [ ] No secrets, personal paths, or machine-specific values
- [ ] `install --dry-run` produces no unexpected diff on a supported VS Code

## Adding a new agent

Follow [docs/agents.md](docs/agents.md#adding-an-agent). A manifest-only addition needs
an existing backend. A new backend also needs shim code, routing, a `BACKENDS` entry,
tests and documentation.

## Code style

- ESM, 2-space indentation, semicolons, double quotes (match existing files)
- Named exports, small functions, no classes unless the API requires one
- Comments explain *why* an anchor or workaround exists, not what the line does
- Avoid dependencies; `node:` built-ins only
