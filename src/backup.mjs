import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./env.mjs";

const FILES = [
  { key: "product", relative: "product.json", seedName: "product.json.orig" },
  {
    key: "agentHost",
    relative: "out/vs/platform/agentHost/node/agentHostMain.js",
    seedName: "agentHostMain.js.orig",
  },
  {
    key: "workbench",
    relative: "out/vs/workbench/workbench.desktop.main.js",
    seedName: "workbench.desktop.main.js.orig",
  },
  {
    key: "css",
    relative: "out/vs/workbench/workbench.desktop.main.css",
    seedName: "workbench.desktop.main.css.orig",
  },
];

export function backupDir(install) {
  return path.join(dataDir(), "backups", install.commit);
}

export function seedDir() {
  return process.env.VAH_BACKUP_SEED ? path.resolve(process.env.VAH_BACKUP_SEED) : null;
}

function fileFor(install, entry) {
  return path.join(install.appDir, entry.relative);
}

function backupFor(install, entry) {
  return path.join(backupDir(install), entry.relative);
}

/**
 * Snapshot the files the installer can modify. A snapshot is written once per
 * commit; later installs keep the original snapshot. VAH_BACKUP_SEED may point
 * at a directory of pristine files (`*.orig`) to seed a clean rollback point.
 */
export function ensureBackups(install) {
  const created = [];
  const seed = seedDir();
  for (const entry of FILES) {
    const target = backupFor(install, entry);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const seeded = seed ? path.join(seed, entry.seedName) : null;
    if (seeded && fs.existsSync(seeded)) {
      fs.copyFileSync(seeded, target);
      created.push({ ...entry, source: seeded });
    } else {
      fs.copyFileSync(fileFor(install, entry), target);
      created.push({ ...entry, source: fileFor(install, entry) });
    }
  }
  return created;
}

export function hasBackup(install) {
  return FILES.every((entry) => fs.existsSync(backupFor(install, entry)));
}

export function restoreBackups(install) {
  if (!hasBackup(install)) {
    throw new Error(`No backup found for ${install.commit}. Nothing to restore.`);
  }
  for (const entry of FILES) {
    fs.copyFileSync(backupFor(install, entry), fileFor(install, entry));
  }
  return FILES.map((entry) => entry.relative);
}

export const BACKUP_FILES = FILES;
