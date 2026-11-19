import { cssRules } from "./canonical.mjs";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Add one SVG-mask codicon rule per agent. Existing icons are left untouched so
 * a second install does not duplicate CSS.
 */
export function patchCss(source, agents) {
  const added = [];
  const present = [];
  let next = source;
  for (const agent of agents) {
    const name = agent.icon?.codicon;
    if (!name || !agent.icon?.svg) continue;
    const pattern = new RegExp(`\\.codicon-${escapeRegExp(name)}\\s*:before`);
    if (pattern.test(next)) {
      present.push(name);
      continue;
    }
    const rules = cssRules([agent]);
    if (!rules) continue;
    next = `${next.replace(/\s*$/, "\n")}\n${rules}`;
    added.push(name);
  }
  return { source: next, added, present, changed: next !== source };
}

export function verifyCss(source, agents) {
  return agents
    .filter((agent) => agent.icon?.codicon && agent.icon?.svg)
    .map((agent) => agent.icon.codicon)
    .filter((name) => !new RegExp(`\\.codicon-${escapeRegExp(name)}\\s*:before`).test(source));
}
