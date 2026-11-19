import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { query, startup } from "../shim/sdk.mjs";

const fakeNodeSource = `
import fs from "node:fs";
const args = process.argv.slice(2);
const log = process.env.FAKE_LOG;
if (log) fs.appendFileSync(log, JSON.stringify(args) + "\\n");
if (args.includes("--list-models")) {
  process.stdout.write("provider  model  context  max  thinking\\nfake  alpha  100000  8192  yes\\nfake  beta  100000  8192  no\\n");
} else if (args[0] === "models") {
  process.stdout.write(JSON.stringify({ models: [
    { selector: "magpie/auto/one", name: "One", thinking: ["low", "high"] },
    { selector: "magpie/auto/two", name: "Two" },
  ]}));
} else if (!args.includes("rpc")) {
  process.exitCode = 1;
}
`;

const fakePowerShellSource = `
$log = $env:FAKE_LOG
if ($log) { Add-Content -LiteralPath $log -Value ($args -join ' ') }
if ($args -contains '--list-models') {
  Write-Output 'provider  model  context  max  thinking'
  Write-Output 'fake  alpha  100000  8192  yes'
  Write-Output 'fake  beta  100000  8192  no'
} elseif ($args.Count -gt 0 -and $args[0] -eq 'models') {
  Write-Output '{"models":[{"selector":"magpie/auto/one","name":"One","thinking":["low","high"]},{"selector":"magpie/auto/two","name":"Two"}]}'
} else {
  exit 0
}
`;

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vah-shim-"));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // The child process may still hold a path briefly on Windows.
    }
  });
  return dir;
}

function setEnv(t, values) {
  const saved = new Map();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function writeFake(dir, name, { ps1 = false } = {}) {
  if (ps1) {
    const file = path.join(dir, `${name}.ps1`);
    fs.writeFileSync(file, fakePowerShellSource, "utf8");
    return file;
  }
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(dir, `${name}.mjs`), fakeNodeSource, "utf8");
    const file = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(file, `@echo off\r\n"${process.execPath}" "%~dp0${name}.mjs" %*\r\n`, "utf8");
    return file;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${fakeNodeSource}`, "utf8");
  fs.chmodSync(file, 0o755);
  return file;
}

async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for child process");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("Pi model discovery searches PATH", async (t) => {
  const dir = makeTempDir(t);
  const home = path.join(dir, "home");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  writeFake(bin, "pi", { ps1: process.platform === "win32" });
  const log = path.join(dir, "pi.log");
  setEnv(t, {
    USERPROFILE: home,
    HOME: home,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`,
    PI_BIN: "",
    FAKE_LOG: log,
  });

  const warm = await startup({ options: { env: { PI_HARNESS: "pi" } } });
  const models = await warm.supportedModels();

  assert.deepEqual(models.map((model) => model.value), ["fake/alpha", "fake/beta"]);
  assert.ok(models[0].supportedEffortLevels.includes("high"));
  assert.match(fs.readFileSync(log, "utf8"), /--list-models/);
});

test("OMP model discovery uses the non-interactive catalog command", async (t) => {
  const dir = makeTempDir(t);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const omp = writeFake(bin, "omp");
  const log = path.join(dir, "omp.log");
  setEnv(t, { OMP_BIN: omp, FAKE_LOG: log });

  const warm = await startup({ options: { env: { PI_HARNESS: "omp" } } });
  const models = await warm.supportedModels();

  assert.deepEqual(models.map((model) => model.value), ["magpie/auto/one", "magpie/auto/two"]);
  assert.deepEqual(models[0].supportedEffortLevels, ["low", "high"]);
  assert.match(fs.readFileSync(log, "utf8"), /"models","ls","--json","--no-extensions"/);
});

test("OMP RPC sessions use the OMP binary and auto-approve", async (t) => {
  const dir = makeTempDir(t);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const omp = writeFake(bin, "omp-rpc", { ps1: process.platform === "win32" });
  const log = path.join(dir, "rpc.log");
  setEnv(t, { OMP_BIN: omp, FAKE_LOG: log });

  const generator = query({
    prompt: "",
    options: {
      env: { PI_HARNESS: "omp" },
      model: "magpie/auto/one",
      permissionMode: "autoApprove",
      cwd: dir,
    },
  });
  await generator.next();
  await waitFor(() => fs.existsSync(log) && fs.readFileSync(log, "utf8").includes("magpie/auto/one"));
  await generator.close();

  const logged = fs.readFileSync(log, "utf8");
  assert.ok(logged.includes("--auto-approve"));
  assert.ok(logged.includes("--model"));
  assert.ok(logged.includes("magpie/auto/one"));
});
