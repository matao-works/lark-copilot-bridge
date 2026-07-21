/**
 * 配置 + 凭证持久化
 *
 * 对照原项目 ~/.lark-channel/config.json 的 profile 体系，简化为单文件：
 *   ~/.lark-copilot-bridge/config.json
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

const CONFIG_DIR = resolve(homedir(), '.lark-copilot-bridge');
const CONFIG_FILE = resolve(CONFIG_DIR, 'config.json');

// 全局安装时从固定目录读配置；当前目录 .env 可覆盖
loadEnv({ path: resolve(CONFIG_DIR, '.env') });
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

/** 加载完整配置（凭证 + copilot 选项） */
export function loadConfig(credentials: AppCredentials): BridgeConfig {
  const persisted = readPersisted();

  const allowedUsers = (process.env.LARK_ALLOWED_USERS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const allowedChats = [...(persisted.allowedChats ?? [])];
  const admins = [...(persisted.admins ?? [])];

  const copilotCwd = validateWorkspaceDir(process.env.COPILOT_CWD || persisted.copilotCwd || process.cwd());

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

/** 校验工作目录是否安全可用（/cd 命令用），支持 ~ 展开 */
export function validateWorkspaceDir(cwd: string): string {
  const abs = resolve(cwd.replace(/^~(?=$|\/|\\)/, homedir()));
  if (!existsSync(abs)) throw new Error(`目录不存在: ${abs}`);
  if (!statSync(abs).isDirectory()) throw new Error(`不是目录: ${abs}`);
  if (abs === '/' || abs === homedir()) {
    throw new Error(`不能是根目录或 home 目录（${abs}），请指定具体项目目录`);
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

/** 列出所有命名工作目录别名 */
export function listWorkspaces(): Record<string, string> {
  return readPersisted().workspaces ?? {};
}

/** 保存/更新一个命名工作目录别名 */
export function saveWorkspace(name: string, path: string): void {
  const existing = readPersisted();
  const workspaces = { ...(existing.workspaces ?? {}), [name]: path };
  writePersisted({ ...existing, workspaces });
}

/** 删除一个命名工作目录别名 */
export function removeWorkspace(name: string): boolean {
  const existing = readPersisted();
  const workspaces = { ...(existing.workspaces ?? {}) };
  if (!(name in workspaces)) return false;
  delete workspaces[name];
  writePersisted({ ...existing, workspaces });
  return true;
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
