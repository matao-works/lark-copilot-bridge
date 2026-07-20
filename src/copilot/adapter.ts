/**
 * Copilot CLI 适配器（支持原生 --resume）
 *
 * 重大纠正：copilot CLI 确实有 resume 机制！
 *   - `--resume=<session-id>` 非交互式恢复指定会话（接受 ID/前缀/名称）
 *   - `--continue` 恢复当前 cwd 最近会话
 *   - `--session-id <uuid>` 精确指定
 *   - `-p` 退出时输出 `copilot --resume=SESSION-ID` 提示，可提取 session-id
 *
 * 所以我们不再自维护历史拼 prompt，而是用 copilot 原生 resume（和原项目 claude --resume 对齐）。
 * 每次跑完从 stderr/stdout 提取 session-id 存回，下次用 --resume 恢复。
 *
 * 流式：stdout 边输出边 onChunk 更新卡片（copilot 输出纯文本流，非 stream-json）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { log } from '../logger.js';

const SESSION_ID_RE = /--resume=([a-zA-Z0-9-]+)/;

export interface CopilotRunOptions {
  cwd: string;
  prompt: string;
  timeoutMs: number;
  extraArgs: string[];
  abortSignal?: AbortSignal;
  /** 恢复指定会话（copilot --resume=<id>） */
  sessionId?: string;
  /** stdout 每收到一段文本就回调（流式更新卡片） */
  onChunk?: (chunk: string) => void;
}

export interface CopilotRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  aborted: boolean;
  timedOut: boolean;
  /** 本次运行的 session-id（用于下次 resume），提取自退出摘要 */
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
    let sessionId: string | undefined;

    const tryExtractSessionId = (text: string): void => {
      if (sessionId) return;
      const m = text.match(SESSION_ID_RE);
      if (m) {
        sessionId = m[1];
        log.debug('提取到 session-id: %s', sessionId);
      }
    };

    const finish = (result: Partial<CopilotRunResult>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
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
        if (chunkBuffer.length >= 200) {
          opts.onChunk(stripAnsi(chunkBuffer));
          chunkBuffer = '';
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
      if (opts.onChunk && chunkBuffer) {
        opts.onChunk(stripAnsi(chunkBuffer));
        chunkBuffer = '';
      }
      log.debug('copilot 退出: code=%s session=%s', code, sessionId ?? '(未提取到)');
      finish({ exitCode: code ?? -1 });
    });

    let timer: NodeJS.Timeout | null = null;
    if (opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        log.warn('copilot 超时(%dms)，终止', opts.timeoutMs);
        killGracefully(child);
      }, opts.timeoutMs);
    }

    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        aborted = true;
        killGracefully(child);
      } else {
        const onAbort = () => {
          if (opts.abortSignal?.aborted && !settled) {
            aborted = true;
            log.info('中断 copilot 进程');
            killGracefully(child);
          }
        };
        opts.abortSignal.addEventListener('abort', onAbort);
      }
    }
  });
}

function killGracefully(child: ChildProcess): void {
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => { try { if (!child.killed) child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export async function checkCopilotInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('copilot', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } resolve(false); }, 5000);
  });
}
