/**
 * 应用级 keepalive：15s 检查 WS；连续断开则真正 reconnect（带超时）。
 */
import { log } from './logger.js';

const KEEPALIVE_INTERVAL_MS = 15_000;
const SLEEP_DETECT_MS = 30_000;
const DEAD_THRESHOLD = 3;
const RECONNECT_TIMEOUT_MS = 20_000;

export interface KeepaliveDeps {
  getConnectionStatus: () => { state: string } | undefined;
  forceReconnect: () => Promise<void>;
}

export function startKeepalive(deps: KeepaliveDeps): { stop: () => void } {
  const { getConnectionStatus, forceReconnect } = deps;
  let lastTick = 0;
  let consecutiveDown = 0;
  let stopped = false;
  let reconnecting = false;

  const tick = async (): Promise<void> => {
    if (stopped || reconnecting) return;
    const now = Date.now();
    const sinceLast = lastTick > 0 ? now - lastTick : 0;
    if (sinceLast > 0 && sinceLast < 5_000) return;
    if (sinceLast > SLEEP_DETECT_MS) {
      consecutiveDown = 0;
      lastTick = now;
      return;
    }
    lastTick = now;

    const status = getConnectionStatus();
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
      reconnecting = true;
      log.warn('keepalive: 触发 forceReconnect');
      try {
        await Promise.race([
          forceReconnect(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`reconnect 超时 ${RECONNECT_TIMEOUT_MS}ms`)), RECONNECT_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        log.error('keepalive forceReconnect 失败: %s', (err as Error).message);
      } finally {
        reconnecting = false;
      }
    }
  };

  const timer = setInterval(() => {
    void tick().catch((err) => log.error('keepalive tick: %s', (err as Error).message));
  }, KEEPALIVE_INTERVAL_MS);
  return { stop: () => { stopped = true; clearInterval(timer); } };
}
