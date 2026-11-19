import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { loadAgents, selectAgents } from "./agents.mjs";
import { doctor } from "./doctor.mjs";
import { findVSCode } from "./env.mjs";
import { install, uninstall } from "./install.mjs";
import { log, setQuiet } from "./log.mjs";
import { installKey, readState, statePath } from "./state.mjs";
import { verifyInstall } from "./verify.mjs";

const VERSION = JSON.parse(
  fs.readFileSync(path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "package.json"), "utf8")
).version;

const HELP = `vscode-agent-harness ${VERSION}

Usage: vah <command> [options]

Commands:
  doctor            Inspect VS Code, patches, shim and agent runtimes
  list              Show available agent manifests
  install           Patch VS Code and install the shim (default: all agents)
  verify            Check that the installation is complete
  status            Show installer state
  uninstall         Restore the original VS Code files

Options:
  --agent <id|all>  Agent(s) to install, comma separated (default: all)
  --vscode <dir>    Path to VS Code's resources/app directory
  --dry-run         Show what would change without writing
  --yes             Do not ask for confirmation
  --json            Machine-readable output (doctor/list/verify/install/status)
  --skip-shim       Do not install the Claude SDK shim
  --skip-terminal   Do not create terminal wrappers
  --purge           With uninstall: also delete backups
  -h, --help        Show this help
  -v, --version     Show version
`;

function parse(argv) {
  const options = { command: "help", agent: null, json: false };
  const rest = [...argv];
  options.command = rest.shift() || "help";
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const readValue = () => {
      const value = rest[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--agent":
        options.agent = readValue();
        break;
      case "--vscode":
        options.vscode = readValue();
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--skip-shim":
        options.skipShim = true;
        break;
      case "--skip-terminal":
        options.skipTerminal = true;
        break;
      case "--purge":
        options.purge = true;
        break;
      case "--all":
        options.agent = "all";
        break;
      case "-h":
      case "--help":
        options.command = "help";
        break;
      case "-v":
      case "--version":
        options.command = "version";
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

/**
 * For `doctor`/`verify`, default to the harnesses actually recorded for this
 * VS Code commit so a partial install is not reported as incomplete. An
 * explicit `--agent` overrides that.
 */
function resolveCheckAgents(options) {
  if (options.agent) return selectAgents(options.agent);
  try {
    const installInfo = findVSCode(options.vscode);
    const state = readState();
    const ids = state.installs?.[installKey(installInfo)]?.agents;
    if (ids?.length) {
      const all = loadAgents();
      return all.filter((agent) => ids.includes(agent.id));
    }
  } catch {
    // fall through to all manifests
  }
  return loadAgents();
}

function summarize(result) {
  const patch = result.patch || {};
  return {
    ok: result.verification ? result.verification.ok : !(patch.errors?.length),
    dryRun: !!result.dryRun,
    install: result.install
      ? {
          appDir: result.install.appDir,
          version: result.install.version,
          commit: result.install.commit,
        }
      : undefined,
    agents: result.agents?.map((agent) => agent.id),
    changed: patch.changed || [],
    checksums: patch.checksums || [],
    shim: result.shim || undefined,
    terminals: result.terminals || undefined,
    verification: result.verification || undefined,
  };
}

async function confirmInstall(agents, options) {
  if (options.yes || options.dryRun || !stdin.isTTY) return true;
  const names = agents.map((agent) => agent.displayName).join(", ");
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`Patch VS Code to add ${names}? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function printList(agents, json) {
  if (json) {
    printJson(
      agents.map((agent) => ({
        id: agent.id,
        name: agent.displayName,
        backend: agent.backend,
        models: agent.models?.catalog,
        permissions: agent.permissionMode.options.map((option) => option.value),
        defaultPermission: agent.permissionMode.default,
        terminal: agent.terminal?.command || null,
      }))
    );
    return;
  }
  const rows = agents.map((agent) => [
    agent.id,
    agent.backend,
    agent.models?.catalog || "-",
    agent.permissionMode.options.map((option) => option.value).join(" / "),
  ]);
  const header = ["AGENT", "BACKEND", "MODELS", "PERMISSIONS"];
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index].length)));
  const line = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(line(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
}

function printDoctor(report) {
  const status = (ok) => (ok ? "ok" : "FAIL");
  if (report.vscode) {
    log.info(`VS Code      ${report.vscode.version} (${report.vscode.commit.slice(0, 10)})${report.vscode.tested ? "" : " [untested]"}`);
    log.detail(report.vscode.appDir);
    log.info(`Running      ${report.vscode.running ? "yes (restart after install)" : "no"}`);
  }
  if (report.patched) {
    log.info(
      `Patched      agent-host ${report.patched.agentHost ? "ok" : "no"}, workbench ${report.patched.workbench ? "ok" : "no"}, css ${report.patched.css ? "ok" : "no"}`
    );
  }
  log.info(`Checksums    ${status(report.checksums?.ok)}`);
  log.info(`Shim         ${status(report.shim.installed)} ${report.shim.root}`);
  log.info(`SDK root env ${report.shim.envValue || "not set"}`);
  for (const runtime of report.runtimes) {
    log.info(`Runtime ${runtime.id.padEnd(5)} ${status(runtime.ok)} ${runtime.binary}`);
  }
  if (report.problems.length) {
    for (const problem of report.problems) log.warn(problem);
  }
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parse(argv);
  } catch (error) {
    log.error(error.message);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  setQuiet(options.json);

  try {
    switch (options.command) {
      case "help":
        console.log(HELP);
        return;
      case "version":
        console.log(VERSION);
        return;
      case "list": {
        printList(selectAgents("all"), options.json);
        return;
      }
      case "doctor": {
        const report = doctor({ vscode: options.vscode, agents: resolveCheckAgents(options) });
        if (options.json) printJson(report);
        else printDoctor(report);
        process.exitCode = report.ok ? 0 : 1;
        return;
      }
      case "verify": {
        const agents = resolveCheckAgents(options);
        const installInfo = findVSCode(options.vscode);
        const report = verifyInstall(installInfo, agents);
        if (options.json) printJson(report);
        else {
          for (const check of report.checks) {
            (check.ok ? log.ok : log.error)(`${check.name}: ${check.detail}`);
          }
        }
        process.exitCode = report.ok ? 0 : 1;
        return;
      }
      case "status": {
        const state = readState();
        if (options.json) printJson({ statePath: statePath(), ...state });
        else {
          log.info(`State file   ${statePath()}`);
          log.info(`Shim root    ${state.shimRoot || "not installed"}`);
          log.info(`Env var      ${state.envVar || "not set"}`);
          const installs = Object.values(state.installs || {});
          if (!installs.length) log.info("Installs     none");
          for (const entry of installs) {
            log.info(`Install      ${entry.version} ${entry.appDir}`);
            log.detail(`agents: ${entry.agents.join(", ")} · ${entry.installedAt}`);
          }
        }
        return;
      }
      case "install": {
        const agents = selectAgents(options.agent);
        if (!(await confirmInstall(agents, options))) {
          log.info("Cancelled");
          return;
        }
        const result = install({
          vscode: options.vscode,
          agent: options.agent,
          dryRun: options.dryRun,
          skipShim: options.skipShim,
          skipTerminal: options.skipTerminal,
        });
        if (options.json) {
          printJson(summarize(result));
        } else if (result.dryRun) {
          log.info("Dry run: no files were written.");
          log.info(`Would change: ${result.patch.changed.join(", ") || "nothing"}`);
        } else {
          log.ok("Installation complete. Quit VS Code completely and start it again.");
        }
        if (!result.dryRun && result.verification && !result.verification.ok) {
          log.warn("Verification reported problems; run `vah verify` for details.");
          process.exitCode = 1;
        }
        return;
      }
      case "uninstall": {
        if (!options.yes && !options.dryRun && stdin.isTTY) {
          const rl = readline.createInterface({ input: stdin, output: stdout });
          const answer = await rl.question("Restore original VS Code files and remove the shim? [y/N] ");
          rl.close();
          if (!/^y(es)?$/i.test(answer.trim())) {
            log.info("Cancelled");
            return;
          }
        }
        const result = uninstall({ vscode: options.vscode, purge: options.purge, dryRun: options.dryRun });
        if (options.json) printJson({ install: result.install.appDir, restored: result.restored, purged: result.purged });
        else if (result.dryRun) log.info(`Would restore: ${result.restored.join(", ")}`);
        else log.ok("VS Code restored. Restart it to load the original files.");
        return;
      }
      default:
        log.error(`Unknown command: ${options.command}`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (error) {
    if (options.json) printJson({ ok: false, error: error.message, details: error.details });
    else {
      log.error(error.message);
      for (const detail of error.details || []) log.detail(detail);
    }
    process.exitCode = 1;
  }
}
