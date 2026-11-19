import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function checksumOf(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("base64").replace(/=+$/, "");
}

/**
 * VS Code refuses to start ("installation appears to be corrupt") when a file
 * listed in product.json.checksums no longer matches. Any patch to out/** must
 * refresh the entry.
 */
export function verifyChecksums(install) {
  const productPath = path.join(install.appDir, "product.json");
  const product = JSON.parse(fs.readFileSync(productPath, "utf8"));
  const checksums = product.checksums || {};
  const mismatches = [];
  const missing = [];

  for (const [relative, expected] of Object.entries(checksums)) {
    const file = path.join(install.appDir, "out", relative);
    if (!fs.existsSync(file)) {
      missing.push(relative);
      continue;
    }
    if (checksumOf(file) !== expected) mismatches.push(relative);
  }

  return { ok: mismatches.length === 0 && missing.length === 0, mismatches, missing };
}

/**
 * Recompute every checksum entry that no longer matches. Writes product.json in
 * VS Code's original formatting (tabs, trailing newline).
 */
export function updateChecksums(install, only = null) {
  const productPath = path.join(install.appDir, "product.json");
  const product = JSON.parse(fs.readFileSync(productPath, "utf8"));
  const checksums = product.checksums || {};
  const updated = [];

  for (const [relative, expected] of Object.entries(checksums)) {
    if (only && !only.has(relative)) continue;
    const file = path.join(install.appDir, "out", relative);
    if (!fs.existsSync(file)) continue;
    const actual = checksumOf(file);
    if (actual !== expected) {
      checksums[relative] = actual;
      updated.push(relative);
    }
  }

  if (updated.length) {
    product.checksums = checksums;
    fs.writeFileSync(productPath, `${JSON.stringify(product, null, "\t")}\n`);
  }

  return updated;
}

export function relativeOutPath(install, absolutePath) {
  return path.relative(path.join(install.appDir, "out"), absolutePath).split(path.sep).join("/");
}
