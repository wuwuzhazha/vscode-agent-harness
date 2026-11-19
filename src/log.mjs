const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);

let quiet = false;

/** Suppress human-readable stdout so `--json` output stays parseable. */
export function setQuiet(value) {
  quiet = Boolean(value);
}

export const log = {
  info(message) {
    if (!quiet) console.log(message);
  },
  step(message) {
    if (!quiet) console.log(`${paint(36, "→")} ${message}`);
  },
  ok(message) {
    if (!quiet) console.log(`${paint(32, "✓")} ${message}`);
  },
  warn(message) {
    console.error(`${paint(33, "!")} ${message}`);
  },
  error(message) {
    console.error(`${paint(31, "✗")} ${message}`);
  },
  detail(message) {
    if (!quiet) console.log(`  ${paint(90, message)}`);
  },
};
