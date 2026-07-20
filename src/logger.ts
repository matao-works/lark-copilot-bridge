/**
 * 日志模块 —— 最小可用版本
 *
 * 原项目用结构化日志（带 profile/级别/脱敏）。
 * MVP 用带级别前缀的 console 输出，够看清流程就行。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function ts(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

export const log = {
  debug(msg: string, ...args: unknown[]) {
    if (shouldLog('debug')) console.debug(`[${ts()}] DEBUG ${msg}`, ...args);
  },
  info(msg: string, ...args: unknown[]) {
    if (shouldLog('info')) console.log(`[${ts()}] INFO  ${msg}`, ...args);
  },
  warn(msg: string, ...args: unknown[]) {
    if (shouldLog('warn')) console.warn(`[${ts()}] WARN  ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]) {
    if (shouldLog('error')) console.error(`[${ts()}] ERROR ${msg}`, ...args);
  },
};
