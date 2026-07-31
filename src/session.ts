/**
 * 会话管理
 *
 * copilot CLI 支持 --resume=<session-id>：
 *   - 每次跑完从退出摘要提取 session-id 存回
 *   - 下次用 --resume=<id> 恢复，copilot 自己保持上下文
 *
 * 保留历史数组作为 fallback（session-id 提取失败时）+ /status 显示。
 */
import { log } from './logger.js';

export interface HistoryEntry {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

export class SessionStore {
  private store = new Map<string, HistoryEntry[]>();
  private running = new Set<string>();
  private abortControllers = new Map<string, AbortController>();
  /** 每个 scope 的工作目录（/cd /ws use 用） */
  private cwdStore = new Map<string, string>();
  /** 每个 scope 的超时覆盖（分钟，0=关闭，/timeout 用） */
  private timeoutStore = new Map<string, number>();
  /** 每个 scope 的 copilot session-id（--resume 用） */
  private sessionIdStore = new Map<string, string>();

  constructor(private maxRounds: number) {}

  getHistory(scope: string): HistoryEntry[] {
    return this.store.get(scope) ?? [];
  }

  appendRound(scope: string, userText: string, assistantText: string): void {
    const now = Date.now();
    const arr = this.store.get(scope) ?? [];
    arr.push({ role: 'user', text: userText, ts: now });
    arr.push({ role: 'assistant', text: assistantText, ts: now });
    const maxItems = this.maxRounds * 2;
    this.store.set(scope, arr.length > maxItems ? arr.slice(arr.length - maxItems) : arr);
  }

  /** copilot session-id（--resume 用） */
  setSessionId(scope: string, id: string): void {
    this.sessionIdStore.set(scope, id);
  }
  sessionIdFor(scope: string): string | undefined {
    return this.sessionIdStore.get(scope);
  }

  /** 清空会话（/new 用）：清历史 + sessionId，保留 cwd */
  clear(scope: string): void {
    this.store.delete(scope);
    this.sessionIdStore.delete(scope);
    log.info('会话 %s 已清空', scope);
  }

  setCwd(scope: string, cwd: string): void {
    this.cwdStore.set(scope, cwd);
    this.clear(scope); // cwd 变了 session 不能复用
    log.info('scope %s cwd → %s', scope, cwd);
  }
  cwdFor(scope: string): string | undefined {
    return this.cwdStore.get(scope);
  }
  clearCwd(scope: string): void {
    this.cwdStore.delete(scope);
  }

  setIdleTimeout(scope: string, minutes: number): void {
    this.timeoutStore.set(scope, minutes);
  }
  idleTimeoutFor(scope: string): number | undefined {
    return this.timeoutStore.get(scope);
  }

  markRunning(scope: string): AbortController {
    this.running.add(scope);
    const ac = new AbortController();
    this.abortControllers.set(scope, ac);
    return ac;
  }
  /** 原子抢锁：已在跑则返回 null */
  tryMarkRunning(scope: string): AbortController | null {
    if (this.running.has(scope)) return null;
    return this.markRunning(scope);
  }
  markIdle(scope: string): void {
    this.running.delete(scope);
    this.abortControllers.delete(scope);
  }
  isRunning(scope: string): boolean {
    return this.running.has(scope);
  }
  runningScopes(): string[] {
    return [...this.running];
  }
  abort(scope: string): boolean {
    const ac = this.abortControllers.get(scope);
    if (ac) {
      ac.abort();
      log.info('已中断 %s 的任务', scope);
      return true;
    }
    return false;
  }

  /** fallback：无 session-id 时拼历史进 prompt */
  buildPrompt(scope: string, currentUserText: string): string {
    const history = this.getHistory(scope);
    if (history.length === 0) return currentUserText;
    const lines = ['以下是与用户的先前对话历史，请基于上下文回答最新问题。', '', '## 对话历史'];
    for (const h of history) {
      lines.push(`${h.role === 'user' ? '用户' : '助手'}: ${h.text}`);
    }
    lines.push('', '## 最新问题', currentUserText);
    return lines.join('\n');
  }
}
