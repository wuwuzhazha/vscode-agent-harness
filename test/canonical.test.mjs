import assert from "node:assert/strict";
import test from "node:test";
import { loadAgents } from "../src/agents.mjs";
import {
  cssRules,
  mIFunction,
  modelIdReturn,
  providerBlock,
  savedChatStore,
  schemeExpression,
  sessionIconChain,
  storageAllowlist,
  tombstoneCondition,
  vSFunction,
  wgeFunction,
} from "../src/patch/canonical.mjs";

const agents = loadAgents();

test("agents are ordered and unique", () => {
  assert.deepEqual(agents.map((agent) => agent.id), ["pi", "omp", "zcode"]);
  assert.equal(new Set(agents.map((agent) => agent.id)).size, agents.length);
});

test("provider predicate admits every harness", () => {
  assert.equal(
    vSFunction(agents),
    'function vS(r){return r===ai||r===Ki||r===Ed||r==="pi"||r==="omp"||r==="zcode"}'
  );
});

test("tombstone and scheme cover every harness", () => {
  assert.equal(
    tombstoneCondition(agents),
    'r!==ai&&r!==Ki&&r!==Ed&&r!=="pi"&&r!=="omp"&&r!=="zcode"'
  );
  assert.equal(
    schemeExpression(agents),
    '(r.session.scheme===Ed||r.session.scheme==="pi"||r.session.scheme==="omp"||r.session.scheme==="zcode")'
  );
});

test("saved chat store and storage allowlist are per harness", () => {
  assert.equal(
    savedChatStore(agents),
    'new Map([[Ed,e.createInstance(iE)],[Ki,e.createInstance(oE)],["pi",e.createInstance(iE)],["omp",e.createInstance(iE)],["zcode",e.createInstance(iE)]])'
  );
  assert.equal(
    storageAllowlist(agents),
    '["copilotcli","claude","codex","pi","omp","zcode"].includes'
  );
});

test("permission normalizer lists every value exactly once", () => {
  const source = mIFunction(agents);
  for (const value of ["default", "readOnly", "noTools", "autoApprove", "edit", "plan", "yolo"]) {
    assert.equal(source.split(`case${JSON.stringify(value)}`).length - 1, 1, value);
  }
  assert.ok(!source.includes('"build"'));
  assert.ok(!source.includes('"guarded"'));
});

test("only hosts that opt in prefix model ids", () => {
  const source = modelIdReturn(agents);
  assert.ok(source.includes('id:i==="omp"'));
  assert.ok(!source.includes('id:i==="zcode"'));
  assert.ok(source.includes('name:i==="omp"?"OMP · "'));
});

test("provider block restores the built-in Claude provider", () => {
  const source = providerBlock(agents);
  assert.ok(source.includes("let cp=f.createInstance(Wk)"));
  assert.ok(source.includes("cp._sdkService=cs;re.registerProvider(cp)"));
  assert.ok(source.includes('"@anthropic-ai","claude-agent-sdk","sdk.mjs"'));
});

test("vendor label knows the harness names", () => {
  assert.equal(
    wgeFunction(agents),
    'function Wge(s,o){if(o==="pi")return"Pi";if(o==="omp")return"OMP";if(o==="zcode")return"ZCode";return o==="copilotcli"?d(18908,null):s.getVendors().find(t=>t.vendor===o)?.displayName??o.charAt(0).toUpperCase()+o.slice(1)}'
  );
  assert.equal(
    sessionIconChain(agents),
    'icon:e.provider==="pi"?"$(pi)":e.provider==="omp"?"$(omp)":e.provider==="zcode"?"$(zcode)":void 0,when:'
  );
});

test("css rules produce one mask block per icon", () => {
  const css = cssRules(agents);
  for (const agent of agents) {
    assert.ok(css.includes(`.codicon-${agent.icon.codicon}:before`));
  }
  assert.equal(css.match(/mask-image:/g).length, agents.length * 2);
});
