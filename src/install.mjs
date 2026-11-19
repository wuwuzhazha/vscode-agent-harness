import fs from "node:fs";
import path from "node:path";
import { loadAgents, selectAgents } from "./agents.mjs";
import { BACKUP_FILES, backupDir, ensureBackups, hasBackup, restoreBackups } from "./backup.mjs";
import { dataDir, findVSCode, isTestedVersion, isVSCodeRunning } from "./env.mjs";
import { log } from "./log.mjs";
import { applyPatches } from "./patch/index.mjs";
import { ENV_VAR, installShim, setUserEnv, shimRoot, unsetUserEnv } from "./shim.mjs";
import { installKey, readState, writeState } from "./state.mjs";
import { ensureTerminalEntry } from "./terminal.mjs";
import { verifyInstall } from "./verify.mjs";

/**
 * Install (or refresh) the selected harnesses. Idempotent: canonical markers
 * make a second run a no-op apart from the shim copy.
 */
export function install({ vscode, agent, dryRun = false, skipShim = false, skipTerminal = false }) {
  const selected = selectAgents(agent);
  const installInfo = findVSCode(vscode);
  const state = readState();
  if (!state.installs) state.installs = {};
  const key = installKey(installInfo);
  // Installs are cumulative: patching is a whole-file rewrite, so previously
  // installed harnesses must stay in the canonical block set.
  const previous = state.installs?.[key]?.agents || [];
  const wanted = new Set([...previous, ...selected.map((item) => item.id)]);
  const agents = loadAgents().filter((item) => wanted.has(item.id));

  log.info(`VS Code ${installInfo.version} (${installInfo.commit.slice(0, 10)})`);
  log.detail(installInfo.appDir);
  if (!isTestedVersion(installInfo.version)) {
    log.warn(`This build is untested. Tested series: 1.147.x. Anchors may differ.`);
  }
  if (isVSCodeRunning()) {
    log.warn("VS Code is running. Patched code loads after a full restart.");
  }

  const backups = dryRun ? [] : ensureBackups(installInfo);
  if (backups.length) {
    log.ok(`Backed up ${backups.length} file(s) to ${backupDir(installInfo)}`);
  }

  const result = applyPatches(installInfo, agents, { dryRun });

  if (dryRun) {
    return { dryRun: true, install: installInfo, agents, patch: result };
  }

  if (result.changed.length) {
    log.ok(`Patched ${result.changed.join(", ")}`);
  } else {
    log.ok("VS Code already patched; no file changes");
  }

  let shim = null;
  if (!skipShim) {
    shim = installShim();
    log.ok(`Shim installed: ${shim.root}`);
    setUserEnv(shimRoot());
    log.ok(`${ENV_VAR} set at user level`);
  }

  const terminals = [];
  if (!skipTerminal) {
    for (const item of selected) {
      if (!item.terminal) continue;
      const terminal = ensureTerminalEntry(item);
      terminals.push({ agent: item.id, ...terminal });
    }
  }

  state.installs[key] = {
    appDir: installInfo.appDir,
    version: installInfo.version,
    commit: installInfo.commit,
    agents: agents.map((item) => item.id),
    installedAt: new Date().toISOString(),
  };
  if (shim) state.shimRoot = shim.root;
  state.envVar = ENV_VAR;
  state.terminalEntries = [
    ...new Set([...(state.terminalEntries || []), ...terminals.filter((t) => t.status === "installed").map((t) => t.command)]),
  ];
  writeState(state);

  const verification = verifyInstall(installInfo, agents);
  return { dryRun: false, install: installInfo, agents, patch: result, shim, terminals, verification };
}

export function uninstall({ vscode, purge = false, dryRun = false }) {
  const state = readState();
  if (!state.installs) state.installs = {};

  const installs = [];
  if (vscode) {
    installs.push(findVSCode(vscode));
  } else {
    for (const entry of Object.values(state.installs)) {
      try {
        installs.push(findVSCode(entry.appDir));
      } catch (error) {
        log.warn(`Skipping ${entry.appDir}: ${error.message}`);
      }
    }
  }
  if (!installs.length) throw new Error("No recorded installation. Pass --vscode <path-to-resources/app>.");

  if (dryRun) {
    return {
      dryRun: true,
      install: installs[0],
      restored: installs.flatMap(() => BACKUP_FILES.map((entry) => entry.relative)),
      purged: false,
    };
  }

  const restored = [];
  for (const installInfo of installs) {
    if (!hasBackup(installInfo)) {
      log.warn(`No backup for ${installInfo.appDir}; leaving it untouched`);
      continue;
    }
    restored.push(...restoreBackups(installInfo));
    delete state.installs[installKey(installInfo)];
    log.ok(`Restored ${installInfo.appDir}`);
  }

  unsetUserEnv();
  log.ok(`${ENV_VAR} removed`);

  const shim = state.shimRoot || shimRoot();
  if (fs.existsSync(shim)) {
    fs.rmSync(shim, { recursive: true, force: true });
    log.ok(`Removed shim ${shim}`);
  }

  for (const command of state.terminalEntries || []) {
    for (const suffix of [".cmd", ""]) {
      const file = path.join(dataDir(), "bin", `${command}${suffix}`);
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    }
  }

  state.shimRoot = null;
  writeState(state);

  if (purge) {
    for (const entry of ["backups"]) {
      const target = path.join(dataDir(), entry);
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    }
    log.ok("Purged backups");
  }

  return { install: installs[0], installs, restored, purged: purge };
}
