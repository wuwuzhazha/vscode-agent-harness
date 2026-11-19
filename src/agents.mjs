import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AGENTS_DIR = path.join(ROOT, "agents");

const BACKENDS = new Set(["pi-rpc", "omp-rpc", "zcode-cli"]);

function validate(agent, file) {
  const fail = (message) => {
    throw new Error(`${path.basename(file)}: ${message}`);
  };
  if (!/^[a-z][a-z0-9-]*$/.test(agent.id || "")) fail("id must be lowercase letters, digits or dashes");
  if (!agent.displayName) fail("displayName is required");
  if (!BACKENDS.has(agent.backend)) fail(`backend must be one of ${[...BACKENDS].join(", ")}`);
  const mode = agent.permissionMode;
  if (!mode || !Array.isArray(mode.options) || mode.options.length === 0) fail("permissionMode.options is required");
  if (!mode.options.some((option) => option.value === mode.default)) fail("permissionMode.default must be one of options");
  for (const option of mode.options) {
    if (!option.value || !option.label || !option.description) fail("permission options need value, label and description");
  }
  if (agent.icon?.codicon && !/^[a-z0-9-]+$/.test(agent.icon.codicon)) fail("icon.codicon must be a codicon name");
}

export function agentsDir() {
  return AGENTS_DIR;
}

/** Load and validate every manifest, ordered by `order` then id. */
export function loadAgents() {
  if (!fs.existsSync(AGENTS_DIR)) throw new Error(`Agent manifest directory not found: ${AGENTS_DIR}`);
  const agents = [];
  for (const file of fs.readdirSync(AGENTS_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(AGENTS_DIR, file);
    const agent = JSON.parse(fs.readFileSync(full, "utf8"));
    validate(agent, full);
    agents.push(agent);
  }
  const ids = new Set();
  for (const agent of agents) {
    if (ids.has(agent.id)) throw new Error(`Duplicate agent id: ${agent.id}`);
    ids.add(agent.id);
  }
  const fallbacks = agents.filter((agent) => agent.permissionMode.fallback);
  if (fallbacks.length > 1) {
    throw new Error("At most one agent manifest may set permissionMode.fallback");
  }
  return agents.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
}

/** @param {string | undefined} id */
export function selectAgents(id) {
  const agents = loadAgents();
  if (!id || id === "all") return agents;
  const wanted = id.split(",").map((value) => value.trim()).filter(Boolean);
  const selected = agents.filter((agent) => wanted.includes(agent.id));
  const unknown = wanted.filter((value) => !selected.some((agent) => agent.id === value));
  if (unknown.length) {
    throw new Error(`Unknown agent: ${unknown.join(", ")}. Known: ${agents.map((agent) => agent.id).join(", ")}`);
  }
  return selected;
}
