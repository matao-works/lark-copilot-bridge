/**
 * 配置 + 凭证持久化
 *
 * 单文件：~/.lark-copilot-bridge/config.json
 * 存扫码拿到的 appId/appSecret/tenant，下次启动免扫码。
 *
 * ACL 变更同时改内存 BridgeConfig + 磁盘，避免「提示成功但当场不生效」。
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { log } from './logger.js';
import type { AppCredentials } from './types.js';

export type { AppCredentials } from './types.js';

export const CONFIG_DIR = process.env.LARK_COPILOT_BRIDGE_HOME
  ? resolve(process.env.LARK_COPILOT_BRIDGE_HOME)
  : resolve(homedir(), '.lark-copilot-bridge');
export const CONFIG_FILE = resolve(CONFIG_DIR, 'config.json');
export const ENV_FILE = resolve(CONFIG_DIR, '.env');

// 全局安装时从固定目录读配置；当前目录 .env 可覆盖
loadEnv({ path: ENV_FILE });
loadEnv();

export interface BridgeConfig {
  credentials: AppCredentials;
  allowedUsers: string[];
  allowedChats: string[];
  admins: string[];
  copilotCwd: string;
  copilotExtraArgs: string[];
  copilotTimeout: number;
  maxHistoryRounds: number;
}

interface PersistedConfig {
  appId: string;
  appSecret: string;
  tenant: 'feishu' | 'lark';
  creatorOpenId?: string;
  copilotCwd?: string;
  copilotExtraArgs?: string[];
  copilotTimeout?: number;
  allowedUsers?: string[];
  allowedChats?: string[];
  admins?: string[];
  workspaces?: Record<string, string>;
  /** 是否完成过首次向导（工作目录 + 谁能用） */
  setupCompleted?: boolean;
}

/** 上次读盘是否成功；失败后禁止覆盖写入，避免抹掉凭证 */
let persistReadable = true;

function readPersisted(): PersistedConfig {
  if (!existsSync(CONFIG_FILE)) {
    persistReadable = true;
    return {} as PersistedConfig;
  }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as PersistedConfig;
    persistReadable = true;
    return parsed;
  } catch (err) {
    persistReadable = false;
    log.error('config.json 损坏，拒绝后续覆盖写入: %s', (err as Error).message);
    return {} as PersistedConfig;
  }
}

function writePersisted(data: PersistedConfig, opts?: { allowCorruptOverwrite?: boolean }): void {
  if (!persistReadable && existsSync(CONFIG_FILE) && !opts?.allowCorruptOverwrite) {
    throw new Error(`config.json 已损坏，拒绝覆盖写入。请手动修复 ${CONFIG_FILE}`);
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  persistReadable = true;
}

/** 从本地文件加载已保存的飞书凭证 */
export function loadCredentials(): AppCredentials | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const parsed = readPersisted();
    if (!parsed.appId || !parsed.appSecret) return null;
    return {
      appId: parsed.appId,
      appSecret: parsed.appSecret,
      tenant: parsed.tenant ?? 'feishu',
      creatorOpenId: parsed.creatorOpenId,
    };
  } catch (err) {
    log.warn('读取凭证文件失败: %s', (err as Error).message);
    return null;
  }
}

/** 保存飞书凭证到本地文件 */
export function saveCredentials(creds: AppCredentials): void {
  const existing = readPersisted();
  // 扫码写入允许覆盖损坏文件（否则永远无法恢复）
  writePersisted({ ...existing, ...creds }, { allowCorruptOverwrite: true });
  log.info('凭证已保存到 %s', CONFIG_FILE);
}

/** 清除飞书凭证（保留 cwd / ACL / workspaces），下次启动重新扫码 */
export function clearCredentials(): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  const existing = readPersisted();
  const {
    appId: _a,
    appSecret: _s,
    tenant: _t,
    creatorOpenId: _c,
    ...rest
  } = existing;
  writePersisted(rest as PersistedConfig, { allowCorruptOverwrite: true });
  return true;
}

/** 供 `config show`：脱敏后的配置快照 */
export function getConfigSummary(): {
  configDir: string;
  configFile: string;
  envFile: string;
  hasCredentials: boolean;
  setupCompleted: boolean;
  appId?: string;
  tenant?: string;
  creatorOpenId?: string;
  copilotCwd?: string;
  copilotTimeout?: number;
  allowedUsers: string[];
  allowedChats: string[];
  admins: string[];
  workspaces: Record<string, string>;
} {
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
    copilotTimeout: Number(process.env.COPILOT_TIMEOUT || persisted.copilotTimeout) || 300_000,
    allowedUsers: resolveAllowedUsers(persisted),
    allowedChats: [...(persisted.allowedChats ?? [])],
    admins: [...(persisted.admins ?? [])],
    workspaces: readWorkspacesForSummary(persisted),
  };
}

/** config show 用：优先 workspaces.json，兼容旧 config.json.workspaces */
function readWorkspacesForSummary(persisted: PersistedConfig): Record<string, string> {
  const wsFile = resolve(CONFIG_DIR, 'workspaces.json');
  if (existsSync(wsFile)) {
    try {
      const parsed = JSON.parse(readFileSync(wsFile, 'utf8')) as { workspaces?: Record<string, string> };
      return { ...(parsed.workspaces ?? {}) };
    } catch {
      /* fall through to legacy */
    }
  }
  return { ...(persisted.workspaces ?? {}) };
}

function resolveAllowedUsers(persisted: PersistedConfig): string[] {
  const fromEnv = (process.env.LARK_ALLOWED_USERS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return [...(persisted.allowedUsers ?? [])];
}

function resolveAllowedCwdHint(persisted: PersistedConfig): string {
  return process.env.COPILOT_CWD || persisted.copilotCwd || process.cwd();
}

export function isSetupCompleted(): boolean {
  return Boolean(readPersisted().setupCompleted);
}

/** 尝试解析可用工作目录；不合法则返回 null（不抛错） */
export function tryResolveWorkspaceDir(): string | null {
  const persisted = readPersisted();
  const raw = process.env.COPILOT_CWD || persisted.copilotCwd;
  if (!raw) return null;
  try {
    return validateWorkspaceDir(raw);
  } catch {
    return null;
  }
}

/** 保存首次向导结果 */
export function saveSetupPreferences(opts: {
  copilotCwd: string;
  allowedUsers: string[];
  setupCompleted?: boolean;
}): void {
  const existing = readPersisted();
  writePersisted({
    ...existing,
    copilotCwd: opts.copilotCwd,
    allowedUsers: [...opts.allowedUsers],
    setupCompleted: opts.setupCompleted ?? true,
  }, { allowCorruptOverwrite: true });
}

/** 加载完整配置（凭证 + copilot 选项） */
export function loadConfig(credentials: AppCredentials): BridgeConfig {
  const persisted = readPersisted();

  const allowedUsers = resolveAllowedUsers(persisted);
  const allowedChats = [...(persisted.allowedChats ?? [])];
  const admins = [...(persisted.admins ?? [])];

  const cwdRaw = process.env.COPILOT_CWD || persisted.copilotCwd || process.cwd();
  const copilotCwd = validateWorkspaceDir(cwdRaw);

  const config: BridgeConfig = {
    credentials,
    allowedUsers,
    allowedChats,
    admins,
    copilotCwd,
    copilotExtraArgs: parseArgs(process.env.COPILOT_EXTRA_ARGS || persisted.copilotExtraArgs?.join(' ')),
    copilotTimeout: Number(process.env.COPILOT_TIMEOUT || persisted.copilotTimeout) || 300_000,
    maxHistoryRounds: 10,
  };

  log.info('配置: cwd=%s timeout=%dms', config.copilotCwd, config.copilotTimeout);
  return config;
}

function parseArgs(s: string | undefined): string[] {
  if (!s) return [];
  return s.trim().split(/\s+/).filter(Boolean);
}

/** 校验工作目录是否安全可用，支持 ~ 展开 */
export function validateWorkspaceDir(cwd: string): string {
  const abs = resolve(cwd.replace(/^~(?=$|\/|\\)/, homedir()));
  if (!existsSync(abs)) {
    throw new Error(`找不到这个文件夹：${abs}\n请检查路径是否复制完整，或在访达里确认文件夹还在。`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new Error(`这不是文件夹：${abs}\n请选择一个文件夹，而不是某个文件。`);
  }
  if (abs === '/') {
    throw new Error('不能选择整个电脑（/）。请选一个具体的项目文件夹。');
  }
  if (abs === homedir()) {
    throw new Error(
      `不能选择整个用户主目录（${abs}）。\n`
      + '请选里面的某个项目文件夹，例如桌面上的工程目录。',
    );
  }
  return abs;
}

/** 保存 copilot 配置到持久化文件（/cd 命令用） */
export function saveCopilotConfig(patch: Partial<Pick<BridgeConfig, 'copilotCwd' | 'copilotExtraArgs' | 'copilotTimeout'>>): void {
  if (!existsSync(CONFIG_FILE)) return;
  try {
    const existing = readPersisted();
    writePersisted({
      ...existing,
      ...(patch.copilotCwd !== undefined ? { copilotCwd: patch.copilotCwd } : {}),
      ...(patch.copilotExtraArgs !== undefined ? { copilotExtraArgs: patch.copilotExtraArgs } : {}),
      ...(patch.copilotTimeout !== undefined ? { copilotTimeout: patch.copilotTimeout } : {}),
    });
  } catch (err) {
    log.warn('保存 copilot 配置失败: %s', (err as Error).message);
  }
}

/** 群白名单：同步更新内存 config + 磁盘 */
export function addAllowedChat(config: BridgeConfig, chatId: string): boolean {
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

export function removeAllowedChat(config: BridgeConfig, chatId: string): boolean {
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

export function addAdmin(config: BridgeConfig, openId: string): boolean {
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

export function removeAdmin(config: BridgeConfig, openId: string): boolean {
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
