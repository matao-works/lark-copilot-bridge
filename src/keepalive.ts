/**
 * 应用级 keepalive（对照原项目 src/bot/keepalive.ts，简化版）
 *
 * 原项目 5 层防御：15s timer + 睡眠检测 + timer storm guard + HTTP probe + 计数器防抖。
 * MVP 简化：15s 检查连接状态，断开连续 3 次就警告并尝试 forceReconnect。
 * SDK 自己会重连（reconnecting/reconnected 事件），这是防御 SDK 漏检的补充层。
 */
import type { LarkChannel } from '@larksuite/channel';
import { log } from './logger.js';

const KEEPALIVE_INTERVAL_MS = 15_000;
const SLEEP_DETECT_MS = 30_000;
const DEAD_THRESHOLD = 3;

export interface KeepaliveDeps {
  channel: LarkChannel;
  domain: string;
  forceReconnect: () => Promise<void>;
}

export function startKeepalive(deps: KeepaliveDeps): { stop: () => void } {
  const { channel, forceReconnect } = deps;
  let lastTick = 0;
  let consecutiveDown = 0;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const now = Date.now();
    const sinceLast = lastTick > 0 ? now - lastTick : 0;
    // timer storm guard
    if (sinceLast > 0 && sinceLast < 5_000) return;
    // 睡眠检测：机器刚醒，重置计数
    if (sinceLast > SLEEP_DETECT_MS) {
      consecutiveDown = 0;
      lastTick = now;
      return;
    }
    lastTick = now;

    const status = (channel as any).getConnectionStatus?.();
    if (!status) return;
    if (status.state === 'connected') {
      if (consecutiveDown > 0) log.info('keepalive 恢复 (after %d ticks)', consecutiveDown);
      consecutiveDown = 0;
      return;
    }

    consecutiveDown++;
    log.warn('keepalive: ws 断开 (%d/%d) state=%s', consecutiveDown, DEAD_THRESHOLD, status.state);
    if (consecutiveDown >= DEAD_THRESHOLD) {
      consecutiveDown = 0;
      log.warn('keepalive: 触发 forceReconnect');
      try { await forceReconnect(); } catch (err) { log.error('keepalive forceReconnect 失败: %s', (err as Error).message); }
    }
  };

  const timer = setInterval(() => { void tick().catch((err) => log.error('keepalive tick: %s', (err as Error).message)); }, KEEPALIVE_INTERVAL_MS);
  return { stop: () => { stopped = true; clearInterval(timer); } };
}
