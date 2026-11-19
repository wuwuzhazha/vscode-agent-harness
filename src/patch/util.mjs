/**
 * Small patching primitives. Every rule is written so that running the
 * installer twice is a no-op: the canonical form is detected first and the
 * rule reports `changed: false`.
 */

/**
 * Replace a single match of `pattern` with `replacement`.
 * @returns {{ source: string, matched: boolean, changed: boolean }}
 */
export function replaceMatch(source, pattern, replacement) {
  const match = pattern.exec(source);
  if (!match) return { source, matched: false, changed: false };
  const next = source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
  return { source: next, matched: true, changed: next !== source };
}

/**
 * Replace a range starting at `startPattern` up to and including `endToken`.
 * Useful for minified function bodies where braces are hard to match safely.
 */
export function replaceRange(source, startPattern, endToken, replacement) {
  const match = startPattern.exec(source);
  if (!match) return { source, matched: false, changed: false };
  const end = source.indexOf(endToken, match.index);
  if (end < 0) return { source, matched: false, changed: false };
  const next =
    source.slice(0, match.index) +
    replacement +
    source.slice(end + endToken.length);
  return { source: next, matched: true, changed: next !== source };
}

/**
 * Apply the first matching variant. `variants` are exact strings from older
 * patch generations; `canonical` is the current output.
 */
export function replaceVariant(source, canonical, variants) {
  if (source.includes(canonical)) return { source, matched: true, changed: false };
  for (const variant of variants) {
    if (!source.includes(variant)) continue;
    return { source: source.split(variant).join(canonical), matched: true, changed: true };
  }
  return { source, matched: false, changed: false };
}

/**
 * Run a list of `{ name, apply }` rules. A rule that cannot find its anchor is
 * reported, not silently skipped, because that usually means the VS Code build
 * is unsupported.
 */
export function runRules(source, rules, context) {
  let current = source;
  const applied = [];
  const unchanged = [];
  const missing = [];
  for (const rule of rules) {
    const result = rule.apply(current, context);
    current = result.source;
    if (result.matched === false) missing.push(rule.name);
    else if (result.changed) applied.push(rule.name);
    else unchanged.push(rule.name);
  }
  return { source: current, applied, unchanged, missing };
}
