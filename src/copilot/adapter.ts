/**
 * Copilot CLI 适配器
 *
 * 默认：--output-format json + --no-ask-user → onEvent(AgentEvent)
 * 降级：--output-format text（或 CLI 不支持 json）→ 文本 onChunk / text 事件
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentEvent } from '../agent/types.js';
import { log } from '../logger.js';
import { JsonlLineBuffer } from './jsonl.js';

const SESSION_ID_RE = /--resume=([a-zA-Z0-9-]+)/;

export type CopilotOutputMode = 'json' | 'text';

export interface CopilotRunOptions {
  cwd: string;
  prompt: string;
  /** 0 = 不设超时 */
  timeoutMs: number;
  extraArgs: string[];
  abortSignal?: AbortSignal;
  sessionId?: string;
  /** 强制输出模式；默认自动探测 */
  outputMode?: CopilotOutputMode;
  /** 本地附件绝对路径 → --attachment */
  attachments?: string[];
  /** 额外允许读的目录 → --add-dir（如附件缓存目录） */
  addDirs?: string[];
  onEvent?: (evt: AgentEvent) => void;
  /** 文本模式下的兼容回调；json 模式不调用 */
  onChunk?: (chunk: string) => void;
}

export interface CopilotRunResult {
  exitCode: number;
  /** 最终答案文本（json 模式下从事件提取，不是原始 JSONL） */
  stdout: string;
  stderr: string;
  aborted: boolean;
  timedOut: boolean;
  sessionId?: string;
  outputMode: CopilotOutputMode;
}

let cachedJsonSupport: boolean | null = null;

/** 探测是否支持 --output-format json（缓存结果） */
export async function supportsCopilotJsonOutput(): Promise<boolean> {
  if (cachedJsonSupport !== null) return cachedJsonSupport;
  let supported = false;
  supported = await new Promise<boolean>((resolve) => {
    const child = spawn('copilot', ['--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    child.stdout?.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.stderr?.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.on('error', () => finish(false));
    child.on('close', () => {
      finish(/--output-format/.test(out) && /\bjson\b/i.test(out));
    });
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish(false);
    }, 5000);
  });
  cachedJsonSupport = supported;
  return supported;
}

function resolveOutputMode(opts: CopilotRunOptions, jsonOk: boolean): CopilotOutputMode {
  const fromExtra = detectFormatInArgs(opts.extraArgs);
  if (fromExtra) return fromExtra;
  if (opts.outputMode) return opts.outputMode;
  return jsonOk ? 'json' : 'text';
}

function detectFormatInArgs(args: string[]): CopilotOutputMode | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--output-format' && args[i + 1]) {
      const v = (args[i + 1] ?? '').toLowerCase();
      if (v === 'json' || v === 'text') return v;
    }
    const m = a.match(/^--output-format=(json|text)$/i);
    if (m) return m[1]!.toLowerCase() as CopilotOutputMode;
  }
  return null;
}

function stripOutputFormatArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--output-format') {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) i++;
      continue;
    }
    if (/^--output-format=/.test(a)) continue;
    if (a === '-s' || a === '--silent') continue;
    // 禁止配置注入任意附件/目录放行
    if (a === '--attachment' || a === '--add-dir') {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) i++;
      continue;
    }
    if (/^--attachment=/.test(a) || /^--add-dir=/.test(a)) continue;
    out.push(a);
  }
  return out;
}

export async function runCopilot(opts: CopilotRunOptions): Promise<CopilotRunResult> {
  const jsonOk = await supportsCopilotJsonOutput();
  const mode = resolveOutputMode(opts, jsonOk);
  if (mode === 'json' && !jsonOk) {
    log.warn('请求 json 输出但 CLI 不支持，降级为 text');
  }
  const effective: CopilotOutputMode = mode === 'json' && jsonOk ? 'json' : 'text';
  return runCopilotWithMode(opts, effective);
}

function runCopilotWithMode(opts: CopilotRunOptions, mode: CopilotOutputMode): Promise<CopilotRunResult> {
  return new Promise((resolve) => {
    const extra = stripOutputFormatArgs(opts.extraArgs);
    const args = ['-p', opts.prompt, '--no-ask-user'];
    if (mode === 'json') {
      args.push('--output-format', 'json');
    } else {
      args.push('-s');
    }
    if (opts.sessionId) {
      args.push(`--resume=${opts.sessionId}`);
      log.debug('copilot resume session: %s', opts.sessionId);
    }
    for (const p of opts.attachments ?? []) {
      if (p) args.push('--attachment', p);
    }
    for (const d of opts.addDirs ?? []) {
      if (d) args.push('--add-dir', d);
    }
    args.push(...extra);

    const child: ChildProcess = spawn('copilot', args, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let rawStdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let wallTimer: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;
    let sessionId: string | undefined;
    let onAbort: (() => void) | undefined;
    let answer = '';
    let emittedDone = false;

    const jsonBuf = new JsonlLineBuffer();
    let chunkBuffer = '';
    let chunkTimer: NodeJS.Timeout | null = null;

    const emit = (evt: AgentEvent): void => {
      if (evt.type === 'system' && evt.sessionId) sessionId = evt.sessionId;
      if (evt.type === 'text') answer += evt.delta;
      if (evt.type === 'text_replace') answer = evt.content;
      if (evt.type === 'final_text') answer = evt.content;
      if (evt.type === 'done' || evt.type === 'error') emittedDone = true;
      opts.onEvent?.(evt);
    };

    const tryExtractSessionId = (text: string): void => {
      if (sessionId) return;
      const m = text.match(SESSION_ID_RE);
      if (m) sessionId = m[1];
    };

    const flushTextChunk = (): void => {
      if (chunkTimer) {
        clearTimeout(chunkTimer);
        chunkTimer = null;
      }
      if (!chunkBuffer) return;
      const piece = stripAnsi(chunkBuffer);
      chunkBuffer = '';
      opts.onChunk?.(piece);
      emit({ type: 'text', delta: piece });
    };

    const finish = (result: Partial<CopilotRunResult>) => {
      if (settled) return;
      settled = true;
      if (wallTimer) clearTimeout(wallTimer);
      if (killTimer) clearTimeout(killTimer);
      if (mode === 'text') flushTextChunk();
      else {
        for (const evt of jsonBuf.flush()) emit(evt);
      }

      if (!emittedDone) {
        if (aborted) emit({ type: 'done', terminationReason: 'interrupted' });
        else if (timedOut) {
          // 不发 error(timeout)：由上层 markWallTimeout 统一终态文案
          emittedDone = true;
        } else if ((result.exitCode ?? 0) !== 0) {
          emit({
            type: 'error',
            message: (stderr || `退出码 ${result.exitCode}`).slice(0, 1500),
            terminationReason: 'error',
          });
        } else {
          emit({ type: 'done', terminationReason: 'completed' });
        }
      }

      if (onAbort && opts.abortSignal) {
        opts.abortSignal.removeEventListener('abort', onAbort);
      }

      const finalAnswer = mode === 'json'
        ? answer
        : stripAnsi(answer || rawStdout);

      resolve({
        exitCode: result.exitCode ?? -1,
        stdout: finalAnswer,
        stderr: stderr.trim(),
        aborted,
        timedOut,
        sessionId,
        outputMode: mode,
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      rawStdout += text;
      tryExtractSessionId(text);
      if (mode === 'json') {
        for (const evt of jsonBuf.push(text)) emit(evt);
      } else if (opts.onChunk || opts.onEvent) {
        chunkBuffer += text;
        if (chunkBuffer.length >= 40) flushTextChunk();
        else if (!chunkTimer) chunkTimer = setTimeout(flushTextChunk, 120);
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
      log.debug('copilot 退出: code=%s mode=%s session=%s', code, mode, sessionId ?? '(未提取到)');
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
