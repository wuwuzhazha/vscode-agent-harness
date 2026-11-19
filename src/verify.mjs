import fs from "node:fs";
import path from "node:path";
import { verifyChecksums } from "./checksums.mjs";
import { commandExists, findZcodeCli, pathsFor } from "./env.mjs";
import { verifyAgentHost } from "./patch/agent-host.mjs";
import { verifyCss } from "./patch/css.mjs";
import { verifyWorkbench } from "./patch/workbench.mjs";
import { ENV_VAR, readUserEnv, shimInstalled, shimRoot, shimSdkFile } from "./shim.mjs";

/**
 * Full post-install verification. Returns structured data so `vah verify --json`
 * can be consumed by an AI agent.
 */
export function verifyInstall(install, agents) {
  const files = pathsFor(install);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const agentHost = fs.readFileSync(files.agentHost, "utf8");
  const missingAgentHost = verifyAgentHost(agentHost, agents);
  add("agent-host", missingAgentHost.length === 0, missingAgentHost.length ? `${missingAgentHost.length} markers missing` : "all markers present");

  const workbench = fs.readFileSync(files.workbench, "utf8");
  const missingWorkbench = verifyWorkbench(workbench, agents);
  add("workbench", missingWorkbench.length === 0, missingWorkbench.length ? `${missingWorkbench.length} markers missing` : "all markers present");

  const css = fs.readFileSync(files.css, "utf8");
  const missingIcons = verifyCss(css, agents);
  add("css", missingIcons.length === 0, missingIcons.length ? `missing icons: ${missingIcons.join(", ")}` : "all icons present");

  const checksums = verifyChecksums(install);
  add(
    "checksums",
    checksums.ok,
    checksums.ok ? "product.json matches patched files" : `mismatched: ${[...checksums.mismatches, ...checksums.missing].join(", ")}`
  );

  add("shim", shimInstalled(), shimSdkFile() || "not installed");

  const envValue = readUserEnv();
  const expectedRoot = shimRoot();
  const envOk = !!(
    envValue &&
    path.resolve(envValue) === path.resolve(expectedRoot) &&
    fs.existsSync(shimSdkFile(envValue))
  );
  add("sdk-root-env", envOk, envValue ? `${envValue}${envOk ? "" : ` (expected ${expectedRoot})`}` : `set ${ENV_VAR}=${expectedRoot}`);

  return {
    ok: checks.every((check) => check.ok),
    install: { appDir: install.appDir, version: install.version, commit: install.commit },
    checks,
    agents: agents.map((agent) => ({
      id: agent.id,
      inHost: !missingAgentHost.length && !missingWorkbench.length,
      icon: !missingIcons.includes(agent.icon?.codicon),
    })),
  };
}

/** Runtime prerequisites for each selected agent. */
export function checkAgentRuntimes(agents) {
  return agents.map((agent) => {
    if (agent.backend === "zcode-cli") {
      const cli = findZcodeCli(agent.terminal?.searchGlobs || []);
      return {
        id: agent.id,
        ok: !!cli,
        binary: cli || "not found",
        detail: cli ? "zcode CLI found" : "set ZCODE_CLI_PATH or install ZCode",
      };
    }
    const binary = agent.backend === "omp-rpc" ? "omp" : "pi";
    const ok = commandExists(binary);
    return {
      id: agent.id,
      ok,
      binary,
      detail: ok ? `${binary} on PATH` : `${binary} not on PATH (shim also checks ~/.pi and ~/.bun)`,
    };
  });
}
