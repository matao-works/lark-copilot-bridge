#!/usr/bin/env node

// src/cli.ts
import { existsSync as existsSync8, accessSync, constants, statSync as statSync2 } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname as dirname5, join as join2 } from "path";

// src/config.ts
import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

// src/logger.ts
var LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
var currentLevel = process.env.LOG_LEVEL || "info";
function ts() {
  return (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").replace("Z", "");
}
function shouldLog(level) {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}
var log = {
  debug(msg, ...args2) {
    if (shouldLog("debug")) console.debug(`[${ts()}] DEBUG ${msg}`, ...args2);
  },
  info(msg, ...args2) {
    if (shouldLog("info")) console.log(`[${ts()}] INFO  ${msg}`, ...args2);
  },
  warn(msg, ...args2) {
    if (shouldLog("warn")) console.warn(`[${ts()}] WARN  ${msg}`, ...args2);
  },
  error(msg, ...args2) {
    if (shouldLog("error")) console.error(`[${ts()}] ERROR ${msg}`, ...args2);
  }
};

// src/config.ts
var CONFIG_DIR = process.env.LARK_COPILOT_BRIDGE_HOME ? resolve(process.env.LARK_COPILOT_BRIDGE_HOME) : resolve(homedir(), ".lark-copilot-bridge");
var CONFIG_FILE = resolve(CONFIG_DIR, "config.json");
var ENV_FILE = resolve(CONFIG_DIR, ".env");
loadEnv({ path: ENV_FILE });
loadEnv();
var persistReadable = true;
function readPersisted() {
  if (!existsSync(CONFIG_FILE)) {
    persistReadable = true;
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    persistReadable = true;
    return parsed;
  } catch (err) {
    persistReadable = false;
    log.error("config.json \u635F\u574F\uFF0C\u62D2\u7EDD\u540E\u7EED\u8986\u76D6\u5199\u5165: %s", err.message);
    return {};
  }
}
function writePersisted(data, opts) {
  if (!persistReadable && existsSync(CONFIG_FILE) && !opts?.allowCorruptOverwrite) {
    throw new Error(`config.json \u5DF2\u635F\u574F\uFF0C\u62D2\u7EDD\u8986\u76D6\u5199\u5165\u3002\u8BF7\u624B\u52A8\u4FEE\u590D ${CONFIG_FILE}`);
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), { mode: 384 });
  persistReadable = true;
}
function loadCredentials() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const parsed = readPersisted();
    if (!parsed.appId || !parsed.appSecret) return null;
    return {
      appId: parsed.appId,
      appSecret: parsed.appSecret,
      tenant: parsed.tenant ?? "feishu",
      creatorOpenId: parsed.creatorOpenId
    };
  } catch (err) {
    log.warn("\u8BFB\u53D6\u51ED\u8BC1\u6587\u4EF6\u5931\u8D25: %s", err.message);
    return null;
  }
}
function saveCredentials(creds) {
  const existing = readPersisted();
  writePersisted({ ...existing, ...creds }, { allowCorruptOverwrite: true });
  log.info("\u51ED\u8BC1\u5DF2\u4FDD\u5B58\u5230 %s", CONFIG_FILE);
}
function clearCredentials() {
  if (!existsSync(CONFIG_FILE)) return false;
  const existing = readPersisted();
  const {
    appId: _a,
    appSecret: _s,
    tenant: _t,
    creatorOpenId: _c,
    ...rest
  } = existing;
  writePersisted(rest, { allowCorruptOverwrite: true });
  return true;
}
function getConfigSummary() {
  const persisted = readPersisted();
  const hasCredentials = Boolean(persisted.appId && persisted.appSecret);
  return {
    configDir: CONFIG_DIR,
    configFile: CONFIG_FILE,
    envFile: ENV_FILE,
    hasCredentials,
    setupCompleted: Boolean(persisted.setupCompleted),
    appId: persisted.appId,
    tenant: persisted.tenant,
    creatorOpenId: persisted.creatorOpenId,
    copilotCwd: resolveAllowedCwdHint(persisted),
    copilotTimeout: Number(process.env.COPILOT_TIMEOUT || persisted.copilotTimeout) || 3e5,
    allowedUsers: resolveAllowedUsers(persisted),
    allowedChats: [...persisted.allowedChats ?? []],
    admins: [...persisted.admins ?? []],
    workspaces: readWorkspacesForSummary(persisted)
  };
}
function readWorkspacesForSummary(persisted) {
  const wsFile = resolve(CONFIG_DIR, "workspaces.json");
  if (existsSync(wsFile)) {
    try {
      const parsed = JSON.parse(readFileSync(wsFile, "utf8"));
      return { ...parsed.workspaces ?? {} };
    } catch {
    }
  }
  return { ...persisted.workspaces ?? {} };
}
function resolveAllowedUsers(persisted) {
  const fromEnv = (process.env.LARK_ALLOWED_USERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return [...persisted.allowedUsers ?? []];
}
function resolveAllowedCwdHint(persisted) {
  return process.env.COPILOT_CWD || persisted.copilotCwd || process.cwd();
}
function isSetupCompleted() {
  return Boolean(readPersisted().setupCompleted);
}
function tryResolveWorkspaceDir() {
  const persisted = readPersisted();
  const raw = process.env.COPILOT_CWD || persisted.copilotCwd;
  if (!raw) return null;
  try {
    return validateWorkspaceDir(raw);
  } catch {
    return null;
  }
}
function saveSetupPreferences(opts) {
  const existing = readPersisted();
  writePersisted({
    ...existing,
    copilotCwd: opts.copilotCwd,
    allowedUsers: [...opts.allowedUsers],
    setupCompleted: opts.setupCompleted ?? true
  }, { allowCorruptOverwrite: true });
}
function loadConfig(credentials) {
  const persisted = readPersisted();
  const allowedUsers = resolveAllowedUsers(persisted);
  const allowedChats = [...persisted.allowedChats ?? []];
  const admins = [...persisted.admins ?? []];
  const cwdRaw = process.env.COPILOT_CWD || persisted.copilotCwd || process.cwd();
  const copilotCwd = validateWorkspaceDir(cwdRaw);
  const config = {
    credentials,
    allowedUsers,
    allowedChats,
    admins,
    copilotCwd,
    copilotExtraArgs: parseArgs(process.env.COPILOT_EXTRA_ARGS || persisted.copilotExtraArgs?.join(" ")),
    copilotTimeout: Number(process.env.COPILOT_TIMEOUT || persisted.copilotTimeout) || 3e5,
    maxHistoryRounds: 10
  };
  log.info("\u914D\u7F6E: cwd=%s timeout=%dms", config.copilotCwd, config.copilotTimeout);
  return config;
}
function parseArgs(s) {
  if (!s) return [];
  return s.trim().split(/\s+/).filter(Boolean);
}
function validateWorkspaceDir(cwd) {
  const abs = resolve(cwd.replace(/^~(?=$|\/|\\)/, homedir()));
  if (!existsSync(abs)) {
    throw new Error(`\u627E\u4E0D\u5230\u8FD9\u4E2A\u6587\u4EF6\u5939\uFF1A${abs}
\u8BF7\u68C0\u67E5\u8DEF\u5F84\u662F\u5426\u590D\u5236\u5B8C\u6574\uFF0C\u6216\u5728\u8BBF\u8FBE\u91CC\u786E\u8BA4\u6587\u4EF6\u5939\u8FD8\u5728\u3002`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new Error(`\u8FD9\u4E0D\u662F\u6587\u4EF6\u5939\uFF1A${abs}
\u8BF7\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6\u5939\uFF0C\u800C\u4E0D\u662F\u67D0\u4E2A\u6587\u4EF6\u3002`);
  }
  if (abs === "/") {
    throw new Error("\u4E0D\u80FD\u9009\u62E9\u6574\u4E2A\u7535\u8111\uFF08/\uFF09\u3002\u8BF7\u9009\u4E00\u4E2A\u5177\u4F53\u7684\u9879\u76EE\u6587\u4EF6\u5939\u3002");
  }
  if (abs === homedir()) {
    throw new Error(
      `\u4E0D\u80FD\u9009\u62E9\u6574\u4E2A\u7528\u6237\u4E3B\u76EE\u5F55\uFF08${abs}\uFF09\u3002
\u8BF7\u9009\u91CC\u9762\u7684\u67D0\u4E2A\u9879\u76EE\u6587\u4EF6\u5939\uFF0C\u4F8B\u5982\u684C\u9762\u4E0A\u7684\u5DE5\u7A0B\u76EE\u5F55\u3002`
    );
  }
  return abs;
}
function saveCopilotConfig(patch) {
  if (!existsSync(CONFIG_FILE)) return;
  try {
    const existing = readPersisted();
    writePersisted({
      ...existing,
      ...patch.copilotCwd !== void 0 ? { copilotCwd: patch.copilotCwd } : {},
      ...patch.copilotExtraArgs !== void 0 ? { copilotExtraArgs: patch.copilotExtraArgs } : {},
      ...patch.copilotTimeout !== void 0 ? { copilotTimeout: patch.copilotTimeout } : {}
    });
  } catch (err) {
    log.warn("\u4FDD\u5B58 copilot \u914D\u7F6E\u5931\u8D25: %s", err.message);
  }
}
function addAllowedChat(config, chatId) {
  if (config.allowedChats.includes(chatId)) return false;
  config.allowedChats.push(chatId);
  try {
    const existing = readPersisted();
    writePersisted({ ...existing, allowedChats: [...config.allowedChats] });
  } catch (err) {
    config.allowedChats = config.allowedChats.filter((c) => c !== chatId);
    throw err;
  }
  return true;
}
function removeAllowedChat(config, chatId) {
  if (!config.allowedChats.includes(chatId)) return false;
  const prev = config.allowedChats;
  config.allowedChats = config.allowedChats.filter((c) => c !== chatId);
  try {
    const existing = readPersisted();
    writePersisted({ ...existing, allowedChats: [...config.allowedChats] });
  } catch (err) {
    config.allowedChats = prev;
    throw err;
  }
  return true;
}
function addAdmin(config, openId) {
  if (config.admins.includes(openId)) return false;
  config.admins.push(openId);
  try {
    const existing = readPersisted();
    writePersisted({ ...existing, admins: [...config.admins] });
  } catch (err) {
    config.admins = config.admins.filter((a) => a !== openId);
    throw err;
  }
  return true;
}
function removeAdmin(config, openId) {
  if (!config.admins.includes(openId)) return false;
  const prev = config.admins;
  config.admins = config.admins.filter((a) => a !== openId);
  try {
    const existing = readPersisted();
    writePersisted({ ...existing, admins: [...config.admins] });
  } catch (err) {
    config.admins = prev;
    throw err;
  }
  return true;
}

// src/copilot/adapter.ts
import { spawn } from "child_process";

// src/copilot/jsonl.ts
function translateCopilotJsonlLine(raw) {
  const line = raw.trim();
  if (!line) return [];
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    log.debug("jsonl \u975E JSON\uFF0C\u5FFD\u7565: %s", line.slice(0, 80));
    return [];
  }
  const type = obj.type ?? "";
  const data = obj.data ?? {};
  switch (type) {
    case "session.start": {
      const sessionId = typeof data.sessionId === "string" ? data.sessionId : void 0;
      return sessionId ? [{ type: "system", sessionId }] : [];
    }
    case "assistant.message_delta": {
      const delta = typeof data.delta === "string" && data.delta || typeof data.content === "string" && data.content || "";
      return delta ? [{ type: "text", delta }] : [];
    }
    case "assistant.thinking_delta":
    case "assistant.reasoning_delta": {
      const delta = typeof data.delta === "string" && data.delta || typeof data.content === "string" && data.content || "";
      return delta ? [{ type: "thinking", delta }] : [];
    }
    case "assistant.message": {
      const content = typeof data.content === "string" ? data.content : "";
      if (!content.trim()) return [];
      const phase = typeof data.phase === "string" ? data.phase : "";
      if (phase === "final_answer") {
        return [
          { type: "text_replace", content },
          { type: "final_text", content }
        ];
      }
      return [{ type: "text_replace", content }];
    }
    case "tool.execution_start": {
      const id = typeof data.toolCallId === "string" && data.toolCallId || typeof obj.id === "string" && obj.id || "";
      if (!id) return [];
      const name = typeof data.toolName === "string" && data.toolName || typeof data.mcpToolName === "string" && data.mcpToolName || "tool";
      const input2 = data.arguments ?? {};
      return [{ type: "tool_use", id, name, input: input2 }];
    }
    case "tool.execution_complete": {
      const id = typeof data.toolCallId === "string" && data.toolCallId || typeof obj.id === "string" && obj.id || "";
      if (!id) return [];
      const success = data.success !== false;
      const output2 = extractToolOutput(data.result);
      return [{ type: "tool_result", id, output: output2, isError: !success }];
    }
    case "permission.requested": {
      return [{ type: "awaiting_permission", active: true }];
    }
    case "permission.completed": {
      return [{ type: "awaiting_permission", active: false }];
    }
    default:
      return [];
  }
}
function extractToolOutput(result) {
  if (result == null) return "";
  if (typeof result === "string") {
    return unwrapOutputTextJson(result);
  }
  if (typeof result !== "object") return String(result);
  const rec = result;
  if (typeof rec.content === "string") {
    return unwrapOutputTextJson(rec.content);
  }
  if (typeof rec.detailedContent === "string") {
    return unwrapOutputTextJson(rec.detailedContent);
  }
  if (typeof rec.text === "string") return rec.text;
  try {
    return JSON.stringify(result, null, 0).slice(0, 4e3);
  } catch {
    return "";
  }
}
function unwrapOutputTextJson(s) {
  const trimmed = s.trim();
  if (!trimmed.startsWith("{")) return s;
  try {
    const o = JSON.parse(trimmed);
    if (o.type === "output_text") {
      if (typeof o.text === "string") return o.text;
      if (o.text && typeof o.text.value === "string") return o.text.value;
    }
  } catch {
  }
  return s;
}
var JsonlLineBuffer = class {
  buf = "";
  push(chunk) {
    this.buf += chunk;
    const events = [];
    for (; ; ) {
      const nl = this.buf.indexOf("\n");
      if (nl < 0) break;
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      events.push(...translateCopilotJsonlLine(line));
    }
    return events;
  }
  /** 进程结束时冲刷最后一行（无换行） */
  flush() {
    if (!this.buf.trim()) {
      this.buf = "";
      return [];
    }
    const line = this.buf;
    this.buf = "";
    return translateCopilotJsonlLine(line);
  }
};

// src/copilot/adapter.ts
var SESSION_ID_RE = /--resume=([a-zA-Z0-9-]+)/;
var cachedJsonSupport = null;
async function supportsCopilotJsonOutput() {
  if (cachedJsonSupport !== null) return cachedJsonSupport;
  let supported = false;
  supported = await new Promise((resolve6) => {
    const child = spawn("copilot", ["--help"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve6(result);
    };
    child.stdout?.on("data", (c) => {
      out += c.toString("utf8");
    });
    child.stderr?.on("data", (c) => {
      out += c.toString("utf8");
    });
    child.on("error", () => finish(false));
    child.on("close", () => {
      finish(/--output-format/.test(out) && /\bjson\b/i.test(out));
    });
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      finish(false);
    }, 5e3);
  });
  cachedJsonSupport = supported;
  return supported;
}
function resolveOutputMode(opts, jsonOk) {
  const fromExtra = detectFormatInArgs(opts.extraArgs);
  if (fromExtra) return fromExtra;
  if (opts.outputMode) return opts.outputMode;
  return jsonOk ? "json" : "text";
}
function detectFormatInArgs(args2) {
  for (let i = 0; i < args2.length; i++) {
    const a = args2[i] ?? "";
    if (a === "--output-format" && args2[i + 1]) {
      const v = (args2[i + 1] ?? "").toLowerCase();
      if (v === "json" || v === "text") return v;
    }
    const m = a.match(/^--output-format=(json|text)$/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}
function stripOutputFormatArgs(args2) {
  const out = [];
  for (let i = 0; i < args2.length; i++) {
    const a = args2[i] ?? "";
    if (a === "--output-format") {
      const next = args2[i + 1];
      if (next !== void 0 && !next.startsWith("-")) i++;
      continue;
    }
    if (/^--output-format=/.test(a)) continue;
    if (a === "-s" || a === "--silent") continue;
    if (a === "--attachment" || a === "--add-dir") {
      const next = args2[i + 1];
      if (next !== void 0 && !next.startsWith("-")) i++;
      continue;
    }
    if (/^--attachment=/.test(a) || /^--add-dir=/.test(a)) continue;
    out.push(a);
  }
  return out;
}
async function runCopilot(opts) {
  const jsonOk = await supportsCopilotJsonOutput();
  const mode = resolveOutputMode(opts, jsonOk);
  if (mode === "json" && !jsonOk) {
    log.warn("\u8BF7\u6C42 json \u8F93\u51FA\u4F46 CLI \u4E0D\u652F\u6301\uFF0C\u964D\u7EA7\u4E3A text");
  }
  const effective = mode === "json" && jsonOk ? "json" : "text";
  return runCopilotWithMode(opts, effective);
}
function runCopilotWithMode(opts, mode) {
  return new Promise((resolve6) => {
    const extra = stripOutputFormatArgs(opts.extraArgs);
    const args2 = ["-p", opts.prompt, "--no-ask-user"];
    if (mode === "json") {
      args2.push("--output-format", "json");
    } else {
      args2.push("-s");
    }
    if (opts.sessionId) {
      args2.push(`--resume=${opts.sessionId}`);
      log.debug("copilot resume session: %s", opts.sessionId);
    }
    for (const p of opts.attachments ?? []) {
      if (p) args2.push("--attachment", p);
    }
    for (const d of opts.addDirs ?? []) {
      if (d) args2.push("--add-dir", d);
    }
    args2.push(...extra);
    const child = spawn("copilot", args2, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let rawStdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let wallTimer = null;
    let killTimer = null;
    let sessionId;
    let onAbort;
    let answer = "";
    let emittedDone = false;
    const jsonBuf = new JsonlLineBuffer();
    let chunkBuffer = "";
    let chunkTimer = null;
    const emit = (evt) => {
      if (evt.type === "system" && evt.sessionId) sessionId = evt.sessionId;
      if (evt.type === "text") answer += evt.delta;
      if (evt.type === "text_replace") answer = evt.content;
      if (evt.type === "final_text") answer = evt.content;
      if (evt.type === "done" || evt.type === "error") emittedDone = true;
      opts.onEvent?.(evt);
    };
    const tryExtractSessionId = (text) => {
      if (sessionId) return;
      const m = text.match(SESSION_ID_RE);
      if (m) sessionId = m[1];
    };
    const flushTextChunk = () => {
      if (chunkTimer) {
        clearTimeout(chunkTimer);
        chunkTimer = null;
      }
      if (!chunkBuffer) return;
      const piece = stripAnsi(chunkBuffer);
      chunkBuffer = "";
      opts.onChunk?.(piece);
      emit({ type: "text", delta: piece });
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (wallTimer) clearTimeout(wallTimer);
      if (killTimer) clearTimeout(killTimer);
      if (mode === "text") flushTextChunk();
      else {
        for (const evt of jsonBuf.flush()) emit(evt);
      }
      if (!emittedDone) {
        if (aborted) emit({ type: "done", terminationReason: "interrupted" });
        else if (timedOut) {
          emittedDone = true;
        } else if ((result.exitCode ?? 0) !== 0) {
          emit({
            type: "error",
            message: (stderr || `\u9000\u51FA\u7801 ${result.exitCode}`).slice(0, 1500),
            terminationReason: "error"
          });
        } else {
          emit({ type: "done", terminationReason: "completed" });
        }
      }
      if (onAbort && opts.abortSignal) {
        opts.abortSignal.removeEventListener("abort", onAbort);
      }
      const finalAnswer = mode === "json" ? answer : stripAnsi(answer || rawStdout);
      resolve6({
        exitCode: result.exitCode ?? -1,
        stdout: finalAnswer,
        stderr: stderr.trim(),
        aborted,
        timedOut,
        sessionId,
        outputMode: mode
      });
    };
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      rawStdout += text;
      tryExtractSessionId(text);
      if (mode === "json") {
        for (const evt of jsonBuf.push(text)) emit(evt);
      } else if (opts.onChunk || opts.onEvent) {
        chunkBuffer += text;
        if (chunkBuffer.length >= 40) flushTextChunk();
        else if (!chunkTimer) chunkTimer = setTimeout(flushTextChunk, 120);
      }
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      tryExtractSessionId(text);
    });
    child.on("error", (err) => {
      log.error("spawn copilot \u5931\u8D25: %s", err.message);
      stderr += `
[spawn error] ${err.message}`;
      finish({ exitCode: -1 });
    });
    child.on("close", (code2) => {
      log.debug("copilot \u9000\u51FA: code=%s mode=%s session=%s", code2, mode, sessionId ?? "(\u672A\u63D0\u53D6\u5230)");
      finish({ exitCode: code2 ?? -1 });
    });
    const setKillTimer = (t) => {
      if (killTimer) clearTimeout(killTimer);
      killTimer = t;
    };
    if (opts.timeoutMs > 0) {
      wallTimer = setTimeout(() => {
        timedOut = true;
        log.warn("copilot \u8D85\u65F6(%dms)\uFF0C\u7EC8\u6B62", opts.timeoutMs);
        killGracefully(child, setKillTimer);
      }, opts.timeoutMs);
    }
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        aborted = true;
        killGracefully(child, setKillTimer);
      } else {
        onAbort = () => {
          if (opts.abortSignal?.aborted && !settled) {
            aborted = true;
            log.info("\u4E2D\u65AD copilot \u8FDB\u7A0B");
            killGracefully(child, setKillTimer);
          }
        };
        opts.abortSignal.addEventListener("abort", onAbort);
      }
    }
  });
}
function killGracefully(child, track) {
  try {
    child.kill("SIGTERM");
  } catch {
  }
  track(setTimeout(() => {
    try {
      if (!child.killed) child.kill("SIGKILL");
    } catch {
    }
  }, 3e3));
}
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
async function checkCopilotInstalled() {
  const info = await getCopilotVersion();
  return info.ok;
}
async function getCopilotVersion() {
  return new Promise((resolve6) => {
    const child = spawn("copilot", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve6(result);
    };
    child.stdout?.on("data", (c) => {
      stdout += c.toString("utf8");
    });
    child.stderr?.on("data", (c) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (err) => finish({ ok: false, error: err.message }));
    child.on("close", (code2) => {
      if (code2 === 0) {
        const version = stripAnsi((stdout || stderr).trim().split("\n")[0] ?? "").trim();
        finish({ ok: true, version: version || "unknown" });
      } else {
        finish({ ok: false, error: (stderr || stdout || `exit ${code2}`).trim().slice(0, 200) });
      }
    });
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      finish({ ok: false, error: "\u63A2\u6D4B\u8D85\u65F6\uFF085s\uFF09" });
    }, 5e3);
  });
}

// src/setup.ts
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { homedir as homedir2 } from "os";
import { resolve as resolve2 } from "path";
function expandPath(raw) {
  return resolve2(raw.trim().replace(/^~(?=$|\/|\\)/, homedir2()));
}
async function ask(rl, question) {
  const answer = await rl.question(question);
  return answer.trim();
}
function shouldRunSetup(opts) {
  if (opts?.force) return true;
  if (!isSetupCompleted()) return true;
  return tryResolveWorkspaceDir() === null;
}
async function runSetupWizard(creds, opts) {
  if (!input.isTTY || !output.isTTY) {
    return null;
  }
  const rl = readline.createInterface({ input, output });
  try {
    console.log("");
    console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    console.log("  \u6B22\u8FCE\u4F7F\u7528\u98DE\u4E66 \xD7 Copilot \u6865\u63A5");
    console.log("  \u63A5\u4E0B\u6765\u53EA\u9700\u56DE\u7B54\u4E24\u4E2A\u95EE\u9898\uFF08\u53EF\u968F\u65F6\u6539\uFF09");
    console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    console.log("");
    const cwd = await askWorkspace(rl);
    const allowedUsers = await askWhoCanUse(rl, creds);
    saveSetupPreferences({
      copilotCwd: cwd,
      allowedUsers,
      setupCompleted: true
    });
    console.log("");
    console.log("\u2713 \u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
    console.log(`  \u5DE5\u4F5C\u6587\u4EF6\u5939: ${cwd}`);
    if (allowedUsers.length === 0) {
      console.log("  \u8C01\u80FD\u7528:     \u4E0D\u9650\u5236\uFF08\u8BF7\u6CE8\u610F\u5B89\u5168\uFF09");
    } else if (creds.creatorOpenId && allowedUsers.length === 1 && allowedUsers[0] === creds.creatorOpenId) {
      console.log("  \u8C01\u80FD\u7528:     \u4EC5\u4F60\u81EA\u5DF1");
    } else {
      console.log(`  \u8C01\u80FD\u7528:     \u5DF2\u9650\u5236 ${allowedUsers.length} \u4EBA`);
    }
    console.log("");
    console.log("\u4EE5\u540E\u60F3\u91CD\u65B0\u8BBE\u7F6E\uFF0C\u5728\u7EC8\u7AEF\u8FD0\u884C\uFF1A");
    console.log("  lark-copilot-bridge setup");
    console.log("");
    return { copilotCwd: cwd, allowedUsers };
  } finally {
    rl.close();
  }
}
async function askWorkspace(rl) {
  console.log("\u30101/2\u3011Copilot \u53EF\u4EE5\u6539\u54EA\u4E9B\u6587\u4EF6\uFF1F");
  console.log("  \u8BF7\u6307\u5B9A\u4E00\u4E2A\u300C\u9879\u76EE\u6587\u4EF6\u5939\u300D\u8DEF\u5F84\u3002");
  console.log("  \u673A\u5668\u4EBA\u53EA\u4F1A\u5728\u8FD9\u4E2A\u6587\u4EF6\u5939\u91CC\u8BFB\u6587\u4EF6\u3001\u6539\u4EE3\u7801\u3002");
  console.log("");
  console.log("  \u600E\u4E48\u627E\u8DEF\u5F84\uFF08Mac\uFF09\uFF1A");
  console.log("    \xB7 \u6253\u5F00\u300C\u8BBF\u8FBE\u300D\u2192 \u8FDB\u5165\u4F60\u7684\u9879\u76EE\u6587\u4EF6\u5939");
  console.log("    \xB7 \u53F3\u952E\u6587\u4EF6\u5939\u6807\u9898\u680F\uFF08\u6216\u6309\u4F4F Option \u70B9\u8DEF\u5F84\uFF09\u590D\u5236\u8DEF\u5F84");
  console.log("    \xB7 \u6216\u5728\u7EC8\u7AEF\u62D6\u6587\u4EF6\u5939\u8FDB\u6765\uFF0C\u8DEF\u5F84\u4F1A\u81EA\u52A8\u51FA\u73B0");
  console.log("");
  console.log(`  \u793A\u4F8B: ~/Desktop/my-project`);
  console.log(`        ${homedir2()}/Documents/work`);
  console.log("");
  const existing = tryResolveWorkspaceDir();
  if (existing) {
    console.log(`  \u5F53\u524D\u5DF2\u4FDD\u5B58: ${existing}`);
    console.log("  \u76F4\u63A5\u56DE\u8F66 = \u7EE7\u7EED\u7528\u8FD9\u4E2A\uFF1B\u6216\u8F93\u5165\u65B0\u8DEF\u5F84\u3002");
  }
  for (; ; ) {
    const hint = existing ? `\u5DE5\u4F5C\u6587\u4EF6\u5939 [${existing}]: ` : "\u5DE5\u4F5C\u6587\u4EF6\u5939\u8DEF\u5F84: ";
    const raw = await ask(rl, hint);
    const candidate = raw ? expandPath(raw) : existing;
    if (!candidate) {
      console.log("  \u8BF7\u8F93\u5165\u4E00\u4E2A\u6587\u4EF6\u5939\u8DEF\u5F84\u3002\n");
      continue;
    }
    try {
      const abs = validateWorkspaceDir(candidate);
      console.log(`  \u2713 \u597D\u7684\uFF0C\u5C06\u4F7F\u7528: ${abs}
`);
      return abs;
    } catch (err) {
      console.log(`  \u2717 ${err.message}`);
      console.log("  \u8BF7\u6362\u4E00\u4E2A\u300C\u5177\u4F53\u7684\u9879\u76EE\u6587\u4EF6\u5939\u300D\uFF0C\u4E0D\u80FD\u662F\u6574\u4E2A\u7528\u6237\u4E3B\u76EE\u5F55\u3002\n");
    }
  }
}
async function askWhoCanUse(rl, creds) {
  console.log("\u30102/2\u3011\u8C01\u53EF\u4EE5\u5728\u98DE\u4E66\u91CC\u4F7F\u7528\u8FD9\u4E2A\u673A\u5668\u4EBA\uFF1F");
  console.log("  \u673A\u5668\u4EBA\u8FDE\u7684\u662F\u4F60\u8FD9\u53F0\u7535\u8111\u4E0A\u7684 Copilot\uFF0C\u76F8\u5F53\u4E8E\u8FDC\u7A0B\u6307\u6325\u4F60\u7684\u7535\u8111\u5199\u4EE3\u7801\u3002");
  console.log("");
  console.log("  1) \u4EC5\u6211\u81EA\u5DF1\uFF08\u63A8\u8350\uFF09");
  console.log("  2) \u6682\u4E0D\u9650\u5236 \u2014 \u4EFB\u4F55\u80FD\u627E\u5230\u673A\u5668\u4EBA\u7684\u4EBA\u90FD\u80FD\u7528\uFF08\u6709\u98CE\u9669\uFF09");
  console.log("");
  for (; ; ) {
    const choice = await ask(rl, "\u8BF7\u9009\u62E9 1 \u6216 2 [1]: ");
    const c = choice || "1";
    if (c === "1") {
      if (creds.creatorOpenId) {
        console.log("  \u2713 \u5DF2\u9650\u5236\u4E3A\u4EC5\u626B\u7801\u521B\u5EFA\u7684\u8D26\u53F7\u53EF\u7528\n");
        return [creds.creatorOpenId];
      }
      console.log("  \u26A0 \u6CA1\u80FD\u81EA\u52A8\u8BC6\u522B\u4F60\u7684\u98DE\u4E66\u8D26\u53F7\u3002");
      console.log("  \u542F\u52A8\u540E\u8BF7\u5148\u79C1\u804A\u673A\u5668\u4EBA\u53D1 /whoami\uFF0C\u518D\u8FD0\u884C:");
      console.log("    lark-copilot-bridge setup");
      console.log("  \u6682\u65F6\u5148\u4E0D\u9650\u5236\uFF0C\u8BF7\u52FF\u628A\u673A\u5668\u4EBA\u62C9\u8FDB\u964C\u751F\u4EBA\u7FA4\u3002\n");
      return [];
    }
    if (c === "2") {
      console.log("  \u26A0 \u5DF2\u9009\u62E9\u4E0D\u9650\u5236\u3002\u8BF7\u4E0D\u8981\u5206\u4EAB\u673A\u5668\u4EBA\uFF0C\u4E5F\u4E0D\u8981\u62C9\u8FDB\u516C\u5F00\u7FA4\u3002\n");
      return [];
    }
    console.log("  \u8BF7\u8F93\u5165 1 \u6216 2\u3002\n");
  }
}
function printSetupRequiredHint() {
  console.error("");
  console.error("\u8FD8\u9700\u8981\u5B8C\u6210\u4E00\u6B21\u7B80\u5355\u8BBE\u7F6E\uFF08\u6307\u5B9A\u9879\u76EE\u6587\u4EF6\u5939\uFF09\u3002");
  console.error("\u8BF7\u5728\u300C\u666E\u901A\u7EC8\u7AEF\u7A97\u53E3\u300D\u91CC\u8FD0\u884C\uFF1A");
  console.error("  lark-copilot-bridge setup");
  console.error("");
  console.error("\u6216\u624B\u52A8\u6307\u5B9A\u6587\u4EF6\u5939\u540E\u518D\u542F\u52A8\uFF1A");
  console.error("  COPILOT_CWD=~/\u4F60\u7684\u9879\u76EE\u6587\u4EF6\u5939 lark-copilot-bridge");
  console.error("");
}

// src/lark/client.ts
import {
  createLarkChannel,
  registerApp
} from "@larksuite/channel";
import qrcode from "qrcode-terminal";
async function registerAppByQR() {
  console.log("\n\u672A\u68C0\u6D4B\u5230\u98DE\u4E66\u5E94\u7528\u914D\u7F6E\uFF0C\u8FDB\u5165\u626B\u7801\u521B\u5EFA\u5411\u5BFC\u3002\n");
  const result = await registerApp({
    source: "lark-copilot-bridge",
    onQRCodeReady: (info) => {
      console.log("\u8BF7\u7528\u98DE\u4E66 App \u626B\u63CF\u4EE5\u4E0B\u4E8C\u7EF4\u7801\u5B8C\u6210\u5E94\u7528\u521B\u5EFA\uFF1A\n");
      qrcode.generate(info.url, { small: true });
      const mins = Math.max(1, Math.round(info.expireIn / 60));
      console.log(`
\u4E8C\u7EF4\u7801\u6709\u6548\u671F\uFF1A\u7EA6 ${mins} \u5206\u949F`);
      console.log(`\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5728\u6D4F\u89C8\u5668\u6253\u5F00\uFF1A${info.url}
`);
    },
    onStatusChange: (info) => {
      if (info.status === "domain_switched") {
        console.log("\u8BC6\u522B\u5230\u56FD\u9645\u7248\u79DF\u6237\uFF0C\u5DF2\u5207\u6362\u5230 larksuite.com \u57DF\u540D\u3002");
      } else if (info.status === "slow_down") {
        console.log("\u8F6E\u8BE2\u901F\u5EA6\u8FC7\u5FEB\uFF0C\u5DF2\u81EA\u52A8\u964D\u901F\u3002");
      }
    }
  });
  const tenant = result.user_info?.tenant_brand === "lark" ? "lark" : "feishu";
  const creatorOpenId = result.user_info?.open_id;
  console.log("\n\u2713 \u5E94\u7528\u521B\u5EFA\u6210\u529F");
  console.log(`  App ID:  ${result.client_id}`);
  console.log(`  Tenant:  ${tenant}`);
  if (creatorOpenId) {
    console.log(`  Creator: ${creatorOpenId} (\u5E94\u7528 owner\uFF0C\u81EA\u52A8\u8C41\u514D\u8BBF\u95EE\u63A7\u5236)`);
  }
  console.log("");
  return {
    appId: result.client_id,
    appSecret: result.client_secret,
    tenant,
    creatorOpenId
  };
}
var LarkBridge = class {
  constructor(creds) {
    this.creds = creds;
    this.channel = createLarkChannel({
      appId: creds.appId,
      appSecret: creds.appSecret,
      domain: creds.tenant === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn",
      source: "lark-copilot-bridge",
      // 群聊需要 @bot 才响应；私聊全响应
      policy: { dmMode: "open", requireMention: false, respondToMentionAll: false },
      // 关掉 SDK 自带队列，我们自己用 MessageQueue 串行
      safety: { chatQueue: { enabled: false } },
      includeRawEvent: true,
      outbound: { streamThrottleMs: 400 },
      wsConfig: { pingTimeout: 3 },
      handshakeTimeoutMs: 8e3,
      httpTimeoutMs: 3e4,
      respectProxyEnv: true
    });
  }
  creds;
  channel;
  /**
   * 连接并注册消息处理器 + 卡片按钮回调。
   * onCardAction: 用户点卡片按钮时触发（如"停止"按钮），evt.action.value 里带 cmd 和 scope。
   */
  connect(onMessage, onCardAction, onComment) {
    let consecutiveReconnects = 0;
    this.channel.on({
      message: async (msg) => {
        if (msg.senderIsBot) return;
        await onMessage(msg);
      },
      cardAction: async (evt) => {
        try {
          await onCardAction?.(evt);
        } catch (err) {
          log.error("cardAction \u5904\u7406\u5931\u8D25: %s", err.message);
        }
      },
      comment: async (evt) => {
        try {
          await onComment?.(evt);
        } catch (err) {
          log.error("comment \u5904\u7406\u5931\u8D25: %s", err.message);
        }
      },
      reconnecting: () => {
        consecutiveReconnects++;
        log.warn("\u98DE\u4E66\u901A\u9053\u91CD\u8FDE\u4E2D (%d)...", consecutiveReconnects);
      },
      reconnected: () => {
        consecutiveReconnects = 0;
        log.info("\u98DE\u4E66\u901A\u9053\u5DF2\u91CD\u8FDE");
      },
      error: (err) => {
        log.error("\u98DE\u4E66\u901A\u9053\u9519\u8BEF: %s", err?.message ?? err);
      }
    });
    return this.channel.connect();
  }
  /** 连接状态（keepalive 用） */
  getConnectionStatus() {
    return this.channel.getConnectionStatus?.();
  }
  /** 机器人身份（openId + name） */
  get botIdentity() {
    const id = this.channel.botIdentity;
    return id ? { openId: id.openId, name: id.name } : void 0;
  }
  /** 发送纯文本消息 */
  async sendText(chatId, text, opts) {
    const result = await this.channel.send(chatId, { text }, opts);
    return result.messageId;
  }
  /** 拉取被引用消息的文本内容（引用回复用） */
  async fetchQuotedText(messageId) {
    try {
      const msg = await this.channel.fetchMessage(messageId);
      return msg?.content;
    } catch (err) {
      log.warn("\u62C9\u53D6\u5F15\u7528\u6D88\u606F\u5931\u8D25: %s", err.message);
      return void 0;
    }
  }
  /** 拉取话题上游消息（首次进入话题时给 copilot 上下文） */
  async fetchTopicMessages(threadId, maxMessages = 20) {
    try {
      const res = await this.channel.rawClient.im.v1.message.list({
        params: {
          container_id_type: "thread",
          container_id: threadId,
          sort_type: "ByCreateTimeAsc",
          page_size: 50
        }
      });
      const items = res?.data?.items ?? res?.data?.messages ?? [];
      return items.slice(0, maxMessages).map((it) => ({
        senderName: it.sender?.id ?? "?",
        content: parseTopicBodyContent(it.body?.content)
      }));
    } catch (err) {
      log.warn("\u62C9\u53D6\u8BDD\u9898\u4E0A\u6E38\u5931\u8D25: %s", err.message);
      return [];
    }
  }
  /** 暴露 rawClient（评论 API 用） */
  get rawClient() {
    return this.channel.rawClient;
  }
  /** 拉取评论内容（含 quote + replies） */
  async fetchComment(fileToken, fileType, commentId) {
    try {
      return await this.channel.comments.fetch({ fileToken, fileType }, commentId);
    } catch (err) {
      log.warn("\u62C9\u53D6\u8BC4\u8BBA\u5931\u8D25: %s", err.message);
      return null;
    }
  }
  /** 回复评论 */
  async replyComment(fileToken, fileType, commentId, text, isWhole = false) {
    try {
      await this.channel.comments.reply({ fileToken, fileType }, commentId, text, { topLevel: isWhole });
    } catch (err) {
      log.warn("\u56DE\u590D\u8BC4\u8BBA\u5931\u8D25: %s", err.message);
    }
  }
  /** 发送一张静态卡片（帮助/状态等） */
  async sendCard(chatId, card, opts) {
    const result = await this.channel.send(chatId, { card }, opts);
    return result.messageId;
  }
  /** keepalive 用：断开并重连 WS */
  async reconnect() {
    const ch = this.channel;
    if (typeof ch.forceReconnect === "function") {
      await ch.forceReconnect();
      return;
    }
    try {
      await ch.disconnect?.();
    } catch {
    }
    await ch.connect();
  }
  /** 撤回消息（空流式回复时用） */
  async recallMessage(messageId) {
    await this.channel.recallMessage(messageId);
  }
  /**
   * 流式卡片回复：先发 initialCard，然后 producer 里用 ctrl.update 增量更新。
   * 返回 stream 消息 id，供空回复撤回。
   */
  async streamCard(chatId, initialCard, producer, opts) {
    const result = await this.channel.stream(chatId, {
      card: {
        initial: initialCard,
        producer: async (ctrl) => {
          const anyCtrl = ctrl;
          const doUpdate = typeof anyCtrl.update === "function" ? (next) => anyCtrl.update(next) : typeof anyCtrl.impl?.update === "function" ? (next) => anyCtrl.impl.update(next) : null;
          if (!doUpdate) {
            throw new Error("CardStreamController.update \u4E0D\u53EF\u7528");
          }
          await producer(doUpdate);
        }
      }
    }, opts);
    return result?.messageId;
  }
  /** 下载消息内附件到本地文件（避免整文件进内存） */
  async downloadResourceToFile(messageId, fileKey, type, destPath) {
    return this.channel.downloadResourceToFile(messageId, fileKey, type, destPath);
  }
  /** 断开连接 */
  async disconnect() {
    await this.channel.disconnect?.();
  }
};
function parseTopicBodyContent(raw) {
  if (raw == null) return "";
  const s = typeof raw === "string" ? raw : String(raw);
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch {
  }
  return s;
}
function extractText(msg) {
  let text = msg.content || "";
  const mentions = msg.mentions || [];
  for (const m of mentions) {
    if (m.key) {
      const replacement = m.isBot ? "" : `@${m.name || m.openId || ""} `;
      text = text.split(m.key).join(replacement);
    }
  }
  return text.replace(/\s+/g, " ").trim();
}
function isMentionedBot(msg) {
  return msg.mentionedBot === true;
}
function scopeOf(msg) {
  return msg.threadId ? `${msg.chatId}:${msg.threadId}` : msg.chatId;
}

// src/daemon/service-cli.ts
import { existsSync as existsSync7 } from "fs";

// src/daemon/launchd.ts
import { spawnSync } from "child_process";
import { existsSync as existsSync3 } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { userInfo } from "os";
import { dirname } from "path";

// src/daemon/paths.ts
import { homedir as homedir3 } from "os";
import { join, resolve as resolve3 } from "path";
import { existsSync as existsSync2 } from "fs";
var SERVICE_NAME = "lark-copilot-bridge.bot";
var LAUNCH_AGENT_LABEL = `ai.${SERVICE_NAME}`;
var SYSTEMD_UNIT_NAME = `${SERVICE_NAME}.service`;
var WINDOWS_TASK_NAME = "LarkCopilotBridge.Bot";
function launchAgentPlistPath() {
  return join(homedir3(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}
function systemdUnitPath() {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir3(), ".config");
  return join(base, "systemd", "user", SYSTEMD_UNIT_NAME);
}
function windowsLauncherCmdPath() {
  return join(CONFIG_DIR, "daemon-launcher.cmd");
}
function daemonLogDir() {
  return join(CONFIG_DIR, "logs");
}
function daemonStdoutPath() {
  return join(daemonLogDir(), "daemon-stdout.log");
}
function daemonStderrPath() {
  return join(daemonLogDir(), "daemon-stderr.log");
}
function processesFile() {
  return join(CONFIG_DIR, "processes.json");
}
function mediaDir() {
  return join(CONFIG_DIR, "media");
}
function bridgeRunArgs() {
  const raw = process.argv[1];
  if (!raw) {
    throw new Error("cannot determine bridge entry path (process.argv[1] is empty)");
  }
  const bridgeEntryPath = resolve3(raw);
  if (!existsSync2(bridgeEntryPath)) {
    throw new Error(`bridge entry path does not exist: ${bridgeEntryPath}`);
  }
  return { nodePath: process.execPath, bridgeEntryPath };
}
function looksLikeNpxCachePath(entryPath) {
  return /[/\\]_npx[/\\]/.test(entryPath) || /[/\\]\.npm[/\\]_npx[/\\]/.test(entryPath);
}

// src/daemon/launchd.ts
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildPlist(inputs) {
  const wd = inputs.workingDirectory ?? inputs.channelHome;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(inputs.nodePath)}</string>
        <string>${escapeXml(inputs.bridgeEntryPath)}</string>
        <string>run</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(wd)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(daemonStdoutPath())}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(daemonStderrPath())}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${escapeXml(inputs.envPath)}</string>
        <key>LARK_COPILOT_BRIDGE_HOME</key>
        <string>${escapeXml(inputs.channelHome)}</string>
    </dict>
</dict>
</plist>
`;
}
async function writePlist() {
  const { nodePath, bridgeEntryPath } = bridgeRunArgs();
  const content = buildPlist({
    nodePath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? "",
    channelHome: CONFIG_DIR
  });
  const plistPath = launchAgentPlistPath();
  await mkdir(dirname(plistPath), { recursive: true });
  await mkdir(daemonLogDir(), { recursive: true });
  await writeFile(plistPath, content, "utf8");
}
function plistExists() {
  return existsSync3(launchAgentPlistPath());
}
function userTarget() {
  return `gui/${userInfo().uid}`;
}
function serviceTarget() {
  return `${userTarget()}/${LAUNCH_AGENT_LABEL}`;
}
function runLaunchctl(args2) {
  const r = spawnSync("launchctl", args2, { encoding: "utf8" });
  return { ok: r.status === 0, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}
function bootstrap() {
  return runLaunchctl(["bootstrap", userTarget(), launchAgentPlistPath()]);
}
function bootout() {
  return runLaunchctl(["bootout", serviceTarget()]);
}
function kickstart() {
  return runLaunchctl(["kickstart", "-k", serviceTarget()]);
}
function disable() {
  return runLaunchctl(["disable", serviceTarget()]);
}
function enable() {
  return runLaunchctl(["enable", serviceTarget()]);
}
function isLoaded() {
  const r = spawnSync("launchctl", ["print", serviceTarget()], {
    stdio: ["ignore", "ignore", "ignore"]
  });
  return r.status === 0;
}
function isRunning() {
  if (!isLoaded()) return false;
  const text = describeService();
  const m = text.match(/pid\s*=\s*(\d+)/);
  const pid = m ? Number(m[1]) : 0;
  return Number.isFinite(pid) && pid > 0;
}
async function waitUntilUnloaded(timeoutMs = 5e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isLoaded()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
function describeService() {
  const r = runLaunchctl(["print", serviceTarget()]);
  return r.stdout || r.stderr || "";
}
async function deletePlist() {
  await rm(launchAgentPlistPath(), { force: true });
}

// src/daemon/systemd.ts
import { spawnSync as spawnSync2 } from "child_process";
import { existsSync as existsSync4 } from "fs";
import { mkdir as mkdir2, rm as rm2, writeFile as writeFile2 } from "fs/promises";
import { dirname as dirname2 } from "path";
function escapeUnit(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function buildUnit(inputs) {
  const wd = inputs.workingDirectory ?? inputs.channelHome;
  return `[Unit]
Description=Lark Copilot Bridge bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${escapeUnit(wd)}
ExecStart="${escapeUnit(inputs.nodePath)}" "${escapeUnit(inputs.bridgeEntryPath)}" run
Restart=always
RestartSec=5
StandardOutput=append:${daemonStdoutPath()}
StandardError=append:${daemonStderrPath()}
Environment="PATH=${escapeUnit(inputs.envPath)}"
Environment="LARK_COPILOT_BRIDGE_HOME=${escapeUnit(inputs.channelHome)}"

[Install]
WantedBy=default.target
`;
}
async function writeUnit() {
  const { nodePath, bridgeEntryPath } = bridgeRunArgs();
  const content = buildUnit({
    nodePath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? "",
    channelHome: CONFIG_DIR
  });
  const unitPath = systemdUnitPath();
  await mkdir2(dirname2(unitPath), { recursive: true });
  await mkdir2(daemonLogDir(), { recursive: true });
  await writeFile2(unitPath, content, "utf8");
}
function unitExists() {
  return existsSync4(systemdUnitPath());
}
function runSystemctl(args2) {
  const r = spawnSync2("systemctl", ["--user", ...args2], { encoding: "utf8" });
  return { ok: r.status === 0, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}
function daemonReload() {
  return runSystemctl(["daemon-reload"]);
}
function enableAndStart() {
  return runSystemctl(["enable", "--now", SYSTEMD_UNIT_NAME]);
}
function stop() {
  return runSystemctl(["stop", SYSTEMD_UNIT_NAME]);
}
function disableAndStop() {
  return runSystemctl(["disable", "--now", SYSTEMD_UNIT_NAME]);
}
function restart() {
  return runSystemctl(["restart", SYSTEMD_UNIT_NAME]);
}
function isActive() {
  const r = spawnSync2("systemctl", ["--user", "is-active", SYSTEMD_UNIT_NAME], {
    stdio: ["ignore", "ignore", "ignore"]
  });
  return r.status === 0;
}
function describeService2() {
  const r = runSystemctl(["status", SYSTEMD_UNIT_NAME, "--no-pager"]);
  return r.stdout || r.stderr || "";
}
async function waitUntilInactive(timeoutMs = 5e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isActive()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
async function deleteUnit() {
  await rm2(systemdUnitPath(), { force: true });
}

// src/daemon/schtasks.ts
import { spawnSync as spawnSync3 } from "child_process";
import { existsSync as existsSync5 } from "fs";
import { mkdir as mkdir3, rm as rm3, writeFile as writeFile3 } from "fs/promises";
import { dirname as dirname3 } from "path";
function buildLauncherCmd(inputs) {
  return [
    "@echo off",
    `cd /d "${inputs.channelHome}"`,
    `set "LARK_COPILOT_BRIDGE_HOME=${inputs.channelHome}"`,
    `set "PATH=${inputs.envPath}"`,
    `"${inputs.nodePath}" "${inputs.bridgeEntryPath}" run >> "${daemonStdoutPath()}" 2>> "${daemonStderrPath()}"`,
    ""
  ].join("\r\n");
}
async function writeLauncherCmd() {
  const { nodePath, bridgeEntryPath } = bridgeRunArgs();
  const content = buildLauncherCmd({
    nodePath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? "",
    channelHome: CONFIG_DIR
  });
  const cmdPath = windowsLauncherCmdPath();
  await mkdir3(dirname3(cmdPath), { recursive: true });
  await mkdir3(daemonLogDir(), { recursive: true });
  await writeFile3(cmdPath, content, "utf8");
}
function runSchtasks(args2) {
  const r = spawnSync3("schtasks", args2, { encoding: "utf8" });
  return { ok: r.status === 0, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}
async function installTask() {
  await writeLauncherCmd();
  return runSchtasks([
    "/Create",
    "/F",
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/TN",
    WINDOWS_TASK_NAME,
    "/TR",
    `"${windowsLauncherCmdPath()}"`
  ]);
}
function runTask() {
  return runSchtasks(["/Run", "/TN", WINDOWS_TASK_NAME]);
}
function endTask() {
  return runSchtasks(["/End", "/TN", WINDOWS_TASK_NAME]);
}
function disableTask() {
  return runSchtasks(["/Change", "/TN", WINDOWS_TASK_NAME, "/Disable"]);
}
function enableTask() {
  return runSchtasks(["/Change", "/TN", WINDOWS_TASK_NAME, "/Enable"]);
}
async function endAndDisable() {
  const ended = endTask();
  const stopped = await waitUntilStopped(5e3);
  const disabled = disableTask();
  if (!stopped) {
    return {
      ok: false,
      stderr: ended.stderr || "task still running after /End",
      stdout: ended.stdout
    };
  }
  if (!disabled.ok) {
    return {
      ok: true,
      stderr: disabled.stderr || "task stopped but /Disable failed",
      stdout: disabled.stdout
    };
  }
  return disabled;
}
var ENABLE_FAIL_ZH = "\u65E0\u6CD5\u542F\u7528\u8BA1\u5212\u4EFB\u52A1\uFF08/Enable \u5931\u8D25\uFF09\u3002\u8BF7\u5728\u300C\u4EFB\u52A1\u8BA1\u5212\u7A0B\u5E8F\u300D\u4E2D\u624B\u52A8\u542F\u7528\u8BE5\u4EFB\u52A1\u540E\u518D start\u3002";
function enableFailResult(enabled) {
  const detail = enabled.stderr.trim();
  return {
    ok: false,
    stderr: detail ? `${ENABLE_FAIL_ZH}
${detail}` : ENABLE_FAIL_ZH,
    stdout: enabled.stdout
  };
}
async function restartTask() {
  endTask();
  await waitUntilStopped();
  const enabled = enableTask();
  if (!enabled.ok) return enableFailResult(enabled);
  return runTask();
}
function enableAndRun() {
  const enabled = enableTask();
  if (!enabled.ok) return enableFailResult(enabled);
  return runTask();
}
function isTaskRegistered() {
  const r = spawnSync3("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME], {
    stdio: ["ignore", "ignore", "ignore"]
  });
  return r.status === 0;
}
function isTaskRunning() {
  const r = runSchtasks(["/Query", "/V", "/FO", "LIST", "/TN", WINDOWS_TASK_NAME]);
  if (!r.ok) return false;
  return /Status:\s+Running/i.test(r.stdout);
}
function describeTask() {
  const r = runSchtasks(["/Query", "/V", "/FO", "LIST", "/TN", WINDOWS_TASK_NAME]);
  return r.stdout || r.stderr || "";
}
async function waitUntilStopped(timeoutMs = 5e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isTaskRunning()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
async function deleteTask() {
  const r = runSchtasks(["/Delete", "/F", "/TN", WINDOWS_TASK_NAME]);
  if (existsSync5(windowsLauncherCmdPath())) {
    await rm3(windowsLauncherCmdPath(), { force: true });
  }
  return r;
}

// src/daemon/service-adapter.ts
function makeLaunchdAdapter() {
  return {
    platformName: "launchd (macOS)",
    fileExists: () => plistExists(),
    isRunning: () => isRunning(),
    servicePath: () => launchAgentPlistPath(),
    install: async () => {
      await writePlist();
    },
    start: () => {
      enable();
      return bootstrap();
    },
    stop: () => bootout(),
    stopAndDisableAutostart: () => {
      const d = disable();
      const out = bootout();
      if (!out.ok) {
        return {
          ok: false,
          stdout: out.stdout,
          stderr: d.ok ? out.stderr : `disable failed: ${d.stderr}
${out.stderr}`
        };
      }
      if (!d.ok) {
        return {
          ok: false,
          stdout: out.stdout,
          stderr: `disable failed: ${d.stderr}
${out.stderr}`.trim()
        };
      }
      return out;
    },
    restart: () => kickstart(),
    waitUntilStopped: (timeoutMs) => waitUntilUnloaded(timeoutMs),
    deleteFile: () => deletePlist(),
    describeStatus: () => describeService(),
    parseStatus: (text) => ({
      pid: text.match(/pid\s*=\s*(\d+)/)?.[1],
      lastExit: text.match(/last exit code\s*=\s*(-?\d+)/i)?.[1]
    })
  };
}
function makeSystemdAdapter() {
  return {
    platformName: "systemd (Linux user)",
    fileExists: () => unitExists(),
    isRunning: () => isActive(),
    servicePath: () => systemdUnitPath(),
    install: async () => {
      await writeUnit();
      daemonReload();
    },
    start: () => enableAndStart(),
    stop: () => stop(),
    stopAndDisableAutostart: () => disableAndStop(),
    restart: () => restart(),
    waitUntilStopped: (timeoutMs) => waitUntilInactive(timeoutMs),
    deleteFile: async () => {
      await deleteUnit();
      daemonReload();
    },
    describeStatus: () => describeService2(),
    parseStatus: (text) => ({
      pid: text.match(/Main PID:\s*(\d+)/)?.[1],
      lastExit: text.match(/Process:\s+\d+\s+ExecStart=.*status=(\d+)/)?.[1]
    })
  };
}
function makeSchtasksAdapter() {
  return {
    platformName: "Task Scheduler (Windows)",
    fileExists: () => isTaskRegistered(),
    isRunning: () => isTaskRunning(),
    servicePath: () => WINDOWS_TASK_NAME,
    install: async () => {
      const r = await installTask();
      if (!r.ok) throw new Error(r.stderr || "schtasks /Create failed");
    },
    start: () => enableAndRun(),
    stop: () => endTask(),
    stopAndDisableAutostart: () => endAndDisable(),
    restart: () => restartTask(),
    waitUntilStopped: (timeoutMs) => waitUntilStopped(timeoutMs),
    deleteFile: async () => {
      await deleteTask();
    },
    describeStatus: () => describeTask(),
    parseStatus: (text) => ({
      pid: text.match(/Process ID:\s*(\d+)/i)?.[1],
      lastExit: text.match(/Last Result:\s*(\d+)/i)?.[1]
    })
  };
}
function getServiceAdapter() {
  if (process.platform === "darwin") return makeLaunchdAdapter();
  if (process.platform === "linux") return makeSystemdAdapter();
  if (process.platform === "win32") return makeSchtasksAdapter();
  return null;
}
function requireAdapter(cmd) {
  const adapter = getServiceAdapter();
  if (!adapter) {
    console.error(`\u2717 \u5F53\u524D\u7CFB\u7EDF\u4E0D\u652F\u6301\u540E\u53F0\u5E38\u9A7B\u547D\u4EE4\u300C${cmd}\u300D`);
    console.error("  \u76EE\u524D\u652F\u6301: macOS (launchd) / Linux (systemd) / Windows (Task Scheduler)");
    process.exit(1);
  }
  return adapter;
}

// src/daemon/registry.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync, writeFileSync as writeFileSync2 } from "fs";
import { dirname as dirname4 } from "path";
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function readRaw() {
  const file = processesFile();
  if (!existsSync6(file)) return { entries: [] };
  try {
    const parsed = JSON.parse(readFileSync2(file, "utf8"));
    if (!Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}
function writeRaw(data) {
  const file = processesFile();
  mkdirSync2(dirname4(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync2(tmp, JSON.stringify(data, null, 2), { mode: 384 });
  renameSync(tmp, file);
}
function readAndPrune() {
  const data = readRaw();
  const live = data.entries.filter((e) => alive(e.pid));
  if (live.length !== data.entries.length) {
    writeRaw({ entries: live });
  }
  return live;
}
function readLive() {
  return readRaw().entries.filter((e) => alive(e.pid));
}
function registerProcess(appId) {
  const entries = readAndPrune().filter((e) => e.pid !== process.pid);
  const entry = {
    id: `pid-${process.pid}`,
    pid: process.pid,
    appId,
    ready: false,
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  entries.push(entry);
  writeRaw({ entries });
  return entry;
}
function markConnected(pid, botName) {
  const entries = readAndPrune();
  const hit = entries.find((e) => e.pid === pid);
  if (!hit) return;
  const label = (botName ?? "").trim() || `bot:${hit.appId.slice(-6)}`;
  hit.botName = label;
  hit.ready = true;
  writeRaw({ entries });
}
function unregisterProcess(pid = process.pid) {
  const entries = readAndPrune().filter((e) => e.pid !== pid);
  writeRaw({ entries });
}
async function waitForBotConnect(appId, beforePids, timeoutMs = 3e4) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = readAndPrune().find(
      (e) => e.appId === appId && !beforePids.has(e.pid) && (e.ready === true || Boolean(e.botName))
    );
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, 500));
  }
  return void 0;
}

// src/daemon/service-cli.ts
function warnNpxIfNeeded() {
  try {
    const { bridgeEntryPath } = bridgeRunArgs();
    if (looksLikeNpxCachePath(bridgeEntryPath)) {
      console.warn("\u26A0 \u68C0\u6D4B\u5230\u901A\u8FC7 npx \u542F\u52A8\u3002\u540E\u53F0\u670D\u52A1\u4F1A\u8BB0\u4E0B\u4E34\u65F6\u8DEF\u5F84\uFF0C\u7F13\u5B58\u6E05\u7406\u540E\u4F1A\u5931\u6548\u3002");
      console.warn("  \u8BF7\u5148\u5168\u5C40\u5B89\u88C5\u518D start\uFF1A");
      console.warn("    npm install -g lark-copilot-bridge");
      console.warn("");
    }
  } catch {
  }
}
function formatStderr(stderr) {
  return stderr.trim() || "(\u65E0\u8BE6\u60C5)";
}
async function reportConnectAfter(verb, appId, fn) {
  const beforePids = new Set(
    readAndPrune().filter((e) => e.appId === appId).map((e) => e.pid)
  );
  const r = await fn();
  if (!r.ok) {
    console.error(`\u2717 ${verb === "started" ? "\u542F\u52A8" : "\u91CD\u542F"}\u5931\u8D25:
${formatStderr(r.stderr)}`);
    return 1;
  }
  console.log(verb === "started" ? "\u6B63\u5728\u7B49\u5F85 bot \u8FDE\u63A5\u2026" : "\u6B63\u5728\u7B49\u5F85 bot \u91CD\u65B0\u8FDE\u63A5\u2026");
  const entry = await waitForBotConnect(appId, beforePids);
  if (entry) {
    const verbZh = verb === "started" ? "\u5DF2\u542F\u52A8" : "\u5DF2\u91CD\u542F";
    console.log(`\u2713 ${verbZh}  bot: ${entry.botName} (${entry.appId})  pid: ${entry.pid}`);
    return 0;
  }
  console.warn("\u26A0 \u5DF2\u4E0B\u53D1\u6307\u4EE4\uFF0C\u4F46 30 \u79D2\u5185\u672A\u89C2\u5BDF\u5230 bot \u8FDE\u63A5\u6210\u529F\u3002");
  console.warn(`  \u67E5\u770B\u65E5\u5FD7: tail -f ${daemonStderrPath()}`);
  console.warn(`              tail -f ${daemonStdoutPath()}`);
  return 0;
}
function ensureConfigured() {
  if (!existsSync7(CONFIG_FILE) || !loadCredentials()) {
    console.error("\u8FD8\u6CA1\u6709\u7ED1\u5B9A\u98DE\u4E66\u3002\u8BF7\u5148\u524D\u53F0\u8DD1\u4E00\u6B21\u5B8C\u6210\u626B\u7801\uFF1A");
    console.error("  lark-copilot-bridge");
    console.error("\u6216\uFF1A");
    console.error("  lark-copilot-bridge setup");
    return null;
  }
  if (!tryResolveWorkspaceDir()) {
    console.error("\u9879\u76EE\u6587\u4EF6\u5939\u8FD8\u6CA1\u9009\u597D\u3002\u8BF7\u5148\u8FD0\u884C\uFF1A");
    console.error("  lark-copilot-bridge setup");
    return null;
  }
  const creds = loadCredentials();
  return { appId: creds.appId };
}
async function runServiceStart() {
  warnNpxIfNeeded();
  const cfg = ensureConfigured();
  if (!cfg) return 1;
  const adapter = requireAdapter("start");
  await adapter.install();
  if (adapter.isRunning()) {
    console.log("\u68C0\u6D4B\u5230\u65E7\u5B9E\u4F8B\uFF0C\u5148\u505C\u6389\u518D\u542F\u52A8\u2026");
    const r = await adapter.stop();
    if (!r.ok) {
      console.warn(`\u26A0 \u505C\u6B62\u65E7\u5B9E\u4F8B\u65F6\u6709\u8B66\u544A\uFF08\u7EE7\u7EED\uFF09:
${formatStderr(r.stderr)}`);
    }
    const ok = await adapter.waitUntilStopped();
    if (!ok) {
      console.error("\u2717 \u65E7\u5B9E\u4F8B\u6CA1\u6709\u5B8C\u5168\u505C\u4E0B\u3002\u8BF7\u7A0D\u540E\u91CD\u8BD5\uFF0C\u6216\uFF1A");
      console.error("  lark-copilot-bridge unregister");
      console.error("  lark-copilot-bridge start");
      return 1;
    }
  }
  return reportConnectAfter("started", cfg.appId, () => adapter.start());
}
async function runServiceStop() {
  const adapter = requireAdapter("stop");
  if (!adapter.fileExists()) {
    console.log("\u540E\u53F0\u670D\u52A1\u8FD8\u6CA1\u6CE8\u518C\u8FC7\uFF0C\u65E0\u9700\u505C\u6B62\u3002");
    return 0;
  }
  if (!adapter.isRunning()) {
    console.log("\u540E\u53F0\u670D\u52A1\u5F53\u524D\u6CA1\u6709\u5728\u8DD1\u3002");
    const r2 = await adapter.stopAndDisableAutostart();
    if (!r2.ok) {
      console.warn(`\u26A0 \u53D6\u6D88\u81EA\u542F\u65F6\u6709\u8B66\u544A:
${formatStderr(r2.stderr)}`);
      return 1;
    }
    if (process.platform === "win32") {
      console.log("  \uFF08\u5DF2\u786E\u4FDD\u8BA1\u5212\u4EFB\u52A1\u7981\u7528\uFF0C\u4E0D\u4F1A\u5728\u767B\u5F55\u65F6\u81EA\u542F\uFF09");
    }
    return 0;
  }
  const creds = loadCredentials();
  const entry = creds ? readAndPrune().find((e) => e.appId === creds.appId && Boolean(e.botName)) : void 0;
  const r = await adapter.stopAndDisableAutostart();
  if (!r.ok) {
    console.error(`\u2717 \u505C\u6B62\u5931\u8D25:
${formatStderr(r.stderr)}`);
    return 1;
  }
  const stopped = await adapter.waitUntilStopped();
  if (!stopped) {
    console.warn("\u26A0 \u5DF2\u4E0B\u53D1\u505C\u6B62\uFF0C\u4F46\u8FDB\u7A0B\u53EF\u80FD\u5C1A\u672A\u5B8C\u5168\u9000\u51FA\u3002");
  }
  if (entry) {
    console.log(`\u2713 bot ${entry.botName} (${entry.appId}) \u5DF2\u505C\u6B62`);
  } else {
    console.log("\u2713 \u540E\u53F0\u670D\u52A1\u5DF2\u505C\u6B62");
  }
  if (process.platform === "win32") {
    console.log("  \uFF08\u8BA1\u5212\u4EFB\u52A1\u5DF2\u7981\u7528\uFF0C\u4E0D\u4F1A\u5728\u767B\u5F55\u65F6\u81EA\u542F\uFF09");
  }
  console.log("  \u518D\u7528 start \u53EF\u91CD\u65B0\u542F\u52A8");
  return 0;
}
async function runServiceRestart() {
  warnNpxIfNeeded();
  const cfg = ensureConfigured();
  if (!cfg) return 1;
  const adapter = requireAdapter("restart");
  if (!adapter.fileExists()) {
    console.error("\u540E\u53F0\u670D\u52A1\u8FD8\u6CA1\u6CE8\u518C\u8FC7\u3002\u8BF7\u5148\u8FD0\u884C\uFF1A");
    console.error("  lark-copilot-bridge start");
    return 1;
  }
  if (adapter.isRunning()) {
    return reportConnectAfter("restarted", cfg.appId, () => adapter.restart());
  }
  return reportConnectAfter("started", cfg.appId, () => adapter.start());
}
async function runServiceStatus() {
  const adapter = requireAdapter("status");
  if (!adapter.fileExists()) {
    console.log("\u540E\u53F0\u670D\u52A1\u5F53\u524D\u6CA1\u5728\u8DD1\uFF08\u4ECE\u672A start \u8FC7\uFF09");
    console.log("  \u7528 start \u542F\u52A8\uFF1A lark-copilot-bridge start");
    return 0;
  }
  if (!adapter.isRunning()) {
    console.log("\u540E\u53F0\u670D\u52A1\u5F53\u524D\u6CA1\u5728\u8DD1");
    console.log("  \u7528 start \u91CD\u65B0\u542F\u52A8");
    return 0;
  }
  const creds = loadCredentials();
  const entry = creds ? readAndPrune().find((e) => e.appId === creds.appId && Boolean(e.botName)) : void 0;
  const { pid, lastExit } = adapter.parseStatus(adapter.describeStatus());
  if (entry) {
    console.log(`\u2713 bot ${entry.botName} (${entry.appId}) \u6B63\u5728\u540E\u53F0\u8FD0\u884C`);
  } else {
    console.log("\u2713 \u540E\u53F0\u670D\u52A1\u6B63\u5728\u8FD0\u884C");
  }
  if (pid) console.log(`  \u8FDB\u7A0B ID: ${pid}`);
  console.log("  \u65E5\u5FD7:");
  console.log(`    ${daemonStdoutPath()}`);
  console.log(`    ${daemonStderrPath()}`);
  if (lastExit && lastExit !== "-1") console.log(`  \u4E0A\u6B21\u9000\u51FA\u7801: ${lastExit}`);
  const summary = getConfigSummary();
  if (summary.copilotCwd) console.log(`  \u9879\u76EE\u6587\u4EF6\u5939: ${summary.copilotCwd}`);
  return 0;
}
async function runServiceUnregister() {
  const adapter = requireAdapter("unregister");
  if (!adapter.fileExists()) {
    console.log("\u540E\u53F0\u670D\u52A1\u8FD8\u6CA1\u6CE8\u518C\u8FC7\uFF0C\u65E0\u9700\u6E05\u7406\u3002");
    return 0;
  }
  if (adapter.isRunning()) {
    const r = await adapter.stopAndDisableAutostart();
    if (!r.ok) {
      console.warn(`\u26A0 \u505C\u6B62\u65F6\u6709\u8B66\u544A\uFF08\u7EE7\u7EED\u6E05\u7406\uFF09:
${formatStderr(r.stderr)}`);
    } else {
      console.log("\u2713 \u5DF2\u505C\u6B62\u540E\u53F0\u670D\u52A1");
    }
    const ok = await adapter.waitUntilStopped();
    if (!ok) {
      console.warn("\u26A0 \u8FDB\u7A0B\u53EF\u80FD\u5C1A\u672A\u5B8C\u5168\u9000\u51FA\uFF0C\u7EE7\u7EED\u6E05\u9664\u6CE8\u518C\u2026");
    }
  }
  await adapter.deleteFile();
  console.log("\u2713 \u5DF2\u6E05\u9664\u540E\u53F0\u5E38\u9A7B\u6CE8\u518C");
  console.log(`  \uFF08\u914D\u7F6E / \u65E5\u5FD7 / \u4F1A\u8BDD\u4ECD\u4FDD\u7559\u5728 ${CONFIG_DIR}\uFF09`);
  return 0;
}

// src/cli.ts
function getPackageVersion() {
  try {
    const require2 = createRequire(import.meta.url);
    const here = dirname5(fileURLToPath(import.meta.url));
    for (const candidate of [
      join2(here, "../package.json"),
      join2(here, "../../package.json"),
      join2(here, "package.json")
    ]) {
      if (existsSync8(candidate)) {
        return require2(candidate).version;
      }
    }
  } catch {
  }
  return "0.0.0";
}
function printHelp() {
  console.log(`lark-copilot-bridge ${getPackageVersion()}
\u5728\u98DE\u4E66\u91CC\u8DDF\u4F60\u7535\u8111\u4E0A\u7684 GitHub Copilot \u804A\u5929\u3002

\u524D\u53F0\uFF1A
  lark-copilot-bridge           \u524D\u53F0\u542F\u52A8\uFF08\u7B2C\u4E00\u6B21\u4F1A\u5F15\u5BFC\u8BBE\u7F6E\uFF09
  lark-copilot-bridge run       \u540C\u4E0A\uFF08\u4F9B\u540E\u53F0\u670D\u52A1\u8C03\u7528\uFF09

\u540E\u53F0\u5E38\u9A7B\uFF08\u9700\u5148\u5168\u5C40\u5B89\u88C5\uFF0C\u4E0D\u8981\u7528 npx start\uFF09\uFF1A
  lark-copilot-bridge start     \u5B89\u88C5\u5E76\u542F\u52A8 OS \u5B88\u62A4\u8FDB\u7A0B
  lark-copilot-bridge stop      \u505C\u6B62\u5E76\u53D6\u6D88\u5F00\u673A\u81EA\u542F
  lark-copilot-bridge restart   \u91CD\u542F\u540E\u53F0\u670D\u52A1
  lark-copilot-bridge status    \u67E5\u770B\u662F\u5426\u5728\u8DD1
  lark-copilot-bridge unregister  \u6E05\u9664\u5B88\u62A4\u8FDB\u7A0B\u6CE8\u518C\uFF08\u4FDD\u7559\u914D\u7F6E\uFF09

\u5176\u5B83\uFF1A
  lark-copilot-bridge setup     \u91CD\u65B0\u9009\u62E9\u9879\u76EE\u6587\u4EF6\u5939 / \u8C01\u80FD\u7528
  lark-copilot-bridge doctor    \u68C0\u67E5\u662F\u5426\u51C6\u5907\u597D\u4E86
  lark-copilot-bridge config    \u67E5\u770B\u5F53\u524D\u8BBE\u7F6E
  lark-copilot-bridge logout    \u89E3\u9664\u98DE\u4E66\u7ED1\u5B9A\uFF08\u4E0B\u6B21\u91CD\u65B0\u626B\u7801\uFF09
  lark-copilot-bridge --version
  lark-copilot-bridge --help

\u5B89\u88C5\uFF1A
  npm install -g lark-copilot-bridge

\u4F60\u9700\u8981\u63D0\u524D\u6709\uFF1A
  \xB7 Node.js 20 \u6216\u66F4\u9AD8
  \xB7 \u5DF2\u767B\u5F55\u7684 GitHub Copilot \u547D\u4EE4\u884C\uFF08\u9700\u8981 Copilot \u8BA2\u9605\uFF09

\u98DE\u4E66\u91CC\u53EF\u53D1\uFF1A/help  /whoami  /new  /stop  /cd  /ws \u2026
\u4E5F\u53EF\u76F4\u63A5\u53D1\u56FE\u7247\u6216\u6587\u4EF6\uFF0C\u4F1A\u4E0B\u8F7D\u5230\u672C\u673A\u540E\u4EA4\u7ED9 Copilot\u3002
`);
}
function printVersion() {
  console.log(getPackageVersion());
}
function printConfig() {
  const s = getConfigSummary();
  console.log("\u5F53\u524D\u8BBE\u7F6E");
  console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`\u8BBE\u7F6E\u6587\u4EF6: ${s.configFile}${existsSync8(s.configFile) ? "" : "\uFF08\u8FD8\u6CA1\u6709\uFF09"}`);
  if (!s.hasCredentials) {
    console.log("\u98DE\u4E66\u7ED1\u5B9A: \u8FD8\u6CA1\u6709\uFF08\u542F\u52A8\u65F6\u4F1A\u8BF7\u4F60\u626B\u7801\uFF09");
  } else {
    console.log(`\u98DE\u4E66\u5E94\u7528: \u5DF2\u7ED1\u5B9A`);
    console.log(`\u4F60\u7684\u8D26\u53F7: ${s.creatorOpenId ?? "\u672A\u8BB0\u5F55\uFF08\u5EFA\u8BAE logout \u540E\u91CD\u65B0\u626B\u7801\uFF09"}`);
  }
  console.log(`\u9879\u76EE\u6587\u4EF6\u5939: ${s.copilotCwd}`);
  const wsNames = Object.keys(s.workspaces);
  if (wsNames.length === 0) {
    console.log("\u547D\u540D\u5DE5\u4F5C\u76EE\u5F55: \u65E0\uFF08\u98DE\u4E66\u91CC\u53D1 /ws add <name>\uFF09");
  } else {
    console.log(`\u547D\u540D\u5DE5\u4F5C\u76EE\u5F55: ${wsNames.length} \u4E2A\uFF08${wsNames.slice(0, 5).join(", ")}${wsNames.length > 5 ? "\u2026" : ""}\uFF09`);
  }
  console.log(`\u5355\u6B21\u6700\u957F: ${Math.round((s.copilotTimeout ?? 0) / 6e4)} \u5206\u949F`);
  if (s.allowedUsers.length === 0) {
    console.log("\u8C01\u80FD\u7528: \u4E0D\u9650\u5236\uFF08\u6709\u98CE\u9669\uFF09");
  } else if (s.creatorOpenId && s.allowedUsers.length === 1 && s.allowedUsers[0] === s.creatorOpenId) {
    console.log("\u8C01\u80FD\u7528: \u4EC5\u4F60\u81EA\u5DF1");
  } else {
    console.log(`\u8C01\u80FD\u7528: \u5DF2\u9650\u5236 ${s.allowedUsers.length} \u4EBA`);
  }
  console.log(`\u9996\u6B21\u5411\u5BFC: ${s.setupCompleted ? "\u5DF2\u5B8C\u6210" : "\u672A\u5B8C\u6210\uFF08\u542F\u52A8\u65F6\u4F1A\u8BE2\u95EE\uFF09"}`);
  console.log("");
  console.log("\u4FEE\u6539\u8BBE\u7F6E: lark-copilot-bridge setup");
}
function runLogout() {
  if (!existsSync8(CONFIG_FILE)) {
    console.log("\u5F53\u524D\u6CA1\u6709\u5DF2\u4FDD\u5B58\u7684\u98DE\u4E66\u7ED1\u5B9A\u3002");
    return 0;
  }
  clearCredentials();
  console.log("\u2713 \u5DF2\u89E3\u9664\u98DE\u4E66\u7ED1\u5B9A\u3002");
  console.log("  \u4F60\u7684\u9879\u76EE\u6587\u4EF6\u5939\u3001\u6743\u9650\u8BBE\u7F6E\u8FD8\u5728\u3002");
  console.log("  \u4E0B\u6B21\u542F\u52A8\u4F1A\u91CD\u65B0\u8BF7\u4F60\u626B\u7801\u3002");
  return 0;
}
async function runSetupCommand() {
  let creds = loadCredentials();
  if (!creds) {
    console.log("\u8FD8\u6CA1\u6709\u7ED1\u5B9A\u98DE\u4E66\u3002\u5148\u626B\u7801\u521B\u5EFA\u673A\u5668\u4EBA\u2026");
    creds = await registerAppByQR();
    saveCredentials(creds);
  }
  const result = await runSetupWizard(creds, { force: true });
  if (!result) {
    printSetupRequiredHint();
    return 1;
  }
  console.log("\u8BBE\u7F6E\u5B8C\u6210\u3002\u73B0\u5728\u53EF\u4EE5\u542F\u52A8\uFF1A");
  console.log("  lark-copilot-bridge");
  return 0;
}
async function runDoctor() {
  let failed = 0;
  const ok = (msg) => console.log(`\u2713 ${msg}`);
  const bad = (msg, tip) => {
    failed++;
    console.log(`\u2717 ${msg}`);
    if (tip) console.log(`    \u2192 ${tip}`);
  };
  const warn = (msg, tip) => {
    console.log(`\u26A0 ${msg}`);
    if (tip) console.log(`    \u2192 ${tip}`);
  };
  console.log(`\u68C0\u67E5\u662F\u5426\u51C6\u5907\u597D\u4E86  (v${getPackageVersion()})
`);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 20) ok(`\u7535\u8111\u8FD0\u884C\u73AF\u5883\u6B63\u5E38\uFF08Node.js ${process.version}\uFF09`);
  else {
    bad(
      `\u7535\u8111\u8FD0\u884C\u73AF\u5883\u8FC7\u65E7\uFF08Node.js ${process.version}\uFF09`,
      "\u8BF7\u5B89\u88C5 Node.js 20 \u6216\u66F4\u9AD8\uFF1Ahttps://nodejs.org/"
    );
  }
  const copilot = await getCopilotVersion();
  if (copilot.ok) ok(`GitHub Copilot \u547D\u4EE4\u884C\u5DF2\u5B89\u88C5\uFF08${copilot.version}\uFF09`);
  else {
    bad("\u8FD8\u6CA1\u6709\u53EF\u7528\u7684 GitHub Copilot \u547D\u4EE4\u884C", "\u5148\u5B89\u88C5\u518D\u767B\u5F55\uFF1A");
    console.log("       curl -fsSL https://gh.io/copilot-install | bash");
    console.log("       \u7136\u540E\u8F93\u5165 copilot\uFF0C\u6309\u63D0\u793A\u767B\u5F55\uFF08\u9700\u8981 Copilot \u8BA2\u9605\uFF09");
  }
  if (copilot.ok) {
    const jsonOk = await supportsCopilotJsonOutput();
    if (jsonOk) {
      ok("\u652F\u6301\u7ED3\u6784\u5316\u6D41\u5F0F\u8F93\u51FA\uFF08--output-format json\uFF09\u2192 \u5361\u7247\u53EF\u663E\u793A\u5DE5\u5177\u8C03\u7528");
    } else {
      warn(
        "\u5F53\u524D Copilot \u4E0D\u652F\u6301 json \u8F93\u51FA\u683C\u5F0F",
        "\u5361\u7247\u53EA\u80FD\u663E\u793A\u7EAF\u6587\u672C\u3002\u8BF7\u5347\u7EA7 Copilot CLI \u5230 1.0.49 \u6216\u66F4\u9AD8"
      );
    }
  }
  if (existsSync8(CONFIG_DIR)) ok("\u5DF2\u6709\u672C\u673A\u8BBE\u7F6E\u76EE\u5F55");
  else warn("\u8FD8\u6CA1\u6709\u8BBE\u7F6E\u76EE\u5F55", "\u7B2C\u4E00\u6B21\u542F\u52A8\u65F6\u4F1A\u81EA\u52A8\u521B\u5EFA");
  if (existsSync8(CONFIG_FILE)) {
    try {
      accessSync(CONFIG_FILE, constants.R_OK);
      const mode = statSync2(CONFIG_FILE).mode & 511;
      const summary2 = getConfigSummary();
      if (summary2.hasCredentials) {
        ok("\u98DE\u4E66\u673A\u5668\u4EBA\u5DF2\u7ED1\u5B9A");
        if (!summary2.creatorOpenId) {
          warn("\u6CA1\u6709\u8BB0\u4E0B\u626B\u7801\u8D26\u53F7", "\u8FD0\u884C\uFF1Alark-copilot-bridge logout \u540E\u91CD\u65B0\u542F\u52A8\u626B\u7801");
        }
      } else {
        warn("\u8FD8\u6CA1\u6709\u98DE\u4E66\u7ED1\u5B9A", "\u542F\u52A8\u540E\u6309\u63D0\u793A\u7528\u98DE\u4E66\u626B\u7801\u5373\u53EF");
      }
      if (mode & 63) {
        warn("\u8BBE\u7F6E\u6587\u4EF6\u6743\u9650\u504F\u677E", `\u53EF\u5728\u7EC8\u7AEF\u6267\u884C\uFF1Achmod 600 ${CONFIG_FILE}`);
      }
    } catch (err) {
      bad("\u8BFB\u4E0D\u5230\u8BBE\u7F6E\u6587\u4EF6", err.message);
    }
  } else {
    warn("\u8FD8\u6CA1\u6709\u98DE\u4E66\u7ED1\u5B9A", "\u542F\u52A8\u540E\u6309\u63D0\u793A\u7528\u98DE\u4E66\u626B\u7801\u5373\u53EF");
  }
  const summary = getConfigSummary();
  try {
    const abs = validateWorkspaceDir(summary.copilotCwd || process.cwd());
    ok(`\u9879\u76EE\u6587\u4EF6\u5939\u53EF\u7528\uFF1A${abs}`);
  } catch (err) {
    bad("\u9879\u76EE\u6587\u4EF6\u5939\u8FD8\u6CA1\u9009\u597D\u6216\u4E0D\u5408\u6CD5", err.message.split("\n")[0]);
    console.log("       \u8BF7\u8FD0\u884C\uFF1Alark-copilot-bridge setup");
  }
  if (summary.allowedUsers.length === 0) {
    warn(
      "\u5F53\u524D\u4E0D\u9650\u5236\u8C01\u80FD\u7528\u8FD9\u4E2A\u673A\u5668\u4EBA",
      "\u63A8\u8350\u8FD0\u884C setup\uFF0C\u9009\u62E9\u300C\u4EC5\u6211\u81EA\u5DF1\u300D"
    );
  } else {
    ok(summary.allowedUsers.length === 1 ? "\u5DF2\u9650\u5236\u4E3A\u6307\u5B9A\u7528\u6237\u53EF\u7528" : `\u5DF2\u9650\u5236 ${summary.allowedUsers.length} \u4EBA\u53EF\u7528`);
  }
  if (!summary.setupCompleted) {
    warn("\u9996\u6B21\u8BBE\u7F6E\u5411\u5BFC\u5C1A\u672A\u5B8C\u6210", "\u542F\u52A8\u65F6\u4F1A\u8BE2\u95EE\uFF0C\u6216\u8FD0\u884C lark-copilot-bridge setup");
  }
  const adapter = getServiceAdapter();
  if (adapter) {
    if (adapter.isRunning()) {
      ok(`\u540E\u53F0\u5E38\u9A7B\u5DF2\u5728\u8DD1\uFF08${adapter.platformName}\uFF09`);
      console.log(`    \u65E5\u5FD7: ${daemonStdoutPath()}`);
      console.log(`          ${daemonStderrPath()}`);
    } else if (adapter.fileExists()) {
      warn("\u540E\u53F0\u670D\u52A1\u5DF2\u6CE8\u518C\u4F46\u5F53\u524D\u6CA1\u5728\u8DD1", "\u8FD0\u884C\uFF1Alark-copilot-bridge start");
    } else {
      console.log(`\xB7 \u540E\u53F0\u5E38\u9A7B\u672A\u6CE8\u518C\uFF08\u53EF\u9009\uFF1Alark-copilot-bridge start\uFF09`);
    }
  }
  console.log("");
  if (failed === 0) {
    const summary2 = getConfigSummary();
    if (!summary2.hasCredentials) {
      console.log("\u672C\u673A\u4F9D\u8D56\u5DF2\u5C31\u7EEA\u3002\u4E0B\u4E00\u6B65\u8BF7\u524D\u53F0\u542F\u52A8\u5E76\u626B\u7801\uFF1A");
      console.log("  lark-copilot-bridge");
      return 0;
    }
    if (!summary2.setupCompleted) {
      console.log("\u98DE\u4E66\u5DF2\u7ED1\u5B9A\uFF0C\u4F46\u9996\u6B21\u8BBE\u7F6E\u672A\u5B8C\u6210\u3002\u8BF7\u8FD0\u884C\uFF1A");
      console.log("  lark-copilot-bridge");
      console.log("\u6216\uFF1A");
      console.log("  lark-copilot-bridge setup");
      return 0;
    }
    console.log("\u770B\u8D77\u6765\u53EF\u4EE5\u4E86\u3002\u4EFB\u9009\u4E00\u79CD\u542F\u52A8\u65B9\u5F0F\uFF1A");
    console.log("  lark-copilot-bridge          # \u524D\u53F0\uFF08\u5173\u6389\u7A97\u53E3\u4F1A\u4E0B\u7EBF\uFF09");
    console.log("  lark-copilot-bridge start    # \u540E\u53F0\u5E38\u9A7B\uFF08\u63A8\u8350\uFF09");
    return 0;
  }
  console.log(`\u8FD8\u6709 ${failed} \u5904\u9700\u8981\u5148\u5904\u7406\u597D\uFF0C\u518D\u542F\u52A8\u3002`);
  return 1;
}
async function dispatchCli(argv) {
  const args2 = argv.filter(Boolean);
  if (args2.length === 0) return null;
  const head = args2[0] ?? "";
  if (head === "--help" || head === "-h" || head === "help") {
    printHelp();
    return 0;
  }
  if (head === "--version" || head === "-V" || head === "version") {
    printVersion();
    return 0;
  }
  if (head === "doctor") {
    return runDoctor();
  }
  if (head === "config") {
    printConfig();
    return 0;
  }
  if (head === "setup") {
    return runSetupCommand();
  }
  if (head === "logout" || head === "reset") {
    return runLogout();
  }
  if (head === "run") {
    return null;
  }
  if (head === "start") {
    return runServiceStart();
  }
  if (head === "stop") {
    return runServiceStop();
  }
  if (head === "restart") {
    return runServiceRestart();
  }
  if (head === "status") {
    return runServiceStatus();
  }
  if (head === "unregister") {
    return runServiceUnregister();
  }
  if (head.startsWith("-")) {
    console.error(`\u4E0D\u8BA4\u8BC6\u7684\u9009\u9879: ${head}
`);
    printHelp();
    return 1;
  }
  console.error(`\u4E0D\u8BA4\u8BC6\u7684\u547D\u4EE4: ${head}
`);
  printHelp();
  return 1;
}

// src/session.ts
var SessionStore = class {
  constructor(maxRounds) {
    this.maxRounds = maxRounds;
  }
  maxRounds;
  store = /* @__PURE__ */ new Map();
  running = /* @__PURE__ */ new Set();
  abortControllers = /* @__PURE__ */ new Map();
  /** 每个 scope 的工作目录（/cd /ws use 用） */
  cwdStore = /* @__PURE__ */ new Map();
  /** 每个 scope 的超时覆盖（分钟，0=关闭，/timeout 用） */
  timeoutStore = /* @__PURE__ */ new Map();
  /** 每个 scope 的 copilot session-id（--resume 用） */
  sessionIdStore = /* @__PURE__ */ new Map();
  /** 世代号：清会话 / 换 cwd / 开跑时递增 */
  generation = /* @__PURE__ */ new Map();
  bumpGeneration(scope) {
    const next = (this.generation.get(scope) ?? 0) + 1;
    this.generation.set(scope, next);
    return next;
  }
  generationFor(scope) {
    return this.generation.get(scope) ?? 0;
  }
  /** 写入前校验：false 表示 /new 等已使本轮失效 */
  isGenerationCurrent(scope, expected) {
    return this.generationFor(scope) === expected;
  }
  getHistory(scope) {
    return this.store.get(scope) ?? [];
  }
  appendRound(scope, userText, assistantText, expectedGen) {
    if (expectedGen !== void 0 && !this.isGenerationCurrent(scope, expectedGen)) {
      log.info("\u8DF3\u8FC7 appendRound\uFF1Ascope=%s gen \u5DF2\u8FC7\u671F want=%d have=%d", scope, expectedGen, this.generationFor(scope));
      return false;
    }
    const now = Date.now();
    const arr = this.store.get(scope) ?? [];
    arr.push({ role: "user", text: userText, ts: now });
    arr.push({ role: "assistant", text: assistantText, ts: now });
    const maxItems = this.maxRounds * 2;
    this.store.set(scope, arr.length > maxItems ? arr.slice(arr.length - maxItems) : arr);
    return true;
  }
  /** copilot session-id（--resume 用） */
  setSessionId(scope, id, expectedGen) {
    if (expectedGen !== void 0 && !this.isGenerationCurrent(scope, expectedGen)) {
      log.info("\u8DF3\u8FC7 setSessionId\uFF1Ascope=%s gen \u5DF2\u8FC7\u671F want=%d have=%d", scope, expectedGen, this.generationFor(scope));
      return false;
    }
    this.sessionIdStore.set(scope, id);
    return true;
  }
  sessionIdFor(scope) {
    return this.sessionIdStore.get(scope);
  }
  /** 清空会话（/new 用）：清历史 + sessionId，保留 cwd；递增 generation */
  clear(scope) {
    this.bumpGeneration(scope);
    this.store.delete(scope);
    this.sessionIdStore.delete(scope);
    log.info("\u4F1A\u8BDD %s \u5DF2\u6E05\u7A7A", scope);
  }
  setCwd(scope, cwd) {
    this.cwdStore.set(scope, cwd);
    this.clear(scope);
    log.info("scope %s cwd \u2192 %s", scope, cwd);
  }
  cwdFor(scope) {
    return this.cwdStore.get(scope);
  }
  clearCwd(scope) {
    this.cwdStore.delete(scope);
  }
  setIdleTimeout(scope, minutes) {
    this.timeoutStore.set(scope, minutes);
  }
  idleTimeoutFor(scope) {
    return this.timeoutStore.get(scope);
  }
  markRunning(scope) {
    this.bumpGeneration(scope);
    this.running.add(scope);
    const ac = new AbortController();
    this.abortControllers.set(scope, ac);
    return ac;
  }
  /** 原子抢锁：已在跑则返回 null */
  tryMarkRunning(scope) {
    if (this.running.has(scope)) return null;
    return this.markRunning(scope);
  }
  markIdle(scope) {
    this.running.delete(scope);
    this.abortControllers.delete(scope);
  }
  isRunning(scope) {
    return this.running.has(scope);
  }
  runningScopes() {
    return [...this.running];
  }
  abort(scope) {
    const ac = this.abortControllers.get(scope);
    if (ac) {
      ac.abort();
      log.info("\u5DF2\u4E2D\u65AD %s \u7684\u4EFB\u52A1", scope);
      return true;
    }
    return false;
  }
  /** fallback：无 session-id 时拼历史进 prompt */
  buildPrompt(scope, currentUserText) {
    const history = this.getHistory(scope);
    if (history.length === 0) return currentUserText;
    const lines = ["\u4EE5\u4E0B\u662F\u4E0E\u7528\u6237\u7684\u5148\u524D\u5BF9\u8BDD\u5386\u53F2\uFF0C\u8BF7\u57FA\u4E8E\u4E0A\u4E0B\u6587\u56DE\u7B54\u6700\u65B0\u95EE\u9898\u3002", "", "## \u5BF9\u8BDD\u5386\u53F2"];
    for (const h of history) {
      lines.push(`${h.role === "user" ? "\u7528\u6237" : "\u52A9\u624B"}: ${h.text}`);
    }
    lines.push("", "## \u6700\u65B0\u95EE\u9898", currentUserText);
    return lines.join("\n");
  }
};

// src/queue.ts
var MessageQueue = class {
  constructor(debounceMs, onFlush) {
    this.debounceMs = debounceMs;
    this.onFlush = onFlush;
  }
  debounceMs;
  onFlush;
  entries = /* @__PURE__ */ new Map();
  blocked = /* @__PURE__ */ new Set();
  /** 投递消息到 scope 队列。未 block 时 arm debounce timer。 */
  push(scope, msg) {
    const entry = this.entries.get(scope);
    if (entry) {
      entry.messages.push(msg);
    } else {
      this.entries.set(scope, { messages: [msg] });
    }
    if (!this.blocked.has(scope)) {
      this.armTimer(scope);
    }
    log.debug("\u961F\u5217 %s push\uFF0C\u5F53\u524D\u79EF\u538B %d", scope, this.entries.get(scope).messages.length);
  }
  /** 暂停 scope 的 timer（run 开始时调），消息继续累积但不 flush */
  block(scope) {
    this.blocked.add(scope);
    this.clearTimer(scope);
  }
  /** 恢复 scope 的 timer（run 结束时调），重新 arm */
  unblock(scope) {
    this.blocked.delete(scope);
    if (this.entries.has(scope)) {
      this.armTimer(scope);
    }
  }
  /** 清空 scope 的积压并返回（命令处理时丢弃队列用） */
  cancel(scope) {
    const entry = this.entries.get(scope);
    this.clearTimer(scope);
    this.entries.delete(scope);
    return entry?.messages ?? [];
  }
  /** scope 当前积压消息数 */
  pendingCount(scope) {
    return this.entries.get(scope)?.messages.length ?? 0;
  }
  armTimer(scope) {
    this.clearTimer(scope);
    const entry = this.entries.get(scope);
    if (!entry || entry.messages.length === 0) return;
    entry.timer = setTimeout(() => {
      const batch = entry.messages;
      this.entries.delete(scope);
      log.info("\u961F\u5217 %s flush\uFF0C\u6279\u91CF %d \u6761", scope, batch.length);
      this.onFlush(scope, batch);
    }, this.debounceMs);
  }
  clearTimer(scope) {
    const entry = this.entries.get(scope);
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = void 0;
    }
  }
};

// src/workspaces.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync3, readFileSync as readFileSync3, renameSync as renameSync2, writeFileSync as writeFileSync3 } from "fs";
import { resolve as resolve4 } from "path";
var WORKSPACES_FILE = resolve4(CONFIG_DIR, "workspaces.json");
var NAME_RE = /^[a-zA-Z0-9_./-]+$/;
function emptyFile() {
  return { workspaces: {} };
}
function migrateLegacyIfNeeded() {
  if (!existsSync9(CONFIG_FILE)) return null;
  if (existsSync9(WORKSPACES_FILE)) {
    try {
      const existing = JSON.parse(readFileSync3(WORKSPACES_FILE, "utf8"));
      if (Object.keys(existing.workspaces ?? {}).length > 0) return null;
    } catch {
    }
  }
  try {
    const parsed = JSON.parse(readFileSync3(CONFIG_FILE, "utf8"));
    const legacy = parsed.workspaces;
    if (!legacy || Object.keys(legacy).length === 0) return null;
    const data = { workspaces: { ...legacy } };
    writeDisk(data);
    try {
      const { workspaces: _w, ...rest } = parsed;
      writeFileSync3(CONFIG_FILE, JSON.stringify(rest, null, 2), { mode: 384 });
    } catch {
    }
    return data;
  } catch {
    return null;
  }
}
function readDisk() {
  const migrated = migrateLegacyIfNeeded();
  if (migrated) return migrated;
  if (!existsSync9(WORKSPACES_FILE)) return emptyFile();
  try {
    const parsed = JSON.parse(readFileSync3(WORKSPACES_FILE, "utf8"));
    return { workspaces: { ...parsed.workspaces ?? {} } };
  } catch {
    return emptyFile();
  }
}
function writeDisk(data) {
  mkdirSync3(CONFIG_DIR, { recursive: true });
  const tmp = `${WORKSPACES_FILE}.${process.pid}.tmp`;
  writeFileSync3(tmp, JSON.stringify(data, null, 2), { mode: 384 });
  renameSync2(tmp, WORKSPACES_FILE);
}
function validateWorkspaceName(name) {
  const n = name.trim();
  if (!n) throw new Error("\u522B\u540D\u4E0D\u80FD\u4E3A\u7A7A");
  if (n.includes("..")) throw new Error("\u522B\u540D\u4E0D\u80FD\u5305\u542B `..`");
  if (!NAME_RE.test(n)) {
    throw new Error("\u522B\u540D\u53EA\u5141\u8BB8\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4EE5\u53CA `_` `.` `/` `-`");
  }
  return n;
}
function listWorkspaces() {
  return { ...readDisk().workspaces };
}
function saveWorkspace(name, path) {
  const n = validateWorkspaceName(name);
  const abs = validateWorkspaceDir(path);
  const data = readDisk();
  data.workspaces[n] = abs;
  writeDisk(data);
  return abs;
}
function removeWorkspace(name) {
  const n = validateWorkspaceName(name);
  const data = readDisk();
  if (!(n in data.workspaces)) return false;
  delete data.workspaces[n];
  writeDisk(data);
  return true;
}
function useWorkspace(name) {
  const n = validateWorkspaceName(name);
  const path = readDisk().workspaces[n];
  if (!path) throw new Error(`\u672A\u627E\u5230\u522B\u540D \`${n}\``);
  return validateWorkspaceDir(path);
}
var list = listWorkspaces;
var save = saveWorkspace;
var remove = removeWorkspace;
var use = useWorkspace;

// src/card/tool-render.ts
var HEADER_SUMMARY_MAX = 80;
var BODY_FIELD_MAX = 600;
var OUTPUT_MAX = 1200;
var BODY_TOTAL_MAX = 2500;
function toolHeaderText(tool) {
  const icon = tool.status === "done" ? "\u2705" : tool.status === "error" ? "\u274C" : "\u23F3";
  const summary = summarizeInput(tool.name, tool.input);
  return summary ? `${icon} **${tool.name}** \u2014 ${summary}` : `${icon} **${tool.name}**`;
}
function toolBodyMd(tool) {
  const parts = [];
  const inputMd = renderInput(tool);
  if (inputMd) parts.push(inputMd);
  if (tool.output) {
    const truncated = truncate(tool.output, OUTPUT_MAX);
    if (tool.status === "error") {
      parts.push(`**Error**
\`\`\`
${truncated}
\`\`\``);
    } else {
      parts.push(`**Output**
\`\`\`
${truncated}
\`\`\``);
    }
  } else if (tool.status === "running") {
    parts.push("_\u8FD0\u884C\u4E2D\u2026_");
  }
  const body = parts.join("\n\n");
  if (body.length <= BODY_TOTAL_MAX) return body;
  return `${body.slice(0, BODY_TOTAL_MAX)}\u2026

_\uFF08\u5DF2\u622A\u65AD\uFF09_`;
}
function summarizeInput(name, input2) {
  if (!input2 || typeof input2 !== "object") return "";
  const rec = input2;
  const pick = (key, max = HEADER_SUMMARY_MAX) => {
    const v = rec[key];
    if (typeof v !== "string") return "";
    const oneLine = v.replace(/\s+/g, " ").trim();
    return oneLine.length > max ? `${oneLine.slice(0, max)}\u2026` : oneLine;
  };
  const n = name.toLowerCase();
  if (n === "bash" || n === "shell" || n === "run_terminal_cmd") return pick("command") || pick("cmd");
  if (n === "read" || n === "read_file" || n === "edit" || n === "write" || n === "write_file") {
    return shortenPath(pick("file_path") || pick("path") || pick("filePath"));
  }
  if (n === "grep" || n === "search") {
    const pat = pick("pattern", 40) || pick("query", 40);
    const path = pick("path", 30);
    return path ? `${pat} in ${shortenPath(path)}` : pat;
  }
  if (n === "glob") return pick("pattern") || pick("glob");
  if (n === "webfetch" || n === "web_fetch") return pick("url");
  if (n === "websearch" || n === "web_search") return pick("query", 60);
  return pick("command") || pick("file_path") || pick("path") || pick("query") || pick("url");
}
function renderInput(tool) {
  const input2 = tool.input;
  if (!input2 || typeof input2 !== "object") return "";
  const rec = input2;
  const str = (k) => typeof rec[k] === "string" ? rec[k] : "";
  const n = tool.name.toLowerCase();
  if (n === "bash" || n === "shell" || n === "run_terminal_cmd") {
    const cmd = str("command") || str("cmd");
    return cmd ? `**Command**
\`\`\`bash
${truncate(cmd, BODY_FIELD_MAX)}
\`\`\`` : "";
  }
  if (n === "read" || n === "read_file" || n === "edit" || n === "write" || n === "write_file") {
    const fp = str("file_path") || str("path") || str("filePath");
    return fp ? `**File** \`${fp}\`` : "";
  }
  if (n === "web_fetch" || n === "webfetch") {
    return str("url") ? `**URL** ${str("url")}` : "";
  }
  if (n === "web_search" || n === "websearch") {
    return str("query") ? `**Query** \`${truncate(str("query"), BODY_FIELD_MAX)}\`` : "";
  }
  if (n === "grep" || n === "search") {
    const lines = [];
    if (str("pattern") || str("query")) lines.push(`**Pattern** \`${str("pattern") || str("query")}\``);
    if (str("path")) lines.push(`**Path** \`${str("path")}\``);
    return lines.join("\n");
  }
  return "";
}
function shortenPath(p) {
  return p;
}
function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

// src/lark/mask-email.ts
var EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
function maskEmailsInText(s) {
  return s.replace(EMAIL_RE, "[email]");
}
function deepMaskEmails(value) {
  if (typeof value === "string") return maskEmailsInText(value);
  if (Array.isArray(value)) return value.map((v) => deepMaskEmails(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepMaskEmails(v);
    }
    return out;
  }
  return value;
}

// src/lark/card.ts
var REASONING_MAX = 1500;
var COLLAPSE_TOOL_THRESHOLD = 3;
function renderCard(state, options) {
  const elements = [];
  if (state.reasoning.content) {
    elements.push(reasoningPanel(state.reasoning.content, state.reasoning.active));
  }
  for (const group of groupBlocks(state.blocks)) {
    if (group.kind === "text") {
      if (group.content.trim()) elements.push(markdown(group.content));
    } else {
      elements.push(...renderToolGroup(group.tools, state.terminal !== "running"));
    }
  }
  if (state.terminal === "running" && elements.length === 0 && state.footer === "thinking" && !state.reasoning.content && !state.statusNote) {
    elements.push(noteMd("_\u6B63\u5728\u601D\u8003\u2026_"));
  }
  if (state.terminal === "running" && state.statusNote) {
    elements.push(noteMd(`_${state.statusNote}_`));
  }
  if (state.terminal === "interrupted") {
    elements.push(noteMd("_\u23F9 \u5DF2\u88AB\u4E2D\u65AD_"));
  } else if (state.terminal === "wall_timeout") {
    const sec = state.wallTimeoutSeconds;
    const msg = state.errorMsg || (sec && sec > 0 ? `\u4EFB\u52A1\u8D85\u65F6\uFF08\u8D85\u8FC7 ${sec}s\uFF09` : "\u4EFB\u52A1\u8D85\u65F6");
    elements.push(noteMd(`_\u23F1 ${msg}_`));
  } else if (state.terminal === "idle_timeout") {
    const mins = state.idleTimeoutMinutes ?? 0;
    elements.push(noteMd(mins > 0 ? `_\u23F1 ${mins} \u5206\u949F\u65E0\u8F93\u51FA\uFF0C\u5DF2\u81EA\u52A8\u7EC8\u6B62_` : "_\u23F1 \u65E0\u8F93\u51FA\uFF0C\u5DF2\u81EA\u52A8\u7EC8\u6B62_"));
  } else if (state.terminal === "error" && state.errorMsg) {
    elements.push(noteMd(`\u26A0\uFE0F ${state.errorMsg}`));
  } else if (state.terminal === "done" && elements.length === 0) {
    elements.push(noteMd("_\uFF08\u672A\u8FD4\u56DE\u5185\u5BB9\uFF09_"));
  }
  if (state.terminal === "running") {
    if (state.footer) elements.push(footerStatus(state.footer));
    elements.push(stopButton(options.scope));
  }
  return deepMaskEmails({
    schema: "2.0",
    config: {
      streaming_mode: state.terminal === "running",
      summary: { content: summaryText(state) }
    },
    body: { elements }
  });
}
function infoCard(title, body) {
  return deepMaskEmails({
    schema: "2.0",
    config: {
      streaming_mode: false,
      summary: { content: title }
    },
    body: {
      elements: [
        markdown(`**${title}**`),
        markdown(body)
      ]
    }
  });
}
function* groupBlocks(blocks) {
  let toolBuf = [];
  for (const b of blocks) {
    if (b.kind === "tool") {
      toolBuf.push(b.tool);
    } else {
      if (toolBuf.length > 0) {
        yield { kind: "tools", tools: toolBuf };
        toolBuf = [];
      }
      yield { kind: "text", content: b.content };
    }
  }
  if (toolBuf.length > 0) yield { kind: "tools", tools: toolBuf };
}
function renderToolGroup(tools, finalized) {
  if (tools.length === 0) return [];
  if (tools.length < COLLAPSE_TOOL_THRESHOLD) {
    if (finalized) {
      return tools.map((t) => toolPanel(t, false));
    }
    return tools.map((t, i) => toolPanel(t, i === tools.length - 1));
  }
  if (finalized) {
    return [collapsedToolSummary(tools, true)];
  }
  const prior = tools.slice(0, -1);
  const latest = tools[tools.length - 1];
  const out = [];
  if (prior.length > 0) out.push(collapsedToolSummary(prior, false));
  if (latest) out.push(toolPanel(latest, true));
  return out;
}
function reasoningPanel(content, active) {
  const title = active ? "\u{1F9E0} **\u601D\u8003\u4E2D**" : "\u{1F9E0} **\u601D\u8003\u5B8C\u6210\uFF0C\u70B9\u51FB\u67E5\u770B**";
  return collapsiblePanel({
    title,
    expanded: active,
    border: "grey",
    body: truncate2(content, REASONING_MAX)
  });
}
function toolPanel(tool, expanded) {
  return collapsiblePanel({
    title: toolHeaderText(tool),
    expanded,
    border: tool.status === "error" ? "red" : "grey",
    body: toolBodyMd(tool) || "_\u65E0\u8F93\u51FA_"
  });
}
function collapsedToolSummary(tools, finalized) {
  const suffix = finalized ? "\uFF08\u5DF2\u7ED3\u675F\uFF09" : "";
  const title = `\u2615 **${tools.length} \u4E2A\u5DE5\u5177\u8C03\u7528${suffix}**`;
  const headerList = tools.map((t) => `- ${toolHeaderText(t)}`).join("\n");
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: panelHeader(title),
    border: { color: "blue", corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: "8px 8px 8px 8px",
    elements: [{ tag: "markdown", content: headerList, text_size: "notation" }]
  };
}
function collapsiblePanel(opts) {
  return {
    tag: "collapsible_panel",
    expanded: opts.expanded,
    header: panelHeader(opts.title),
    border: { color: opts.border, corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: "8px 8px 8px 8px",
    elements: [{ tag: "markdown", content: opts.body, text_size: "notation" }]
  };
}
function panelHeader(titleMd) {
  return {
    title: { tag: "markdown", content: titleMd },
    vertical_align: "center",
    icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
    icon_position: "follow_text",
    icon_expanded_angle: -180
  };
}
function stopButton(scope) {
  return {
    tag: "button",
    text: { tag: "plain_text", content: "\u23F9 \u7EC8\u6B62" },
    type: "danger",
    behaviors: [{ type: "callback", value: { cmd: "stop", scope } }]
  };
}
function footerStatus(status) {
  const text = status === "thinking" ? "\u{1F9E0} \u6B63\u5728\u601D\u8003" : status === "tool_running" ? "\u{1F9F0} \u6B63\u5728\u8C03\u7528\u5DE5\u5177" : status === "awaiting_permission" ? "\u{1F510} \u7B49\u5F85\u6743\u9650\u786E\u8BA4" : "\u270D\uFE0F \u6B63\u5728\u8F93\u51FA";
  return noteMd(text);
}
function summaryText(state) {
  if (state.terminal === "interrupted") return "\u5DF2\u4E2D\u65AD";
  if (state.terminal === "wall_timeout") return "\u5DF2\u8D85\u65F6";
  if (state.terminal === "idle_timeout") return "\u65E0\u8F93\u51FA\u8D85\u65F6";
  if (state.terminal === "error") return "\u51FA\u9519";
  if (state.terminal === "done") return "\u5DF2\u5B8C\u6210";
  if (state.footer === "awaiting_permission") return "\u7B49\u5F85\u6743\u9650";
  if (state.footer === "tool_running") return "\u6B63\u5728\u8C03\u7528\u5DE5\u5177";
  if (state.footer === "streaming") return "\u6B63\u5728\u8F93\u51FA";
  return "\u601D\u8003\u4E2D";
}
function markdown(content) {
  return { tag: "markdown", content };
}
function noteMd(content) {
  return { tag: "markdown", content, text_size: "notation" };
}
function truncate2(s, max) {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

// src/acl.ts
function isOwner(senderId, ownerOpenId) {
  return Boolean(ownerOpenId && senderId === ownerOpenId);
}
function isAdmin(senderId, config) {
  return config.admins.includes(senderId);
}
function isPrivileged(senderId, config, ownerOpenId) {
  if (ownerOpenId) {
    return isOwner(senderId, ownerOpenId) || isAdmin(senderId, config);
  }
  if (config.allowedUsers.length > 0) {
    return isAdmin(senderId, config) || config.allowedUsers.includes(senderId);
  }
  return true;
}
function canUseBot(senderId, config, ownerOpenId) {
  if (config.allowedUsers.length === 0) return true;
  return isOwner(senderId, ownerOpenId) || isAdmin(senderId, config) || config.allowedUsers.includes(senderId);
}

// src/media/cache.ts
import { createHash } from "crypto";
import { createReadStream, existsSync as existsSync10, readdirSync, statSync as statSync3 } from "fs";
import { mkdir as mkdir4, readdir, rename, rm as rm4, stat } from "fs/promises";
import { join as join3 } from "path";
var MEDIA_GC_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
var MEDIA_TMP_MIN_AGE_MS = 60 * 60 * 1e3;
var MAX_ATTACHMENTS_PER_BATCH = 10;
var MAX_FILE_BYTES = 25 * 1024 * 1024;
function sanitizeMediaBatchId(messageId) {
  const s = messageId.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 64);
  return s || "unknown";
}
function mediaBatchDir(messageId, root = mediaDir()) {
  return join3(root, sanitizeMediaBatchId(messageId));
}
var UNSUPPORTED_LABEL = {
  sticker: "\u8868\u60C5",
  audio: "\u8BED\u97F3",
  video: "\u89C6\u9891"
};
function defaultMime(kind) {
  switch (kind) {
    case "image":
      return "image/png";
    case "audio":
      return "audio/ogg";
    case "video":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}
function extForMime(mime) {
  const map = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "application/json": "json",
    "application/zip": "zip"
  };
  return map[mime.toLowerCase()] ?? "bin";
}
async function hashFile(path) {
  return new Promise((resolve6, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (c) => hash.update(c));
    stream.on("error", reject);
    stream.on("end", () => resolve6(hash.digest("hex")));
  });
}
function isDownloadableResource(r) {
  return r.type === "image" || r.type === "file";
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function tmpOwnerPid(name) {
  const m = name.match(/^\.tmp-(\d+)-/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
var MediaCache = class {
  constructor(downloader, rootDir = mediaDir()) {
    this.downloader = downloader;
    this.rootDir = rootDir;
  }
  downloader;
  rootDir;
  async resolve(items) {
    const skipped = [];
    if (items.length === 0) {
      return { accepted: [], skipped, downloadableCount: 0 };
    }
    await mkdir4(this.rootDir, { recursive: true });
    const downloadable = items.filter((it) => {
      if (!isDownloadableResource(it.resource)) {
        const label = UNSUPPORTED_LABEL[it.resource.type] ?? it.resource.type;
        skipped.push(`\u6682\u4E0D\u652F\u6301${label}`);
        return false;
      }
      return true;
    });
    if (downloadable.length > MAX_ATTACHMENTS_PER_BATCH) {
      skipped.push(`\u9644\u4EF6\u8FC7\u591A\uFF0C\u4EC5\u5904\u7406\u524D ${MAX_ATTACHMENTS_PER_BATCH} \u4E2A`);
    }
    const slice = downloadable.slice(0, MAX_ATTACHMENTS_PER_BATCH);
    const accepted = [];
    for (const item of slice) {
      try {
        const file = await this.resolveOne(item);
        if (!file) continue;
        if (file.size > MAX_FILE_BYTES) {
          skipped.push(`${file.originalName ?? "\u6587\u4EF6"} \u8D85\u8FC7 ${MAX_FILE_BYTES / 1024 / 1024}MB`);
          await rm4(file.absPath, { force: true }).catch(() => void 0);
          continue;
        }
        accepted.push(file);
      } catch (err) {
        const msg = err.message;
        if (msg.startsWith("OVERSIZE:")) {
          skipped.push(msg.slice("OVERSIZE:".length));
        } else {
          log.warn("\u9644\u4EF6\u4E0B\u8F7D\u5931\u8D25 fileKey=%s: %s", item.resource.fileKey, msg);
          skipped.push(`\u4E0B\u8F7D\u5931\u8D25: ${item.resource.fileName ?? item.resource.fileKey.slice(-8)}`);
        }
      }
    }
    return { accepted, skipped, downloadableCount: downloadable.length };
  }
  async resolveOne(item) {
    const { messageId, resource: r } = item;
    const tmpPath = join3(
      this.rootDir,
      `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    let finalized = false;
    try {
      const type = r.type === "image" ? "image" : "file";
      const { contentType } = await this.downloader.downloadResourceToFile(
        messageId,
        r.fileKey,
        type,
        tmpPath
      );
      const tmpStat = await stat(tmpPath);
      if (tmpStat.size > MAX_FILE_BYTES) {
        throw new Error(`OVERSIZE:${r.fileName ?? "\u6587\u4EF6"} \u8D85\u8FC7 ${MAX_FILE_BYTES / 1024 / 1024}MB`);
      }
      const hash = await hashFile(tmpPath);
      const mime = contentType ?? defaultMime(r.type);
      const ext = extForMime(mime);
      const absPath = join3(this.rootDir, `${hash}.${ext}`);
      if (existsSync10(absPath)) {
        await rm4(tmpPath, { force: true });
        finalized = true;
        log.info("\u9644\u4EF6\u7F13\u5B58\u547D\u4E2D: %s", absPath);
      } else {
        await rename(tmpPath, absPath);
        finalized = true;
        log.info("\u9644\u4EF6\u5DF2\u4E0B\u8F7D: %s (%d bytes)", absPath, tmpStat.size);
      }
      return {
        absPath,
        kind: r.type,
        size: tmpStat.size,
        mime,
        ...r.fileName ? { originalName: r.fileName } : {}
      };
    } finally {
      if (!finalized) {
        await rm4(tmpPath, { force: true }).catch(() => void 0);
      }
    }
  }
};
async function gcMediaCacheWalk(dir, cutoff, tmpCutoff) {
  let removed = 0;
  const names = await readdir(dir);
  for (const name of names) {
    const p = join3(dir, name);
    try {
      if (name.startsWith(".tmp-")) {
        const st2 = await stat(p);
        const owner = tmpOwnerPid(name);
        const ownerDead = owner !== null && !pidAlive(owner);
        const oldEnough = st2.mtimeMs < tmpCutoff;
        if (owner === process.pid) continue;
        if (ownerDead || oldEnough) {
          await rm4(p, { force: true });
          removed++;
        }
        continue;
      }
      const st = await stat(p);
      if (st.isDirectory()) {
        removed += await gcMediaCacheWalk(p, cutoff, tmpCutoff);
        try {
          const leftover = await readdir(p);
          if (leftover.length === 0) {
            await rm4(p, { recursive: true, force: true });
            removed++;
          }
        } catch {
        }
        continue;
      }
      if (st.isFile() && st.mtimeMs < cutoff) {
        await rm4(p, { force: true });
        removed++;
      }
    } catch {
    }
  }
  return removed;
}
async function gcMediaCache(maxAgeMs = MEDIA_GC_MAX_AGE_MS, root = mediaDir()) {
  if (!existsSync10(root)) return 0;
  const cutoff = Date.now() - maxAgeMs;
  const tmpCutoff = Date.now() - MEDIA_TMP_MIN_AGE_MS;
  const removed = await gcMediaCacheWalk(root, cutoff, tmpCutoff);
  if (removed > 0) log.info("\u9644\u4EF6\u7F13\u5B58 GC: \u5220\u9664 %d \u4E2A\u6587\u4EF6/\u76EE\u5F55", removed);
  return removed;
}
function formatAttachmentsForPrompt(atts) {
  if (atts.length === 0) return "";
  const lines = atts.map((a, i) => {
    const label = a.originalName ? `${a.originalName} (${a.kind})` : `${a.kind} #${i + 1}`;
    return `- ${label}: ${a.absPath}`;
  });
  return `<attachments>
${lines.join("\n")}
</attachments>

`;
}
function formatSkippedSummary(skipped) {
  if (skipped.length === 0) return "";
  const uniq = [...new Set(skipped)];
  return `\u9644\u4EF6\u63D0\u793A\uFF1A${uniq.join("\uFF1B")}`;
}
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function mediaCacheStats(root = mediaDir(), maxFiles = 2e3) {
  if (!existsSync10(root)) {
    return { files: 0, bytes: 0, truncated: false, label: "\u7A7A" };
  }
  let files = 0;
  let bytes = 0;
  let truncated = false;
  const walk = (dir) => {
    if (truncated) return;
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (truncated) return;
      if (name.startsWith(".tmp-")) continue;
      const p = join3(dir, name);
      try {
        const st = statSync3(p);
        if (st.isDirectory()) {
          walk(p);
        } else if (st.isFile()) {
          files++;
          bytes += st.size;
          if (files >= maxFiles) {
            truncated = true;
            return;
          }
        }
      } catch {
      }
    }
  };
  walk(root);
  if (files === 0) return { files: 0, bytes: 0, truncated: false, label: "\u7A7A" };
  const label = truncated ? `\u2265${files} \u4E2A\u6587\u4EF6 \xB7 ${formatBytes(bytes)}+\uFF08\u5DF2\u622A\u65AD\u7EDF\u8BA1\uFF09` : `${files} \u4E2A\u6587\u4EF6 \xB7 ${formatBytes(bytes)}`;
  return { files, bytes, truncated, label };
}

// src/commands.ts
import { realpathSync } from "fs";
import { resolve as resolve5 } from "path";
function replyOpts(ctx) {
  return {
    replyTo: ctx.messageId,
    ...ctx.threadId ? { replyInThread: true } : {}
  };
}
async function replyText(ctx, text) {
  try {
    await ctx.lark.sendText(ctx.chatId, text, replyOpts(ctx));
  } catch (err) {
    log.error("\u547D\u4EE4\u56DE\u590D\u5931\u8D25: %s", err.message);
  }
}
async function replyCard(ctx, card) {
  try {
    await ctx.lark.sendCard(ctx.chatId, card, replyOpts(ctx));
  } catch (err) {
    log.error("\u547D\u4EE4\u5361\u7247\u5931\u8D25: %s", err.message);
  }
}
async function requirePrivilege(ctx) {
  if (isPrivileged(ctx.senderId, ctx.config, ctx.ownerOpenId)) return true;
  await replyText(ctx, "\u26A0\uFE0F \u6B64\u547D\u4EE4\u4EC5 bot owner / \u7BA1\u7406\u5458\u53EF\u7528\u3002");
  return false;
}
var HELP_BODY = `**\u600E\u4E48\u7528**

\u76F4\u63A5\u6253\u5B57\u53D1\u6D88\u606F\u5373\u53EF\uFF08\u7FA4\u804A\u8BF7 @\u6211\uFF09\u3002

**\u5E38\u7528\u547D\u4EE4**

- \`/new\` \u2014 \u6362\u4E2A\u65B0\u8BDD\u9898
- \`/stop\` \u2014 \u505C\u4E0B\u6B63\u5728\u505A\u7684\u4E8B\uFF08\u4E5F\u53EF\u70B9\u5361\u7247\u300C\u7EC8\u6B62\u300D\uFF09
- \`/status\` \u2014 \u5F53\u524D\u72B6\u6001\uFF08cwd / \u4F1A\u8BDD / \u961F\u5217 / \u540E\u53F0\u670D\u52A1 / \u9644\u4EF6\u7F13\u5B58\uFF09
- \`/whoami\` \u2014 \u67E5\u770B\u6211\u7684\u7528\u6237\u7F16\u53F7\uFF08\u7ED9\u7BA1\u7406\u5458\u7528\uFF09
- \`/help\` \u2014 \u672C\u8BF4\u660E

**\u8FDB\u9636\uFF08\u4E00\u822C\u4E0D\u7528\uFF09**

- \`/cd \u6587\u4EF6\u5939\u8DEF\u5F84\` \u2014 \u6362\u9879\u76EE\u6587\u4EF6\u5939\uFF08\u9700\u7BA1\u7406\u5458\uFF09
- \`/ws\` \u2014 \u547D\u540D\u5DE5\u4F5C\u76EE\u5F55\uFF08\u9700\u7BA1\u7406\u5458\uFF09
  - \`/ws\` / \`/ws list\` \u2014 \u5217\u51FA\u522B\u540D
  - \`/ws add <name> [path]\` \u2014 \u4FDD\u5B58\u522B\u540D\uFF08\u9ED8\u8BA4\u5F53\u524D cwd\uFF09
  - \`/ws save <name>\` \u2014 \u628A\u5F53\u524D cwd \u5B58\u6210\u522B\u540D
  - \`/ws use <name>\` \u2014 \u5207\u6362\u5230\u522B\u540D\u76EE\u5F55
  - \`/ws rm <name>\` \u2014 \u5220\u9664\u522B\u540D
- \`/timeout\` \u2014 \u8C03\u6574\u8D85\u65F6
- \`/invite\` \`/remove\` \u2014 \u767D\u540D\u5355 / \u7BA1\u7406\u5458
`;
async function handleCommand(text, ctx) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { handled: false };
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0] ?? "";
  const arg = parts.slice(1).join(" ");
  log.info("\u547D\u4EE4: %s [scope=%s sender=%s]", cmd, ctx.scope, ctx.senderId);
  switch (cmd) {
    case "/new":
    case "/reset": {
      const wasRunning = ctx.session.isRunning(ctx.scope);
      if (wasRunning) ctx.session.abort(ctx.scope);
      ctx.session.clear(ctx.scope);
      await replyText(ctx, wasRunning ? "\u5DF2\u4E2D\u65AD\u5F53\u524D\u4EFB\u52A1\u5E76\u5F00\u59CB\u65B0\u4F1A\u8BDD\u3002" : "\u5DF2\u5F00\u59CB\u65B0\u4F1A\u8BDD\u3002");
      return { handled: true };
    }
    case "/help": {
      await replyCard(ctx, infoCard("\u{1F4A1} \u4F7F\u7528\u5E2E\u52A9", HELP_BODY));
      return { handled: true };
    }
    case "/whoami":
    case "/id": {
      await replyText(
        ctx,
        `\u4F60\u7684\u7528\u6237\u7F16\u53F7\uFF1A\`${ctx.senderId}\`

\u82E5\u8981\u8BA9\u7BA1\u7406\u5458\u628A\u4F60\u52A0\u8FDB\u53EF\u7528\u540D\u5355\uFF0C\u628A\u4E0A\u9762\u8FD9\u4E32\u53D1\u7ED9\u5BF9\u65B9\uFF0C\u5BF9\u65B9\u53D1\u9001\uFF1A
\`/invite admin ${ctx.senderId}\``
      );
      return { handled: true };
    }
    case "/stop": {
      ctx.session.abort(ctx.scope);
      await replyText(ctx, "\u5DF2\u53D1\u9001\u7EC8\u6B62\u4FE1\u53F7\u3002");
      return { handled: true };
    }
    case "/status": {
      await replyCard(ctx, buildStatusCard(ctx));
      return { handled: true };
    }
    case "/cd": {
      if (!await requirePrivilege(ctx)) return { handled: true };
      if (!arg) {
        await replyText(ctx, "\u7528\u6CD5\uFF1A`/cd <\u7EDD\u5BF9\u8DEF\u5F84>` \u6216 `/cd ~/projects/foo`");
        return { handled: true };
      }
      try {
        const abs = validateWorkspaceDir(arg);
        if (ctx.session.isRunning(ctx.scope)) ctx.session.abort(ctx.scope);
        ctx.session.setCwd(ctx.scope, abs);
        saveCopilotConfig({ copilotCwd: abs });
        await replyText(ctx, `\u2713 \u5DF2\u5207\u6362 cwd \u5230 \`${abs}\`
\uFF08\u672C\u4F1A\u8BDD\u5DF2\u91CD\u7F6E\uFF1B\u4E0B\u6B21\u542F\u52A8\u9ED8\u8BA4\u4E5F\u7528\u6B64\u76EE\u5F55\uFF09`);
      } catch (err) {
        await replyText(ctx, `\u274C ${err.message}`);
      }
      return { handled: true };
    }
    case "/ws": {
      if (!await requirePrivilege(ctx)) return { handled: true };
      return handleWs(arg, ctx);
    }
    case "/timeout": {
      return handleTimeout(arg, ctx);
    }
    case "/invite": {
      if (!await requirePrivilege(ctx)) return { handled: true };
      const [sub, ...rest] = arg.trim().split(/\s+/);
      const target = rest.join(" ");
      try {
        if (sub === "group") {
          const added = addAllowedChat(ctx.config, ctx.chatId);
          await replyText(ctx, added ? "\u2705 \u5DF2\u628A\u5F53\u524D\u7FA4\u52A0\u5165\u767D\u540D\u5355\uFF08\u7ACB\u5373\u751F\u6548\uFF09\u3002" : "\u5F53\u524D\u7FA4\u5DF2\u5728\u767D\u540D\u5355\u4E2D\u3002");
        } else if (sub === "admin") {
          if (!target) {
            await replyText(
              ctx,
              "\u7528\u6CD5\uFF1A`/invite admin <open_id>`\n\n\u5BF9\u65B9\u5148\u79C1\u804A\u673A\u5668\u4EBA\u53D1 `/whoami`\uFF0C\u628A\u8FD4\u56DE\u7684 open_id \u53D1\u7ED9\u4F60\u5373\u53EF\u3002"
            );
          } else {
            const added = addAdmin(ctx.config, target);
            await replyText(ctx, added ? `\u2705 \u5DF2\u6DFB\u52A0\u7BA1\u7406\u5458\uFF1A${target}` : `${target} \u5DF2\u662F\u7BA1\u7406\u5458`);
          }
        } else {
          await replyText(
            ctx,
            "\u7528\u6CD5\uFF1A\n\u2022 `/invite group` \u2014 \u628A\u5F53\u524D\u7FA4\u52A0\u5165\u767D\u540D\u5355\n\u2022 `/invite admin <open_id>` \u2014 \u6DFB\u52A0\u7BA1\u7406\u5458\n\n\u83B7\u53D6 open_id\uFF1A\u8BA9\u5BF9\u65B9\u53D1 `/whoami`"
          );
        }
      } catch (err) {
        await replyText(ctx, `\u274C ${err.message}`);
      }
      return { handled: true };
    }
    case "/remove": {
      if (!await requirePrivilege(ctx)) return { handled: true };
      const [sub, ...rest] = arg.trim().split(/\s+/);
      const target = rest.join(" ");
      try {
        if (sub === "group") {
          const removed = removeAllowedChat(ctx.config, ctx.chatId);
          await replyText(ctx, removed ? "\u2705 \u5DF2\u628A\u5F53\u524D\u7FA4\u79FB\u51FA\u767D\u540D\u5355\u3002" : "\u5F53\u524D\u7FA4\u4E0D\u5728\u767D\u540D\u5355\u4E2D\u3002");
        } else if (sub === "admin") {
          if (!target) {
            await replyText(ctx, "\u7528\u6CD5\uFF1A`/remove admin <open_id>`");
          } else {
            const removed = removeAdmin(ctx.config, target);
            await replyText(ctx, removed ? `\u2705 \u5DF2\u79FB\u9664\u7BA1\u7406\u5458\uFF1A${target}` : `${target} \u4E0D\u662F\u7BA1\u7406\u5458`);
          }
        } else {
          await replyText(ctx, "\u7528\u6CD5\uFF1A`/remove group` \u6216 `/remove admin <open_id>`");
        }
      } catch (err) {
        await replyText(ctx, `\u274C ${err.message}`);
      }
      return { handled: true };
    }
    default: {
      const name = cmd.slice(1);
      if (/^[a-z][\w-]*$/i.test(name)) {
        await replyText(ctx, `\u672A\u77E5\u547D\u4EE4 \`${cmd}\`\u3002\u53D1 /help \u67E5\u770B\u53EF\u7528\u547D\u4EE4\u3002`);
        return { handled: true };
      }
      return { handled: false };
    }
  }
}
async function handleWs(arg, ctx) {
  const [sub, wsName, ...pathParts] = arg.split(/\s+/);
  const pathArg = pathParts.join(" ");
  switch (sub) {
    case "":
    case "list": {
      const wsMap = list();
      const currentCwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
      const entries = Object.entries(wsMap);
      let body;
      if (entries.length === 0) {
        body = `\u5F53\u524D cwd\uFF1A\`${currentCwd}\`

\u6682\u65E0\u547D\u540D\u5DE5\u4F5C\u76EE\u5F55\u3002
\u{1F4A1} \`/ws add <name>\` \u6216 \`/ws save <name>\` \u4FDD\u5B58\u522B\u540D`;
      } else {
        const lines = entries.map(
          ([n, p]) => `- **${n}** \u2192 \`${p}\`${p === currentCwd ? "  \u2190 \u5F53\u524D" : ""}`
        );
        body = `\u5F53\u524D cwd\uFF1A\`${currentCwd}\`

${lines.join("\n")}`;
      }
      await replyCard(ctx, infoCard("\u{1F4C2} \u5DE5\u4F5C\u76EE\u5F55", body));
      return { handled: true };
    }
    case "add": {
      if (!wsName) {
        await replyText(ctx, "\u7528\u6CD5\uFF1A`/ws add <name> [path]`");
        return { handled: true };
      }
      const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
      const pathToSave = pathArg || cwd;
      try {
        const abs = save(wsName, pathToSave);
        await replyText(ctx, `\u2713 \u5DF2\u4FDD\u5B58\uFF1A\`${wsName}\` \u2192 ${abs}`);
      } catch (err) {
        await replyText(ctx, `\u274C ${err.message}`);
      }
      return { handled: true };
    }
    case "save": {
      if (!wsName) {
        await replyText(ctx, "\u7528\u6CD5\uFF1A`/ws save <name>`");
        return { handled: true };
      }
      const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
      try {
        const abs = save(wsName, cwd);
        await replyText(ctx, `\u2713 \u5DF2\u4FDD\u5B58\uFF1A\`${wsName}\` \u2192 ${abs}`);
      } catch (err) {
        await replyText(ctx, `\u274C ${err.message}`);
      }
      return { handled: true };
    }
    case "use": {
      if (!wsName) {
        await replyText(ctx, "\u7528\u6CD5\uFF1A`/ws use <name>`");
        return { handled: true };
      }
      try {
        const abs = use(wsName);
        if (ctx.session.isRunning(ctx.scope)) ctx.session.abort(ctx.scope);
        ctx.session.setCwd(ctx.scope, abs);
        saveCopilotConfig({ copilotCwd: abs });
        await replyText(ctx, `\u2713 \u5DF2\u5207\u6362\u5230 \`${wsName}\` \u2192 ${abs}
\uFF08\u672C\u4F1A\u8BDD\u5DF2\u91CD\u7F6E\uFF1B\u4E0B\u6B21\u542F\u52A8\u9ED8\u8BA4\u4E5F\u7528\u6B64\u76EE\u5F55\uFF09`);
      } catch (err) {
        await replyText(ctx, `\u274C ${err.message}`);
      }
      return { handled: true };
    }
    case "rm":
    case "remove": {
      if (!wsName) {
        await replyText(ctx, "\u7528\u6CD5\uFF1A`/ws rm <name>` \u6216 `/ws remove <name>`");
        return { handled: true };
      }
      try {
        const ok = remove(wsName);
        await replyText(ctx, ok ? `\u2713 \u5DF2\u5220\u9664 \`${wsName}\`` : `\u274C \u672A\u627E\u5230 \`${wsName}\``);
      } catch (err) {
        await replyText(ctx, `\u274C ${err.message}`);
      }
      return { handled: true };
    }
    default: {
      await replyText(ctx, "\u7528\u6CD5\uFF1A`/ws list|add|save|use|rm`");
      return { handled: true };
    }
  }
}
async function handleTimeout(arg, ctx) {
  const v = arg.trim().toLowerCase();
  if (!v) {
    const cur = ctx.session.idleTimeoutFor(ctx.scope);
    const desc = cur === void 0 ? "\u9ED8\u8BA4" : cur === 0 ? "\u5173\u95ED" : `${cur} \u5206\u949F`;
    await replyText(ctx, `\u5F53\u524D\u8D85\u65F6\uFF1A${desc}
\u7528\u6CD5\uFF1A\`/timeout <\u5206\u949F>\` \u6216 \`/timeout off\``);
    return { handled: true };
  }
  if (v === "off" || v === "0") {
    ctx.session.setIdleTimeout(ctx.scope, 0);
    await replyText(ctx, "\u2713 \u5DF2\u5173\u95ED\u8D85\u65F6");
    return { handled: true };
  }
  const n = Number(v);
  const MAX_TIMEOUT_MIN = 24 * 60;
  if (!Number.isFinite(n) || n < 0) {
    await replyText(ctx, "\u7528\u6CD5\uFF1A`/timeout <\u5206\u949F>` \u6216 `/timeout off`");
    return { handled: true };
  }
  if (n > MAX_TIMEOUT_MIN) {
    await replyText(ctx, `\u274C \u8D85\u65F6\u4E0A\u9650 ${MAX_TIMEOUT_MIN} \u5206\u949F\uFF0824h\uFF09`);
    return { handled: true };
  }
  ctx.session.setIdleTimeout(ctx.scope, n);
  await replyText(ctx, `\u2713 \u8D85\u65F6\u5DF2\u8BBE\u4E3A ${n} \u5206\u949F`);
  return { handled: true };
}
function shortId(id, keep = 8) {
  if (!id) return "\u65E0";
  if (id.length <= keep * 2 + 1) return id;
  return `${id.slice(0, keep)}\u2026${id.slice(-4)}`;
}
function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve5(a) === resolve5(b);
  }
}
function daemonStatusLine(appId) {
  const adapter = getServiceAdapter();
  if (!adapter) return "\u5F53\u524D\u7CFB\u7EDF\u4E0D\u652F\u6301 OS \u5B88\u62A4\u8FDB\u7A0B";
  if (!adapter.fileExists()) return `\u672A\u6CE8\u518C\uFF08\u53EF\u7528 \`start\` \u540E\u53F0\u5E38\u9A7B \xB7 ${adapter.platformName}\uFF09`;
  if (!adapter.isRunning()) return `\u5DF2\u6CE8\u518C\u4F46\u672A\u8FD0\u884C\uFF08\`start\` \u53EF\u62C9\u8D77 \xB7 ${adapter.platformName}\uFF09`;
  const { pid: pidStr } = adapter.parseStatus(adapter.describeStatus());
  const pid = pidStr ? Number(pidStr) : NaN;
  const pidOk = Number.isFinite(pid) && pid > 0;
  const entry = pidOk ? readLive().find((e) => e.pid === pid && e.appId === appId) : readLive().find((e) => e.appId === appId && (e.ready || e.botName));
  const self = pidOk && pid === process.pid ? "\uFF08\u672C\u8FDB\u7A0B\uFF09" : "";
  const bits = [
    "\u8FD0\u884C\u4E2D",
    pidOk ? `pid ${pid}${self}` : void 0,
    entry?.botName ? `bot ${entry.botName}` : void 0,
    adapter.platformName
  ].filter(Boolean);
  return bits.join(" \xB7 ");
}
function buildStatusCard(ctx) {
  const privileged = isPrivileged(ctx.senderId, ctx.config, ctx.ownerOpenId);
  const running = ctx.session.isRunning(ctx.scope);
  const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
  const pending = ctx.queue.pendingCount(ctx.scope);
  const timeout = ctx.session.idleTimeoutFor(ctx.scope);
  const scopeTimeoutDesc = timeout === void 0 ? "\u8DDF\u968F\u9ED8\u8BA4" : timeout === 0 ? "\u5173\u95ED" : `${timeout} \u5206\u949F`;
  const defaultTimeoutMin = Math.round(ctx.config.copilotTimeout / 6e4);
  const defaultTimeoutDesc = ctx.config.copilotTimeout > 0 ? `${defaultTimeoutMin} \u5206\u949F` : "\u4E0D\u9650\u5236";
  const wsMap = list();
  const wsEntries = Object.entries(wsMap);
  const matchedAlias = wsEntries.find(([, p]) => samePath(p, cwd))?.[0];
  const wsLine = wsEntries.length === 0 ? "\u65E0" : matchedAlias ? `${wsEntries.length} \u4E2A\uFF08\u5F53\u524D \`${matchedAlias}\`\uFF09` : `${wsEntries.length} \u4E2A`;
  const sessionId = ctx.session.sessionIdFor(ctx.scope);
  const bot = ctx.lark.botIdentity;
  const lines = [
    `**\u672C\u4F1A\u8BDD**`,
    `\xB7 \u72B6\u6001\uFF1A${running ? "\u5904\u7406\u4E2D" : "\u7A7A\u95F2"}${pending > 0 ? ` \xB7 \u961F\u5217 ${pending}` : ""}`,
    `\xB7 cwd\uFF1A\`${cwd}\``,
    `\xB7 /ws\uFF1A${wsLine}`,
    `\xB7 Copilot session\uFF1A\`${shortId(sessionId)}\``,
    `\xB7 \u8D85\u65F6\uFF1A\u672C\u4F1A\u8BDD ${scopeTimeoutDesc}\uFF08\u9ED8\u8BA4 ${defaultTimeoutDesc}\uFF09`,
    `\xB7 scope\uFF1A\`${ctx.scope}\``
  ];
  if (privileged) {
    const media = mediaCacheStats();
    const runningScopes = ctx.session.runningScopes();
    lines.push(
      "",
      `**\u672C\u673A**`,
      `\xB7 \u673A\u5668\u4EBA\uFF1A${bot?.name ? `${bot.name}` : "\uFF08\u672A\u77E5\uFF09"}${bot?.openId ? ` \xB7 \`${shortId(bot.openId, 6)}\`` : ""}`,
      `\xB7 \u540E\u53F0\u5E38\u9A7B\uFF1A${daemonStatusLine(ctx.config.credentials.appId)}`,
      `\xB7 \u5168\u5C40\u8FDB\u884C\u4E2D\uFF1A${runningScopes.length === 0 ? "\u65E0" : `${runningScopes.length} \u4E2A scope`}`,
      `\xB7 \u9644\u4EF6\u7F13\u5B58\uFF1A${media.label}`
    );
  } else {
    lines.push(
      "",
      `**\u672C\u673A**`,
      `\xB7 \u673A\u5668\u4EBA\uFF1A${bot?.name ? `${bot.name}` : "\uFF08\u672A\u77E5\uFF09"}`,
      `\xB7 \u540E\u53F0\u5E38\u9A7B / \u5168\u5C40\u4EFB\u52A1 / \u7F13\u5B58\uFF1A\u4EC5\u7BA1\u7406\u5458\u53EF\u89C1`
    );
  }
  return infoCard("\u{1F4CA} \u5F53\u524D\u72B6\u6001", lines.join("\n"));
}

// src/card/run-state.ts
function initialState() {
  return {
    blocks: [],
    reasoning: { content: "", active: false },
    footer: "thinking",
    terminal: "running"
  };
}
function closeStreamingText(blocks) {
  return blocks.map(
    (b) => b.kind === "text" && b.streaming ? { ...b, streaming: false } : b
  );
}
function hasVisibleCardContent(state) {
  if (answerText(state)) return true;
  if (state.blocks.some((b) => b.kind === "tool")) return true;
  if (state.reasoning.content.trim()) return true;
  return false;
}
function reduce(state, evt) {
  if (state.terminal !== "running" && evt.type !== "system" && evt.type !== "done" && evt.type !== "error") {
    return state;
  }
  switch (evt.type) {
    case "text": {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.kind === "text" && last.streaming) {
        const next = { ...last, content: last.content + evt.delta };
        return {
          ...state,
          blocks: [...state.blocks.slice(0, -1), next],
          reasoning: { ...state.reasoning, active: false },
          footer: "streaming",
          statusNote: void 0
        };
      }
      return {
        ...state,
        blocks: [...state.blocks, { kind: "text", content: evt.delta, streaming: true }],
        reasoning: { ...state.reasoning, active: false },
        footer: "streaming",
        statusNote: void 0
      };
    }
    case "text_replace": {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.kind === "text" && last.streaming) {
        return {
          ...state,
          blocks: [...state.blocks.slice(0, -1), { ...last, content: evt.content }],
          reasoning: { ...state.reasoning, active: false },
          footer: "streaming",
          statusNote: void 0
        };
      }
      return {
        ...state,
        blocks: [...state.blocks, { kind: "text", content: evt.content, streaming: true }],
        reasoning: { ...state.reasoning, active: false },
        footer: "streaming",
        statusNote: void 0
      };
    }
    case "final_text":
      return { ...state, finalText: evt.content };
    case "thinking":
      return {
        ...state,
        reasoning: { content: state.reasoning.content + evt.delta, active: true },
        footer: "thinking",
        statusNote: void 0
      };
    case "awaiting_permission":
      if (evt.active) {
        return {
          ...state,
          footer: "awaiting_permission",
          statusNote: "\u7B49\u5F85\u5DE5\u5177\u6743\u9650\u786E\u8BA4\u2026"
        };
      }
      return {
        ...state,
        footer: state.footer === "awaiting_permission" ? "thinking" : state.footer,
        statusNote: void 0
      };
    case "tool_use": {
      const tool = {
        id: evt.id,
        name: evt.name,
        input: evt.input,
        status: "running"
      };
      return {
        ...state,
        blocks: [...closeStreamingText(state.blocks), { kind: "tool", tool }],
        reasoning: { ...state.reasoning, active: false },
        footer: "tool_running",
        statusNote: void 0
      };
    }
    case "tool_result": {
      const blocks = state.blocks.map((b) => {
        if (b.kind !== "tool" || b.tool.id !== evt.id) return b;
        return {
          ...b,
          tool: {
            ...b.tool,
            status: evt.isError ? "error" : "done",
            output: evt.output
          }
        };
      });
      return { ...state, blocks };
    }
    case "system":
      return {
        ...state,
        ...evt.sessionId ? { sessionId: evt.sessionId } : {}
      };
    case "error": {
      if (evt.terminationReason === "timeout") {
        return state;
      }
      const terminal = evt.terminationReason === "interrupted" ? "interrupted" : "error";
      return sealTerminal(state, terminal, {
        errorMsg: evt.message || state.errorMsg,
        collapseText: terminal === "error"
      });
    }
    case "done": {
      const terminal = evt.terminationReason === "interrupted" ? "interrupted" : evt.terminationReason === "timeout" ? "wall_timeout" : "done";
      return sealTerminal(state, terminal, {
        collapseText: terminal === "done" || terminal === "wall_timeout"
      });
    }
    default:
      return state;
  }
}
function sealTerminal(state, terminal, opts) {
  let blocks = closeStreamingText(state.blocks);
  if (opts.collapseText) {
    blocks = finalizeTextBlocks(blocks, state.finalText);
  } else if (state.finalText?.trim()) {
    const hasText = blocks.some((b) => b.kind === "text" && b.content.trim());
    if (!hasText) {
      blocks = [...blocks, { kind: "text", content: state.finalText, streaming: false }];
    }
  }
  return {
    ...state,
    blocks,
    reasoning: { ...state.reasoning, active: false },
    terminal,
    footer: null,
    statusNote: void 0,
    ...opts.errorMsg !== void 0 ? { errorMsg: opts.errorMsg } : {}
  };
}
function markInterrupted(state) {
  if (state.terminal === "interrupted") return state;
  return sealTerminal(state, "interrupted", { collapseText: false });
}
function markWallTimeout(state, seconds, message) {
  const msg = message ?? (seconds > 0 ? `\u4EFB\u52A1\u8D85\u65F6\uFF08\u8D85\u8FC7 ${seconds}s\uFF09` : "\u4EFB\u52A1\u8D85\u65F6");
  const next = sealTerminal(state, "wall_timeout", { errorMsg: msg, collapseText: true });
  return {
    ...next,
    wallTimeoutSeconds: seconds > 0 ? seconds : void 0
  };
}
function finalizeIfRunning(state) {
  if (state.terminal !== "running") return state;
  return reduce(state, { type: "done", terminationReason: "completed" });
}
function finalizeTextBlocks(blocks, finalText) {
  let lastTextIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && b.kind === "text" && b.content.trim()) lastTextIdx = i;
  }
  const answer = (finalText ?? "").trim() || (lastTextIdx >= 0 ? blocks[lastTextIdx].content.trim() : "") || "";
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "tool") {
      out.push(b);
      continue;
    }
    if (i === lastTextIdx) {
      if (answer) out.push({ kind: "text", content: answer, streaming: false });
    }
  }
  if (lastTextIdx < 0 && answer) {
    out.push({ kind: "text", content: answer, streaming: false });
  }
  return out;
}
function answerText(state) {
  if (state.finalText?.trim()) return state.finalText.trim();
  const texts = state.blocks.filter((b) => b.kind === "text").map((b) => b.content.trim()).filter(Boolean);
  return (texts[texts.length - 1] ?? "").trim();
}

// src/keepalive.ts
var KEEPALIVE_INTERVAL_MS = 15e3;
var SLEEP_DETECT_MS = 3e4;
var DEAD_THRESHOLD = 3;
var RECONNECT_TIMEOUT_MS = 2e4;
function startKeepalive(deps) {
  const { getConnectionStatus, forceReconnect } = deps;
  let lastTick = 0;
  let consecutiveDown = 0;
  let stopped = false;
  let reconnecting = false;
  const tick = async () => {
    if (stopped || reconnecting) return;
    const now = Date.now();
    const sinceLast = lastTick > 0 ? now - lastTick : 0;
    if (sinceLast > 0 && sinceLast < 5e3) return;
    if (sinceLast > SLEEP_DETECT_MS) {
      consecutiveDown = 0;
      lastTick = now;
      return;
    }
    lastTick = now;
    const status = getConnectionStatus();
    if (!status) return;
    if (status.state === "connected") {
      if (consecutiveDown > 0) log.info("keepalive \u6062\u590D (after %d ticks)", consecutiveDown);
      consecutiveDown = 0;
      return;
    }
    consecutiveDown++;
    log.warn("keepalive: ws \u65AD\u5F00 (%d/%d) state=%s", consecutiveDown, DEAD_THRESHOLD, status.state);
    if (consecutiveDown >= DEAD_THRESHOLD) {
      consecutiveDown = 0;
      reconnecting = true;
      log.warn("keepalive: \u89E6\u53D1 forceReconnect");
      try {
        await Promise.race([
          forceReconnect(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`reconnect \u8D85\u65F6 ${RECONNECT_TIMEOUT_MS}ms`)), RECONNECT_TIMEOUT_MS);
          })
        ]);
      } catch (err) {
        log.error("keepalive forceReconnect \u5931\u8D25: %s", err.message);
      } finally {
        reconnecting = false;
      }
    }
  };
  const timer = setInterval(() => {
    void tick().catch((err) => log.error("keepalive tick: %s", err.message));
  }, KEEPALIVE_INTERVAL_MS);
  return { stop: () => {
    stopped = true;
    clearInterval(timer);
  } };
}

// src/bridge-prompt.ts
var BRIDGE_SYSTEM_PROMPT = `# lark-copilot-bridge \u8FD0\u884C\u7EA6\u5B9A

\u4F60\u6B63\u5728 lark-copilot-bridge \u91CC\u8DD1\uFF1A\u628A\u98DE\u4E66\u7528\u6237\u6D88\u606F\u6865\u63A5\u5230\u672C\u5730 copilot CLI\u3002

## bridge_context

\u6BCF\u6761\u6D88\u606F\u9876\u90E8\u4F1A\u5E26\u4E00\u4E2A <bridge_context> \u5757\uFF1A
{"chatId":"oc_xxx","chatType":"p2p|group","senderId":"ou_xxx","senderName":"...","botOpenId":"ou_xxx","source":"im"}

\u5173\u952E\u5B57\u6BB5\uFF1A
- botOpenId\uFF1A\u4F60\u81EA\u5DF1\u7684 open_id
- chatType\uFF1Ap2p\uFF08\u79C1\u804A\uFF09\u6216 group\uFF08\u7FA4\u804A\uFF09
- senderId/senderName\uFF1A\u53D1\u9001\u8005

\u8FD9\u4E9B\u90FD\u662F bridge \u6CE8\u5165\u7684\u5143\u6570\u636E\uFF0C\u4E0D\u8981\u7167\u6284\u5230\u56DE\u590D\u91CC\u2014\u2014\u5BF9\u7528\u6237\u4E0D\u53EF\u89C1\u3002

## quoted_message

\u7528\u6237\u7528"\u5F15\u7528\u56DE\u590D"\u6307\u5411\u67D0\u6761\u6D88\u606F\u65F6\uFF0Cbridge \u4F1A\u6CE8\u5165 <quoted_message> \u5757\uFF0C\u662F\u88AB\u5F15\u7528\u6D88\u606F\u7684\u5185\u5BB9\u3002
\u8FD9\u662F\u7528\u6237\u6307\u5411\u7684\u5BF9\u8C61\uFF0C\u56F4\u7ED5\u5B83\u5C55\u5F00\u56DE\u7B54\u3002\u4E0D\u8981\u7167\u6284 XML \u6807\u7B7E\u3002

## \u591A\u6D88\u606F\u6807\u6CE8

\u591A\u6761\u6D88\u606F\u5728\u77ED\u65F6\u95F4\u5185\u5408\u5E76\u9001\u8FBE\u65F6\uFF0C\u6BCF\u6BB5\u4F1A\u5E26 [\u540D\u5B57 (user|bot)]: \u884C\u9996\u6807\u6CE8\u4EE5\u533A\u5206\u53D1\u9001\u8005\u3002
\u8FD9\u662F bridge \u6CE8\u5165\u7684\u5C55\u793A\u683C\u5F0F\uFF0C\u56DE\u590D\u65F6\u4E0D\u8981\u6A21\u4EFF\u8FD9\u79CD\u6807\u6CE8\u3002

## \u7A7A\u6D88\u606F

\u5982\u679C\u6D88\u606F\u5185\u5BB9\u662F"\u53EA @ \u4E86\u4F60\u7684\u5524\u9192\uFF08ping\uFF09"\uFF0C\u8BF7\u7B80\u77ED\u56DE\u5E94\uFF0C\u4E0D\u8981\u8FFD\u95EE\u3002

## \u7FA4\u804A\u534F\u4F5C

- \u7FA4\u91CC\u53EA\u6709\u771F\u5B9E @\uFF08\u7ED3\u6784\u5316 mention\uFF09\u624D\u80FD\u8BA9\u5176\u4ED6 bot \u6536\u5230\u6D88\u606F
- \u9ED8\u8BA4\u4E0D\u8981 @ \u5176\u4ED6 bot\uFF0C\u907F\u514D\u6B7B\u5FAA\u73AF
- \u56DE\u590D\u4EBA\u7C7B\u4E0D\u9700\u8981 @

## \u5DE5\u4F5C\u76EE\u5F55

\u4F60\u5728\u914D\u7F6E\u7684\u5DE5\u4F5C\u76EE\u5F55\u4E0B\u8FD0\u884C\uFF0C\u53EF\u4EE5\u8BFB\u5199\u6587\u4EF6\u3001\u6267\u884C\u547D\u4EE4\u3002\u7528\u6237\u53EF\u80FD\u901A\u8FC7 /cd \u5207\u6362\u5DE5\u4F5C\u76EE\u5F55\u3002
`;
function buildSystemPrompt(botOpenId, botName) {
  if (!botOpenId) return BRIDGE_SYSTEM_PROMPT;
  const nameSuffix = botName ? `\uFF0C\u540D\u5B57\u662F\u300C${botName}\u300D` : "";
  return `${BRIDGE_SYSTEM_PROMPT}
## \u4F60\u7684\u8EAB\u4EFD

\u4F60\u7684 open_id \u662F \`${botOpenId}\`${nameSuffix}\u3002\u6D88\u606F\u5185\u5BB9\u6216 mentions \u91CC\u51FA\u73B0\u8FD9\u4E2A open_id \u90FD\u662F\u6307\u4F60\u81EA\u5DF1\u3002
`;
}

// src/prompt-util.ts
function bridgeContextBlock(fields) {
  return `<bridge_context>
${JSON.stringify(fields)}
</bridge_context>

`;
}
function xmlBlock(tag, body) {
  return `<${tag}>
${escapeXmlText(body)}
</${tag}>

`;
}
function escapeXmlText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/media/strip.ts
var MD_IMAGE_RE = /!\[[^\]]*]\([^)]+\)/g;
var XML_MEDIA_RE = /<(?:file|image|media|audio|video|sticker)\b[^>]*\/?>/gi;
function stripAttachmentRefs(text) {
  return text.replace(MD_IMAGE_RE, "").replace(XML_MEDIA_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}
function emptyTextWithAttachmentsFallback() {
  return "\u8BF7\u770B\u9644\u4EF6\u3002";
}

// src/index.ts
process.on("unhandledRejection", (reason) => {
  log.error("\u672A\u5904\u7406 rejection: %s", reason);
});
process.on("uncaughtException", (err) => {
  log.error("\u672A\u6355\u83B7\u5F02\u5E38: %s", err.message);
});
async function main() {
  console.log("");
  console.log("\u6B63\u5728\u68C0\u67E5\u672C\u673A GitHub Copilot\u2026");
  if (!await checkCopilotInstalled()) {
    console.error("");
    console.error("\u8FD8\u4E0D\u80FD\u542F\u52A8\uFF1A\u672C\u673A\u6CA1\u6709\u53EF\u7528\u7684 GitHub Copilot \u547D\u4EE4\u884C\u5DE5\u5177\u3002");
    console.error("");
    console.error("\u8BF7\u6309\u987A\u5E8F\u505A\u8FD9\u4E24\u6B65\uFF08\u9700\u8981\u6709 Copilot \u8BA2\u9605\uFF09\uFF1A");
    console.error("  1) \u5B89\u88C5\uFF1A");
    console.error("       curl -fsSL https://gh.io/copilot-install | bash");
    console.error("  2) \u6253\u5F00\u7EC8\u7AEF\u8F93\u5165 copilot\uFF0C\u6309\u63D0\u793A\u7528 GitHub \u8D26\u53F7\u767B\u5F55");
    console.error("");
    console.error("\u505A\u5B8C\u540E\u53EF\u5148\u81EA\u68C0\uFF1A lark-copilot-bridge doctor");
    console.error("");
    process.exit(1);
  }
  console.log("\u2713 Copilot \u5DF2\u5C31\u7EEA");
  let creds = loadCredentials();
  if (!creds) {
    console.log("");
    console.log("\u7B2C\u4E00\u6B21\u4F7F\u7528\uFF1A\u8BF7\u7528\u624B\u673A\u98DE\u4E66\u626B\u63CF\u63A5\u4E0B\u6765\u7684\u4E8C\u7EF4\u7801\uFF0C\u521B\u5EFA\u673A\u5668\u4EBA\u3002");
    console.log("\uFF08\u53EA\u9700\u626B\u4E00\u6B21\uFF0C\u4EE5\u540E\u4F1A\u81EA\u52A8\u8BB0\u4F4F\uFF09");
    creds = await registerAppByQR();
    saveCredentials(creds);
  } else {
    log.info("\u4F7F\u7528\u5DF2\u4FDD\u5B58\u7684\u98DE\u4E66\u5E94\u7528: %s", creds.appId);
  }
  if (shouldRunSetup()) {
    const result = await runSetupWizard(creds);
    if (!result && !tryResolveWorkspaceDir()) {
      printSetupRequiredHint();
      process.exit(1);
    }
  }
  let config;
  try {
    config = loadConfig(creds);
  } catch (err) {
    console.error("");
    console.error(`\u65E0\u6CD5\u542F\u52A8\uFF1A${err.message}`);
    console.error("");
    console.error("\u8BF7\u8FD0\u884C\u8BBE\u7F6E\u5411\u5BFC\uFF1A lark-copilot-bridge setup");
    console.error("");
    process.exit(1);
  }
  const lark = new LarkBridge(creds);
  const session = new SessionStore(config.maxHistoryRounds);
  const ownerOpenId = creds.creatorOpenId;
  if (!ownerOpenId) {
    log.warn("\u672A\u8BB0\u5F55\u626B\u7801\u8D26\u53F7\uFF1A\u5EFA\u8BAE\u8FD0\u884C lark-copilot-bridge logout \u540E\u91CD\u65B0\u626B\u7801\u3002");
  }
  let queue;
  queue = new MessageQueue(600, (scope, batch) => {
    queue.block(scope);
    void runOne(batch, scope, { lark, session, queue, config, ownerOpenId }).finally(() => queue.unblock(scope));
  });
  const onCardAction = async (evt) => {
    const value = evt.action?.value ?? {};
    if (value.cmd !== "stop" || !value.scope) return;
    const senderId = evt.operator?.openId;
    if (!senderId) {
      log.warn("\u5361\u7247\u505C\u6B62\u88AB\u62D2\u7EDD: \u65E0 operator.openId");
      return;
    }
    if (!canUseBot(senderId, config, ownerOpenId)) {
      log.warn("\u5361\u7247\u505C\u6B62\u88AB\u62D2\u7EDD: sender=%s", senderId);
      return;
    }
    if (!evt.chatId) {
      log.warn("\u5361\u7247\u505C\u6B62\u88AB\u62D2\u7EDD: \u65E0 chatId");
      return;
    }
    if (!(value.scope === evt.chatId || value.scope.startsWith(`${evt.chatId}:`))) {
      log.warn("\u5361\u7247\u505C\u6B62 scope \u4E0E chat \u4E0D\u5339\u914D: scope=%s chat=%s", value.scope, evt.chatId);
      return;
    }
    const ok = session.abort(value.scope);
    log.info("\u5361\u7247\u505C\u6B62\u6309\u94AE: scope=%s ok=%s", value.scope, ok);
  };
  await lark.connect(
    (msg) => handleMessage(msg, { lark, session, queue, config, ownerOpenId }),
    onCardAction,
    (evt) => handleComment(evt, { lark, session, config, ownerOpenId })
  );
  registerProcess(creds.appId);
  markConnected(process.pid, lark.botIdentity?.name);
  void gcMediaCache().catch((err) => {
    log.warn("\u9644\u4EF6\u7F13\u5B58 GC \u5931\u8D25: %s", err.message);
  });
  const keepalive = startKeepalive({
    getConnectionStatus: () => lark.getConnectionStatus(),
    forceReconnect: async () => {
      log.warn("keepalive \u89E6\u53D1 reconnect");
      await lark.reconnect();
    }
  });
  let stopping = false;
  const stop2 = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`
\u6536\u5230 ${sig}\uFF0C\u6B63\u5728\u5173\u95ED...`);
    keepalive.stop();
    for (const scope of session.runningScopes()) session.abort(scope);
    unregisterProcess();
    try {
      await lark.disconnect();
    } catch (err) {
      log.error("disconnect \u5931\u8D25: %s", err.message);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void stop2("SIGINT"));
  process.on("SIGTERM", () => void stop2("SIGTERM"));
  printReadyBanner({
    botName: lark.botIdentity?.name,
    botOpenId: lark.botIdentity?.openId,
    cwd: config.copilotCwd,
    timeoutMs: config.copilotTimeout,
    allowedUsers: config.allowedUsers,
    ownerOpenId
  });
}
function printReadyBanner(opts) {
  const name = opts.botName || "\uFF08\u8BF7\u5728\u98DE\u4E66\u641C\u7D22\u521A\u521B\u5EFA\u7684\u5E94\u7528\u540D\uFF09";
  const timeoutMin = opts.timeoutMs > 0 ? `${Math.round(opts.timeoutMs / 6e4)} \u5206\u949F` : "\u4E0D\u9650\u5236";
  const who = opts.allowedUsers.length === 0 ? "\u4EFB\u4F55\u4EBA\uFF08\u53EA\u8981\u80FD\u627E\u5230\u8FD9\u4E2A\u673A\u5668\u4EBA\uFF09\u2014 \u6709\u98CE\u9669" : opts.ownerOpenId && opts.allowedUsers.length === 1 && opts.allowedUsers[0] === opts.ownerOpenId ? "\u4EC5\u4F60\u81EA\u5DF1" : `\u5DF2\u9650\u5236 ${opts.allowedUsers.length} \u4EBA`;
  console.log("");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log("  \u5DF2\u5C31\u7EEA\uFF0C\u53EF\u4EE5\u53BB\u98DE\u4E66\u804A\u5929\u4E86");
  console.log("");
  console.log(`  \u673A\u5668\u4EBA\u540D\u79F0: ${name}`);
  console.log(`  \u5B83\u4F1A\u6539\u8FD9\u91CC\u7684\u6587\u4EF6: ${opts.cwd}`);
  console.log(`  \u5355\u6B21\u4EFB\u52A1\u6700\u957F: ${timeoutMin}`);
  console.log(`  \u8C01\u80FD\u7528: ${who}`);
  console.log("");
  console.log("  \u63A5\u4E0B\u6765\u8BF7\u4F60\uFF1A");
  console.log(`    1. \u6253\u5F00\u98DE\u4E66\uFF0C\u641C\u7D22\u300C${opts.botName || "\u521A\u624D\u626B\u7801\u521B\u5EFA\u7684\u673A\u5668\u4EBA"}\u300D`);
  console.log("    2. \u70B9\u8FDB\u53BB\uFF0C\u76F4\u63A5\u53D1\u4E00\u53E5\u8BDD\uFF0C\u4F8B\u5982\uFF1A\u4F60\u597D");
  console.log("    3. \u7FA4\u804A\u91CC\u8981\u7528\u7684\u8BDD\uFF0C\u5FC5\u987B @ \u5B83");
  console.log("    4. \u4E5F\u53EF\u76F4\u63A5\u53D1\u56FE\u7247\u6216\u6587\u4EF6");
  console.log("");
  console.log("  \u5E38\u7528\uFF1A\u53D1 /help \u770B\u547D\u4EE4\uFF1B\u60F3\u6362\u9879\u76EE\u6587\u4EF6\u5939\u53EF\u8FD0\u884C");
  console.log("        lark-copilot-bridge setup");
  console.log("");
  console.log("  \u60F3\u5173\u6389\u7A97\u53E3\u4ECD\u4FDD\u6301\u5728\u7EBF\uFF1F\u53E6\u5F00\u7EC8\u7AEF\u8FD0\u884C\uFF1A");
  console.log("        lark-copilot-bridge start");
  if (opts.allowedUsers.length === 0) {
    console.log("  \u26A0 \u5F53\u524D\u4E0D\u9650\u5236\u4F7F\u7528\u8005\u3002\u53EF\u518D\u8FD0\u884C setup \u6539\u6210\u300C\u4EC5\u6211\u81EA\u5DF1\u300D\u3002");
  }
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log("");
}
async function handleMessage(msg, ctx) {
  const { lark, session, queue, config, ownerOpenId } = ctx;
  const scope = scopeOf(msg);
  const text = extractText(msg);
  log.info(
    "\u6536\u5230\u6D88\u606F: type=%s chat=%s mid=%s sender=%s textLen=%d mentionedBot=%s",
    msg.chatType,
    msg.chatId,
    msg.messageId,
    msg.senderId,
    text.length,
    msg.mentionedBot
  );
  if (msg.chatType === "group" && !isMentionedBot(msg)) {
    log.info("\u7FA4\u804A\u672A @bot\uFF0C\u5FFD\u7565");
    return;
  }
  if (!canUseBot(msg.senderId, config, ownerOpenId)) {
    log.warn("\u7528\u6237 %s \u65E0\u6743\u9650", msg.senderId);
    await lark.sendText(msg.chatId, "\u4F60\u6CA1\u6709\u4F7F\u7528\u6B64\u673A\u5668\u4EBA\u7684\u6743\u9650\u3002", { replyTo: msg.messageId });
    return;
  }
  if (msg.chatType === "group" && msg.senderId !== ownerOpenId && !config.admins.includes(msg.senderId) && config.allowedChats.length > 0 && !config.allowedChats.includes(msg.chatId)) {
    await lark.sendText(
      msg.chatId,
      "\u5F53\u524D\u7FA4\u5C1A\u672A\u52A0\u5165\u54CD\u5E94\u5217\u8868\u3002\nBot owner \u53EF\u5728\u672C\u7FA4\u53D1 /invite group \u52A0\u5165\u767D\u540D\u5355\u3002",
      { replyTo: msg.messageId, ...msg.threadId ? { replyInThread: true } : {} }
    );
    return;
  }
  const plainCmd = stripAttachmentRefs(text);
  const hasDownloadable = (msg.resources ?? []).some(isDownloadableResource);
  const cmdResult = await handleCommand(plainCmd || text, {
    lark,
    session,
    queue,
    config,
    chatId: msg.chatId,
    scope,
    messageId: msg.messageId,
    threadId: msg.threadId,
    senderId: msg.senderId,
    ownerOpenId
  });
  if (cmdResult.handled) {
    queue.cancel(scope);
    if (hasDownloadable) {
      await lark.sendText(
        msg.chatId,
        "\u547D\u4EE4\u5DF2\u6267\u884C\uFF1B\u672C\u6761\u6D88\u606F\u91CC\u7684\u9644\u4EF6\u5DF2\u5FFD\u7565\u3002\u82E5\u8981\u5904\u7406\u9644\u4EF6\uFF0C\u8BF7\u5355\u72EC\u53D1\u9001\u56FE\u7247/\u6587\u4EF6\uFF08\u4E0D\u8981\u5E26 / \u547D\u4EE4\uFF09\u3002",
        { replyTo: msg.messageId, ...msg.threadId ? { replyInThread: true } : {} }
      ).catch(() => void 0);
    }
    return;
  }
  queue.push(scope, msg);
  log.info("\u5DF2\u5165\u961F: scope=%s pending=%d", scope, queue.pendingCount(scope));
}
function messagePlainText(msg) {
  return stripAttachmentRefs(extractText(msg));
}
function mergeMessages(batch) {
  const texts = batch.map((m) => messagePlainText(m));
  if (batch.length === 1) return texts[0] ?? "";
  return batch.map((m, i) => {
    const name = m.senderName ?? m.senderId;
    const type = m.senderIsBot ? "bot" : "user";
    const t = texts[i] || "\uFF08\u65E0\u6B63\u6587\u6D88\u606F\uFF09";
    return `[${name} (${type})]: ${t}`;
  }).join("\n\n");
}
function collectResourceItems(batch) {
  const items = [];
  for (const msg of batch) {
    for (const r of msg.resources ?? []) {
      items.push({ messageId: msg.messageId, resource: r });
    }
  }
  return items;
}
function sendOptsFor(msg) {
  return {
    replyTo: msg.messageId,
    ...msg.threadId ? { replyInThread: true } : {}
  };
}
async function handleComment(evt, ctx) {
  if (!evt.mentionedBot) return;
  const { lark, session, config, ownerOpenId } = ctx;
  if (!canUseBot(evt.operator.openId, config, ownerOpenId)) return;
  const fetched = await lark.fetchComment(evt.fileToken, evt.fileType, evt.commentId);
  if (!fetched) return;
  const replies = fetched.replies ?? [];
  const targetReply = evt.replyId ? replies.find((r) => r.reply_id === evt.replyId) : replies[replies.length - 1];
  const question = replyElementsToText(targetReply);
  if (!question) return;
  const quote = fetched.quote || "";
  log.info("\u8BC4\u8BBA @bot: file=%s comment=%s qLen=%d", evt.fileToken.slice(-6), evt.commentId.slice(-6), question.length);
  const scope = `comment:${evt.fileToken}:${evt.commentId}`;
  const ac = session.tryMarkRunning(scope);
  if (!ac) {
    log.info("\u8BC4\u8BBA scope \u5FD9\uFF0C\u8DF3\u8FC7");
    return;
  }
  const runGen = session.generationFor(scope);
  try {
    const sessionId = session.sessionIdFor(scope);
    const cwd = session.cwdFor(scope) ?? config.copilotCwd;
    const prompt = xmlBlock("comment_context", `\u9009\u4E2D\u5185\u5BB9: ${quote}
\u8BC4\u8BBA\u95EE\u9898: ${question}`) + question;
    const result = await runCopilot({
      cwd,
      prompt,
      timeoutMs: config.copilotTimeout,
      extraArgs: config.copilotExtraArgs,
      sessionId,
      abortSignal: ac.signal
    });
    if (!result.aborted && result.sessionId) session.setSessionId(scope, result.sessionId, runGen);
    if (result.aborted) return;
    const reply = (result.stdout || "(\u65E0\u56DE\u590D)").slice(0, 2e3);
    await lark.replyComment(evt.fileToken, evt.fileType, evt.commentId, reply, Boolean(fetched.isWhole));
  } finally {
    session.markIdle(scope);
  }
}
function replyElementsToText(reply) {
  const elements = reply?.content?.elements ?? [];
  return elements.map((el) => el.type === "text_run" ? el.text_run?.text ?? "" : el.type === "docs_link" ? el.docs_link?.url ?? "" : "").join("").trim();
}
async function runOne(batch, scope, ctx) {
  const { lark, session, config } = ctx;
  const firstMsg = batch[0];
  const lastMsg = batch[batch.length - 1] ?? firstMsg;
  const text = mergeMessages(batch);
  const ac = session.markRunning(scope);
  const runGen = session.generationFor(scope);
  const chatId = lastMsg.chatId;
  try {
    const cwd = session.cwdFor(scope) ?? config.copilotCwd;
    const scopeTimeout = session.idleTimeoutFor(scope);
    const timeoutMs = scopeTimeout === 0 ? 0 : scopeTimeout !== void 0 ? scopeTimeout * 6e4 : config.copilotTimeout;
    log.info("\u5F00\u59CB\u5904\u7406: scope=%s chat=%s cwd=%s mid=%s batch=%d timeoutMs=%d", scope, chatId, cwd, lastMsg.messageId, batch.length, timeoutMs);
    const botOpenId = lark.botIdentity?.openId ?? "";
    const sessionId = session.sessionIdFor(scope);
    let quotedBlock = "";
    if (lastMsg.replyToMessageId) {
      const quoted = await lark.fetchQuotedText(lastMsg.replyToMessageId);
      if (quoted) quotedBlock = xmlBlock("quoted_message", quoted);
    }
    const systemPrefix = sessionId ? "" : buildSystemPrompt(botOpenId, lark.botIdentity?.name) + "\n\n";
    const ctxBlock = bridgeContextBlock({
      chatType: lastMsg.chatType,
      senderId: lastMsg.senderId,
      senderName: lastMsg.senderName ?? "",
      botOpenId,
      source: "im"
    });
    const batchMediaDir = mediaBatchDir(lastMsg.messageId);
    const media = new MediaCache(lark, batchMediaDir);
    const resourceItems = collectResourceItems(batch);
    const {
      accepted: attachments,
      skipped: mediaSkipped,
      downloadableCount
    } = await media.resolve(resourceItems);
    const sendOpts = sendOptsFor(lastMsg);
    let plain = text.trim();
    if (!plain && attachments.length > 0) {
      plain = emptyTextWithAttachmentsFallback();
    }
    if (downloadableCount > 0 && attachments.length === 0) {
      const detail = formatSkippedSummary(mediaSkipped) || "\u672A\u80FD\u4E0B\u8F7D\u9644\u4EF6\uFF08\u53EF\u80FD\u5DF2\u8FC7\u671F\u6216\u6743\u9650\u4E0D\u8DB3\uFF09";
      await lark.sendText(chatId, detail, sendOpts);
      return;
    }
    if (resourceItems.length > 0 && attachments.length === 0 && !plain) {
      const detail = formatSkippedSummary(mediaSkipped) || "\u6682\u4E0D\u652F\u6301\u8FD9\u7C7B\u9644\u4EF6";
      await lark.sendText(chatId, detail, sendOpts);
      return;
    }
    if (mediaSkipped.length > 0) {
      log.warn("\u9644\u4EF6\u90E8\u5206\u8DF3\u8FC7: %s", mediaSkipped.join("; "));
      await lark.sendText(
        chatId,
        formatSkippedSummary(mediaSkipped),
        sendOpts
      ).catch(() => void 0);
    }
    const userText = plain || "\uFF08\u5BF9\u65B9\u53D1\u6765\u4E00\u6761\u6CA1\u6709\u6B63\u6587\u7684\u6D88\u606F\u2014\u2014\u901A\u5E38\u662F\u53EA @ \u4E86\u4F60\u7684\u5524\u9192\u3002\u8BF7\u7B80\u77ED\u56DE\u5E94\u3002\uFF09";
    const historyUserText = userText;
    const userPart = sessionId ? userText : session.buildPrompt(scope, userText);
    const attachBlock = formatAttachmentsForPrompt(attachments);
    let topicBlock = "";
    if (lastMsg.threadId && !sessionId) {
      const topicMsgs = await lark.fetchTopicMessages(lastMsg.threadId);
      if (topicMsgs.length > 0) {
        topicBlock = xmlBlock("topic_context", topicMsgs.map((m) => `${m.senderName}: ${m.content}`).join("\n"));
      }
    }
    const prompt = systemPrefix + ctxBlock + quotedBlock + topicBlock + attachBlock + userPart;
    log.info(
      "\u8C03\u7528 copilot: promptLen=%d session=%s attachments=%d",
      prompt.length,
      sessionId ?? "(new)",
      attachments.length
    );
    let state = initialState();
    let updateFn = null;
    let cardClosed = false;
    let updateChain = Promise.resolve();
    const scheduleCardUpdate = () => {
      if (cardClosed || !updateFn) return;
      const snapshot = state;
      const doUpdate = updateFn;
      updateChain = updateChain.then(() => {
        if (cardClosed) return;
        return doUpdate(renderCard(snapshot, { scope }));
      }).catch((err) => {
        log.warn("\u6D41\u5F0F\u5361\u7247\u66F4\u65B0\u5931\u8D25: %s", err.message);
      });
    };
    const agentDone = runCopilot({
      cwd,
      prompt,
      timeoutMs,
      extraArgs: config.copilotExtraArgs,
      abortSignal: ac.signal,
      sessionId,
      attachments: attachments.map((a) => a.absPath),
      // 有附件时仅放行本批次媒体目录，供 Copilot 读本地文件
      ...attachments.length > 0 ? { addDirs: [batchMediaDir] } : {},
      onEvent: (evt) => {
        state = reduce(state, evt);
        scheduleCardUpdate();
      }
    });
    const applyTerminalOverrides = (result2) => {
      if (result2.aborted) {
        if (state.terminal === "running") state = markInterrupted(state);
        return;
      }
      if (result2.timedOut) {
        if (state.terminal === "running" || state.terminal === "wall_timeout") {
          const sec = timeoutMs > 0 ? Math.round(timeoutMs / 1e3) : 0;
          state = markWallTimeout(
            state,
            sec,
            sec > 0 ? `\u4EFB\u52A1\u8D85\u65F6\uFF08\u8D85\u8FC7 ${sec}s\uFF09` : "\u4EFB\u52A1\u8D85\u65F6"
          );
        }
        return;
      }
      if (result2.exitCode !== 0 && state.terminal !== "error" && state.terminal !== "interrupted") {
        const detail = (result2.stderr || "").trim() || `\u9000\u51FA\u7801 ${result2.exitCode}`;
        state = reduce(state, {
          type: "error",
          message: `copilot \u8FD0\u884C\u5931\u8D25\uFF1A${detail.slice(0, 1500)}`,
          terminationReason: "error"
        });
        return;
      }
      if (state.terminal === "running") {
        state = finalizeIfRunning(state);
      }
    };
    let streamMessageId;
    let deliveredViaStream = false;
    let terminalApplied = false;
    const settleTerminal = (result2) => {
      if (terminalApplied) return;
      terminalApplied = true;
      applyTerminalOverrides(result2);
    };
    try {
      streamMessageId = await lark.streamCard(
        chatId,
        renderCard(initialState(), { scope }),
        async (update) => {
          updateFn = update;
          await update(renderCard(state, { scope }));
          const result2 = await agentDone;
          await updateChain.catch(() => void 0);
          settleTerminal(result2);
          deliveredViaStream = true;
          if (!result2.aborted) {
            const sid = result2.sessionId || state.sessionId;
            if (sid) session.setSessionId(scope, sid, runGen);
          }
          cardClosed = true;
          await update(renderCard(state, { scope }));
          const answer2 = (result2.stdout || answerText(state)).trim();
          if (!result2.aborted && result2.exitCode === 0 && answer2) {
            session.appendRound(scope, historyUserText, answer2, runGen);
          }
        },
        sendOpts
      );
    } catch (streamErr) {
      cardClosed = true;
      log.error("streamCard \u5931\u8D25: %s", streamErr.message);
    }
    const result = await agentDone;
    settleTerminal(result);
    if (!deliveredViaStream && !result.aborted) {
      const sid = result.sessionId || state.sessionId;
      if (sid) session.setSessionId(scope, sid, runGen);
    }
    const answer = (result.stdout || answerText(state)).trim();
    const cleanEmpty = !result.aborted && !result.timedOut && result.exitCode === 0 && !answer && !hasVisibleCardContent(state);
    if (deliveredViaStream && cleanEmpty && streamMessageId) {
      try {
        await lark.recallMessage(streamMessageId);
        log.info("\u7A7A\u56DE\u590D\u5DF2\u64A4\u56DE mid=%s", streamMessageId);
      } catch (err) {
        log.warn("\u64A4\u56DE\u7A7A\u56DE\u590D\u5931\u8D25: %s", err.message);
      }
      return;
    }
    if (!deliveredViaStream) {
      if (streamMessageId) {
        try {
          await lark.recallMessage(streamMessageId);
        } catch {
        }
      }
      try {
        await lark.sendCard(chatId, renderCard(state, { scope }), sendOpts);
        if (!result.aborted && result.exitCode === 0 && answer) {
          session.appendRound(scope, historyUserText, answer, runGen);
        }
        log.info("\u9759\u6001\u5361\u7247\u56DE\u9000\u5DF2\u53D1\u9001 exit=%s", result.exitCode);
      } catch (cardErr) {
        log.error("\u9759\u6001\u5361\u7247\u4E5F\u5931\u8D25\uFF0C\u7EAF\u6587\u672C\u515C\u5E95: %s", cardErr.message);
        const failDetail = (result.stderr || "").trim() || `exit ${result.exitCode}`;
        const body = result.aborted ? "\u4EFB\u52A1\u5DF2\u88AB\u4E2D\u65AD\u3002" : result.timedOut ? timeoutMs > 0 ? `\u4EFB\u52A1\u8D85\u65F6\uFF08\u8D85\u8FC7 ${timeoutMs / 1e3}s\uFF09\u3002` : "\u4EFB\u52A1\u8D85\u65F6\u3002" : result.exitCode !== 0 ? `copilot \u5931\u8D25\uFF1A${failDetail.slice(0, 1500)}` : answer || "(\u7A7A\u56DE\u590D)";
        await lark.sendText(chatId, body.slice(0, 3500), sendOpts);
      }
    } else {
      log.info("\u6D41\u5F0F\u5361\u7247\u5B8C\u6210 exit=%s mode=%s outLen=%d", result.exitCode, result.outputMode, answer.length);
    }
  } catch (err) {
    const detail = err.message || String(err);
    log.error("\u5904\u7406\u5931\u8D25: chat=%s %s", chatId, detail);
    try {
      await lark.sendText(chatId, `\u26A0\uFE0F \u5904\u7406\u5931\u8D25\uFF1A${detail}`.slice(0, 2e3), {
        replyTo: lastMsg.messageId,
        ...lastMsg.threadId ? { replyInThread: true } : {}
      });
    } catch (textErr) {
      log.error("\u7EAF\u6587\u672C\u56DE\u9000\u4E5F\u5931\u8D25: %s", textErr.message);
    }
  } finally {
    session.markIdle(scope);
  }
}

// bin/lark-copilot-bridge.ts
var args = process.argv.slice(2);
var code = await dispatchCli(args);
if (code !== null) {
  process.exit(code);
}
main().catch((err) => {
  console.error("\u542F\u52A8\u5931\u8D25:", err);
  process.exit(1);
});
//# sourceMappingURL=lark-copilot-bridge.js.map