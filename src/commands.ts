/**
 * 斜杠命令系统
 *
 * - 普通命令：谁能聊天谁就能用（/new /help /status /stop /timeout）
 * - 特权命令：仅 owner/admin（/invite /remove /cd /ws）
 * - 回执一律 replyTo 用户消息
 */
import type { IncomingMessage } from './lark/client.js';
import type { LarkBridge } from './lark/client.js';
import type { SessionStore } from './session.js';
import type { MessageQueue } from './queue.js';
import type { BridgeConfig } from './config.js';
import {
  validateWorkspaceDir,
  addAllowedChat,
  removeAllowedChat,
  addAdmin,
  removeAdmin,
  saveCopilotConfig,
} from './config.js';
import * as workspaces from './workspaces.js';
import { infoCard } from './lark/card.js';
import { isPrivileged } from './acl.js';
import { log } from './logger.js';
import { getServiceAdapter } from './daemon/service-adapter.js';
import { readLive } from './daemon/registry.js';
import { mediaCacheStats } from './media/cache.js';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

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

const HELP_BODY = `**怎么用**

直接打字发消息即可（群聊请 @我）。

**常用命令**

- \`/new\` — 换个新话题
- \`/stop\` — 停下正在做的事（也可点卡片「终止」）
- \`/status\` — 当前状态（cwd / 会话 / 队列 / 后台服务 / 附件缓存）
- \`/whoami\` — 查看我的用户编号（给管理员用）
- \`/help\` — 本说明

**进阶（一般不用）**

- \`/cd 文件夹路径\` — 换项目文件夹（需管理员）
- \`/ws\` — 命名工作目录（需管理员）
  - \`/ws\` / \`/ws list\` — 列出别名
  - \`/ws add <name> [path]\` — 保存别名（默认当前 cwd）
  - \`/ws save <name>\` — 把当前 cwd 存成别名
  - \`/ws use <name>\` — 切换到别名目录
  - \`/ws rm <name>\` — 删除别名
- \`/timeout\` — 调整超时
- \`/invite\` \`/remove\` — 白名单 / 管理员
`;

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

    case '/whoami':
    case '/id': {
      await replyText(
        ctx,
        `你的用户编号：\`${ctx.senderId}\`\n\n`
        + `若要让管理员把你加进可用名单，把上面这串发给对方，对方发送：\n`
        + `\`/invite admin ${ctx.senderId}\``,
      );
      return { handled: true };
    }

    case '/stop': {
      ctx.session.abort(ctx.scope);
      await replyText(ctx, '已发送终止信号。');
      return { handled: true };
    }

    case '/status': {
      await replyCard(ctx, buildStatusCard(ctx));
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
            await replyText(
              ctx,
              '用法：`/invite admin <open_id>`\n\n'
              + '对方先私聊机器人发 `/whoami`，把返回的 open_id 发给你即可。',
            );
          } else {
            const added = addAdmin(ctx.config, target);
            await replyText(ctx, added ? `✅ 已添加管理员：${target}` : `${target} 已是管理员`);
          }
        } else {
          await replyText(
            ctx,
            '用法：\n'
            + '• `/invite group` — 把当前群加入白名单\n'
            + '• `/invite admin <open_id>` — 添加管理员\n\n'
            + '获取 open_id：让对方发 `/whoami`',
          );
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

    default: {
      // 像 /foo 的未知命令给出提示；像 /Users/... 的路径留给 Copilot
      const name = cmd.slice(1);
      if (/^[a-z][\w-]*$/i.test(name)) {
        await replyText(ctx, `未知命令 \`${cmd}\`。发 /help 查看可用命令。`);
        return { handled: true };
      }
      return { handled: false };
    }
  }
}

async function handleWs(arg: string, ctx: CommandContext): Promise<CommandResult> {
  const [sub, wsName, ...pathParts] = arg.split(/\s+/);
  const pathArg = pathParts.join(' ');

  switch (sub) {
    case '':
    case 'list': {
      const wsMap = workspaces.list();
      const currentCwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
      const entries = Object.entries(wsMap);
      let body: string;
      if (entries.length === 0) {
        body = `当前 cwd：\`${currentCwd}\`\n\n暂无命名工作目录。\n💡 \`/ws add <name>\` 或 \`/ws save <name>\` 保存别名`;
      } else {
        const lines = entries.map(
          ([n, p]) => `- **${n}** → \`${p}\`${p === currentCwd ? '  ← 当前' : ''}`,
        );
        body = `当前 cwd：\`${currentCwd}\`\n\n${lines.join('\n')}`;
      }
      await replyCard(ctx, infoCard('📂 工作目录', body));
      return { handled: true };
    }
    case 'add': {
      if (!wsName) {
        await replyText(ctx, '用法：`/ws add <name> [path]`');
        return { handled: true };
      }
      const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
      const pathToSave = pathArg || cwd;
      try {
        const abs = workspaces.save(wsName, pathToSave);
        await replyText(ctx, `✓ 已保存：\`${wsName}\` → ${abs}`);
      } catch (err) {
        await replyText(ctx, `❌ ${(err as Error).message}`);
      }
      return { handled: true };
    }
    case 'save': {
      if (!wsName) {
        await replyText(ctx, '用法：`/ws save <name>`');
        return { handled: true };
      }
      const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
      try {
        const abs = workspaces.save(wsName, cwd);
        await replyText(ctx, `✓ 已保存：\`${wsName}\` → ${abs}`);
      } catch (err) {
        await replyText(ctx, `❌ ${(err as Error).message}`);
      }
      return { handled: true };
    }
    case 'use': {
      if (!wsName) {
        await replyText(ctx, '用法：`/ws use <name>`');
        return { handled: true };
      }
      try {
        const abs = workspaces.use(wsName);
        if (ctx.session.isRunning(ctx.scope)) ctx.session.abort(ctx.scope);
        ctx.session.setCwd(ctx.scope, abs);
        saveCopilotConfig({ copilotCwd: abs });
        await replyText(ctx, `✓ 已切换到 \`${wsName}\` → ${abs}\n（本会话已重置；下次启动默认也用此目录）`);
      } catch (err) {
        await replyText(ctx, `❌ ${(err as Error).message}`);
      }
      return { handled: true };
    }
    case 'rm':
    case 'remove': {
      if (!wsName) {
        await replyText(ctx, '用法：`/ws rm <name>` 或 `/ws remove <name>`');
        return { handled: true };
      }
      try {
        const ok = workspaces.remove(wsName);
        await replyText(ctx, ok ? `✓ 已删除 \`${wsName}\`` : `❌ 未找到 \`${wsName}\``);
      } catch (err) {
        await replyText(ctx, `❌ ${(err as Error).message}`);
      }
      return { handled: true };
    }
    default: {
      await replyText(ctx, '用法：`/ws list|add|save|use|rm`');
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

function shortId(id: string | undefined, keep = 8): string {
  if (!id) return '无';
  if (id.length <= keep * 2 + 1) return id;
  return `${id.slice(0, keep)}…${id.slice(-4)}`;
}

function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

function daemonStatusLine(appId: string): string {
  const adapter = getServiceAdapter();
  if (!adapter) return '当前系统不支持 OS 守护进程';
  if (!adapter.fileExists()) return `未注册（可用 \`start\` 后台常驻 · ${adapter.platformName}）`;
  if (!adapter.isRunning()) return `已注册但未运行（\`start\` 可拉起 · ${adapter.platformName}）`;
  const { pid: pidStr } = adapter.parseStatus(adapter.describeStatus());
  const pid = pidStr ? Number(pidStr) : NaN;
  const pidOk = Number.isFinite(pid) && pid > 0;
  const entry = pidOk
    ? readLive().find((e) => e.pid === pid && e.appId === appId)
    : readLive().find((e) => e.appId === appId && (e.ready || e.botName));
  const self = pidOk && pid === process.pid ? '（本进程）' : '';
  const bits = [
    '运行中',
    pidOk ? `pid ${pid}${self}` : undefined,
    entry?.botName ? `bot ${entry.botName}` : undefined,
    adapter.platformName,
  ].filter(Boolean);
  return bits.join(' · ');
}

function buildStatusCard(ctx: CommandContext): object {
  const privileged = isPrivileged(ctx.senderId, ctx.config, ctx.ownerOpenId);
  const running = ctx.session.isRunning(ctx.scope);
  const cwd = ctx.session.cwdFor(ctx.scope) ?? ctx.config.copilotCwd;
  const pending = ctx.queue.pendingCount(ctx.scope);
  const timeout = ctx.session.idleTimeoutFor(ctx.scope);
  const scopeTimeoutDesc = timeout === undefined
    ? '跟随默认'
    : timeout === 0
      ? '关闭'
      : `${timeout} 分钟`;
  const defaultTimeoutMin = Math.round(ctx.config.copilotTimeout / 60_000);
  const defaultTimeoutDesc = ctx.config.copilotTimeout > 0
    ? `${defaultTimeoutMin} 分钟`
    : '不限制';

  const wsMap = workspaces.list();
  const wsEntries = Object.entries(wsMap);
  const matchedAlias = wsEntries.find(([, p]) => samePath(p, cwd))?.[0];
  const wsLine = wsEntries.length === 0
    ? '无'
    : matchedAlias
      ? `${wsEntries.length} 个（当前 \`${matchedAlias}\`）`
      : `${wsEntries.length} 个`;

  const sessionId = ctx.session.sessionIdFor(ctx.scope);
  const bot = ctx.lark.botIdentity;

  const lines = [
    `**本会话**`,
    `· 状态：${running ? '处理中' : '空闲'}${pending > 0 ? ` · 队列 ${pending}` : ''}`,
    `· cwd：\`${cwd}\``,
    `· /ws：${wsLine}`,
    `· Copilot session：\`${shortId(sessionId)}\``,
    `· 超时：本会话 ${scopeTimeoutDesc}（默认 ${defaultTimeoutDesc}）`,
    `· scope：\`${ctx.scope}\``,
  ];

  if (privileged) {
    const media = mediaCacheStats();
    const runningScopes = ctx.session.runningScopes();
    lines.push(
      '',
      `**本机**`,
      `· 机器人：${bot?.name ? `${bot.name}` : '（未知）'}${bot?.openId ? ` · \`${shortId(bot.openId, 6)}\`` : ''}`,
      `· 后台常驻：${daemonStatusLine(ctx.config.credentials.appId)}`,
      `· 全局进行中：${runningScopes.length === 0 ? '无' : `${runningScopes.length} 个 scope`}`,
      `· 附件缓存：${media.label}`,
    );
  } else {
    lines.push(
      '',
      `**本机**`,
      `· 机器人：${bot?.name ? `${bot.name}` : '（未知）'}`,
      `· 后台常驻 / 全局任务 / 缓存：仅管理员可见`,
    );
  }

  return infoCard('📊 当前状态', lines.join('\n'));
}
