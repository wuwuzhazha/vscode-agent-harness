#!/usr/bin/env node
/**
 * Repository consistency checks that do not need VS Code.
 * Run with `npm run check`; CI runs it on every push.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgents } from "../src/agents.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const errors = [];
const fail = (message) => errors.push(message);

const agents = loadAgents();
if (agents.length === 0) fail("no agent manifests found");

for (const agent of agents) {
  const file = path.join(root, "agents", `${agent.id}.json`);
  if (!fs.existsSync(file)) fail(`manifest file name does not match id: ${agent.id}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
for (const [name, bin] of Object.entries(packageJson.bin || {})) {
  if (!fs.existsSync(path.join(root, bin))) fail(`bin entry ${name} points at missing ${bin}`);
}

for (const file of ["shim/sdk.mjs", "shim/package.json", "shim/pi-edit-gate.ts"]) {
  if (!fs.existsSync(path.join(root, file))) fail(`missing bundled shim file: ${file}`);
}

const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
for (const agent of agents) {
  if (!readme.includes(`\`${agent.id}\``)) fail(`README does not mention agent ${agent.id}`);
}

const markdownFiles = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
  "DISCLAIMER.md",
  "NOTICE.md",
  ...fs
    .readdirSync(path.join(root, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`),
];

for (const relative of markdownFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    fail(`missing documentation file: ${relative}`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    let target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split("#")[0];
    if (!target) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      fail(`${relative}: broken link ${target}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(`✗ ${error}`);
  console.error(`\n${errors.length} problem(s) found`);
  process.exit(1);
}

console.log(`✓ ${agents.length} manifests, ${markdownFiles.length} docs, shim files present`);
