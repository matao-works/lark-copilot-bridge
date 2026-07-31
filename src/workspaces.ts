/**
 * 命名工作目录别名
 *
 * 持久化：~/.lark-copilot-bridge/workspaces.json
 *   { "workspaces": { "name": "/abs/path" } }
 *
 * 兼容：若仅有旧版 config.json 里的 workspaces 字段，首次读写时迁到独立文件。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_DIR, CONFIG_FILE, validateWorkspaceDir } from './config.js';

export const WORKSPACES_FILE = resolve(CONFIG_DIR, 'workspaces.json');

const NAME_RE = /^[a-zA-Z0-9_./-]+$/;

interface WorkspacesFile {
  workspaces: Record<string, string>;
}

function emptyFile(): WorkspacesFile {
  return { workspaces: {} };
}

/** 从旧 config.json.workspaces 迁移（文件缺失 / 空 / 损坏且 legacy 有数据时） */
function migrateLegacyIfNeeded(): WorkspacesFile | null {
  if (!existsSync(CONFIG_FILE)) return null;

  // 已有非空 workspaces.json 时不迁，避免覆盖有效数据
  if (existsSync(WORKSPACES_FILE)) {
    try {
      const existing = JSON.parse(readFileSync(WORKSPACES_FILE, 'utf8')) as Partial<WorkspacesFile>;
      if (Object.keys(existing.workspaces ?? {}).length > 0) return null;
    } catch {
      // JSON 不可读 → 若 legacy 有数据则迁移覆盖
    }
  }

  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as {
      workspaces?: Record<string, string>;
      [k: string]: unknown;
    };
    const legacy = parsed.workspaces;
    if (!legacy || Object.keys(legacy).length === 0) return null;
    const data: WorkspacesFile = { workspaces: { ...legacy } };
    writeDisk(data);
    // 迁走后从 config.json 去掉，避免双写
    try {
      const { workspaces: _w, ...rest } = parsed;
      writeFileSync(CONFIG_FILE, JSON.stringify(rest, null, 2), { mode: 0o600 });
    } catch {
      /* 迁出成功即可，清 legacy 失败可忽略 */
    }
    return data;
  } catch {
    return null;
  }
}

function readDisk(): WorkspacesFile {
  const migrated = migrateLegacyIfNeeded();
  if (migrated) return migrated;
  if (!existsSync(WORKSPACES_FILE)) return emptyFile();
  try {
    const parsed = JSON.parse(readFileSync(WORKSPACES_FILE, 'utf8')) as Partial<WorkspacesFile>;
    return { workspaces: { ...(parsed.workspaces ?? {}) } };
  } catch {
    return emptyFile();
  }
}

function writeDisk(data: WorkspacesFile): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${WORKSPACES_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, WORKSPACES_FILE);
}

/** 别名规则：`[a-zA-Z0-9_./-]+`，拒绝 `..` */
export function validateWorkspaceName(name: string): string {
  const n = name.trim();
  if (!n) throw new Error('别名不能为空');
  if (n.includes('..')) throw new Error('别名不能包含 `..`');
  if (!NAME_RE.test(n)) {
    throw new Error('别名只允许字母、数字、以及 `_` `.` `/` `-`');
  }
  return n;
}

export function listWorkspaces(): Record<string, string> {
  return { ...readDisk().workspaces };
}

export function getWorkspace(name: string): string | undefined {
  const n = name.trim();
  if (!n) return undefined;
  return readDisk().workspaces[n];
}

export function saveWorkspace(name: string, path: string): string {
  const n = validateWorkspaceName(name);
  const abs = validateWorkspaceDir(path);
  const data = readDisk();
  data.workspaces[n] = abs;
  writeDisk(data);
  return abs;
}

export function removeWorkspace(name: string): boolean {
  const n = validateWorkspaceName(name);
  const data = readDisk();
  if (!(n in data.workspaces)) return false;
  delete data.workspaces[n];
  writeDisk(data);
  return true;
}

/** 解析别名并校验目录仍可用，返回绝对路径（不改 session） */
export function useWorkspace(name: string): string {
  const n = validateWorkspaceName(name);
  const path = readDisk().workspaces[n];
  if (!path) throw new Error(`未找到别名 \`${n}\``);
  return validateWorkspaceDir(path);
}

// --- short aliases for `import * as workspaces` ---
export const list = listWorkspaces;
export const save = saveWorkspace;
export const remove = removeWorkspace;
export const use = useWorkspace;
export const get = getWorkspace;
