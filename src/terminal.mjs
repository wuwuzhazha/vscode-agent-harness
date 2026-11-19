import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandExists, dataDir, findZcodeCli } from "./env.mjs";

const PATH_START = "# >>> vscode-agent-harness PATH >>>";
const PATH_END = "# <<< vscode-agent-harness PATH <<<";

function cliFor(agent) {
  if (agent.terminal?.defaultScript && fs.existsSync(agent.terminal.defaultScript)) {
    return agent.terminal.defaultScript;
  }
  return findZcodeCli(agent.terminal?.searchGlobs || []);
}

function writeWrapper(agent, cli) {
  const dir = path.join(dataDir(), "bin");
  fs.mkdirSync(dir, { recursive: true });
  const command = agent.terminal?.command || agent.id;
  if (process.platform === "win32") {
    const file = path.join(dir, `${command}.cmd`);
    fs.writeFileSync(file, `@ECHO off\r\nnode "${cli}" %*\r\n`);
    return { dir, file };
  }
  const file = path.join(dir, command);
  fs.writeFileSync(file, `#!/bin/sh\nexec node "${cli}" "$@"\n`);
  fs.chmodSync(file, 0o755);
  return { dir, file };
}

function pathIncludes(dir) {
  const parts = (process.env.PATH || "").split(path.delimiter);
  return parts.some((part) => part && path.resolve(part) === path.resolve(dir));
}

function shellRc() {
  const shell = path.basename(process.env.SHELL || "bash");
  if (shell === "zsh") return path.join(os.homedir(), ".zshrc");
  if (shell === "fish") return path.join(os.homedir(), ".config", "fish", "config.fish");
  return path.join(os.homedir(), ".bashrc");
}

function addToUserPath(dir) {
  if (pathIncludes(dir)) return { method: "already-on-path" };
  if (process.platform === "win32") {
    const script =
      `$p=[Environment]::GetEnvironmentVariable('Path','User');` +
      `$d='${dir.replace(/'/g, "''")}';` +
      `if(-not $p){$p=''};` +
      `if(-not ($p.Split(';') -contains $d)){[Environment]::SetEnvironmentVariable('Path',($p.TrimEnd(';')+';'+$d),'User')}`;
    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(`Could not update user PATH: ${String(result.stderr || "").trim()}`);
    }
    process.env.PATH = `${process.env.PATH || ""}${path.delimiter}${dir}`;
    return { method: "powershell-user-path" };
  }
  const file = shellRc();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!text.includes(PATH_START)) {
    const line = file.endsWith("config.fish")
      ? `set -gx PATH "${dir}" $PATH`
      : `export PATH="${dir}:$PATH"`;
    fs.appendFileSync(file, `\n${PATH_START}\n${line}\n${PATH_END}\n`);
  }
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH || ""}`;
  return { method: file };
}

/**
 * Ensure the terminal entry named in the manifest exists. Never overwrites an
 * existing command: if `zcode` already resolves, that installation wins.
 */
export function ensureTerminalEntry(agent, { dryRun = false } = {}) {
  const command = agent.terminal?.command;
  if (!command) return { skipped: "no terminal entry" };
  if (commandExists(command)) {
    return { status: "present", command };
  }
  const cli = cliFor(agent);
  if (!cli) return { status: "missing-cli" };
  if (dryRun) return { status: "would-install", cli, command };
  const wrapper = writeWrapper(agent, cli);
  const pathResult = addToUserPath(wrapper.dir);
  return { status: "installed", command, cli, ...wrapper, ...pathResult };
}
