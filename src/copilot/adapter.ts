/**
 * Copilot CLI 适配器（支持原生 --resume）
 *
 * 调用：copilot -p ... -s --no-ask-user [--resume=id]
 * 流式：stdout onChunk；退出摘要提取 session-id。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { log } from '../logger.js';

const SESSION_ID_RE = /--resume=([a-zA-Z0-9-]+)/;

export interface CopilotRunOptions {
  cwd: string;
  prompt: string;
  /** 0 = 不设超时 */
  timeoutMs: number;
  extraArgs: string[];
  abortSignal?: AbortSignal;
  sessionId?: string;
  onChunk?: (chunk: string) => void;
}

export interface CopilotRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  aborted: boolean;
  timedOut: boolean;
  sessionId?: string;
}

export function runCopilot(opts: CopilotRunOptions): Promise<CopilotRunResult> {
  return new Promise((resolve) => {
    const args = ['-p', opts.prompt, '-s', '--no-ask-user'];
    if (opts.sessionId) {
      args.push(`--resume=${opts.sessionId}`);
      log.debug('copilot resume session: %s', opts.sessionId);
    }
    args.push(...opts.extraArgs);

    const child: ChildProcess = spawn('copilot', args, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let chunkBuffer = '';
    let chunkTimer: NodeJS.Timeout | null = null;
    let wallTimer: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;
    let sessionId: string | undefined;
    let onAbort: (() => void) | undefined;

    const tryExtractSessionId = (text: string): void => {
      if (sessionId) return;
      const m = text.match(SESSION_ID_RE);
      if (m) sessionId = m[1];
    };

    const flushChunk = (): void => {
      if (chunkTimer) {
        clearTimeout(chunkTimer);
        chunkTimer = null;
      }
      if (!opts.onChunk || !chunkBuffer) return;
      opts.onChunk(stripAnsi(chunkBuffer));
      chunkBuffer = '';
    };

    const finish = (result: Partial<CopilotRunResult>) => {
      if (settled) return;
      settled = true;
      if (wallTimer) clearTimeout(wallTimer);
      if (killTimer) clearTimeout(killTimer);
      flushChunk();
      if (onAbort && opts.abortSignal) {
        opts.abortSignal.removeEventListener('abort', onAbort);
      }
      resolve({
        exitCode: result.exitCode ?? -1,
        stdout: stripAnsi(stdout),
        stderr: stderr.trim(),
        aborted,
        timedOut,
        sessionId,
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout += text;
      tryExtractSessionId(text);
      if (opts.onChunk) {
        chunkBuffer += text;
        if (chunkBuffer.length >= 40) {
          flushChunk();
        } else if (!chunkTimer) {
          chunkTimer = setTimeout(flushChunk, 120);
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      tryExtractSessionId(text);
    });

    child.on('error', (err) => {
      log.error('spawn copilot 失败: %s', err.message);
      stderr += `\n[spawn error] ${err.message}`;
      finish({ exitCode: -1 });
    });

    child.on('close', (code) => {
      log.debug('copilot 退出: code=%s session=%s', code, sessionId ?? '(未提取到)');
      finish({ exitCode: code ?? -1 });
    });

    const setKillTimer = (t: NodeJS.Timeout): void => {
      if (killTimer) clearTimeout(killTimer);
      killTimer = t;
    };

    if (opts.timeoutMs > 0) {
      wallTimer = setTimeout(() => {
        timedOut = true;
        log.warn('copilot 超时(%dms)，终止', opts.timeoutMs);
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
            log.info('中断 copilot 进程');
            killGracefully(child, setKillTimer);
          }
        };
        opts.abortSignal.addEventListener('abort', onAbort);
      }
    }
  });
}

function killGracefully(child: ChildProcess, track: (t: NodeJS.Timeout) => void): void {
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  track(setTimeout(() => {
    try { if (!child.killed) child.kill('SIGKILL'); } catch { /* ignore */ }
  }, 3000));
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export async function checkCopilotInstalled(): Promise<boolean> {
  const info = await getCopilotVersion();
  return info.ok;
}

/** 探测 copilot CLI 是否可用，并返回版本字符串 */
export async function getCopilotVersion(): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('copilot', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (result: { ok: boolean; version?: string; error?: string }) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => finish({ ok: false, error: err.message }));
    child.on('close', (code) => {
      if (code === 0) {
        const version = stripAnsi((stdout || stderr).trim().split('\n')[0] ?? '').trim();
        finish({ ok: true, version: version || 'unknown' });
      } else {
        finish({ ok: false, error: (stderr || stdout || `exit ${code}`).trim().slice(0, 200) });
      }
    });
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ ok: false, error: '探测超时（5s）' });
    }, 5000);
  });
}
