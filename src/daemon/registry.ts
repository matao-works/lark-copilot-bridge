/**
 * 本机进程注册表（供 start 等待 bot 就绪）
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { processesFile } from './paths.js';

export interface ProcessEntry {
  id: string;
  pid: number;
  appId: string;
  /** 连接就绪后必填（可有兜底名） */
  botName?: string;
  ready?: boolean;
  startedAt: string;
}

interface RegistryFile {
  entries: ProcessEntry[];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRaw(): RegistryFile {
  const file = processesFile();
  if (!existsSync(file)) return { entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as RegistryFile;
    if (!Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function writeRaw(data: RegistryFile): void {
  const file = processesFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

export function readAndPrune(): ProcessEntry[] {
  const data = readRaw();
  const live = data.entries.filter((e) => alive(e.pid));
  if (live.length !== data.entries.length) {
    writeRaw({ entries: live });
  }
  return live;
}

/** 只读：过滤死进程但不写盘（供 /status 等高频路径） */
export function readLive(): ProcessEntry[] {
  return readRaw().entries.filter((e) => alive(e.pid));
}

export function registerProcess(appId: string): ProcessEntry {
  const entries = readAndPrune().filter((e) => e.pid !== process.pid);
  const entry: ProcessEntry = {
    id: `pid-${process.pid}`,
    pid: process.pid,
    appId,
    ready: false,
    startedAt: new Date().toISOString(),
  };
  entries.push(entry);
  writeRaw({ entries });
  return entry;
}

/** WS 连上后标记就绪；botName 空时用兜底，避免 start 空等 */
export function markConnected(pid: number, botName?: string): void {
  const entries = readAndPrune();
  const hit = entries.find((e) => e.pid === pid);
  if (!hit) return;
  const label = (botName ?? '').trim() || `bot:${hit.appId.slice(-6)}`;
  hit.botName = label;
  hit.ready = true;
  writeRaw({ entries });
}

/** @deprecated 用 markConnected */
export function updateBotName(pid: number, botName: string): void {
  markConnected(pid, botName);
}

export function unregisterProcess(pid = process.pid): void {
  const entries = readAndPrune().filter((e) => e.pid !== pid);
  writeRaw({ entries });
}

export async function waitForBotConnect(
  appId: string,
  beforePids: Set<number>,
  timeoutMs = 30_000,
): Promise<ProcessEntry | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = readAndPrune().find(
      (e) =>
        e.appId === appId
        && !beforePids.has(e.pid)
        && (e.ready === true || Boolean(e.botName)),
    );
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, 500));
  }
  return undefined;
}
