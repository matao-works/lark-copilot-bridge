/**
 * Linux systemd --user 后端
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  SYSTEMD_UNIT_NAME,
  bridgeRunArgs,
  daemonLogDir,
  daemonStderrPath,
  daemonStdoutPath,
  systemdUnitPath,
} from './paths.js';
import { CONFIG_DIR } from '../config.js';

function escapeUnit(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildUnit(inputs: {
  nodePath: string;
  bridgeEntryPath: string;
  envPath: string;
  channelHome: string;
  workingDirectory?: string;
}): string {
  const wd = inputs.workingDirectory ?? inputs.channelHome;
  return `[Unit]
Description=Lark Copilot Bridge bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${escapeUnit(wd)}
ExecStart="${escapeUnit(inputs.nodePath)}" "${escapeUnit(inputs.bridgeEntryPath)}" run
Restart=always
RestartSec=5
StandardOutput=append:${daemonStdoutPath()}
StandardError=append:${daemonStderrPath()}
Environment="PATH=${escapeUnit(inputs.envPath)}"
Environment="LARK_COPILOT_BRIDGE_HOME=${escapeUnit(inputs.channelHome)}"

[Install]
WantedBy=default.target
`;
}

export async function writeUnit(): Promise<void> {
  const { nodePath, bridgeEntryPath } = bridgeRunArgs();
  const content = buildUnit({
    nodePath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? '',
    channelHome: CONFIG_DIR,
  });
  const unitPath = systemdUnitPath();
  await mkdir(dirname(unitPath), { recursive: true });
  await mkdir(daemonLogDir(), { recursive: true });
  await writeFile(unitPath, content, 'utf8');
}

export function unitExists(): boolean {
  return existsSync(systemdUnitPath());
}

function runSystemctl(args: string[]): { ok: boolean; stderr: string; stdout: string } {
  const r = spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

export function daemonReload(): { ok: boolean; stderr: string; stdout: string } {
  return runSystemctl(['daemon-reload']);
}

export function enableAndStart(): { ok: boolean; stderr: string; stdout: string } {
  return runSystemctl(['enable', '--now', SYSTEMD_UNIT_NAME]);
}

export function stop(): { ok: boolean; stderr: string; stdout: string } {
  return runSystemctl(['stop', SYSTEMD_UNIT_NAME]);
}

export function disableAndStop(): { ok: boolean; stderr: string; stdout: string } {
  return runSystemctl(['disable', '--now', SYSTEMD_UNIT_NAME]);
}

export function restart(): { ok: boolean; stderr: string; stdout: string } {
  return runSystemctl(['restart', SYSTEMD_UNIT_NAME]);
}

export function isActive(): boolean {
  const r = spawnSync('systemctl', ['--user', 'is-active', SYSTEMD_UNIT_NAME], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return r.status === 0;
}

export function describeService(): string {
  const r = runSystemctl(['status', SYSTEMD_UNIT_NAME, '--no-pager']);
  return r.stdout || r.stderr || '';
}

export async function waitUntilInactive(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isActive()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function deleteUnit(): Promise<void> {
  await rm(systemdUnitPath(), { force: true });
}
