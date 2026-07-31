/**
 * 首次使用向导：用白话问两件事——工作文件夹、谁能用。
 * 不要求用户懂环境变量 / open_id / cwd。
 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  isSetupCompleted,
  saveSetupPreferences,
  validateWorkspaceDir,
  tryResolveWorkspaceDir,
} from './config.js';
import type { AppCredentials } from './types.js';

export interface SetupResult {
  copilotCwd: string;
  allowedUsers: string[];
}

function expandPath(raw: string): string {
  return resolve(raw.trim().replace(/^~(?=$|\/|\\)/, homedir()));
}

async function ask(rl: readline.Interface, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

/** 是否应弹出向导（首次、或工作目录还没配好） */
export function shouldRunSetup(opts?: { force?: boolean }): boolean {
  if (opts?.force) return true;
  if (!isSetupCompleted()) return true;
  return tryResolveWorkspaceDir() === null;
}

/**
 * 交互式设置。非 TTY 时返回 null（调用方应给出白话错误）。
 */
export async function runSetupWizard(creds: AppCredentials, opts?: { force?: boolean }): Promise<SetupResult | null> {
  if (!input.isTTY || !output.isTTY) {
    return null;
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log('');
    console.log('────────────────────────────────────────');
    console.log('  欢迎使用飞书 × Copilot 桥接');
    console.log('  接下来只需回答两个问题（可随时改）');
    console.log('────────────────────────────────────────');
    console.log('');

    const cwd = await askWorkspace(rl);
    const allowedUsers = await askWhoCanUse(rl, creds);

    saveSetupPreferences({
      copilotCwd: cwd,
      allowedUsers,
      setupCompleted: true,
    });

    console.log('');
    console.log('✓ 设置已保存');
    console.log(`  工作文件夹: ${cwd}`);
    if (allowedUsers.length === 0) {
      console.log('  谁能用:     不限制（请注意安全）');
    } else if (creds.creatorOpenId && allowedUsers.length === 1 && allowedUsers[0] === creds.creatorOpenId) {
      console.log('  谁能用:     仅你自己');
    } else {
      console.log(`  谁能用:     已限制 ${allowedUsers.length} 人`);
    }
    console.log('');
    console.log('以后想重新设置，在终端运行：');
    console.log('  lark-copilot-bridge setup');
    console.log('');

    return { copilotCwd: cwd, allowedUsers };
  } finally {
    rl.close();
  }
}

async function askWorkspace(rl: readline.Interface): Promise<string> {
  console.log('【1/2】Copilot 可以改哪些文件？');
  console.log('  请指定一个「项目文件夹」路径。');
  console.log('  机器人只会在这个文件夹里读文件、改代码。');
  console.log('');
  console.log('  怎么找路径（Mac）：');
  console.log('    · 打开「访达」→ 进入你的项目文件夹');
  console.log('    · 右键文件夹标题栏（或按住 Option 点路径）复制路径');
  console.log('    · 或在终端拖文件夹进来，路径会自动出现');
  console.log('');
  console.log(`  示例: ~/Desktop/my-project`);
  console.log(`        ${homedir()}/Documents/work`);
  console.log('');

  const existing = tryResolveWorkspaceDir();
  if (existing) {
    console.log(`  当前已保存: ${existing}`);
    console.log('  直接回车 = 继续用这个；或输入新路径。');
  }

  for (;;) {
    const hint = existing ? `工作文件夹 [${existing}]: ` : '工作文件夹路径: ';
    const raw = await ask(rl, hint);
    const candidate = raw ? expandPath(raw) : existing;
    if (!candidate) {
      console.log('  请输入一个文件夹路径。\n');
      continue;
    }
    try {
      const abs = validateWorkspaceDir(candidate);
      console.log(`  ✓ 好的，将使用: ${abs}\n`);
      return abs;
    } catch (err) {
      console.log(`  ✗ ${(err as Error).message}`);
      console.log('  请换一个「具体的项目文件夹」，不能是整个用户主目录。\n');
    }
  }
}

async function askWhoCanUse(rl: readline.Interface, creds: AppCredentials): Promise<string[]> {
  console.log('【2/2】谁可以在飞书里使用这个机器人？');
  console.log('  机器人连的是你这台电脑上的 Copilot，相当于远程指挥你的电脑写代码。');
  console.log('');
  console.log('  1) 仅我自己（推荐）');
  console.log('  2) 暂不限制 — 任何能找到机器人的人都能用（有风险）');
  console.log('');

  for (;;) {
    const choice = await ask(rl, '请选择 1 或 2 [1]: ');
    const c = choice || '1';
    if (c === '1') {
      if (creds.creatorOpenId) {
        console.log('  ✓ 已限制为仅扫码创建的账号可用\n');
        return [creds.creatorOpenId];
      }
      console.log('  ⚠ 没能自动识别你的飞书账号。');
      console.log('  启动后请先私聊机器人发 /whoami，再运行:');
      console.log('    lark-copilot-bridge setup');
      console.log('  暂时先不限制，请勿把机器人拉进陌生人群。\n');
      return [];
    }
    if (c === '2') {
      console.log('  ⚠ 已选择不限制。请不要分享机器人，也不要拉进公开群。\n');
      return [];
    }
    console.log('  请输入 1 或 2。\n');
  }
}

/** 非交互场景下的白话说明 */
export function printSetupRequiredHint(): void {
  console.error('');
  console.error('还需要完成一次简单设置（指定项目文件夹）。');
  console.error('请在「普通终端窗口」里运行：');
  console.error('  lark-copilot-bridge setup');
  console.error('');
  console.error('或手动指定文件夹后再启动：');
  console.error('  COPILOT_CWD=~/你的项目文件夹 lark-copilot-bridge');
  console.error('');
}
