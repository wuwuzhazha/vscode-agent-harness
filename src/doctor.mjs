import fs from "node:fs";
import { verifyChecksums } from "./checksums.mjs";
import { findVSCode, isTestedVersion, isVSCodeRunning, pathsFor } from "./env.mjs";
import { verifyAgentHost } from "./patch/agent-host.mjs";
import { verifyCss } from "./patch/css.mjs";
import { verifyWorkbench } from "./patch/workbench.mjs";
import { ENV_VAR, readUserEnv, shimInstalled, shimRoot } from "./shim.mjs";
import { checkAgentRuntimes } from "./verify.mjs";

export function doctor({ vscode, agents }) {
  const report = {
    vscode: null,
    patched: null,
    checksums: null,
    shim: { installed: shimInstalled(), root: shimRoot(), envVar: ENV_VAR, envValue: readUserEnv() },
    runtimes: checkAgentRuntimes(agents),
    ok: false,
    problems: [],
  };

  let install;
  try {
    install = findVSCode(vscode);
    report.vscode = {
      appDir: install.appDir,
      version: install.version,
      commit: install.commit,
      tested: isTestedVersion(install.version),
      running: isVSCodeRunning(),
    };
    if (!report.vscode.tested) {
      report.problems.push(`VS Code ${install.version} is untested; supported: 1.147.x`);
    }
  } catch (error) {
    report.problems.push(error.message);
  }

  if (install) {
    const files = pathsFor(install);
    try {
      const agentHost = fs.readFileSync(files.agentHost, "utf8");
      const workbench = fs.readFileSync(files.workbench, "utf8");
      const css = fs.readFileSync(files.css, "utf8");
      const missing = {
        agentHost: verifyAgentHost(agentHost, agents),
        workbench: verifyWorkbench(workbench, agents),
        css: verifyCss(css, agents),
      };
      report.patched = {
        agentHost: missing.agentHost.length === 0,
        workbench: missing.workbench.length === 0,
        css: missing.css.length === 0,
        missing,
      };
    } catch (error) {
      report.problems.push(`Could not read VS Code files: ${error.message}`);
    }
    report.checksums = verifyChecksums(install);
    if (!report.checksums.ok) report.problems.push("product.json checksums do not match patched files");
  }

  if (!report.shim.installed) report.problems.push("shim not installed");
  if (!report.shim.envValue) report.problems.push(`${ENV_VAR} is not set`);
  for (const runtime of report.runtimes) {
    if (!runtime.ok) report.problems.push(`${runtime.id}: ${runtime.detail}`);
  }

  report.ok = report.problems.length === 0;
  return report;
}
