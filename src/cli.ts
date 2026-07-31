/**
 * CLI 子命令：version / doctor / config / logout / setup
 */
import { existsSync, accessSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CONFIG_DIR,
  CONFIG_FILE,
  clearCredentials,
  getConfigSummary,
  loadCredentials,
  saveCredentials,
  validateWorkspaceDir,
} from './config.js';
import { getCopilotVersion, supportsCopilotJsonOutput } from './copilot/adapter.js';
import { runSetupWizard, printSetupRequiredHint } from './setup.js';
import { registerAppByQR } from './lark/client.js';
import {
  runServiceStart,
  runServiceStop,
  runServiceRestart,
  runServiceStatus,
  runServiceUnregister,
} from './daemon/service-cli.js';
import { getServiceAdapter } from './daemon/service-adapter.js';
import { daemonStdoutPath, daemonStderrPath } from './daemon/paths.js';

export function getPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
      join(here, '../package.json'),
      join(here, '../../package.json'),
      join(here, 'package.json'),
    ]) {
      if (existsSync(candidate)) {
        return (require(candidate) as { version: string }).version;
      }
    }
  } catch { /* ignore */ }
  return '0.0.0';
}

export function printHelp(): void {
  console.log(`lark-copilot-bridge ${getPackageVersion()}
在飞书里跟你电脑上的 GitHub Copilot 聊天。

前台：
  lark-copilot-bridge           前台启动（第一次会引导设置）
  lark-copilot-bridge run       同上（供后台服务调用）

后台常驻（需先全局安装，不要用 npx start）：
  lark-copilot-bridge start     安装并启动 OS 守护进程
  lark-copilot-bridge stop      停止并取消开机自启
  lark-copilot-bridge restart   重启后台服务
  lark-copilot-bridge status    查看是否在跑
  lark-copilot-bridge unregister  清除守护进程注册（保留配置）

其它：
  lark-copilot-bridge setup     重新选择项目文件夹 / 谁能用
  lark-copilot-bridge doctor    检查是否准备好了
  lark-copilot-bridge config    查看当前设置
  lark-copilot-bridge logout    解除飞书绑定（下次重新扫码）
  lark-copilot-bridge --version
  lark-copilot-bridge --help

安装：
  npm install -g github:matao-works/lark-copilot-bridge

你需要提前有：
  · Node.js 20 或更高
  · 已登录的 GitHub Copilot 命令行（需要 Copilot 订阅）

飞书里可发：/help  /whoami  /new  /stop  /cd  /ws …
也可直接发图片或文件，会下载到本机后交给 Copilot。
`);
}

export function printVersion(): void {
  console.log(getPackageVersion());
}

export function printConfig(): void {
  const s = getConfigSummary();
  console.log('当前设置');
  console.log('────────');
  console.log(`设置文件: ${s.configFile}${existsSync(s.configFile) ? '' : '（还没有）'}`);
  if (!s.hasCredentials) {
    console.log('飞书绑定: 还没有（启动时会请你扫码）');
  } else {
    console.log(`飞书应用: 已绑定`);
    console.log(`你的账号: ${s.creatorOpenId ?? '未记录（建议 logout 后重新扫码）'}`);
  }
  console.log(`项目文件夹: ${s.copilotCwd}`);
  const wsNames = Object.keys(s.workspaces);
  if (wsNames.length === 0) {
    console.log('命名工作目录: 无（飞书里发 /ws add <name>）');
  } else {
    console.log(`命名工作目录: ${wsNames.length} 个（${wsNames.slice(0, 5).join(', ')}${wsNames.length > 5 ? '…' : ''}）`);
  }
  console.log(`单次最长: ${Math.round((s.copilotTimeout ?? 0) / 60_000)} 分钟`);
  if (s.allowedUsers.length === 0) {
    console.log('谁能用: 不限制（有风险）');
  } else if (s.creatorOpenId && s.allowedUsers.length === 1 && s.allowedUsers[0] === s.creatorOpenId) {
    console.log('谁能用: 仅你自己');
  } else {
    console.log(`谁能用: 已限制 ${s.allowedUsers.length} 人`);
  }
  console.log(`首次向导: ${s.setupCompleted ? '已完成' : '未完成（启动时会询问）'}`);
  console.log('');
  console.log('修改设置: lark-copilot-bridge setup');
}

export function runLogout(): number {
  if (!existsSync(CONFIG_FILE)) {
    console.log('当前没有已保存的飞书绑定。');
    return 0;
  }
  clearCredentials();
  console.log('✓ 已解除飞书绑定。');
  console.log('  你的项目文件夹、权限设置还在。');
  console.log('  下次启动会重新请你扫码。');
  return 0;
}

export async function runSetupCommand(): Promise<number> {
  let creds = loadCredentials();
  if (!creds) {
    console.log('还没有绑定飞书。先扫码创建机器人…');
    creds = await registerAppByQR();
    saveCredentials(creds);
  }
  const result = await runSetupWizard(creds, { force: true });
  if (!result) {
    printSetupRequiredHint();
    return 1;
  }
  console.log('设置完成。现在可以启动：');
  console.log('  lark-copilot-bridge');
  return 0;
}

export async function runDoctor(): Promise<number> {
  let failed = 0;
  const ok = (msg: string) => console.log(`✓ ${msg}`);
  const bad = (msg: string, tip?: string) => {
    failed++;
    console.log(`✗ ${msg}`);
    if (tip) console.log(`    → ${tip}`);
  };
  const warn = (msg: string, tip?: string) => {
    console.log(`⚠ ${msg}`);
    if (tip) console.log(`    → ${tip}`);
  };

  console.log(`检查是否准备好了  (v${getPackageVersion()})\n`);

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 20) ok(`电脑运行环境正常（Node.js ${process.version}）`);
  else {
    bad(
      `电脑运行环境过旧（Node.js ${process.version}）`,
      '请安装 Node.js 20 或更高：https://nodejs.org/',
    );
  }

  const copilot = await getCopilotVersion();
  if (copilot.ok) ok(`GitHub Copilot 命令行已安装（${copilot.version}）`);
  else {
    bad('还没有可用的 GitHub Copilot 命令行', '先安装再登录：');
    console.log('       curl -fsSL https://gh.io/copilot-install | bash');
    console.log('       然后输入 copilot，按提示登录（需要 Copilot 订阅）');
  }

  if (copilot.ok) {
    const jsonOk = await supportsCopilotJsonOutput();
    if (jsonOk) {
      ok('支持结构化流式输出（--output-format json）→ 卡片可显示工具调用');
    } else {
      warn(
        '当前 Copilot 不支持 json 输出格式',
        '卡片只能显示纯文本。请升级 Copilot CLI 到 1.0.49 或更高',
      );
    }
  }

  if (existsSync(CONFIG_DIR)) ok('已有本机设置目录');
  else warn('还没有设置目录', '第一次启动时会自动创建');

  if (existsSync(CONFIG_FILE)) {
    try {
      accessSync(CONFIG_FILE, constants.R_OK);
      const mode = statSync(CONFIG_FILE).mode & 0o777;
      const summary = getConfigSummary();
      if (summary.hasCredentials) {
        ok('飞书机器人已绑定');
        if (!summary.creatorOpenId) {
          warn('没有记下扫码账号', '运行：lark-copilot-bridge logout 后重新启动扫码');
        }
      } else {
        warn('还没有飞书绑定', '启动后按提示用飞书扫码即可');
      }
      if (mode & 0o077) {
        warn('设置文件权限偏松', `可在终端执行：chmod 600 ${CONFIG_FILE}`);
      }
    } catch (err) {
      bad('读不到设置文件', (err as Error).message);
    }
  } else {
    warn('还没有飞书绑定', '启动后按提示用飞书扫码即可');
  }

  const summary = getConfigSummary();
  try {
    const abs = validateWorkspaceDir(summary.copilotCwd || process.cwd());
    ok(`项目文件夹可用：${abs}`);
  } catch (err) {
    bad('项目文件夹还没选好或不合法', (err as Error).message.split('\n')[0]);
    console.log('       请运行：lark-copilot-bridge setup');
  }

  if (summary.allowedUsers.length === 0) {
    warn(
      '当前不限制谁能用这个机器人',
      '推荐运行 setup，选择「仅我自己」',
    );
  } else {
    ok(summary.allowedUsers.length === 1 ? '已限制为指定用户可用' : `已限制 ${summary.allowedUsers.length} 人可用`);
  }

  if (!summary.setupCompleted) {
    warn('首次设置向导尚未完成', '启动时会询问，或运行 lark-copilot-bridge setup');
  }

  const adapter = getServiceAdapter();
  if (adapter) {
    if (adapter.isRunning()) {
      ok(`后台常驻已在跑（${adapter.platformName}）`);
      console.log(`    日志: ${daemonStdoutPath()}`);
      console.log(`          ${daemonStderrPath()}`);
    } else if (adapter.fileExists()) {
      warn('后台服务已注册但当前没在跑', '运行：lark-copilot-bridge start');
    } else {
      console.log(`· 后台常驻未注册（可选：lark-copilot-bridge start）`);
    }
  }

  console.log('');
  if (failed === 0) {
    console.log('看起来可以了。任选一种启动方式：');
    console.log('  lark-copilot-bridge          # 前台（关掉窗口会下线）');
    console.log('  lark-copilot-bridge start    # 后台常驻（推荐）');
    return 0;
  }
  console.log(`还有 ${failed} 处需要先处理好，再启动。`);
  return 1;
}

/** 解析 argv；若已处理并应退出则返回 exit code，否则返回 null（继续启动） */
export async function dispatchCli(argv: string[]): Promise<number | null> {
  const args = argv.filter(Boolean);
  if (args.length === 0) return null;

  const head = args[0] ?? '';

  if (head === '--help' || head === '-h' || head === 'help') {
    printHelp();
    return 0;
  }
  if (head === '--version' || head === '-V' || head === 'version') {
    printVersion();
    return 0;
  }
  if (head === 'doctor') {
    return runDoctor();
  }
  if (head === 'config') {
    printConfig();
    return 0;
  }
  if (head === 'setup') {
    return runSetupCommand();
  }
  if (head === 'logout' || head === 'reset') {
    return runLogout();
  }
  if (head === 'run') {
    return null;
  }
  if (head === 'start') {
    return runServiceStart();
  }
  if (head === 'stop') {
    return runServiceStop();
  }
  if (head === 'restart') {
    return runServiceRestart();
  }
  if (head === 'status') {
    return runServiceStatus();
  }
  if (head === 'unregister') {
    return runServiceUnregister();
  }

  if (head.startsWith('-')) {
    console.error(`不认识的选项: ${head}\n`);
    printHelp();
    return 1;
  }

  console.error(`不认识的命令: ${head}\n`);
  printHelp();
  return 1;
}
