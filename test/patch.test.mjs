import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadAgents } from "../src/agents.mjs";
import { patchAgentHost, verifyAgentHost } from "../src/patch/agent-host.mjs";
import { patchCss, verifyCss } from "../src/patch/css.mjs";
import { patchWorkbench, verifyWorkbench } from "../src/patch/workbench.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const agents = loadAgents();
const fixture = (name) => fs.readFileSync(path.join(here, "fixtures", name), "utf8");

test("agent host patch is complete and idempotent", () => {
  const pristine = fixture("agent-host-pristine.txt");
  const first = patchAgentHost(pristine, agents);
  assert.deepEqual(first.missing, []);
  assert.deepEqual(verifyAgentHost(first.source, agents), []);
  assert.ok(first.source.includes('PI_HARNESS:this.id'));
  assert.ok(first.source.includes('r.session.scheme==="zcode"'));

  const second = patchAgentHost(first.source, agents);
  assert.deepEqual(second.applied, []);
  assert.equal(second.source, first.source);
});

test("agent host patch also upgrades an older single-harness patch", () => {
  const older = fixture("agent-host-pristine.txt")
    .replace(
      "re.registerProvider(f.createInstance(Wk)),",
      '(()=>{let pi=f.createInstance(Wk);pi.id="pi";re.registerProvider(pi)})(),'
    )
    .replace(
      "function vS(r){return r===ai||r===Ki||r===Ed}",
      'function vS(r){return r===ai||r===Ki||r===Ed||r==="pi"}'
    );
  const result = patchAgentHost(older, agents);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(verifyAgentHost(result.source, agents), []);
});

test("a single-agent install patches only that provider", () => {
  const onlyZcode = agents.filter((agent) => agent.id === "zcode");
  const host = patchAgentHost(fixture("agent-host-pristine.txt"), onlyZcode);
  assert.deepEqual(verifyAgentHost(host.source, onlyZcode), []);
  assert.ok(host.source.includes('["zcode","ZCode","ZCode CLI (zcode --prompt)"]'));
  assert.ok(!host.source.includes('["pi","Pi"'));
  const workbench = patchWorkbench(fixture("workbench-pristine.txt"), onlyZcode);
  assert.deepEqual(verifyWorkbench(workbench.source, onlyZcode), []);
  assert.ok(!workbench.source.includes('o==="omp"'));
});

test("workbench patch is complete and idempotent", () => {
  const pristine = fixture("workbench-pristine.txt");
  const first = patchWorkbench(pristine, agents);
  assert.deepEqual(first.missing, []);
  assert.deepEqual(verifyWorkbench(first.source, agents), []);
  assert.ok(first.source.includes('if(o==="zcode")return"ZCode"'));
  assert.ok(first.source.includes('e.provider==="zcode"?"$(zcode)"'));

  const second = patchWorkbench(first.source, agents);
  assert.deepEqual(second.applied, []);
  assert.equal(second.source, first.source);
});

test("workbench patch upgrades the pi-only icon form", () => {
  const older = fixture("workbench-pristine.txt").replace(
    "description:e.description,when:",
    'description:e.description,icon:e.provider==="pi"?X.fromId("pi"):void 0,when:'
  );
  const result = patchWorkbench(older, agents);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(verifyWorkbench(result.source, agents), []);
});

test("css patch adds missing icons once", () => {
  const first = patchCss("/* base */\n", agents);
  assert.deepEqual(first.added, ["pi", "omp", "zcode"]);
  assert.deepEqual(verifyCss(first.source, agents), []);
  const second = patchCss(first.source, agents);
  assert.deepEqual(second.added, []);
  assert.equal(second.source, first.source);
});

test("css patch preserves an existing icon block", () => {
  const existing = ".codicon-pi:before { content: \"π\"; }\n";
  const result = patchCss(existing, agents);
  assert.deepEqual(result.added, ["omp", "zcode"]);
  assert.ok(result.source.startsWith(existing));
});

const backupDir = process.env.VAH_TEST_BACKUP_DIR;
test(
  "patches real VS Code 1.147 files from a pristine backup",
  { skip: !backupDir || !fs.existsSync(path.join(backupDir, "agentHostMain.js.orig")) },
  () => {
    const agentHost = fs.readFileSync(path.join(backupDir, "agentHostMain.js.orig"), "utf8");
    const workbench = fs.readFileSync(path.join(backupDir, "workbench.desktop.main.js.orig"), "utf8");
    const hostResult = patchAgentHost(agentHost, agents);
    const workbenchResult = patchWorkbench(workbench, agents);
    assert.deepEqual(hostResult.missing, []);
    assert.deepEqual(workbenchResult.missing, []);
    assert.deepEqual(verifyAgentHost(hostResult.source, agents), []);
    assert.deepEqual(verifyWorkbench(workbenchResult.source, agents), []);
    assert.equal(patchAgentHost(hostResult.source, agents).source, hostResult.source);
    assert.equal(patchWorkbench(workbenchResult.source, agents).source, workbenchResult.source);
  }
);
