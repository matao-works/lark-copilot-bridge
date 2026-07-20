/**
 * 配置 + 凭证持久化
 *
 * 对照原项目 ~/.lark-channel/config.json 的 profile 体系，简化为单文件：
 *   ~/.lark-copilot-bridge/config.json
 * 存扫码拿到的 appId/appSecret/tenant，下次启动免扫码。
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { log } from './logger.js';

const CONFIG_DIR = resolve(homedir(), '.lark-copilot-bridge');
const CONFIG_FILE = resolve(CONFIG_DIR, 'config.json');

export interface AppCredentials {
  appId: string;
  appSecret: string;
  tenant: 'feishu' | 'lark';
  creatorOpenId?: string;
}

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

/** 从本地文件加载已保存的飞书凭证 */
export function loadCredentials(): AppCredentials | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const parsed: PersistedConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
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
  mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = existsSync(CONFIG_FILE)
    ? (() => { try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } })()
    : {};
  const merged: PersistedConfig = { ...existing, ...creds };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  log.info('凭证已保存到 %s', CONFIG_FILE);
}

/** 加载完整配置（凭证 + copilot 选项） */
export function loadConfig(credentials: AppCredentials): BridgeConfig {
  // 优先从环境变量读 copilot 配置，其次从持久化文件
  const persisted: Partial<PersistedConfig> = existsSync(CONFIG_FILE)
    ? (() => { try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } })()
    : {};

  const allowedUsers = (process.env.LARK_ALLOWED_USERS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const allowedChats = (persisted.allowedChats ?? []);
  const admins = (persisted.admins ?? []);

  const copilotCwd = validateCwd(process.env.COPILOT_CWD || persisted.copilotCwd || process.cwd());

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

function validateCwd(cwd: string): string {
  return validateWorkspaceDir(cwd);
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
    const existing = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    const merged = {
      ...existing,
      ...(patch.copilotCwd ? { copilotCwd: patch.copilotCwd } : {}),
      ...(patch.copilotExtraArgs ? { copilotExtraArgs: patch.copilotExtraArgs } : {}),
      ...(patch.copilotTimeout ? { copilotTimeout: patch.copilotTimeout } : {}),
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  } catch (err) {
    log.warn('保存 copilot 配置失败: %s', (err as Error).message);
  }
}

/** 列出所有命名工作目录别名 */
export function listWorkspaces(): Record<string, string> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    return parsed.workspaces ?? {};
  } catch { return {}; }
}

/** 保存/更新一个命名工作目录别名 */
export function saveWorkspace(name: string, path: string): void {
  const existing = existsSync(CONFIG_FILE)
    ? (() => { try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } })()
    : {};
  const workspaces = { ...(existing.workspaces ?? {}), [name]: path };
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, workspaces }, null, 2), { mode: 0o600 });
}

/** 删除一个命名工作目录别名 */
export function removeWorkspace(name: string): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  try {
    const existing = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    const workspaces = existing.workspaces ?? {};
    if (!(name in workspaces)) return false;
    delete workspaces[name];
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, workspaces }, null, 2), { mode: 0o600 });
    return true;
  } catch { return false; }
}

/** 把一个群加入白名单（/invite group 用） */
export function addAllowedChat(chatId: string): boolean {
  const existing = existsSync(CONFIG_FILE)
    ? (() => { try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } })()
    : {};
  const chats: string[] = existing.allowedChats ?? [];
  if (chats.includes(chatId)) return false;
  chats.push(chatId);
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, allowedChats: chats }, null, 2), { mode: 0o600 });
  return true;
}

/** 把一个群移出白名单（/remove group 用） */
export function removeAllowedChat(chatId: string): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  try {
    const existing = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    const chats: string[] = existing.allowedChats ?? [];
    if (!chats.includes(chatId)) return false;
    existing.allowedChats = chats.filter((c: string) => c !== chatId);
    writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
    return true;
  } catch { return false; }
}

/** 添加管理员（/invite admin 用） */
export function addAdmin(openId: string): boolean {
  const existing = existsSync(CONFIG_FILE)
    ? (() => { try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } })()
    : {};
  const admins: string[] = existing.admins ?? [];
  if (admins.includes(openId)) return false;
  admins.push(openId);
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, admins }, null, 2), { mode: 0o600 });
  return true;
}

/** 移除管理员（/remove admin 用） */
export function removeAdmin(openId: string): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  try {
    const existing = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    const admins: string[] = existing.admins ?? [];
    if (!admins.includes(openId)) return false;
    existing.admins = admins.filter((a: string) => a !== openId);
    writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
    return true;
  } catch { return false; }
}
