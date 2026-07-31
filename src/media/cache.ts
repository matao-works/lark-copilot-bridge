/**
 * 附件缓存：下载飞书 image/file → content-addressed 本地文件
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResourceDescriptor, ResourceType } from '@larksuite/channel';
import { mediaDir } from '../daemon/paths.js';
import { log } from '../logger.js';

export const MEDIA_GC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 临时文件至少保留多久再被 GC（避免并发下载被误删） */
export const MEDIA_TMP_MIN_AGE_MS = 60 * 60 * 1000;
export const MAX_ATTACHMENTS_PER_BATCH = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** 将 messageId 清洗为安全子目录名（非字母数字 → `_`，最长 64） */
export function sanitizeMediaBatchId(messageId: string): string {
  const s = messageId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64);
  return s || 'unknown';
}

/** 某条消息批次的媒体缓存目录：media/<safeMessageId>/ */
export function mediaBatchDir(messageId: string, root = mediaDir()): string {
  return join(root, sanitizeMediaBatchId(messageId));
}

const UNSUPPORTED_LABEL: Record<string, string> = {
  sticker: '表情',
  audio: '语音',
  video: '视频',
};

export interface ResolvedAttachment {
  absPath: string;
  kind: string;
  size: number;
  mime: string;
  originalName?: string;
}

export interface MediaDownloader {
  downloadResourceToFile(
    messageId: string,
    fileKey: string,
    type: ResourceType,
    destPath: string,
  ): Promise<{ contentType?: string }>;
}

export interface ResolveItem {
  messageId: string;
  resource: ResourceDescriptor;
}

function defaultMime(kind: string): string {
  switch (kind) {
    case 'image':
      return 'image/png';
    case 'audio':
      return 'audio/ogg';
    case 'video':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

function extForMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'application/json': 'json',
    'application/zip': 'zip',
  };
  return map[mime.toLowerCase()] ?? 'bin';
}

async function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (c) => hash.update(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function isDownloadableResource(r: ResourceDescriptor): boolean {
  return r.type === 'image' || r.type === 'file';
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 从 `.tmp-<pid>-…` 解析 pid */
function tmpOwnerPid(name: string): number | null {
  const m = name.match(/^\.tmp-(\d+)-/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export class MediaCache {
  constructor(
    private downloader: MediaDownloader,
    private rootDir: string = mediaDir(),
  ) {}

  async resolve(items: ResolveItem[]): Promise<{
    accepted: ResolvedAttachment[];
    skipped: string[];
    /** 消息里声明过、理论上可下的 image/file 数量（不含 sticker 等） */
    downloadableCount: number;
  }> {
    const skipped: string[] = [];
    if (items.length === 0) {
      return { accepted: [], skipped, downloadableCount: 0 };
    }

    await mkdir(this.rootDir, { recursive: true });

    const downloadable = items.filter((it) => {
      if (!isDownloadableResource(it.resource)) {
        const label = UNSUPPORTED_LABEL[it.resource.type] ?? it.resource.type;
        skipped.push(`暂不支持${label}`);
        return false;
      }
      return true;
    });

    if (downloadable.length > MAX_ATTACHMENTS_PER_BATCH) {
      skipped.push(`附件过多，仅处理前 ${MAX_ATTACHMENTS_PER_BATCH} 个`);
    }
    const slice = downloadable.slice(0, MAX_ATTACHMENTS_PER_BATCH);
    const accepted: ResolvedAttachment[] = [];

    for (const item of slice) {
      try {
        const file = await this.resolveOne(item);
        if (!file) continue;
        if (file.size > MAX_FILE_BYTES) {
          skipped.push(`${file.originalName ?? '文件'} 超过 ${MAX_FILE_BYTES / 1024 / 1024}MB`);
          await rm(file.absPath, { force: true }).catch(() => undefined);
          continue;
        }
        accepted.push(file);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.startsWith('OVERSIZE:')) {
          skipped.push(msg.slice('OVERSIZE:'.length));
        } else {
          log.warn('附件下载失败 fileKey=%s: %s', item.resource.fileKey, msg);
          skipped.push(`下载失败: ${item.resource.fileName ?? item.resource.fileKey.slice(-8)}`);
        }
      }
    }

    return { accepted, skipped, downloadableCount: downloadable.length };
  }

  private async resolveOne(item: ResolveItem): Promise<ResolvedAttachment | null> {
    const { messageId, resource: r } = item;
    const tmpPath = join(
      this.rootDir,
      `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    let finalized = false;
    try {
      const type: ResourceType = r.type === 'image' ? 'image' : 'file';
      const { contentType } = await this.downloader.downloadResourceToFile(
        messageId,
        r.fileKey,
        type,
        tmpPath,
      );
      const tmpStat = await stat(tmpPath);
      if (tmpStat.size > MAX_FILE_BYTES) {
        throw new Error(`OVERSIZE:${r.fileName ?? '文件'} 超过 ${MAX_FILE_BYTES / 1024 / 1024}MB`);
      }
      const hash = await hashFile(tmpPath);
      const mime = contentType ?? defaultMime(r.type);
      const ext = extForMime(mime);
      const absPath = join(this.rootDir, `${hash}.${ext}`);
      if (existsSync(absPath)) {
        await rm(tmpPath, { force: true });
        finalized = true;
        log.info('附件缓存命中: %s', absPath);
      } else {
        await rename(tmpPath, absPath);
        finalized = true;
        log.info('附件已下载: %s (%d bytes)', absPath, tmpStat.size);
      }
      return {
        absPath,
        kind: r.type,
        size: tmpStat.size,
        mime,
        ...(r.fileName ? { originalName: r.fileName } : {}),
      };
    } finally {
      if (!finalized) {
        await rm(tmpPath, { force: true }).catch(() => undefined);
      }
    }
  }
}

async function gcMediaCacheWalk(
  dir: string,
  cutoff: number,
  tmpCutoff: number,
): Promise<number> {
  let removed = 0;
  const names = await readdir(dir);
  for (const name of names) {
    const p = join(dir, name);
    try {
      if (name.startsWith('.tmp-')) {
        const st = await stat(p);
        const owner = tmpOwnerPid(name);
        const ownerDead = owner !== null && !pidAlive(owner);
        const oldEnough = st.mtimeMs < tmpCutoff;
        // 本进程自己的临时文件不在 GC 里删（由 resolveOne finally 负责）
        if (owner === process.pid) continue;
        if (ownerDead || oldEnough) {
          await rm(p, { force: true });
          removed++;
        }
        continue;
      }
      const st = await stat(p);
      if (st.isDirectory()) {
        // 先清目录内过期文件；勿仅凭目录 mtime 整删（双开时可能误删对方在用的 batch）
        removed += await gcMediaCacheWalk(p, cutoff, tmpCutoff);
        try {
          const leftover = await readdir(p);
          if (leftover.length === 0) {
            await rm(p, { recursive: true, force: true });
            removed++;
          }
        } catch { /* ignore */ }
        continue;
      }
      if (st.isFile() && st.mtimeMs < cutoff) {
        await rm(p, { force: true });
        removed++;
      }
    } catch { /* ignore */ }
  }
  return removed;
}

export async function gcMediaCache(
  maxAgeMs = MEDIA_GC_MAX_AGE_MS,
  root = mediaDir(),
): Promise<number> {
  if (!existsSync(root)) return 0;
  const cutoff = Date.now() - maxAgeMs;
  const tmpCutoff = Date.now() - MEDIA_TMP_MIN_AGE_MS;
  const removed = await gcMediaCacheWalk(root, cutoff, tmpCutoff);
  if (removed > 0) log.info('附件缓存 GC: 删除 %d 个文件/目录', removed);
  return removed;
}

export function formatAttachmentsForPrompt(atts: ResolvedAttachment[]): string {
  if (atts.length === 0) return '';
  const lines = atts.map((a, i) => {
    const label = a.originalName ? `${a.originalName} (${a.kind})` : `${a.kind} #${i + 1}`;
    return `- ${label}: ${a.absPath}`;
  });
  return `<attachments>\n${lines.join('\n')}\n</attachments>\n\n`;
}

export function formatSkippedSummary(skipped: string[]): string {
  if (skipped.length === 0) return '';
  const uniq = [...new Set(skipped)];
  return `附件提示：${uniq.join('；')}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** /status 用：统计附件缓存；同步 walk 设上限，避免极多文件时卡顿 */
export function mediaCacheStats(
  root = mediaDir(),
  maxFiles = 2000,
): { files: number; bytes: number; truncated: boolean; label: string } {
  if (!existsSync(root)) {
    return { files: 0, bytes: 0, truncated: false, label: '空' };
  }
  let files = 0;
  let bytes = 0;
  let truncated = false;
  const walk = (dir: string): void => {
    if (truncated) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (truncated) return;
      if (name.startsWith('.tmp-')) continue;
      const p = join(dir, name);
      try {
        const st = statSync(p);
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
      } catch { /* ignore */ }
    }
  };
  walk(root);
  if (files === 0) return { files: 0, bytes: 0, truncated: false, label: '空' };
  const label = truncated
    ? `≥${files} 个文件 · ${formatBytes(bytes)}+（已截断统计）`
    : `${files} 个文件 · ${formatBytes(bytes)}`;
  return { files, bytes, truncated, label };
}
