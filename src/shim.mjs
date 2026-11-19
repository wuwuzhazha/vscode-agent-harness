import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "./env.mjs";

export const ENV_VAR = "VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT";
const BLOCK_START = "# >>> vscode-agent-harness >>>";
const BLOCK_END = "# <<< vscode-agent-harness <<<";

export function repoRoot() {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

export function shimSourceDir() {
  return path.join(repoRoot(), "shim");
}

export function shimRoot() {
  return path.join(dataDir(), "shim");
}

export function shimSdkFile(root = shimRoot()) {
  return path.join(root, "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.mjs");
}

export function shimInstalled() {
  return fs.existsSync(shimSdkFile());
}

/** Copy the bundled shim into the harness data directory. */
export function installShim() {
  const source = shimSourceDir();
  const target = shimRoot();
  const sourceSdk = path.join(source, "sdk.mjs");
  if (!fs.existsSync(sourceSdk)) {
    throw new Error(`Bundled shim is incomplete: ${sourceSdk} is missing`);
  }
  const sdkDir = path.dirname(shimSdkFile(target));
  fs.mkdirSync(sdkDir, { recursive: true });
  fs.copyFileSync(sourceSdk, path.join(sdkDir, "sdk.mjs"));
  const pkg = path.join(source, "package.json");
  if (fs.existsSync(pkg)) fs.copyFileSync(pkg, path.join(sdkDir, "package.json"));
  const gate = path.join(source, "pi-edit-gate.ts");
  if (fs.existsSync(gate)) fs.copyFileSync(gate, path.join(target, "pi-edit-gate.ts"));
  process.env[ENV_VAR] = target;
  return { root: target, sdk: shimSdkFile(target) };
}

function rcFile() {
  const shell = path.basename(process.env.SHELL || "bash");
  if (shell === "zsh") return path.join(os.homedir(), ".zshrc");
  if (shell === "fish") return path.join(os.homedir(), ".config", "fish", "config.fish");
  return path.join(os.homedir(), ".bashrc");
}

function removeBlock(text) {
  const start = text.indexOf(BLOCK_START);
  if (start < 0) return text;
  const end = text.indexOf(BLOCK_END, start);
  if (end < 0) return text.slice(0, start);
  return text.slice(0, start) + text.slice(end + BLOCK_END.length).replace(/^\r?\n/, "");
}

/**
 * Persist the SDK root at user level. VS Code must be started from a process
 * that inherits this variable; changes do not reach an already-running app.
 */
export function setUserEnv(value) {
  if (process.platform === "win32") {
    const result = spawnSync("setx", [ENV_VAR, value], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) {
      throw new Error(`setx failed: ${String(result.stderr || result.stdout || "").trim()}`);
    }
    process.env[ENV_VAR] = value;
    return { method: "setx", value };
  }

  if (process.platform === "darwin") {
    spawnSync("launchctl", ["setenv", ENV_VAR, value], { encoding: "utf8" });
  }
  const file = rcFile();
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const cleaned = removeBlock(text).replace(/\s*$/, "\n");
  const block =
    `${BLOCK_START}\nexport ${ENV_VAR}="${value}"\n${BLOCK_END}\n`;
  fs.writeFileSync(file, `${cleaned}${block}`);
  process.env[ENV_VAR] = value;
  return { method: file, value };
}

export function unsetUserEnv() {
  if (process.platform === "win32") {
    spawnSync("reg", ["delete", "HKCU\\Environment", "/v", ENV_VAR, "/f"], {
      encoding: "utf8",
      windowsHide: true,
    });
    delete process.env[ENV_VAR];
    return;
  }
  const file = rcFile();
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, removeBlock(text));
  }
  delete process.env[ENV_VAR];
}

/** Read the persisted user-level value, independent of this process. */
export function readUserEnv() {
  if (process.env[ENV_VAR] && fs.existsSync(shimSdkFile(process.env[ENV_VAR]))) {
    return process.env[ENV_VAR];
  }
  if (process.platform === "win32") {
    const result = spawnSync("reg", ["query", "HKCU\\Environment", "/v", ENV_VAR], {
      encoding: "utf8",
      windowsHide: true,
    });
    const match = String(result.stdout || "").match(new RegExp(`${ENV_VAR}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)`));
    return match ? match[1].trim() : null;
  }
  const file = rcFile();
  if (!fs.existsSync(file)) return null;
  const match = fs.readFileSync(file, "utf8").match(new RegExp(`export ${ENV_VAR}="([^"]+)"`));
  return match ? match[1] : null;
}
