import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checksumOf, updateChecksums, verifyChecksums } from "../src/checksums.mjs";

function makeInstall() {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "vah-checksum-"));
  fs.mkdirSync(path.join(appDir, "out", "vs", "workbench"), { recursive: true });
  const file = path.join(appDir, "out", "vs", "workbench", "workbench.desktop.main.js");
  fs.writeFileSync(file, "console.log(1)\n");
  fs.writeFileSync(
    path.join(appDir, "product.json"),
    JSON.stringify({ checksums: { "vs/workbench/workbench.desktop.main.js": "stale", "vs/missing.js": "x" } }, null, "\t") + "\n"
  );
  return { appDir, version: "1.147.0", commit: "test", quality: "stable", file };
}

test("checksums detect and repair patched files", () => {
  const install = makeInstall();
  assert.equal(verifyChecksums(install).ok, false);
  assert.deepEqual(verifyChecksums(install).mismatches, ["vs/workbench/workbench.desktop.main.js"]);

  const updated = updateChecksums(install);
  assert.deepEqual(updated, ["vs/workbench/workbench.desktop.main.js"]);

  const product = JSON.parse(fs.readFileSync(path.join(install.appDir, "product.json"), "utf8"));
  assert.equal(product.checksums["vs/workbench/workbench.desktop.main.js"], checksumOf(install.file));
  assert.ok(fs.readFileSync(path.join(install.appDir, "product.json"), "utf8").includes('\n\t"checksums"'));

  const after = verifyChecksums(install);
  assert.equal(after.ok, false);
  assert.deepEqual(after.missing, ["vs/missing.js"]);
});
