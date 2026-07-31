/**
 * macOS launchd 后端
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname } from 'node:path';
import {
  LAUNCH_AGENT_LABEL,
  bridgeRunArgs,
  daemonLogDir,
  daemonStderrPath,
  daemonStdoutPath,
  launchAgentPlistPath,
} from './paths.js';
import { CONFIG_DIR } from '../config.js';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPlist(inputs: {
  nodePath: string;
  bridgeEntryPath: string;
  envPath: string;
  channelHome: string;
  workingDirectory?: string;
}): string {
  const wd = inputs.workingDirectory ?? inputs.channelHome;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(inputs.nodePath)}</string>
        <string>${escapeXml(inputs.bridgeEntryPath)}</string>
        <string>run</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(wd)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(daemonStdoutPath())}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(daemonStderrPath())}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${escapeXml(inputs.envPath)}</string>
        <key>LARK_COPILOT_BRIDGE_HOME</key>
        <string>${escapeXml(inputs.channelHome)}</string>
    </dict>
</dict>
</plist>
`;
}

export async function writePlist(): Promise<void> {
  const { nodePath, bridgeEntryPath } = bridgeRunArgs();
  const content = buildPlist({
    nodePath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? '',
    channelHome: CONFIG_DIR,
  });
  const plistPath = launchAgentPlistPath();
  await mkdir(dirname(plistPath), { recursive: true });
  await mkdir(daemonLogDir(), { recursive: true });
  await writeFile(plistPath, content, 'utf8');
}

export function plistExists(): boolean {
  return existsSync(launchAgentPlistPath());
}

function userTarget(): string {
  return `gui/${userInfo().uid}`;
}

function serviceTarget(): string {
  return `${userTarget()}/${LAUNCH_AGENT_LABEL}`;
}

function runLaunchctl(args: string[]): { ok: boolean; stderr: string; stdout: string } {
  const r = spawnSync('launchctl', args, { encoding: 'utf8' });
  return { ok: r.status === 0, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

export function bootstrap(): { ok: boolean; stderr: string; stdout: string } {
  return runLaunchctl(['bootstrap', userTarget(), launchAgentPlistPath()]);
}

export function bootout(): { ok: boolean; stderr: string; stdout: string } {
  return runLaunchctl(['bootout', serviceTarget()]);
}

export function kickstart(): { ok: boolean; stderr: string; stdout: string } {
  return runLaunchctl(['kickstart', '-k', serviceTarget()]);
}

/** Prefer disable so KeepAlive does not come back on next login after stop. */
export function disable(): { ok: boolean; stderr: string; stdout: string } {
  return runLaunchctl(['disable', serviceTarget()]);
}

export function enable(): { ok: boolean; stderr: string; stdout: string } {
  return runLaunchctl(['enable', serviceTarget()]);
}

export function isLoaded(): boolean {
  const r = spawnSync('launchctl', ['print', serviceTarget()], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return r.status === 0;
}

/** loaded 且 pid>0 才算在跑（避免仅挂着未起进程） */
export function isRunning(): boolean {
  if (!isLoaded()) return false;
  const text = describeService();
  const m = text.match(/pid\s*=\s*(\d+)/);
  const pid = m ? Number(m[1]) : 0;
  return Number.isFinite(pid) && pid > 0;
}

export async function waitUntilUnloaded(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isLoaded()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export function describeService(): string {
  const r = runLaunchctl(['print', serviceTarget()]);
  return r.stdout || r.stderr || '';
}

export async function deletePlist(): Promise<void> {
  await rm(launchAgentPlistPath(), { force: true });
}
