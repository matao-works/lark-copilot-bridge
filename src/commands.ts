/**
 * 斜杠命令系统（对照原项目 src/commands/index.ts 补齐）
 *
 * 命令回执规则（对照原项目）：简单命令用纯文本，/help /status /ws list 用交互卡片。
 * /stop 行为：有 run 在跑时不回复文字（卡片自动渲染"已中断"），无 run 时简短提示。
 */
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
} from './config.js';
import { infoCard } from './lark/card.js';
import { log } from './logger.js';

export interface CommandContext {
  lark: LarkBridge;
  session: SessionStore;
  queue: MessageQueue<any>;
  config: BridgeConfig;
  chatId: string;
  scope: string;
  ownerOpenId?: string;
}

export interface CommandResult {
  handled: boolean;
}

const HELP_BODY = `**命令列表**

- \`/new\` \`/reset\` — 清空当前会话
- \`/cd <path>\` — 切换工作目录（会重置会话，支持 ~ 展开）
- \`/ws list\` — 列出命名工作目录
- \`/ws save <name>\` — 保存当前工作目录为别名
- \`/ws use <name>\` — 切换到命名工作目录
- \`/ws remove <name>\` — 删除命名工作目录
- \`/status\` — 查看当前状态
- \`/stop\` — 停止当前任务（也可点卡片 ⏹ 按钮）
- \`/timeout [N|off]\` — 设置当前会话超时（分钟），off 关闭
- \`/invite group\` — 把当前群加入响应白名单
- \`/invite admin <open_id>\` — 添加管理员
- \`/remove group\` — 把当前群移出响应白名单
- \`/remove admin <open_id>\` — 移除管理员
- \`/help\` — 本帮助

其他内容直接发给 Copilot。
私聊无需 @，群聊需 @机器人。`;

export async function handleCommand(text: string, ctx: CommandContext): Promise<CommandResult> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return { handled: false };

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0] ?? '';
  const arg = parts.slice(1).join(' ');
  log.info('命令: %s [scope=%s]', cmd, ctx.scope);

  switch (cmd) {
    case '/new':
    case '/reset': {
      const wasRunning = ctx.session.isRunning(ctx.scope);
      if (wasRunning) ctx.session.abort(ctx.scope);
      ctx.session.clear(ctx.scope);
      await ctx.lark.sendText(ctx.chatId, wasRunning ? '已中断当前任务并开始新会话。' : '已开始新会话。');
      return { handled: true };
    }

    case '/help': {
      await ctx.lark.sendCard(ctx.chatId, infoCard('💡 使用帮助', HELP_BODY));
      return { handled: true };
    }

    case '/stop': {
      // 对照原项目：有 run 不回复（卡片自动渲染"已中断"），无 run 简短提示
      const ok = ctx.session.abort(ctx.scope);
      if (!ok) {
        await ctx.lark.sendText(ctx.chatId, '当前没有正在运行的任务。');
      }
      return { handled: true };
    }

    case '/status': {
      await ctx.lark.sendCard(ctx.chatId, statusCard(ctx));
      return { handled: true };
    }

    case '/cd': {
      if (!arg) {
        await ctx.lark.sendText(ctx.chatId, '用法：`/cd <绝对路径>` 或 `/cd ~/projects/foo`');
        return { handled: true };
      }
      try {
        const abs = validateWorkspaceDir(arg);
        if (ctx.session.isRunning(ctx.scope)) ctx.session.abort(ctx.scope);
        ctx.session.setCwd(ctx.scope, abs);
        await ctx.lark.sendText(ctx.chatId, `✓ 已切换 cwd 到 \`${abs}\`\n（会话已重置）`);
      } catch (err) {
        await ctx.lark.sendText(ctx.chatId, `❌ ${(err as Error).message}`);
      }
      return { handled: true };
    }

    case '/ws': {
      return handleWs(arg, ctx);
    }

    case '/timeout': {
      return handleTimeout(arg, ctx);
    }

    case '/invite': {
      const [sub, ...rest] = arg.trim().split(/\s+/);
      const target = rest.join(' ');
      if (sub === 'group') {
        const added = addAllowedChat(ctx.chatId);
        await ctx.lark.sendText(ctx.chatId, added ? '✅ 已把当前群加入白名单。' : '当前群已在白名单中。');
      } else if (sub === 'admin') {
        if (!target) {
          await ctx.lark.sendText(ctx.chatId, '用法：`/invite admin <open_id>`');
        } else {
          const added = addAdmin(target);
          await ctx.lark.sendText(ctx.chatId, added ? `✅ 已添加管理员：${target}` : `${target} 已是管理员`);
        }
      } else {
        await ctx.lark.sendText(ctx.chatId, '用法：`/invite group` 或 `/invite admin <open_id>`');
      }
      return { handled: true };
    }

    case '/remove': {
      const [sub, ...rest] = arg.trim().split(/\s+/);
      const target = rest.join(' ');
      if (sub === 'group') {
        const removed = removeAllowedChat(ctx.chatId);
        await ctx.lark.sendText(ctx.chatId, removed ? '✅ 已把当前群移出白名单。' : '当前群不在白名单中。');
      } else if (sub === 'admin') {
        if (!target) {
          await ctx.lark.sendText(ctx.chatId, '用法：`/remove admin <open_id>`');
        } else {
          const removed = removeAdmin(target);
          await ctx.lark.sendText(ctx.chatId, removed ? `✅ 已移除管理员：${target}` : `${target} 不是管理员`);
        }
      } else {
        await ctx.lark.sendText(ctx.chatId, '用法：`/remove group` 或 `/remove admin <open_id>`');
      }
      return { handled: true };
    }

    default: {
      // 对照原项目：未知命令不当错误，当普通消息走 agent
      return { handled: false };
    }
  }
}

function handleWs(arg: string, ctx: CommandContext): CommandResult | Promise<CommandResult> {
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
        body = `当前 cwd：\`${currentCwd}\`\n\n暂无命名工作目录。\n💡 发送 \`/ws save <name>\` 把当前 cwd 存为别名`;
      } else {
        const lines = entries.map(
          ([n, p]) => `- **${n}** → \`${p}\`${p === currentCwd ? '  ← 当前' : ''}`,
        );
        body = `当前 cwd：\`${currentCwd}\`\n\n${lines.join('\n')}`;
      }
      void ctx.lark.sendCard(ctx.chatId, infoCard('📂 工作目录', body));
      return Promise.resolve({ handled: true });
    }
    case 'save': {
      if (!name) {
        void ctx.lark.sendText(ctx.chatId, '用法：`/ws save <name>`');
        return Promise.resolve({ handled: true });
      }
      const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
      saveWorkspace(name, cwd);
      void ctx.lark.sendText(ctx.chatId, `✓ 工作目录别名已保存：\`${name}\` → ${cwd}`);
      return Promise.resolve({ handled: true });
    }
    case 'use': {
      if (!name) {
        void ctx.lark.sendText(ctx.chatId, '用法：`/ws use <name>`');
        return Promise.resolve({ handled: true });
      }
      const workspaces = listWorkspaces();
      if (!(name in workspaces)) {
        void ctx.lark.sendText(ctx.chatId, `未找到工作目录别名：\`${name}\``);
        return Promise.resolve({ handled: true });
      }
      if (ctx.session.isRunning(ctx.scope)) ctx.session.abort(ctx.scope);
      ctx.session.setCwd(ctx.scope, workspaces[name]);
      void ctx.lark.sendText(ctx.chatId, `✓ 已切换到 \`${name}\` (${workspaces[name]})\n（会话已重置）`);
      return Promise.resolve({ handled: true });
    }
    case 'remove':
    case 'rm': {
      if (!name) {
        void ctx.lark.sendText(ctx.chatId, '用法：`/ws remove <name>`');
        return Promise.resolve({ handled: true });
      }
      const ok = removeWorkspace(name);
      void ctx.lark.sendText(ctx.chatId, ok ? `✓ 已删除工作目录别名：\`${name}\`` : `未找到工作目录别名：\`${name}\``);
      return Promise.resolve({ handled: true });
    }
    default: {
      void ctx.lark.sendText(ctx.chatId, '用法：`/ws [list|save <name>|use <name>|remove <name>]`');
      return Promise.resolve({ handled: true });
    }
  }
}

function handleTimeout(arg: string, ctx: CommandContext): CommandResult | Promise<CommandResult> {
  const globalDefault = Math.round(ctx.config.copilotTimeout / 60_000);
  const scopeOverride = ctx.session.idleTimeoutFor(ctx.scope);

  if (!arg) {
    const cur = scopeOverride !== undefined ? `${scopeOverride} 分钟` : `默认(${globalDefault} 分钟)`;
    void ctx.lark.sendText(
      ctx.chatId,
      `⏱ 当前会话超时：${cur}\n全局默认：${globalDefault} 分钟\n\n用法：\n- \`/timeout 15\` 当前会话设 15 分钟\n- \`/timeout off\` 关闭当前会话超时`,
    );
    return Promise.resolve({ handled: true });
  }

  if (arg === 'off') {
    ctx.session.setIdleTimeout(ctx.scope, 0);
    void ctx.lark.sendText(ctx.chatId, '✅ 已关闭当前会话的超时。');
    return Promise.resolve({ handled: true });
  }

  const n = Number(arg);
  if (!Number.isFinite(n) || n < 1 || n > 120) {
    void ctx.lark.sendText(ctx.chatId, '❌ 用法：`/timeout <1-120>` / `/timeout off`');
    return Promise.resolve({ handled: true });
  }
  ctx.session.setIdleTimeout(ctx.scope, n);
  void ctx.lark.sendText(ctx.chatId, `✅ 当前会话超时已设为 ${n} 分钟。`);
  return Promise.resolve({ handled: true });
}

function statusCard(ctx: CommandContext): object {
  const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
  const historyLen = ctx.session.getHistory(ctx.scope).length;
  const running = ctx.session.isRunning(ctx.scope);
  const pending = ctx.queue.pendingCount(ctx.scope);
  const timeoutOverride = ctx.session.idleTimeoutFor(ctx.scope);
  const timeout = timeoutOverride !== undefined
    ? (timeoutOverride === 0 ? '关闭' : `${timeoutOverride} 分钟`)
    : `${Math.round(ctx.config.copilotTimeout / 60_000)} 分钟(默认)`;
  const body = [
    `🧭 **scope**: \`${ctx.scope}\``,
    `📁 **cwd**: \`${cwd}\``,
    `🔗 **会话轮数**: ${Math.floor(historyLen / 2)}/${ctx.config.maxHistoryRounds}`,
    `⏱ **超时**: ${timeout}`,
    `🏃 **当前状态**: ${running ? '处理中' : '空闲'}${pending > 0 ? ` (队列 ${pending})` : ''}`,
    `🛡 **飞书应用**: ${ctx.config.credentials.appId}`,
    `⚙️ **Copilot 参数**: ${ctx.config.copilotExtraArgs.length ? ctx.config.copilotExtraArgs.join(' ') : '无'}`,
  ].join('\n');
  return infoCard('📊 当前状态', body);
}
