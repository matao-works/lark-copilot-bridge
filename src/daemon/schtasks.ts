/**
 * Windows Task Scheduler 后端
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  WINDOWS_TASK_NAME,
  bridgeRunArgs,
  daemonLogDir,
  daemonStderrPath,
  daemonStdoutPath,
  windowsLauncherCmdPath,
} from './paths.js';
import { CONFIG_DIR } from '../config.js';

export function buildLauncherCmd(inputs: {
  nodePath: string;
  bridgeEntryPath: string;
  envPath: string;
  channelHome: string;
}): string {
  return [
    '@echo off',
    `cd /d "${inputs.channelHome}"`,
    `set "LARK_COPILOT_BRIDGE_HOME=${inputs.channelHome}"`,
    `set "PATH=${inputs.envPath}"`,
    `"${inputs.nodePath}" "${inputs.bridgeEntryPath}" run >> "${daemonStdoutPath()}" 2>> "${daemonStderrPath()}"`,
    '',
  ].join('\r\n');
}

async function writeLauncherCmd(): Promise<void> {
  const { nodePath, bridgeEntryPath } = bridgeRunArgs();
  const content = buildLauncherCmd({
    nodePath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? '',
    channelHome: CONFIG_DIR,
  });
  const cmdPath = windowsLauncherCmdPath();
  await mkdir(dirname(cmdPath), { recursive: true });
  await mkdir(daemonLogDir(), { recursive: true });
  await writeFile(cmdPath, content, 'utf8');
}

function runSchtasks(args: string[]): { ok: boolean; stderr: string; stdout: string } {
  const r = spawnSync('schtasks', args, { encoding: 'utf8' });
  return { ok: r.status === 0, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

export async function installTask(): Promise<{ ok: boolean; stderr: string; stdout: string }> {
  await writeLauncherCmd();
  return runSchtasks([
    '/Create',
    '/F',
    '/SC',
    'ONLOGON',
    '/RL',
    'LIMITED',
    '/TN',
    WINDOWS_TASK_NAME,
    '/TR',
    `"${windowsLauncherCmdPath()}"`,
  ]);
}

export function runTask(): { ok: boolean; stderr: string; stdout: string } {
  return runSchtasks(['/Run', '/TN', WINDOWS_TASK_NAME]);
}

export function endTask(): { ok: boolean; stderr: string; stdout: string } {
  return runSchtasks(['/End', '/TN', WINDOWS_TASK_NAME]);
}

export function disableTask(): { ok: boolean; stderr: string; stdout: string } {
  return runSchtasks(['/Change', '/TN', WINDOWS_TASK_NAME, '/Disable']);
}

export function enableTask(): { ok: boolean; stderr: string; stdout: string } {
  return runSchtasks(['/Change', '/TN', WINDOWS_TASK_NAME, '/Enable']);
}

export async function endAndDisable(): Promise<{ ok: boolean; stderr: string; stdout: string }> {
  const ended = endTask();
  const stopped = await waitUntilStopped(5_000);
  const disabled = disableTask();
  if (!stopped) {
    return {
      ok: false,
      stderr: ended.stderr || 'task still running after /End',
      stdout: ended.stdout,
    };
  }
  // 已停住即视为成功；disable 失败只附带 stderr
  if (!disabled.ok) {
    return {
      ok: true,
      stderr: disabled.stderr || 'task stopped but /Disable failed',
      stdout: disabled.stdout,
    };
  }
  return disabled;
}

const ENABLE_FAIL_ZH =
  '无法启用计划任务（/Enable 失败）。请在「任务计划程序」中手动启用该任务后再 start。';

function enableFailResult(enabled: { stderr: string; stdout: string }): {
  ok: false;
  stderr: string;
  stdout: string;
} {
  const detail = enabled.stderr.trim();
  return {
    ok: false,
    stderr: detail ? `${ENABLE_FAIL_ZH}\n${detail}` : ENABLE_FAIL_ZH,
    stdout: enabled.stdout,
  };
}

export async function restartTask(): Promise<{ ok: boolean; stderr: string; stdout: string }> {
  endTask();
  await waitUntilStopped();
  const enabled = enableTask();
  if (!enabled.ok) return enableFailResult(enabled);
  return runTask();
}

/** stop 会 /Disable，start 必须先 /Enable 再 /Run */
export function enableAndRun(): { ok: boolean; stderr: string; stdout: string } {
  const enabled = enableTask();
  if (!enabled.ok) return enableFailResult(enabled);
  return runTask();
}

export function isTaskRegistered(): boolean {
  const r = spawnSync('schtasks', ['/Query', '/TN', WINDOWS_TASK_NAME], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return r.status === 0;
}

export function isTaskRunning(): boolean {
  const r = runSchtasks(['/Query', '/V', '/FO', 'LIST', '/TN', WINDOWS_TASK_NAME]);
  if (!r.ok) return false;
  return /Status:\s+Running/i.test(r.stdout);
}

export function describeTask(): string {
  const r = runSchtasks(['/Query', '/V', '/FO', 'LIST', '/TN', WINDOWS_TASK_NAME]);
  return r.stdout || r.stderr || '';
}

export async function waitUntilStopped(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isTaskRunning()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function deleteTask(): Promise<{ ok: boolean; stderr: string; stdout: string }> {
  const r = runSchtasks(['/Delete', '/F', '/TN', WINDOWS_TASK_NAME]);
  if (existsSync(windowsLauncherCmdPath())) {
    await rm(windowsLauncherCmdPath(), { force: true });
  }
  return r;
}
