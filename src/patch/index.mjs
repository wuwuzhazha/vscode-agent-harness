import fs from "node:fs";
import path from "node:path";
import { updateChecksums, verifyChecksums } from "../checksums.mjs";
import { pathsFor } from "../env.mjs";
import { patchAgentHost, verifyAgentHost } from "./agent-host.mjs";
import { patchCss, verifyCss } from "./css.mjs";
import { patchWorkbench, verifyWorkbench } from "./workbench.mjs";

function relativeOut(install, file) {
  return path.relative(path.join(install.appDir, "out"), file).split(path.sep).join("/");
}

/**
 * Compute every patched file in memory. Nothing is written until all rules have
 * matched and the canonical markers verify, so a failed run cannot leave VS
 * Code half-patched.
 */
export function planPatches(install, agents) {
  const files = pathsFor(install);
  const results = [];
  const errors = [];

  const agentHost = fs.readFileSync(files.agentHost, "utf8");
  const agentHostResult = patchAgentHost(agentHost, agents);
  const agentHostMissing = verifyAgentHost(agentHostResult.source, agents);
  results.push({
    key: "agentHost",
    file: files.agentHost,
    relative: relativeOut(install, files.agentHost),
    source: agentHostResult.source,
    changed: agentHostResult.source !== agentHost,
    applied: agentHostResult.applied,
    unchanged: agentHostResult.unchanged,
  });
  if (agentHostResult.missing.length) {
    errors.push(`agentHost: anchors not found: ${agentHostResult.missing.join(", ")}`);
  }
  if (agentHostMissing.length) {
    errors.push(`agentHost: canonical markers missing after patch: ${agentHostMissing.length}`);
  }

  const workbench = fs.readFileSync(files.workbench, "utf8");
  const workbenchResult = patchWorkbench(workbench, agents);
  const workbenchMissing = verifyWorkbench(workbenchResult.source, agents);
  results.push({
    key: "workbench",
    file: files.workbench,
    relative: relativeOut(install, files.workbench),
    source: workbenchResult.source,
    changed: workbenchResult.source !== workbench,
    applied: workbenchResult.applied,
    unchanged: workbenchResult.unchanged,
  });
  if (workbenchResult.missing.length) {
    errors.push(`workbench: anchors not found: ${workbenchResult.missing.join(", ")}`);
  }
  if (workbenchMissing.length) {
    errors.push(`workbench: canonical markers missing after patch: ${workbenchMissing.length}`);
  }

  const css = fs.readFileSync(files.css, "utf8");
  const cssResult = patchCss(css, agents);
  const cssMissing = verifyCss(cssResult.source, agents);
  results.push({
    key: "css",
    file: files.css,
    relative: relativeOut(install, files.css),
    source: cssResult.source,
    changed: cssResult.changed,
    addedIcons: cssResult.added,
    presentIcons: cssResult.present,
  });
  if (cssMissing.length) {
    errors.push(`css: icons missing after patch: ${cssMissing.join(", ")}`);
  }

  return { results, errors };
}

export function applyPatches(install, agents, { dryRun = false } = {}) {
  const { results, errors } = planPatches(install, agents);
  if (errors.length) {
    const error = new Error(`Patching failed:\n${errors.map((line) => `  - ${line}`).join("\n")}`);
    error.details = errors;
    throw error;
  }

  const changed = results.filter((result) => result.changed);
  if (dryRun) {
    return { dryRun, results, changed: changed.map((result) => result.relative), checksums: [] };
  }

  for (const result of changed) {
    fs.writeFileSync(result.file, result.source);
  }

  const only = new Set(changed.map((result) => result.relative));
  const updated = updateChecksums(install, only);
  const verification = verifyChecksums(install);
  if (!verification.ok) {
    throw new Error(
      `Checksum verification failed after patching: ${[...verification.mismatches, ...verification.missing].join(", ")}`
    );
  }

  return {
    dryRun,
    results,
    changed: changed.map((result) => result.relative),
    checksums: updated,
  };
}
