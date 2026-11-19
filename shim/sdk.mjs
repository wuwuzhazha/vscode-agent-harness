// Agent harness shim for @anthropic-ai/claude-agent-sdk.
// Installed by vscode-agent-harness. VS Code loads this file when
// VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT points at ~/.vscode-harness/shim.
// It exposes the subset of the Claude Agent SDK API the harness uses and
// drives pi/omp (--mode rpc) or zcode (--output-format stream-json).

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function findShimRoot() {
  let current = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(current, "pi-edit-gate.ts"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.dirname(path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")))));
}
const SHIM_ROOT = findShimRoot();
const LOG_FILE = process.env.PI_CLAUDE_SHIM_LOG || path.join(SHIM_ROOT, "shim.log");

function log(...args) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`);
  } catch {
    // ignore logging failures
  }
}

export class AbortError extends Error {
  constructor(message = "Aborted") {
    super(message);
    this.name = "AbortError";
  }
}

// npm installs command shims as .cmd on Windows; a bare PATH entry is not
// executable there. Prefer .cmd/.exe and fall back to a .ps1 wrapper.
function isFile(candidate) {
  try {
    return Boolean(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function findOnPath(name) {
  const win = process.platform === "win32";
  const fileNames = win ? [`${name}.cmd`, `${name}.exe`, `${name}.ps1`, name] : [name];
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const fileName of fileNames) {
      const candidate = path.join(dir, fileName);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function findOmp() {
  const home = os.homedir();
  const win = process.platform === "win32";
  const candidates = [
    process.env.OMP_BIN,
    path.join(home, "AppData", "Roaming", "npm", win ? "omp.cmd" : "omp"),
    path.join(home, ".local", "bin", win ? "omp.cmd" : "omp"),
    path.join(home, ".local", "bin", "omp"),
    path.join(home, ".bun", "bin", win ? "omp.cmd" : "omp"),
  ];
  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate;
  }
  return findOnPath("omp") || (win ? "omp.cmd" : "omp");
}

function findPi() {
  const home = os.homedir();
  const win = process.platform === "win32";
  const candidates = [
    process.env.PI_BIN,
    path.join(home, ".pi", "agent", "bin", win ? "pi.cmd" : "pi"),
    path.join(home, ".pi", "agent", "bin", "pi"),
    path.join(home, "AppData", "Roaming", "npm", win ? "pi.cmd" : "pi"),
  ];
  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate;
  }
  return findOnPath("pi");
}

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const MODEL_CACHE_TTL = 5 * 60 * 1000;
const modelCache = new Map();

function runCapture(bin, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      const isPs1 = process.platform === "win32" && /\.ps1$/i.test(bin || "");
      child = spawn(isPs1 ? "powershell.exe" : bin, isPs1 ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", bin, ...args] : args, {
        windowsHide: true,
        shell: !isPs1 && process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(null);
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", () => {});
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 && out.trim() ? out : null); });
  });
}

function parseOmpModels(text) {
  let json;
  try { json = JSON.parse(text); } catch { return []; }
  return (json.models ?? [])
    .filter((m) => !m.kind || m.kind === "chat")
    .map((m) => {
      const levels = (m.thinking ?? []).filter((l) => EFFORT_LEVELS.includes(l));
      const value = m.selector || (m.provider ? `${m.provider}/${m.id}` : m.id);
      return { value, displayName: m.name || m.id || value, ...(levels.length ? { supportedEffortLevels: levels } : {}) };
    })
    .filter((m) => !!m.value);
}

function parsePiModels(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^provider\s+model\b/i.test(trimmed)) continue;
    const cols = trimmed.split(/\s{2,}/);
    if (cols.length < 2) continue;
    const [provider, model, , , thinking] = cols;
    if (!provider || !model) continue;
    const levels = /^yes$/i.test(thinking ?? "") ? EFFORT_LEVELS.slice() : [];
    rows.push({
      value: `${provider}/${model}`,
      displayName: model,
      ...(levels.length ? { supportedEffortLevels: levels } : {}),
    });
  }
  return rows;
}

async function listHarnessModels(provider) {
  const cached = modelCache.get(provider);
  if (cached && Date.now() - cached.at < MODEL_CACHE_TTL) return cached.models;
  let models = [];
  try {
    if (provider === "omp") {
      // `omp models` opens an interactive picker on 18.22.x and never exits.
      const out = await runCapture(findOmp(), ["models", "ls", "--json", "--no-extensions"], 60000);
      if (out) models = parseOmpModels(out);
    } else {
      const out = await runCapture(findPi(), ["--list-models"]);
      if (out) models = parsePiModels(out);
    }
  } catch (err) {
    log("model list failed", provider, err?.message || String(err));
  }
  if (!models.length) {
    models = provider === "omp"
      ? [{ value: "omp-default", displayName: "OMP (default)" }]
      : [{ value: "pi-default", displayName: "Pi (default)" }];
  }
  log("model catalog", { provider, count: models.length });
  modelCache.set(provider, { at: Date.now(), models });
  return models;
}

function shellQuote(value) {
  if (process.platform !== "win32") return `'${String(value).replace(/'/g, `'\\''`)}'`;
  return `"${String(value).replace(/"/g, '""')}"`;
}

class PiRpc {
  constructor(cwd, env, model, effort, permissionMode) {
    this.cwd = cwd || process.cwd();
    this.model = model;
    this.effort = effort;
    this.permissionMode = permissionMode;
    this.env = { ...process.env, ...(env || {}) };
    this.child = null;
    this.buffer = "";
    this.events = [];
    this.waiters = [];
    this.pending = new Map();
    this.seq = 0;
    this.closed = false;
  }

  async start() {
    // OMP selectors are provider/model (for example magpie/auto/...), so the
    // host tag is the reliable discriminator; omp-* is only a legacy prefix.
    const isOmp = this.env?.PI_HARNESS === "omp" || (typeof this.model === "string" && this.model.startsWith("omp"));
    const pi = isOmp ? findOmp() : findPi();
    if (!pi) throw new Error(`${isOmp ? "omp" : "pi"} executable not found (set ${isOmp ? "OMP_BIN" : "PI_BIN"})`);
    let model = this.model;
    if (typeof model === "string" && model.startsWith("omp-")) model = model.slice(4);
    const args = ["--mode", "rpc", "--no-session"];
    if (model && model !== "pi-default" && model !== "omp-default" && model !== "default") args.push("--model", model);
    if (this.effort) args.push("--thinking", this.effort);
    if (this.permissionMode === "readOnly") args.push("--tools", isOmp ? "read,grep,glob" : "read,grep,find,ls");
    else if (this.permissionMode === "noTools") args.push("--no-tools");
    else if (this.permissionMode === "autoApprove" && isOmp) args.push("--auto-approve");
    const editGate = path.join(SHIM_ROOT, "pi-edit-gate.ts");
    if (fs.existsSync(editGate)) args.push("--extension", editGate);
    const isPs1 = process.platform === "win32" && /\.ps1$/i.test(pi);
    this.child = spawn(isPs1 ? "powershell.exe" : pi, isPs1 ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", pi, ...args] : args, {
      cwd: this.cwd,
      env: this.env,
      windowsHide: true,
      shell: !isPs1 && process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    log("spawned pi", { pid: this.child.pid, cwd: this.cwd, pi, model, effort: this.effort, permissionMode: this.permissionMode });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this._onStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => log("pi stderr", chunk.trim().slice(0, 2000)));
    this.child.on("error", (err) => {
      log("pi process error", err?.message || String(err));
      this._end();
    });
    this.child.on("exit", (code, signal) => {
      log("pi exited", { code, signal });
      this._end();
    });
  }

  _onStdout(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (err) {
        log("unparseable pi record", line.slice(0, 1000), err?.message);
        continue;
      }
      this._onRecord(record);
    }
  }

  _onRecord(record) {
    if (record.type === "response") {
      const pending = this.pending.get(record.id);
      if (pending) {
        this.pending.delete(record.id);
        pending.resolve(record);
      } else {
        log("response without waiter", record);
      }
      return;
    }
    this._pushEvent(record);
  }

  _pushEvent(event) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.events.push(event);
  }

  _end() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
    for (const [, pending] of this.pending) pending.resolve({ type: "response", success: false, error: "pi exited" });
    this.pending.clear();
  }

  send(record) {
    if (!this.child || this.closed || !this.child.stdin.writable) return false;
    try {
      this.child.stdin.write(JSON.stringify(record) + "\n");
      return true;
    } catch (err) {
      log("stdin write failed", err?.message || String(err));
      return false;
    }
  }

  request(record) {
    const id = record.id || `req-${++this.seq}`;
    const promise = new Promise((resolve) => this.pending.set(id, { resolve }));
    this.send({ ...record, id });
    return promise;
  }

  async prompt(text, images) {
    const record = { type: "prompt", message: text };
    if (images && images.length) record.images = images;
    // Pi rejects a prompt during an active run unless a streaming behavior is set.
    // The harness serializes turns, but be defensive: try followUp on rejection.
    const id = `prompt-${++this.seq}`;
    const response = await this.request({ ...record, id });
    if (response && response.success === false) {
      log("prompt rejected", response.error);
      await this.request({ type: "prompt", message: text, images, streamingBehavior: "followUp", id: `prompt-${++this.seq}` });
    }
  }

  nextEvent() {
    if (this.events.length) return Promise.resolve(this.events.shift());
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close() {
    try {
      if (this.child && !this.closed) this.child.stdin.end();
    } catch {
      // ignore
    }
    try {
      if (this.child) this.child.kill();
    } catch {
      // ignore
    }
    this._end();
  }
}

function extractUserText(value) {
  const message = value?.message || value;
  const content = message?.content;
  let text = "";
  const images = [];
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") {
        text += (text ? "\n" : "") + block.text;
      } else if (block.type === "image") {
        const data = block.source?.data || block.data;
        const mimeType = block.source?.media_type || block.mimeType;
        if (data) images.push({ type: "image", data, mimeType: mimeType || "image/png" });
      }
    }
  }
  return { text, images };
}

const TOOL_NAME_MAP = {
  edit: "Edit",
  write: "Write",
  read: "Read",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
  ls: "LS",
  list: "LS",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  todo: "TodoWrite",
  todowrite: "TodoWrite",
  task: "Task",
};

function mapToolName(name) {
  return TOOL_NAME_MAP[String(name || "").toLowerCase()] || name || "Tool";
}

// Pi tool arguments use different field names than Claude Code's tools.
// VSCode's harness only recognizes edits when the tool name is Edit/MultiEdit/Write
// and the input carries `file_path`; it snapshots the file before/after the call to
// build the native diff.
function mapToolInput(name, args) {
  const a = args && typeof args === "object" ? args : {};
  const key = String(name || "").toLowerCase();
  const filePath = a.file_path ?? a.path ?? a.filePath ?? a.filename ?? "";
  switch (key) {
    case "edit": {
      const edits = Array.isArray(a.edits)
        ? a.edits
        : typeof a.oldText === "string" || typeof a.old_string === "string"
          ? [{ oldText: a.oldText ?? a.old_string, newText: a.newText ?? a.new_string }]
          : [];
      const mapped = edits.map((edit) => ({
        old_string: edit?.oldText ?? edit?.old_string ?? "",
        new_string: edit?.newText ?? edit?.new_string ?? "",
      }));
      if (mapped.length <= 1) {
        return {
          file_path: filePath,
          old_string: mapped[0]?.old_string ?? "",
          new_string: mapped[0]?.new_string ?? "",
        };
      }
      return { file_path: filePath, edits: mapped };
    }
    case "write":
      return { file_path: filePath, content: a.content ?? "" };
    case "read":
      return { file_path: filePath };
    case "bash":
    case "powershell":
      return { command: a.command ?? "" };
    case "grep":
      return { pattern: a.pattern ?? a.query ?? "", path: a.path };
    case "glob":
      return { pattern: a.pattern ?? a.glob ?? "", path: a.path };
    case "ls":
    case "list":
      return { path: filePath || "." };
    default:
      return a;
  }
}

function textOfBlocks(blocks) {
  return blocks.filter((block) => block.type === "text").map((block) => block.text || "").join("\n");
}

function mapAssistantBlocks(message) {
  const blocks = [];
  for (const block of message?.content || []) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && block.text) {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "thinking" && block.thinking) {
      blocks.push({ type: "thinking", thinking: block.thinking });
    } else if (block.type === "toolCall") {
      const input = mapToolInput(block.name, block.arguments);
      const name = Array.isArray(input?.edits) ? "MultiEdit" : mapToolName(block.name);
      blocks.push({ type: "tool_use", id: block.id, name, input });
    }
  }
  return blocks;
}

function usageOf(message) {
  const usage = message?.usage || {};
  return {
    input_tokens: usage.input ?? 0,
    output_tokens: usage.output ?? 0,
    cache_read_input_tokens: usage.cacheRead ?? 0,
    cache_creation_input_tokens: usage.cacheWrite ?? 0,
  };
}

function assistantMessage(sessionId, message, blocks = mapAssistantBlocks(message)) {
  return {
    type: "assistant",
    message: {
      id: `msg_${randomUUID().replace(/-/g, "")}`,
      type: "message",
      role: "assistant",
      model: message?.responseModel || message?.model || "pi",
      content: blocks,
      stop_reason: blocks.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: usageOf(message),
    },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId,
  };
}

// VSCode's Claude harness builds chat text and tool cards from the SDK's
// partial streaming messages (`stream_event` with Anthropic API events);
// the final `assistant` message is only used for history/checkpointing.
// Pi hands us complete messages, so synthesize an equivalent event stream.
function streamEvents(sessionId, message, blocks) {
  const messageId = `msg_${randomUUID().replace(/-/g, "")}`;
  const model = message?.responseModel || message?.model || "pi";
  const events = [];
  const push = (event) =>
    events.push({
      type: "stream_event",
      event,
      parent_tool_use_id: null,
      uuid: randomUUID(),
      session_id: sessionId,
    });
  push({
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: usageOf(message),
    },
  });
  blocks.forEach((block, index) => {
    if (block.type === "tool_use") {
      push({ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) } });
      push({ type: "content_block_stop", index });
    } else if (block.type === "thinking") {
      push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } });
      push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } });
      push({ type: "content_block_stop", index });
    } else {
      push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
      push({ type: "content_block_stop", index });
    }
  });
  push({
    type: "message_delta",
    delta: { stop_reason: blocks.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null },
    usage: usageOf(message),
  });
  push({ type: "message_stop" });
  return events;
}

function toolResultMessage(sessionId, toolUseId, result, isError) {
  let text = "";
  if (typeof result === "string") {
    text = result;
  } else if (result?.content && Array.isArray(result.content)) {
    text = result.content.map((block) => (typeof block === "string" ? block : block?.text || "")).join("\n");
  } else if (result !== undefined) {
    try {
      text = JSON.stringify(result);
    } catch {
      text = String(result);
    }
  }
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: [{ type: "text", text }],
          is_error: Boolean(isError),
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

function systemInitMessage(sessionId, cwd, options) {
  return {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    claude_code_version: "2.1.327",
    cwd,
    tools: ["Read", "Write", "Edit", "Bash"],
    mcp_servers: [],
    model: options?.model || "pi",
    permissionMode: options?.permissionMode || "default",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid: randomUUID(),
    session_id: sessionId,
  };
}

function resultMessage(sessionId, text, aborted) {
  if (aborted) {
    return {
      type: "result",
      subtype: "error_during_execution",
      duration_ms: 0,
      duration_api_ms: 0,
      is_error: true,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      errors: [],
      session_id: sessionId,
    };
  }
  return {
    type: "result",
    subtype: "success",
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    result: text || "",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    session_id: sessionId,
  };
}

// ---------------------------------------------------------------------------
// ZCode backend: translates `zcode --output-format stream-json` events into
// Claude Agent SDK messages. Used when the harness id is "zcode".
// ---------------------------------------------------------------------------
function findZcodeCli() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const candidates = [
    process.env.ZCODE_CLI_PATH,
    path.join(local, "Programs", "ZCode", "resources", "glm", "zcode.cjs"),
    path.join(programFiles, "ZCode", "resources", "glm", "zcode.cjs"),
    path.join(home, "ZCode", "resources", "glm", "zcode.cjs"),
  ];
  for (const drive of ["C", "D", "E", "F"]) {
    candidates.push(path.join(`${drive}:\\`, "ZCode", "resources", "glm", "zcode.cjs"));
  }
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return "zcode.cjs";
}
const ZCODE_CLI = findZcodeCli();
const ZCODE_MODEL_PREFIX = "zcode-";
const ZCODE_CONFIG_FILE = path.join(os.homedir(), ".zcode", "v2", "provider_config.json");
const ZCODE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
let zcodeCatalogCache = null;
let zcodeConfigQueue = Promise.resolve();

function zcStripPrefix(id) {
  if (typeof id !== "string") return "";
  return id.startsWith(ZCODE_MODEL_PREFIX) ? id.slice(ZCODE_MODEL_PREFIX.length) : id;
}

function zcReadProviderConfig() {
  try {
    const raw = fs.readFileSync(ZCODE_CONFIG_FILE, "utf8");
    return { raw, json: JSON.parse(raw) };
  } catch {
    return null;
  }
}

function zcProviderRule() {
  const cfg = zcReadProviderConfig();
  const rules = cfg?.json?.config?.providerConfigRules?.providerRules || [];
  return rules.find((rule) => /magpie/i.test(`${rule.providerId || ""} ${rule.providerName || ""}`)) || rules[0] || null;
}

function zcDefaultModelId() {
  const order = zcProviderRule()?.config?.modelOrder;
  return Array.isArray(order) && order.length ? order[0] : "";
}

/** Local Magpie credentials come from ZCode's own provider config, never source. */
function zcMagpieAccess() {
  const rule = zcProviderRule();
  return {
    baseUrl: process.env.MAGPIE_BASE_URL || rule?.config?.api?.baseUrl || "http://127.0.0.1:3425",
    token: process.env.MAGPIE_TOKEN || rule?.config?.access?.apiKey || "",
  };
}

async function zcodeModelCatalog() {
  if (zcodeCatalogCache && Date.now() < zcodeCatalogCache.expiresAt) return zcodeCatalogCache.models;
  const models = [];
  const magpie = zcMagpieAccess();
  try {
    const url = `${magpie.baseUrl.replace(/\/+$/, "")}/v1/models`;
    const res = await fetch(url, {
      headers: magpie.token ? { authorization: `Bearer ${magpie.token}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = await res.json();
      for (const m of body.data || []) {
        if (!m?.id) continue;
        const levels = (m.reasoning_levels || (m.supported_reasoning_levels || []).map((x) => x.effort) || []).filter((l) => ZCODE_EFFORTS.includes(l));
        models.push({
          value: ZCODE_MODEL_PREFIX + m.id,
          displayName: m.magpie_label || m.display_name || m.id,
          ...(levels.length ? { supportedEffortLevels: levels } : {}),
        });
      }
    }
  } catch (err) {
    log("zcode model fetch failed", err?.message || String(err));
  }
  if (!models.length) {
    const cfg = zcReadProviderConfig();
    const rules = cfg?.json?.config?.modelConfigRules?.providerModelRules || [];
    for (const rule of rules) {
      if (!rule?.modelId) continue;
      const levels = (rule.config?.optionSpecs?.reasoningLevel?.values || []).filter((l) => ZCODE_EFFORTS.includes(l));
      models.push({
        value: ZCODE_MODEL_PREFIX + rule.modelId,
        displayName: rule.modelId,
        ...(levels.length ? { supportedEffortLevels: levels } : {}),
      });
    }
  }
  if (!models.length) models.push({ value: ZCODE_MODEL_PREFIX + "default", displayName: "ZCode (default)" });
  const seen = new Set();
  const unique = models.filter((m) => (seen.has(m.value) ? false : (seen.add(m.value), true)));
  zcodeCatalogCache = { expiresAt: Date.now() + 5 * 60 * 1000, models: unique };
  log("zcode model catalog", { count: unique.length });
  return unique;
}

// ZCode headless has no --model flag. A new CLI session resolves its model from
// defaultModelSelection in ~/.zcode/v2/provider_config.json, so swap it in just
// for the spawn, then restore the original file once turn.started confirms it.
function zcApplySelection(modelId, effort) {
  return new Promise((resolve) => {
    const prev = zcodeConfigQueue;
    let release;
    zcodeConfigQueue = new Promise((r) => (release = r));
    prev.then(() => {
      let restore = () => {};
      try {
        const cur = zcReadProviderConfig();
        if (!cur || !cur.json?.config || !modelId) {
          release();
        } else {
          const selection = { providerId: "magpie", modelId };
          if (effort && ZCODE_EFFORTS.includes(effort)) selection.options = { reasoningLevel: effort };
          cur.json.config.defaultModelSelection = selection;
          const written = JSON.stringify(cur.json);
          fs.writeFileSync(ZCODE_CONFIG_FILE, written);
          let done = false;
          const originalSelection = cur.json.config.defaultModelSelection;
          restore = () => {
            if (done) return;
            done = true;
            try {
              const now = fs.readFileSync(ZCODE_CONFIG_FILE, "utf8");
              if (now === written) {
                fs.writeFileSync(ZCODE_CONFIG_FILE, cur.raw);
              } else {
                const live = JSON.parse(now);
                const liveSelection = live?.config?.defaultModelSelection;
                if (liveSelection && liveSelection.providerId === selection.providerId && liveSelection.modelId === selection.modelId) {
                  if (originalSelection === undefined) delete live.config.defaultModelSelection;
                  else live.config.defaultModelSelection = originalSelection;
                  fs.writeFileSync(ZCODE_CONFIG_FILE, JSON.stringify(live));
                  log("zcode selection restored (merged)");
                } else {
                  log("zcode selection left untouched; config changed by another writer");
                }
              }
            } catch {}
            release();
          };
          log("zcode selection applied", { modelId, effort: effort || "(default)" });
        }
      } catch (err) {
        log("zcode selection failed", err?.message || String(err));
        release();
      }
      resolve(restore);
    });
  });
}

function zcMode(permissionMode) {
  switch (permissionMode) {
    case "plan":
    case "build":
    case "edit":
    case "guarded":
    case "yolo":
      return permissionMode;
    default:
      return "edit";
  }
}

function zcUsage(usage) {
  return {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    cache_read_input_tokens: usage?.cacheReadTokens ?? 0,
    cache_creation_input_tokens: usage?.cacheWriteTokens ?? 0,
  };
}

function zcAssistant(sessionId, blocks, model, usage) {
  return {
    type: "assistant",
    message: {
      id: `msg_${randomUUID().replace(/-/g, "")}`,
      type: "message",
      role: "assistant",
      model: model || "zcode",
      content: blocks,
      stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: zcUsage(usage),
    },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId,
  };
}

function zcStreamEvents(sessionId, blocks, model, usage) {
  const messageId = `msg_${randomUUID().replace(/-/g, "")}`;
  const events = [];
  const emit = (event) => events.push({ type: "stream_event", event, parent_tool_use_id: null, uuid: randomUUID(), session_id: sessionId });
  emit({ type: "message_start", message: { id: messageId, type: "message", role: "assistant", model: model || "zcode", content: [], stop_reason: null, stop_sequence: null, usage: zcUsage(usage) } });
  blocks.forEach((block, index) => {
    if (block.type === "tool_use") {
      emit({ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      emit({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) } });
      emit({ type: "content_block_stop", index });
    } else if (block.type === "thinking") {
      emit({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } });
      emit({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } });
      emit({ type: "content_block_stop", index });
    } else {
      emit({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      emit({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
      emit({ type: "content_block_stop", index });
    }
  });
  emit({ type: "message_delta", delta: { stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null }, usage: zcUsage(usage) });
  emit({ type: "message_stop" });
  return events;
}

function zcToolResult(sessionId, toolUseId, result, isError) {
  let text = "";
  if (typeof result === "string") text = result;
  else if (result && typeof result === "object") {
    if (typeof result.content === "string") text = result.content;
    else if (Array.isArray(result.content)) text = result.content.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n");
    else {
      try { text = JSON.stringify(result); } catch { text = String(result); }
    }
  }
  return {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: [{ type: "text", text }], is_error: Boolean(isError) }] },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId,
  };
}

function zcResult(sessionId, text, usage, aborted) {
  return {
    type: "result",
    subtype: aborted ? "error_during_execution" : "success",
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: Boolean(aborted),
    num_turns: 1,
    result: aborted ? "" : (text || ""),
    stop_reason: aborted ? "aborted" : "end_turn",
    total_cost_usd: 0,
    usage: zcUsage(usage),
    modelUsage: {},
    permission_denials: [],
    session_id: sessionId,
  };
}

function zcInit(sessionId, cwd, options) {
  return {
    type: "system",
    subtype: "init",
    apiKeySource: "zcode",
    claude_code_version: "2.1.327",
    cwd,
    tools: ["Read", "Write", "Edit", "Bash"],
    mcp_servers: [],
    model: options?.model || "zcode-default",
    // model below is the harness-facing id; see zcodeQuery for the CLI id
    permissionMode: zcMode(options?.permissionMode),
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid: randomUUID(),
    session_id: sessionId,
  };
}

function zcNode() {
  const explicit = process.env.ZCODE_NODE_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "nodejs", "node.exe"),
    "C:\\Program Files\\nodejs\\node.exe",
  ];
  for (const candidate of candidates) {
    try { if (candidate && fs.existsSync(candidate)) return candidate; } catch {}
  }
  return "node";
}

function zcodeQuery(params) {
  const prompt = params?.prompt;
  const options = params?.options || {};
  const sessionId = options.sessionId || randomUUID();
  const cwd = typeof options.cwd === "string" ? options.cwd.replace(/^file:\/\//, "") : process.cwd();
  const mode = zcMode(options.permissionMode);
  let zcodeSession = null;
  let child = null;
  let closed = false;
  let selectedModel = zcStripPrefix(options.model);
  if (selectedModel === "default") selectedModel = "";
  let selectedEffort = typeof options.effort === "string" ? options.effort : "";
  let modelName = selectedModel || "zcode";
  let lastText = "";

  const queue = [];
  let wake = null;
  let producerDone = false;
  function push(event) {
    queue.push(event);
    if (wake) { const w = wake; wake = null; w(); }
  }
  function closeQueue() {
    producerDone = true;
    if (wake) { const w = wake; wake = null; w(); }
  }
  async function next() {
    while (queue.length === 0 && !producerDone) await new Promise((r) => (wake = r));
    return queue.shift();
  }

  function killChild() {
    try { child?.kill(); } catch {}
  }

  async function runTurn(text) {
    const args = [
      ZCODE_CLI,
      "--prompt", text,
      "--cwd", cwd,
      "--mode", mode,
      "--output-format", "stream-json",
      "--no-color",
    ];
    if (zcodeSession) args.push("--resume", zcodeSession);
    const wantedModel = selectedModel && selectedModel !== zcDefaultModelId() ? selectedModel : "";
    const wantedEffort = selectedEffort && selectedEffort !== "max" ? selectedEffort : "";
    const restoreSelection = zcodeSession || (!wantedModel && !wantedEffort)
      ? null
      : await zcApplySelection(wantedModel || zcDefaultModelId(), wantedEffort);
    let selectionRestored = false;
    const restoreOnce = () => {
      if (selectionRestored || !restoreSelection) return;
      selectionRestored = true;
      restoreSelection();
    };
    log("zcode turn start", { cwd, mode, resume: zcodeSession, model: selectedModel || "(default)", effort: selectedEffort || "(default)", chars: text.length });

    lastText = "";
    await new Promise((resolve) => {
      let buffer = "";
      let textAcc = "";
      let thinkAcc = "";
      let emittedResult = false;
      let turnUsage = null;

      child = spawn(zcNode(), [ZCODE_CLI, ...args.slice(1)], { cwd, windowsHide: true, env: { ...process.env } });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.sessionId && String(event.sessionId).startsWith("sess_")) zcodeSession = event.sessionId;
          switch (event.type) {
            case "turn.started":
              if (event.payload?.modelSelection?.modelId) modelName = event.payload.modelSelection.modelId;
              restoreOnce();
              break;
            case "model.streaming": {
              const kind = event.payload?.kind;
              const delta = event.payload?.delta || "";
              if (kind === "reasoning_delta") thinkAcc += delta;
              else if (kind === "text_delta") textAcc += delta;
              else if (kind === "finish") {
                const blocks = [];
                if (thinkAcc) blocks.push({ type: "thinking", thinking: thinkAcc });
                if (textAcc) blocks.push({ type: "text", text: textAcc });
                if (blocks.length) {
                  lastText = textAcc;
                  for (const ev of zcStreamEvents(sessionId, blocks, modelName)) push(ev);
                  push(zcAssistant(sessionId, blocks, modelName));
                }
                thinkAcc = "";
                textAcc = "";
              }
              break;
            }
            case "tool.updated": {
              const p = event.payload || {};
              if (p.kind === "scheduled") {
                const block = { type: "tool_use", id: p.toolCallId, name: p.toolName || "Tool", input: p.input || {} };
                for (const ev of zcStreamEvents(sessionId, [block], modelName)) push(ev);
                push(zcAssistant(sessionId, [block], modelName));
              } else if (p.kind === "result") {
                const r = p.result || {};
                push(zcToolResult(sessionId, p.toolCallId, r.content ?? "", r.success === false));
              }
              break;
            }
            case "turn.completed":
              turnUsage = event.payload?.usage || null;
              if (!emittedResult) {
                emittedResult = true;
                push(zcResult(sessionId, event.payload?.response || lastText, turnUsage, false));
              }
              break;
            case "result":
              if (!emittedResult) {
                emittedResult = true;
                push(zcResult(sessionId, event.response || lastText, event.usage || turnUsage, false));
              }
              break;
            default:
              break;
          }
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d) => log("zcode stderr", String(d).trim().slice(0, 800)));
      child.on("error", (err) => { log("zcode spawn error", err?.message || String(err)); restoreOnce(); resolve(); });
      child.on("close", (code) => {
        log("zcode turn end", { code });
        restoreOnce();
        if (!emittedResult) {
          emittedResult = true;
          push(zcResult(sessionId, lastText, turnUsage, closed || code !== 0));
        }
        child = null;
        resolve();
      });
    });
  }

  const generator = (async function* () {
    log("zcode query start", { cwd, promptType: typeof prompt, model: options.model, mode });
    yield zcInit(sessionId, cwd, options);

    const consumer = (async () => {
      if (typeof prompt === "string") {
        await runTurn(prompt);
      } else if (prompt && typeof prompt[Symbol.asyncIterator] === "function") {
        for await (const userMessage of prompt) {
          if (closed) break;
          const { text } = extractUserText(userMessage);
          if (!text) continue;
          await runTurn(text);
          if (closed) break;
        }
      } else if (prompt != null) {
        await runTurn(String(prompt));
      }
    })()
      .catch((err) => log("zcode consumer error", err?.message || String(err)))
      .finally(() => closeQueue());

    while (true) {
      const event = await next();
      if (event === undefined) break;
      yield event;
    }
    await consumer;
    log("zcode query end");
  })();

  generator.interrupt = async () => {
    killChild();
  };
  generator.setPermissionMode = async () => {};
  generator.setMcpPermissionModeOverride = async () => ({});
  generator.setModel = async (model) => {
    const raw = typeof model === "string" ? model : model?.id;
    if (!raw) return;
    const next = zcStripPrefix(raw);
    if (!next || next === "default" || next === selectedModel) return;
    selectedModel = next;
    modelName = next;
    if (zcodeSession) {
      log("zcode model changed; next turn starts a fresh CLI session", { model: next });
      zcodeSession = null;
    }
  };
  generator.setEffort = async (effort) => {
    if (!effort || effort === selectedEffort) return;
    selectedEffort = effort;
    if (zcodeSession) {
      log("zcode effort changed; next turn starts a fresh CLI session", { effort });
      zcodeSession = null;
    }
  };
  generator.setMaxThinkingTokens = async () => {};
  generator.applyFlagSettings = async () => {};
  generator.reloadPlugins = async () => {};
  generator.setSettings = async () => {};
  generator.supportedCommands = async () => [];
  generator.supportedModels = async () => zcodeModelCatalog();
  generator.supportedAgents = async () => [];
  generator.getSettings = async () => ({});
  generator.getAccountInfo = async () => ({ apiProvider: "zcode", tokenSource: "zai", apiKeySource: "none" });
  generator.accountInfo = async () => ({ apiProvider: "zcode", tokenSource: "zai", apiKeySource: "none" });
  generator.close = async () => {
    closed = true;
    closeQueue();
    killChild();
    try { await generator.return(); } catch {}
  };
  generator.getContextUsage = async () => null;
  generator.getUsage = async () => null;
  generator.mcpServerStatus = async () => [];
  generator.stopTask = async () => {};
  generator.rewindFiles = async () => ({});
  generator.seedReadFile = async () => {};

  if (options.abortController?.signal) {
    options.abortController.signal.addEventListener("abort", () => {
      closed = true;
      killChild();
    });
  }
  return generator;
}

function isZcodeOptions(options) {
  const harness = options?.env?.PI_HARNESS;
  if (harness) return harness === "zcode";
  const model = options?.model;
  return typeof model === "string" && (model === "zcode-default" || model.startsWith("zcode-"));
}

export function query(params) {
  if (isZcodeOptions(params?.options)) return zcodeQuery(params);
  return piQuery(params);
}

function piQuery(params) {
  const prompt = params?.prompt;
  const options = params?.options || {};
  const sessionId = options.sessionId || randomUUID();
  const cwd = typeof options.cwd === "string" ? options.cwd.replace(/^file:\/\//, "") : process.cwd();
  const rpc = new PiRpc(cwd, options.env, options.model, options.effort, options.permissionMode);
  let closedByAbort = false;

  const generator = (async function* () {
    log("query start", { cwd, promptType: typeof prompt, sessionId, model: options.model, effort: options.effort });
    await rpc.start();
    yield systemInitMessage(sessionId, cwd, options);

    let inputDone = false;
    const consumer = (async () => {
      try {
        if (typeof prompt === "string") {
          await rpc.prompt(prompt);
          inputDone = true;
        } else if (prompt && typeof prompt[Symbol.asyncIterator] === "function") {
          for await (const userMessage of prompt) {
            const { text, images } = extractUserText(userMessage);
            if (text || images.length) await rpc.prompt(text, images);
          }
          inputDone = true;
        } else if (prompt != null) {
          await rpc.prompt(String(prompt));
          inputDone = true;
        }
      } catch (err) {
        log("prompt consumer error", err?.message || String(err));
        inputDone = true;
      }
    })();

    let lastAssistantText = "";
    while (!closedByAbort) {
      const event = await rpc.nextEvent();
      if (!event) break;
      switch (event.type) {
        case "message_update": {
          const update = event.assistantMessageEvent;
          if (update?.type === "text_delta" && update.delta) lastAssistantText += update.delta;
          break;
        }
        case "message_end": {
          const message = event.message;
          if (message?.role === "assistant") {
            const blocks = mapAssistantBlocks(message);
            log("assistant blocks", blocks.map((block) => block.type === "tool_use" ? { type: "tool_use", id: block.id, name: block.name, input: block.input } : { type: block.type }));
            const text = textOfBlocks(blocks);
            if (text) lastAssistantText = text;
            if (blocks.length) {
              for (const streamEvent of streamEvents(sessionId, message, blocks)) yield streamEvent;
              yield assistantMessage(sessionId, message, blocks);
            }
          }
          break;
        }
        case "tool_execution_end": {
          log("tool result", { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
          yield toolResultMessage(sessionId, event.toolCallId, event.result, event.isError);
          break;
        }
        case "agent_settled":
        case "agent_end": {
          yield resultMessage(sessionId, lastAssistantText, Boolean(event.aborted));
          lastAssistantText = "";
          if (typeof prompt === "string") {
            inputDone = true;
            await consumer.catch(() => {});
            rpc.close();
            return;
          }
          if (inputDone) {
            rpc.close();
            return;
          }
          break;
        }
        default:
          break;
      }
    }
    await consumer.catch(() => {});
    rpc.close();
    log("query end");
  })();

  generator.interrupt = async () => {
    closedByAbort = true;
    rpc.send({ type: "abort" });
  };
  generator.setPermissionMode = async () => {};
  generator.setMcpPermissionModeOverride = async () => ({});
  generator.setModel = async (model) => {
    try {
      let m = typeof model === "string" ? model : model?.id;
      if (typeof m !== "string" || !m) return;
      if (m.startsWith("omp-")) m = m.slice(4);
      const slash = m.indexOf("/");
      if (slash <= 0) return;
      log("rpc set_model", m);
      await rpc.send({ type: "set_model", provider: m.slice(0, slash), modelId: m.slice(slash + 1) });
    } catch (err) {
      log("set_model failed", err?.message || String(err));
    }
  };
  generator.setMaxThinkingTokens = async () => {};
  generator.setEffort = async (effort) => {
    try {
      if (!effort) return;
      log("rpc set_thinking_level", effort);
      await rpc.send({ type: "set_thinking_level", level: effort });
    } catch (err) {
      log("set_thinking_level failed", err?.message || String(err));
    }
  };
  generator.applyFlagSettings = async () => {};
  generator.reloadPlugins = async () => {};
  generator.setSettings = async () => {};
  generator.supportedCommands = async () => [];
  generator.supportedModels = async () => listHarnessModels(options.env?.PI_HARNESS === "omp" ? "omp" : "pi");
  generator.supportedAgents = async () => [];
  generator.getSettings = async () => ({});
  generator.getAccountInfo = async () => ({ apiProvider: "pi", tokenSource: "pi", apiKeySource: "pi" });
  generator.accountInfo = async () => ({ apiProvider: "pi", tokenSource: "pi", apiKeySource: "pi" });
  generator.close = async () => {
    closedByAbort = true;
    rpc.close();
    try {
      await generator.return();
    } catch {
      // ignore
    }
  };
  generator.getContextUsage = async () => null;
  generator.getUsage = async () => null;
  generator.mcpServerStatus = async () => [];
  generator.stopTask = async () => {};
  generator.rewindFiles = async () => ({});
  generator.seedReadFile = async () => {};

  if (options.abortController?.signal) {
    options.abortController.signal.addEventListener("abort", () => {
      closedByAbort = true;
      rpc.send({ type: "abort" });
    });
  }

  return generator;
}

export function tool(name, description, inputSchema, handler) {
  return { name, description, inputSchema, handler };
}

export function createSdkMcpServer(options) {
  return {
    type: "sdk",
    name: options?.name || "sdk",
    version: options?.version || "1.0.0",
    tools: options?.tools || [],
  };
}

export async function listSessions() {
  return [];
}
export async function getSessionMessages() {
  return [];
}
export async function getSessionInfo() {
  return undefined;
}
export async function renameSession() {}
export async function archiveSession() {}
export async function unarchiveSession() {}
export async function deleteSession() {}
export async function forkSession() {
  return undefined;
}
export async function tagSession() {}
export async function importSessionToStore() {}
export async function listSubagents() {
  return [];
}
export async function getSubagentMessages() {
  return [];
}
export async function startup(params = {}) {
  const options = params?.options || {};
  const active = new Set();
  const warm = {
    query(prompt) {
      const instance = query({ prompt, options });
      active.add(instance);
      return instance;
    },
    accountInfo: async () => ({ apiProvider: "pi", tokenSource: "pi", apiKeySource: "pi" }),
    supportedModels: async () => isZcodeOptions(options) ? zcodeModelCatalog() : listHarnessModels(options.env?.PI_HARNESS === "omp" ? "omp" : "pi"),
    supportedCommands: async () => [],
    supportedAgents: async () => [],
    getSettings: async () => ({}),
    [Symbol.asyncDispose]: async () => {
      for (const instance of active) {
        try {
          await instance.close?.();
        } catch {
          // ignore
        }
      }
      active.clear();
    },
  };
  return warm;
}
export async function prewarm() {}
export async function resolveSettings() {
  return { effective: {}, provenance: {} };
}
export function parseDirectConnectUrl() {
  return undefined;
}
export function filterEscalatingDefaultMode(mode) {
  return mode;
}
export function matchDeniedModels() {
  return [];
}
export async function foldSessionSummary(summary) {
  return summary;
}

export const BUILTIN_TOOL_NAMES = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "Task"];
export const LEGACY_TOOL_NAME_ALIASES = {};
export const HOOK_EVENTS = [];
export const EXIT_REASONS = [];
export const ORG_POLICY_LIMIT_PREFIXES = [];
export const USAGE_LIMIT_ERROR_PREFIXES = [];
export const USAGE_TRANSITION_PREFIXES = [];
export const USAGE_WARNING_PREFIXES = [];
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "SYSTEM_PROMPT_DYNAMIC_BOUNDARY";
export class FileIndex {}
export class InMemorySessionStore {}
export class CommandMatcher {}
export class DirectConnectError extends Error {}
export class DirectConnectTransport {}
