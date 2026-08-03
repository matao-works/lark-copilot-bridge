/**
 * 后台常驻 CLI：start / stop / restart / status / unregister
 */
import { existsSync } from 'node:fs';
import { CONFIG_DIR, CONFIG_FILE, loadCredentials, getConfigSummary, tryResolveWorkspaceDir } from '../config.js';
import { requireAdapter } from './service-adapter.js';
import {
  bridgeRunArgs,
  daemonStderrPath,
  daemonStdoutPath,
  looksLikeNpxCachePath,
} from './paths.js';
import { readAndPrune, waitForBotConnect } from './registry.js';

function warnNpxIfNeeded(): void {
  try {
    const { bridgeEntryPath } = bridgeRunArgs();
    if (looksLikeNpxCachePath(bridgeEntryPath)) {
      console.warn('⚠ 检测到通过 npx 启动。后台服务会记下临时路径，缓存清理后会失效。');
      console.warn('  请先全局安装再 start：');
      console.warn('    npm install -g lark-copilot-bridge');
      console.warn('');
    }
  } catch { /* ignore */ }
}

function formatStderr(stderr: string): string {
  return stderr.trim() || '(无详情)';
}

async function reportConnectAfter(
  verb: 'started' | 'restarted',
  appId: string,
  fn: () => Promise<{ ok: boolean; stderr: string }> | { ok: boolean; stderr: string },
): Promise<number> {
  const beforePids = new Set(
    readAndPrune().filter((e) => e.appId === appId).map((e) => e.pid),
  );
  const r = await fn();
  if (!r.ok) {
    console.error(`✗ ${verb === 'started' ? '启动' : '重启'}失败:\n${formatStderr(r.stderr)}`);
    return 1;
  }
  console.log(verb === 'started' ? '正在等待 bot 连接…' : '正在等待 bot 重新连接…');
  const entry = await waitForBotConnect(appId, beforePids);
  if (entry) {
    const verbZh = verb === 'started' ? '已启动' : '已重启';
    console.log(`✓ ${verbZh}  bot: ${entry.botName} (${entry.appId})  pid: ${entry.pid}`);
    return 0;
  }
  console.warn('⚠ 已下发指令，但 30 秒内未观察到 bot 连接成功。');
  console.warn(`  查看日志: tail -f ${daemonStderrPath()}`);
  console.warn(`              tail -f ${daemonStdoutPath()}`);
  return 0;
}

function ensureConfigured(): { appId: string } | null {
  if (!existsSync(CONFIG_FILE) || !loadCredentials()) {
    console.error('还没有绑定飞书。请先前台跑一次完成扫码：');
    console.error('  lark-copilot-bridge');
    console.error('或：');
    console.error('  lark-copilot-bridge setup');
    return null;
  }
  if (!tryResolveWorkspaceDir()) {
    console.error('项目文件夹还没选好。请先运行：');
    console.error('  lark-copilot-bridge setup');
    return null;
  }
  const creds = loadCredentials()!;
  return { appId: creds.appId };
}

export async function runServiceStart(): Promise<number> {
  warnNpxIfNeeded();
  const cfg = ensureConfigured();
  if (!cfg) return 1;
  const adapter = requireAdapter('start');

  await adapter.install();
  if (adapter.isRunning()) {
    console.log('检测到旧实例，先停掉再启动…');
    const r = await adapter.stop();
    if (!r.ok) {
      console.warn(`⚠ 停止旧实例时有警告（继续）:\n${formatStderr(r.stderr)}`);
    }
    const ok = await adapter.waitUntilStopped();
    if (!ok) {
      console.error('✗ 旧实例没有完全停下。请稍后重试，或：');
      console.error('  lark-copilot-bridge unregister');
      console.error('  lark-copilot-bridge start');
      return 1;
    }
  }
  return reportConnectAfter('started', cfg.appId, () => adapter.start());
}

export async function runServiceStop(): Promise<number> {
  const adapter = requireAdapter('stop');
  if (!adapter.fileExists()) {
    console.log('后台服务还没注册过，无需停止。');
    return 0;
  }
  if (!adapter.isRunning()) {
    console.log('后台服务当前没有在跑。');
    const r = await adapter.stopAndDisableAutostart();
    if (!r.ok) {
      console.warn(`⚠ 取消自启时有警告:\n${formatStderr(r.stderr)}`);
      return 1;
    }
    if (process.platform === 'win32') {
      console.log('  （已确保计划任务禁用，不会在登录时自启）');
    }
    return 0;
  }
  const creds = loadCredentials();
  const entry = creds
    ? readAndPrune().find((e) => e.appId === creds.appId && Boolean(e.botName))
    : undefined;
  const r = await adapter.stopAndDisableAutostart();
  if (!r.ok) {
    console.error(`✗ 停止失败:\n${formatStderr(r.stderr)}`);
    return 1;
  }
  const stopped = await adapter.waitUntilStopped();
  if (!stopped) {
    console.warn('⚠ 已下发停止，但进程可能尚未完全退出。');
  }
  if (entry) {
    console.log(`✓ bot ${entry.botName} (${entry.appId}) 已停止`);
  } else {
    console.log('✓ 后台服务已停止');
  }
  if (process.platform === 'win32') {
    console.log('  （计划任务已禁用，不会在登录时自启）');
  }
  console.log('  再用 start 可重新启动');
  return 0;
}

export async function runServiceRestart(): Promise<number> {
  warnNpxIfNeeded();
  const cfg = ensureConfigured();
  if (!cfg) return 1;
  const adapter = requireAdapter('restart');
  if (!adapter.fileExists()) {
    console.error('后台服务还没注册过。请先运行：');
    console.error('  lark-copilot-bridge start');
    return 1;
  }
  if (adapter.isRunning()) {
    return reportConnectAfter('restarted', cfg.appId, () => adapter.restart());
  }
  return reportConnectAfter('started', cfg.appId, () => adapter.start());
}

export async function runServiceStatus(): Promise<number> {
  const adapter = requireAdapter('status');
  if (!adapter.fileExists()) {
    console.log('后台服务当前没在跑（从未 start 过）');
    console.log('  用 start 启动： lark-copilot-bridge start');
    return 0;
  }
  if (!adapter.isRunning()) {
    console.log('后台服务当前没在跑');
    console.log('  用 start 重新启动');
    return 0;
  }
  const creds = loadCredentials();
  const entry = creds
    ? readAndPrune().find((e) => e.appId === creds.appId && Boolean(e.botName))
    : undefined;
  const { pid, lastExit } = adapter.parseStatus(adapter.describeStatus());
  if (entry) {
    console.log(`✓ bot ${entry.botName} (${entry.appId}) 正在后台运行`);
  } else {
    console.log('✓ 后台服务正在运行');
  }
  if (pid) console.log(`  进程 ID: ${pid}`);
  console.log('  日志:');
  console.log(`    ${daemonStdoutPath()}`);
  console.log(`    ${daemonStderrPath()}`);
  if (lastExit && lastExit !== '-1') console.log(`  上次退出码: ${lastExit}`);
  const summary = getConfigSummary();
  if (summary.copilotCwd) console.log(`  项目文件夹: ${summary.copilotCwd}`);
  return 0;
}

export async function runServiceUnregister(): Promise<number> {
  const adapter = requireAdapter('unregister');
  if (!adapter.fileExists()) {
    console.log('后台服务还没注册过，无需清理。');
    return 0;
  }
  if (adapter.isRunning()) {
    const r = await adapter.stopAndDisableAutostart();
    if (!r.ok) {
      console.warn(`⚠ 停止时有警告（继续清理）:\n${formatStderr(r.stderr)}`);
    } else {
      console.log('✓ 已停止后台服务');
    }
    const ok = await adapter.waitUntilStopped();
    if (!ok) {
      console.warn('⚠ 进程可能尚未完全退出，继续清除注册…');
    }
  }
  await adapter.deleteFile();
  console.log('✓ 已清除后台常驻注册');
  console.log(`  （配置 / 日志 / 会话仍保留在 ${CONFIG_DIR}）`);
  return 0;
}
