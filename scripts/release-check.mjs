#!/usr/bin/env node
/**
 * Pre-publication audit. Fails while placeholders or machine-specific values are
 * still tracked, so an accidental push does not leak paths or publish dead links.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

// Built from pieces so this file does not match its own rules.
const OWNER_TOKEN = "OWN" + "ER";
const LOCAL_USER = "wht" + "01";

const rules = [
  { name: "repository placeholder", pattern: new RegExp(`\\b${OWNER_TOKEN}\\b`) },
  { name: "personal user path", pattern: new RegExp(LOCAL_USER) },
  { name: "hard-coded ZCode path", pattern: /D:[\\/]ZCode/ },
  { name: "hard-coded Magpie token", pattern: /Bearer magpie/ },
  { name: "unresolved template marker", pattern: /\{\{[A-Z0-9_]+\}\}/ }
];

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => file !== "scripts/release-check.mjs")
  .filter((file) => !/\.(png|jpg|jpeg|gif|ico|tgz)$/i.test(file));

const findings = [];
for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (const rule of rules) {
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) {
        findings.push({ file, line: index + 1, rule: rule.name, text: line.trim().slice(0, 120) });
      }
    });
  }
}

const author = execFileSync("git", ["log", "-1", "--format=%an <%ae>"], { encoding: "utf8" }).trim();
console.log(`Commit author: ${author}`);
if (!/@users\.noreply\.github\.com$/.test(author) && !/noreply/.test(author)) {
  console.log("  note: publishing exposes this address in the commit metadata.");
  console.log("  use a GitHub noreply address or `git commit --amend --reset-author` if needed.");
}

if (findings.length) {
  console.error("\nNot ready to publish:\n");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}  [${finding.rule}]`);
    console.error(`  ${finding.text}`);
  }
  console.error(`\n${findings.length} finding(s). Replace placeholders and machine-specific values first.`);
  process.exit(1);
}

console.log("\nNo placeholders, personal paths or bundled credentials found.");
console.log("Also confirm: LICENSE/NOTICE, repository URLs, issue-template links, and a fresh clone test.");
