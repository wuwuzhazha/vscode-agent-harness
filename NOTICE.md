# Notices and third-party rights

Copyright (c) 2026 wuwuzhazha.

This project is licensed under the MIT License (see [LICENSE](LICENSE)). That license
covers the original installer, patch rules, shim and documentation in this repository.
The no-warranty and liability terms, plus the product-specific risks of modifying a VS
Code installation, are summarized in [DISCLAIMER.md](DISCLAIMER.md).

## No upstream SDK code

`shim/sdk.mjs` is an independent compatibility layer. It implements the small subset of the
`@anthropic-ai/claude-agent-sdk` module surface that VS Code's agent host calls, but it
does not contain or redistribute Anthropic's SDK source. The official package is
distributed under its own terms (`SEE LICENSE IN README.md` / "© Anthropic PBC. All
rights reserved"), which do not apply to this independent implementation.

The directory name `node_modules/@anthropic-ai/claude-agent-sdk` is required only because
that is the path VS Code resolves when
`VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT` is set. The bundled `shim/package.json` deliberately
uses a different package name and is marked `private`.

## VS Code

Visual Studio Code is a Microsoft product. Its source code is available under the MIT
License, while the distributed application and Microsoft trademarks are subject to
Microsoft's terms. This project:

- does not redistribute the VS Code application or a substantial portion of its source;
- contains only short anchor strings and regexes needed to locate patch points in a
  user's local installation;
- is unofficial and is not endorsed by or affiliated with Microsoft or GitHub.

Users are responsible for complying with the license and terms that apply to their VS
Code installation, and for understanding that modifying an installation may affect
support or code signing.

## Agent names and marks

Pi, OMP, ZCode, GLM, Anthropic, Claude, GitHub Copilot and all other product names are
trademarks or registered trademarks of their respective owners. They are used here only
to describe interoperability. This project is not affiliated with, endorsed by, or
sponsored by any of them.

The icons in `agents/*.json` are original monochrome glyphs, not copies of vendor logos.

## User responsibility

By installing a harness you choose to run a third-party coding agent with access to your
workspace and, depending on the permission mode, your shell. You are responsible for:

- the licenses and terms of the agent CLI and model provider you use;
- reviewing what the agent is allowed to read, write and execute;
- complying with your employer's or organization's policies.

## Reporting concerns

If you believe this repository contains material that infringes your rights, open a
private report via the repository's Security tab or contact the maintainer on GitHub
([@wuwuzhazha](https://github.com/wuwuzhazha)). We will respond promptly and remove or
adjust material where appropriate.

## No warranty

This project is provided "AS IS", without warranty of any kind. See
[DISCLAIMER.md](DISCLAIMER.md) and [LICENSE](LICENSE) for the full terms.
