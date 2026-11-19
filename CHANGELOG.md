# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-19

### Added

- Native VS Code harness support for Pi, OMP and ZCode through a single
  Claude Agent SDK shim.
- Data-driven agent manifests (`agents/*.json`) for provider descriptors, permission
  modes, icons, model prefixes and terminal entries.
- Idempotent patch planner with canonical region detection, in-memory verification and
  no partial writes.
- Automatic `product.json.checksums` repair after patching.
- Per-commit backups under `~/.vscode-harness/backups`, `VAH_BACKUP_SEED` support and a
  full `uninstall` path.
- Shim installation to `~/.vscode-harness/shim` and user-level
  `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT` configuration.
- ZCode backend: stream-json translation, Magpie model catalog, reasoning levels,
  edit/plan/yolo modes, session resume and safe model selection.
- Pi/OMP JSON-RPC backend with per-host model lists, thinking levels, permission modes
  and the Pi edit-gate for native diff snapshots.
- CLI (`vah`) with `doctor`, `list`, `install`, `verify`, `status` and `uninstall`,
  including `--json`, `--dry-run`, `--agent`, `--vscode` and `--purge`.
- AI deployment contract in `AGENTS.md` and prompt templates in `docs/ai-deploy.md`.

### Known limitations

- Targets VS Code 1.147.x only; later builds may change minified anchors.
- macOS/Linux discovery is implemented but not covered by CI.
- ZCode `build` and `guarded` modes are unavailable in headless mode.
