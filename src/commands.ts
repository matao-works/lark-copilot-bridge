/**
 * 斜杠命令系统（对照原项目 src/commands/index.ts）
 *
 * - 普通命令：谁能聊天谁就能用（/new /help /status /stop /timeout）
 * - 特权命令：仅 owner/admin（/invite /remove /cd /ws）——个人自用不挡扫码本人
 * - 回执一律 replyTo 用户消息
 */
import type { IncomingMessage } from './lark/client.js';
import type { LarkBridge } from './lark/client.js';
import type { SessionStore } from './session.js';
import type { MessageQueue } from './queue.js';
import type { BridgeConfig } from './config.js';
import {
  listWorkspaces,
  saveWorkspace,
  removeWorkspace,
  validateWorkspaceDir,
  addAllowedChat,
  removeAllowedChat,
  addAdmin,
  removeAdmin,
  saveCopilotConfig,
} from './config.js';
import { infoCard } from './lark/card.js';
import { isPrivileged } from './acl.js';
import { log } from './logger.js';

export interface CommandContext {
  lark: LarkBridge;
  session: SessionStore;
  queue: MessageQueue<IncomingMessage>;
  config: BridgeConfig;
  chatId: string;
  scope: string;
  messageId: string;
  threadId?: string;
  senderId: string;
  ownerOpenId?: string;
}

export interface CommandResult {
  handled: boolean;
}

type ReplyOpts = { replyTo: string; replyInThread?: true };

function replyOpts(ctx: CommandContext): ReplyOpts {
  return {
    replyTo: ctx.messageId,
    ...(ctx.threadId ? { replyInThread: true as const } : {}),
  };
}

async function replyText(ctx: CommandContext, text: string): Promise<void> {
  try {
    await ctx.lark.sendText(ctx.chatId, text, replyOpts(ctx));
  } catch (err) {
    log.error('命令回复失败: %s', (err as Error).message);
  }
}

async function replyCard(ctx: CommandContext, card: object): Promise<void> {
  try {
    await ctx.lark.sendCard(ctx.chatId, card, replyOpts(ctx));
  } catch (err) {
    log.error('命令卡片失败: %s', (err as Error).message);
  }
}

async function requirePrivilege(ctx: CommandContext): Promise<boolean> {
  if (isPrivileged(ctx.senderId, ctx.config, ctx.ownerOpenId)) return true;
  await replyText(ctx, '⚠️ 此命令仅 bot owner / 管理员可用。');
  return false;
}

const HELP_BODY = `**命令列表**

- \`/new\` \`/reset\` — 清空当前会话
- \`/cd <path>\` — 切换工作目录（owner，会重置会话）
- \`/ws list|save|use|remove\` — 工作目录别名（owner）
- \`/status\` — 查看当前状态
- \`/stop\` — 停止当前任务（也可点卡片 ⏹ 终止）
- \`/timeout [N|off]\` — 设置当前会话超时（分钟）
- \`/invite group|admin\` — 白名单 / 管理员（owner）
- \`/remove group|admin\` — 移出白名单 / 管理员（owner）
- \`/help\` — 本帮助

其他内容直接发给 Copilot。私聊无需 @，群聊需 @机器人。`;

export async function handleCommand(text: string, ctx: CommandContext): Promise<CommandResult> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return { handled: false };

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0] ?? '';
  const arg = parts.slice(1).join(' ');
  log.info('命令: %s [scope=%s sender=%s]', cmd, ctx.scope, ctx.senderId);

  switch (cmd) {
    case '/new':
    case '/reset': {
      const wasRunning = ctx.session.isRunning(ctx.scope);
      if (wasRunning) ctx.session.abort(ctx.scope);
      ctx.session.clear(ctx.scope);
      await replyText(ctx, wasRunning ? '已中断当前任务并开始新会话。' : '已开始新会话。');
      return { handled: true };
    }

    case '/help': {
      await replyCard(ctx, infoCard('💡 使用帮助', HELP_BODY));
      return { handled: true };
    }

    case '/stop': {
      ctx.session.abort(ctx.scope);
      return { handled: true };
    }

    case '/status': {
      await replyCard(ctx, statusCard(ctx));
      return { handled: true };
    }

    case '/cd': {
      if (!(await requirePrivilege(ctx))) return { handled: true };
      if (!arg) {
        await replyText(ctx, '用法：`/cd <绝对路径>` 或 `/cd ~/projects/foo`');
        return { handled: true };
      }
      try {
        const abs = validateWorkspaceDir(arg);
        if (ctx.session.isRunning(ctx.scope)) ctx.session.abort(ctx.scope);
        ctx.session.setCwd(ctx.scope, abs);
        // 落盘供下次启动默认；进程内不改全局 config，避免其它 chat 默认 cwd 被带走
        saveCopilotConfig({ copilotCwd: abs });
        await replyText(ctx, `✓ 已切换 cwd 到 \`${abs}\`\n（本会话已重置；下次启动默认也用此目录）`);
      } catch (err) {
        await replyText(ctx, `❌ ${(err as Error).message}`);
      }
      return { handled: true };
    }

    case '/ws': {
      if (!(await requirePrivilege(ctx))) return { handled: true };
      return handleWs(arg, ctx);
    }

    case '/timeout': {
      return handleTimeout(arg, ctx);
    }

    case '/invite': {
      if (!(await requirePrivilege(ctx))) return { handled: true };
      const [sub, ...rest] = arg.trim().split(/\s+/);
      const target = rest.join(' ');
      try {
        if (sub === 'group') {
          const added = addAllowedChat(ctx.config, ctx.chatId);
          await replyText(ctx, added ? '✅ 已把当前群加入白名单（立即生效）。' : '当前群已在白名单中。');
        } else if (sub === 'admin') {
          if (!target) {
            await replyText(ctx, '用法：`/invite admin <open_id>`');
          } else {
            const added = addAdmin(ctx.config, target);
            await replyText(ctx, added ? `✅ 已添加管理员：${target}` : `${target} 已是管理员`);
          }
        } else {
          await replyText(ctx, '用法：`/invite group` 或 `/invite admin <open_id>`');
        }
      } catch (err) {
        await replyText(ctx, `❌ ${(err as Error).message}`);
      }
      return { handled: true };
    }

    case '/remove': {
      if (!(await requirePrivilege(ctx))) return { handled: true };
      const [sub, ...rest] = arg.trim().split(/\s+/);
      const target = rest.join(' ');
      try {
        if (sub === 'group') {
          const removed = removeAllowedChat(ctx.config, ctx.chatId);
          await replyText(ctx, removed ? '✅ 已把当前群移出白名单。' : '当前群不在白名单中。');
        } else if (sub === 'admin') {
          if (!target) {
            await replyText(ctx, '用法：`/remove admin <open_id>`');
          } else {
            const removed = removeAdmin(ctx.config, target);
            await replyText(ctx, removed ? `✅ 已移除管理员：${target}` : `${target} 不是管理员`);
          }
        } else {
          await replyText(ctx, '用法：`/remove group` 或 `/remove admin <open_id>`');
        }
      } catch (err) {
        await replyText(ctx, `❌ ${(err as Error).message}`);
      }
      return { handled: true };
    }

    default:
      return { handled: false };
  }
}

async function handleWs(arg: string, ctx: CommandContext): Promise<CommandResult> {
  const [sub, ...rest] = arg.split(/\s+/);
  const name = rest.join(' ');

  switch (sub) {
    case '':
    case 'list': {
      const workspaces = listWorkspaces();
      const currentCwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
      const entries = Object.entries(workspaces);
      let body: string;
      if (entries.length === 0) {
        body = `当前 cwd：\`${currentCwd}\`\n\n暂无命名工作目录。\n💡 \`/ws save <name>\` 保存别名`;
      } else {
        const lines = entries.map(
          ([n, p]) => `- **${n}** → \`${p}\`${p === currentCwd ? '  ← 当前' : ''}`,
        );
        body = `当前 cwd：\`${currentCwd}\`\n\n${lines.join('\n')}`;
      }
      await replyCard(ctx, infoCard('📂 工作目录', body));
      return { handled: true };
    }
    case 'save': {
      if (!name) {
        await replyText(ctx, '用法：`/ws save <name>`');
        return { handled: true };
      }
      const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
      saveWorkspace(name, cwd);
      await replyText(ctx, `✓ 已保存：\`${name}\` → ${cwd}`);
      return { handled: true };
    }
    case 'use': {
      if (!name) {
        await replyText(ctx, '用法：`/ws use <name>`');
        return { handled: true };
      }
      const path = listWorkspaces()[name];
      if (!path) {
        await replyText(ctx, `❌ 未找到别名 \`${name}\``);
        return { handled: true };
      }
      try {
        const abs = validateWorkspaceDir(path);
        if (ctx.session.isRunning(ctx.scope)) ctx.session.abort(ctx.scope);
        ctx.session.setCwd(ctx.scope, abs);
        saveCopilotConfig({ copilotCwd: abs });
        await replyText(ctx, `✓ 已切换到 \`${name}\` → ${abs}\n（本会话已重置；下次启动默认也用此目录）`);
      } catch (err) {
        await replyText(ctx, `❌ ${(err as Error).message}`);
      }
      return { handled: true };
    }
    case 'remove': {
      if (!name) {
        await replyText(ctx, '用法：`/ws remove <name>`');
        return { handled: true };
      }
      const ok = removeWorkspace(name);
      await replyText(ctx, ok ? `✓ 已删除 \`${name}\`` : `❌ 未找到 \`${name}\``);
      return { handled: true };
    }
    default: {
      await replyText(ctx, '用法：`/ws list|save|use|remove`');
      return { handled: true };
    }
  }
}

async function handleTimeout(arg: string, ctx: CommandContext): Promise<CommandResult> {
  const v = arg.trim().toLowerCase();
  if (!v) {
    const cur = ctx.session.idleTimeoutFor(ctx.scope);
    const desc = cur === undefined ? '默认' : cur === 0 ? '关闭' : `${cur} 分钟`;
    await replyText(ctx, `当前超时：${desc}\n用法：\`/timeout <分钟>\` 或 \`/timeout off\``);
    return { handled: true };
  }
  if (v === 'off' || v === '0') {
    ctx.session.setIdleTimeout(ctx.scope, 0);
    await replyText(ctx, '✓ 已关闭超时');
    return { handled: true };
  }
  const n = Number(v);
  const MAX_TIMEOUT_MIN = 24 * 60;
  if (!Number.isFinite(n) || n < 0) {
    await replyText(ctx, '用法：`/timeout <分钟>` 或 `/timeout off`');
    return { handled: true };
  }
  if (n > MAX_TIMEOUT_MIN) {
    await replyText(ctx, `❌ 超时上限 ${MAX_TIMEOUT_MIN} 分钟（24h）`);
    return { handled: true };
  }
  ctx.session.setIdleTimeout(ctx.scope, n);
  await replyText(ctx, `✓ 超时已设为 ${n} 分钟`);
  return { handled: true };
}

function statusCard(ctx: CommandContext): object {
  const running = ctx.session.isRunning(ctx.scope);
  const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
  const pending = ctx.queue.pendingCount(ctx.scope);
  const timeout = ctx.session.idleTimeoutFor(ctx.scope);
  const timeoutDesc = timeout === undefined ? '默认' : timeout === 0 ? '关闭' : `${timeout} 分钟`;
  const body = [
    `**状态**: ${running ? '处理中' : '空闲'}${pending > 0 ? `（队列 ${pending}）` : ''}`,
    `**cwd**: \`${cwd}\``,
    `**超时**: ${timeoutDesc}`,
    `**scope**: \`${ctx.scope}\``,
  ].join('\n');
  return infoCard('📊 当前状态', body);
}
