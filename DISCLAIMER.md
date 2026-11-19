# Disclaimer

## English

**Unofficial software.** `vscode-agent-harness` is an independent community project. It
is not affiliated with, endorsed by, sponsored by, or supported by Microsoft, GitHub,
Anthropic, Pi, OMP, ZCode, Zhipu AI, or any other vendor mentioned in this repository.
All product names and trademarks belong to their respective owners.

**Use at your own risk.** The installer modifies files inside your local VS Code
installation, rewrites `product.json` checksums, installs a module under your home
directory, sets the user-level `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT` environment variable,
and may add a terminal wrapper and a user PATH entry. These changes can:

- be overwritten by a VS Code update;
- cause VS Code to report a corrupt installation or fail to start if interrupted;
- interact unexpectedly with other extensions, patches, or security software;
- temporarily modify ZCode's `~/.zcode/v2/provider_config.json` while selecting a model.

Back up important work and keep the generated rollback data
(`~/.vscode-harness/backups`). You can restore the original files with
`vah uninstall --yes`.

**No warranty.** The software is provided "AS IS", without warranty of any kind, express
or implied, including but not limited to the warranties of merchantability, fitness for a
particular purpose, title, and non-infringement. See [LICENSE](LICENSE).

**No liability.** To the maximum extent permitted by applicable law, the author and
contributors are not liable for any claim, damages, data loss, service interruption,
security incident, or other liability arising from the use of, or inability to use, this
software.

**Third-party agents.** Harnesses can give a coding agent access to your files and shell.
You are responsible for the commands an agent runs, the data it can read, the changes it
makes, and the cost of any model API calls.

**Compliance.** You are responsible for complying with the licenses, terms of service,
acceptable-use policies, and organizational rules that apply to VS Code, the agent CLIs,
the model providers, and your own repositories. Reverse engineering and modification may
be restricted in some jurisdictions or by some agreements; assess this before use.

**Not legal advice.** The licensing and compliance notes in this repository are
engineering documentation, not legal advice. Consult qualified counsel for your
situation.

## 中文

**非官方项目。** `vscode-agent-harness` 是独立的社区项目，与 Microsoft、GitHub、
Anthropic、Pi、OMP、ZCode、智谱 AI 及其他提及的厂商均无隶属、背书、赞助或支持关系。
所有产品名称与商标归各自所有者。

**使用风险自负。** 安装器会修改本机 VS Code 安装目录中的文件、重写
`product.json` 校验和、在用户目录安装模块、设置用户级环境变量
`VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT`，并可能创建终端包装脚本和修改用户 PATH。这些
修改可能导致：

- VS Code 更新后补丁失效；
- 安装中断时 VS Code 提示“安装已损坏”或无法启动；
- 与其他扩展、补丁或安全软件产生非预期交互；
- 选择模型时临时修改 ZCode 的 `~/.zcode/v2/provider_config.json`。

请备份重要数据，并保留 `~/.vscode-harness/backups` 中的回滚数据；可执行
`vah uninstall --yes` 恢复原始文件。

**不提供担保。** 本软件按“现状”提供，不附带任何明示或暗示的担保，包括但不限于
适销性、特定用途适用性、权利完整性及不侵权担保。详见 [LICENSE](LICENSE)。

**责任限制。** 在适用法律允许的最大范围内，作者与贡献者不对因使用或无法使用本软件
而产生的任何索赔、损害、数据丢失、服务中断、安全事件或其他责任负责。

**第三方 Agent。** Harness 可能让编码 Agent 访问你的文件和 Shell。Agent 执行的命令、
读取的数据、做出的修改以及模型 API 费用，均由你自行负责。

**合规责任。** 你有责任遵守适用于 VS Code、Agent CLI、模型提供商及你自身仓库的
许可证、服务条款、可接受使用政策和组织规定。部分司法辖区或协议可能限制逆向工程与
修改行为，请在使用前自行评估。

**不构成法律意见。** 本仓库中的许可证与合规说明仅为工程文档，不构成法律意见。如有
疑问，请咨询专业律师。

## Reporting

If you believe this project infringes your rights or contains inappropriate material,
please open a private report through the repository's Security tab or contact the
maintainer via GitHub ([@wuwuzhazha](https://github.com/wuwuzhazha)).
