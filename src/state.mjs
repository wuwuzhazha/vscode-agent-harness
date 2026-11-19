import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function statePath() {
  return path.join(process.env.VAH_HOME || path.join(os.homedir(), ".vscode-harness"), "state.json");
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {
      schemaVersion: 1,
      installs: {},
      shimRoot: null,
      envVar: null,
      terminalEntries: [],
    };
  }
}

export function writeState(state) {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  return file;
}

export function installKey(install) {
  return `${install.commit}`;
}
