/**
 * Daemon 路径与服务标识（单实例，无 profile）
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { CONFIG_DIR } from '../config.js';

export const SERVICE_NAME = 'lark-copilot-bridge.bot';
export const LAUNCH_AGENT_LABEL = `ai.${SERVICE_NAME}`;
export const SYSTEMD_UNIT_NAME = `${SERVICE_NAME}.service`;
export const WINDOWS_TASK_NAME = 'LarkCopilotBridge.Bot';

export function launchAgentPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

export function systemdUnitPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'systemd', 'user', SYSTEMD_UNIT_NAME);
}

export function windowsLauncherCmdPath(): string {
  return join(CONFIG_DIR, 'daemon-launcher.cmd');
}

export function daemonLogDir(): string {
  return join(CONFIG_DIR, 'logs');
}

export function daemonStdoutPath(): string {
  return join(daemonLogDir(), 'daemon-stdout.log');
}

export function daemonStderrPath(): string {
  return join(daemonLogDir(), 'daemon-stderr.log');
}

export function processesFile(): string {
  return join(CONFIG_DIR, 'processes.json');
}

export function mediaDir(): string {
  return join(CONFIG_DIR, 'media');
}

/** 供单元文件 / 测试使用：生成 ProgramArguments（绝对路径） */
export function bridgeRunArgs(): { nodePath: string; bridgeEntryPath: string } {
  const raw = process.argv[1];
  if (!raw) {
    throw new Error('cannot determine bridge entry path (process.argv[1] is empty)');
  }
  const bridgeEntryPath = resolve(raw);
  if (!existsSync(bridgeEntryPath)) {
    throw new Error(`bridge entry path does not exist: ${bridgeEntryPath}`);
  }
  return { nodePath: process.execPath, bridgeEntryPath };
}

export function looksLikeNpxCachePath(entryPath: string): boolean {
  return /[/\\]_npx[/\\]/.test(entryPath) || /[/\\]\.npm[/\\]_npx[/\\]/.test(entryPath);
}
