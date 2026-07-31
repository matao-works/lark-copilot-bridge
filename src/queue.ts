/**
 * 消息队列 + debounce 合批
 *
 * 机制：
 *   - 同 scope 消息累积 DEBOUNCE_MS（600ms）后合并成一批 flush
 *   - run 进行中 block(scope) 暂停 timer，消息继续累积
 *   - run 结束 unblock(scope) 重新 arm timer
 *   - 命令 bypass queue（直接处理，不进队列）
 *
 * 效果：用户连续发"帮我看看" + "重点分析 X" 会合成一次 copilot 调用，
 * 而不是每条独立处理。run 期间的新消息累积到下一批。
 */
import { log } from './logger.js';

export class MessageQueue<T> {
  private entries = new Map<string, { messages: T[]; timer?: NodeJS.Timeout }>();
  private blocked = new Set<string>();

  constructor(
    private debounceMs: number,
    private onFlush: (scope: string, batch: T[]) => void,
  ) {}

  /** 投递消息到 scope 队列。未 block 时 arm debounce timer。 */
  push(scope: string, msg: T): void {
    const entry = this.entries.get(scope);
    if (entry) {
      entry.messages.push(msg);
    } else {
      this.entries.set(scope, { messages: [msg] });
    }
    if (!this.blocked.has(scope)) {
      this.armTimer(scope);
    }
    log.debug('队列 %s push，当前积压 %d', scope, this.entries.get(scope)!.messages.length);
  }

  /** 暂停 scope 的 timer（run 开始时调），消息继续累积但不 flush */
  block(scope: string): void {
    this.blocked.add(scope);
    this.clearTimer(scope);
  }

  /** 恢复 scope 的 timer（run 结束时调），重新 arm */
  unblock(scope: string): void {
    this.blocked.delete(scope);
    if (this.entries.has(scope)) {
      this.armTimer(scope);
    }
  }

  /** 清空 scope 的积压并返回（命令处理时丢弃队列用） */
  cancel(scope: string): T[] {
    const entry = this.entries.get(scope);
    this.clearTimer(scope);
    this.entries.delete(scope);
    return entry?.messages ?? [];
  }

  /** scope 当前积压消息数 */
  pendingCount(scope: string): number {
    return this.entries.get(scope)?.messages.length ?? 0;
  }

  private armTimer(scope: string): void {
    this.clearTimer(scope);
    const entry = this.entries.get(scope);
    if (!entry || entry.messages.length === 0) return;
    entry.timer = setTimeout(() => {
      const batch = entry.messages;
      this.entries.delete(scope);
      log.info('队列 %s flush，批量 %d 条', scope, batch.length);
      this.onFlush(scope, batch);
    }, this.debounceMs);
  }

  private clearTimer(scope: string): void {
    const entry = this.entries.get(scope);
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }
}
