import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PRODUCT_RELATIVE = "product.json";
export const AGENT_HOST_RELATIVE = "out/vs/platform/agentHost/node/agentHostMain.js";
export const WORKBENCH_RELATIVE = "out/vs/workbench/workbench.desktop.main.js";
export const CSS_RELATIVE = "out/vs/workbench/workbench.desktop.main.css";

/** @typedef {{ appDir: string, product: any, version: string, commit: string, quality: string }} VSCodeInstall */

export function homeDir() {
  return os.homedir();
}

export function dataDir() {
  return process.env.VAH_HOME || path.join(homeDir(), ".vscode-harness");
}

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function which(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Some VS Code builds keep the app payload in a per-commit directory
 * (`<install>/<commit>/resources/app`, used by the update system when the
 * install directory is read-only). Return both layouts.
 */
function appDirsFor(installRoot) {
  const out = [path.join(installRoot, "resources", "app")];
  try {
    for (const entry of fs.readdirSync(installRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f]{10,}$/i.test(entry.name)) continue;
      out.push(path.join(installRoot, entry.name, "resources", "app"));
    }
  } catch {
    // not a directory / no permission
  }
  return out;
}

function candidatesFromCodeCli() {
  const out = [];
  for (const bin of which("code")) {
    // <install>/bin/code -> <install>
    const install = path.dirname(path.dirname(bin));
    out.push(...appDirsFor(install));
    out.push(path.join(install, "Contents", "Resources", "app"));
  }
  return out;
}

export function vscodeCandidates(explicit) {
  const list = [];
  if (explicit) list.push(explicit, ...appDirsFor(explicit));
  if (process.env.VSCODE_APP_DIR) list.push(process.env.VSCODE_APP_DIR);

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(homeDir(), "AppData", "Local");
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    list.push(...appDirsFor(path.join(local, "Programs", "Microsoft VS Code")));
    list.push(...appDirsFor(path.join(pf, "Microsoft VS Code")));
    list.push(...appDirsFor(path.join(pf86, "Microsoft VS Code")));
    for (const drive of ["C:", "D:", "E:"]) {
      list.push(...appDirsFor(path.join(`${drive}\\`, "Microsoft VS Code")));
      list.push(...appDirsFor(path.join(`${drive}\\`, "VSCode")));
    }
  } else if (process.platform === "darwin") {
    list.push("/Applications/Visual Studio Code.app/Contents/Resources/app");
    list.push(path.join(homeDir(), "Applications", "Visual Studio Code.app", "Contents", "Resources", "app"));
  } else {
    list.push("/usr/share/code/resources/app");
    list.push("/usr/lib/code/resources/app");
    list.push("/opt/visual-studio-code/resources/app");
    list.push("/snap/code/current/usr/share/code/resources/app");
  }

  list.push(...candidatesFromCodeCli());

  const seen = new Set();
  return list.filter((candidate) => {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function isVSCodeAppDir(appDir) {
  return exists(path.join(appDir, PRODUCT_RELATIVE)) && exists(path.join(appDir, WORKBENCH_RELATIVE));
}

/**
 * Locate a VS Code installation and read its product metadata.
 * @param {string | undefined} explicit
 * @returns {VSCodeInstall}
 */
export function findVSCode(explicit) {
  for (const candidate of vscodeCandidates(explicit)) {
    if (!isVSCodeAppDir(candidate)) continue;
    try {
      const product = JSON.parse(fs.readFileSync(path.join(candidate, PRODUCT_RELATIVE), "utf8"));
      return {
        appDir: path.resolve(candidate),
        product,
        version: String(product.version || "unknown"),
        commit: String(product.commit || "unknown"),
        quality: String(product.quality || "stable"),
      };
    } catch {
      // keep looking
    }
  }
  throw new Error(
    "VS Code installation not found. Pass --vscode <path-to-resources/app> or set VSCODE_APP_DIR."
  );
}

export function pathsFor(install) {
  return {
    product: path.join(install.appDir, PRODUCT_RELATIVE),
    agentHost: path.join(install.appDir, AGENT_HOST_RELATIVE),
    workbench: path.join(install.appDir, WORKBENCH_RELATIVE),
    css: path.join(install.appDir, CSS_RELATIVE),
  };
}

const TESTED_MINORS = new Set(["1.147"]);

export function isTestedVersion(version) {
  const minor = String(version).split(".").slice(0, 2).join(".");
  return TESTED_MINORS.has(minor);
}

export function expandEnvPath(value) {
  return value.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match);
}

export function commandExists(command) {
  return which(command).length > 0;
}

/**
 * Locate the ZCode CLI entry script. Manifests may provide `searchGlobs`
 * (with %ENV% placeholders); these are tried before the defaults.
 */
export function findZcodeCli(searchGlobs = []) {
  const home = homeDir();
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const candidates = [
    process.env.ZCODE_CLI_PATH,
    ...searchGlobs.map(expandEnvPath),
    path.join(local, "Programs", "ZCode", "resources", "glm", "zcode.cjs"),
    path.join(programFiles, "ZCode", "resources", "glm", "zcode.cjs"),
    path.join(home, "ZCode", "resources", "glm", "zcode.cjs"),
  ];
  for (const drive of ["C", "D", "E", "F"]) {
    candidates.push(path.join(`${drive}:\\`, "ZCode", "resources", "glm", "zcode.cjs"));
  }
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return path.resolve(candidate);
  }
  return null;
}

export function isVSCodeRunning() {
  if (process.platform === "win32") {
    const result = spawnSync("tasklist", ["/FI", "IMAGENAME eq Code.exe"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return /Code\.exe/i.test(String(result.stdout || ""));
  }
  const result = spawnSync("pgrep", ["-f", "Visual Studio Code|/usr/share/code/code"], {
    encoding: "utf8",
  });
  return result.status === 0;
}
