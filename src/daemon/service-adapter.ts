/**
 * 跨平台 ServiceAdapter
 */
import * as launchd from './launchd.js';
import * as systemd from './systemd.js';
import * as schtasks from './schtasks.js';
import { launchAgentPlistPath, systemdUnitPath, WINDOWS_TASK_NAME } from './paths.js';

export interface ServiceResult {
  ok: boolean;
  stderr: string;
  stdout: string;
}

export interface ServiceAdapter {
  platformName: string;
  fileExists: () => boolean;
  isRunning: () => boolean;
  servicePath: () => string;
  install: () => Promise<void>;
  start: () => Promise<ServiceResult> | ServiceResult;
  stop: () => Promise<ServiceResult> | ServiceResult;
  stopAndDisableAutostart: () => Promise<ServiceResult> | ServiceResult;
  restart: () => Promise<ServiceResult> | ServiceResult;
  waitUntilStopped: (timeoutMs?: number) => Promise<boolean>;
  deleteFile: () => Promise<void>;
  describeStatus: () => string;
  parseStatus: (text: string) => { pid?: string; lastExit?: string };
}

function makeLaunchdAdapter(): ServiceAdapter {
  return {
    platformName: 'launchd (macOS)',
    fileExists: () => launchd.plistExists(),
    isRunning: () => launchd.isRunning(),
    servicePath: () => launchAgentPlistPath(),
    install: async () => {
      await launchd.writePlist();
    },
    start: () => {
      launchd.enable();
      return launchd.bootstrap();
    },
    stop: () => launchd.bootout(),
    stopAndDisableAutostart: () => {
      // 先 disable，避免下次登录 RunAtLoad；再 bootout 卸掉当前实例
      const d = launchd.disable();
      const out = launchd.bootout();
      if (!out.ok) {
        return {
          ok: false,
          stdout: out.stdout,
          stderr: d.ok ? out.stderr : `disable failed: ${d.stderr}\n${out.stderr}`,
        };
      }
      if (!d.ok) {
        // bootout 已成功停掉，但未禁用自启——对用户视为失败以便重试/排查
        return {
          ok: false,
          stdout: out.stdout,
          stderr: `disable failed: ${d.stderr}\n${out.stderr}`.trim(),
        };
      }
      return out;
    },
    restart: () => launchd.kickstart(),
    waitUntilStopped: (timeoutMs) => launchd.waitUntilUnloaded(timeoutMs),
    deleteFile: () => launchd.deletePlist(),
    describeStatus: () => launchd.describeService(),
    parseStatus: (text) => ({
      pid: text.match(/pid\s*=\s*(\d+)/)?.[1],
      lastExit: text.match(/last exit code\s*=\s*(-?\d+)/i)?.[1],
    }),
  };
}

function makeSystemdAdapter(): ServiceAdapter {
  return {
    platformName: 'systemd (Linux user)',
    fileExists: () => systemd.unitExists(),
    isRunning: () => systemd.isActive(),
    servicePath: () => systemdUnitPath(),
    install: async () => {
      await systemd.writeUnit();
      systemd.daemonReload();
    },
    start: () => systemd.enableAndStart(),
    stop: () => systemd.stop(),
    stopAndDisableAutostart: () => systemd.disableAndStop(),
    restart: () => systemd.restart(),
    waitUntilStopped: (timeoutMs) => systemd.waitUntilInactive(timeoutMs),
    deleteFile: async () => {
      await systemd.deleteUnit();
      systemd.daemonReload();
    },
    describeStatus: () => systemd.describeService(),
    parseStatus: (text) => ({
      pid: text.match(/Main PID:\s*(\d+)/)?.[1],
      lastExit: text.match(/Process:\s+\d+\s+ExecStart=.*status=(\d+)/)?.[1],
    }),
  };
}

function makeSchtasksAdapter(): ServiceAdapter {
  return {
    platformName: 'Task Scheduler (Windows)',
    fileExists: () => schtasks.isTaskRegistered(),
    isRunning: () => schtasks.isTaskRunning(),
    servicePath: () => WINDOWS_TASK_NAME,
    install: async () => {
      const r = await schtasks.installTask();
      if (!r.ok) throw new Error(r.stderr || 'schtasks /Create failed');
    },
    start: () => schtasks.enableAndRun(),
    stop: () => schtasks.endTask(),
    stopAndDisableAutostart: () => schtasks.endAndDisable(),
    restart: () => schtasks.restartTask(),
    waitUntilStopped: (timeoutMs) => schtasks.waitUntilStopped(timeoutMs),
    deleteFile: async () => {
      await schtasks.deleteTask();
    },
    describeStatus: () => schtasks.describeTask(),
    parseStatus: (text) => ({
      pid: text.match(/Process ID:\s*(\d+)/i)?.[1],
      lastExit: text.match(/Last Result:\s*(\d+)/i)?.[1],
    }),
  };
}

export function getServiceAdapter(): ServiceAdapter | null {
  if (process.platform === 'darwin') return makeLaunchdAdapter();
  if (process.platform === 'linux') return makeSystemdAdapter();
  if (process.platform === 'win32') return makeSchtasksAdapter();
  return null;
}

export function requireAdapter(cmd: string): ServiceAdapter {
  const adapter = getServiceAdapter();
  if (!adapter) {
    console.error(`✗ 当前系统不支持后台常驻命令「${cmd}」`);
    console.error('  目前支持: macOS (launchd) / Linux (systemd) / Windows (Task Scheduler)');
    process.exit(1);
  }
  return adapter;
}
