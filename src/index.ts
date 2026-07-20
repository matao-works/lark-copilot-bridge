/**
 * 主入口：扫码即用 + 流式卡片 + 稳定性保障
 *
 * 对照原项目 src/cli/commands/start.ts 的 runStart：
 *   1. 检测 copilot CLI
 *   2. 飞书凭证（有就用，没有就扫码创建并保存）
 *   3. 建立 LarkChannel 通道
 *   4. 全局错误兜底 + 信号优雅关闭 + keepalive 心跳
 *   5. 收消息 → 权限 → 命令 → 入队 → 流式卡片 + copilot
 */
import {
  loadCredentials,
  saveCredentials,
  loadConfig,
  type BridgeConfig,
} from './config.js';
import {
  LarkBridge,
  registerAppByQR,
  extractText,
  isMentionedBot,
  scopeOf,
  type IncomingMessage,
} from './lark/client.js';
import { SessionStore } from './session.js';
import { MessageQueue } from './queue.js';
import { handleCommand } from './commands.js';
import { runCopilot, checkCopilotInstalled } from './copilot/adapter.js';
import { thinkingCard, streamingCard, finalCard, errorCard } from './lark/card.js';
import { startKeepalive } from './keepalive.js';
import { buildSystemPrompt } from './bridge-prompt.js';
import type { CommentEvent } from '@larksuite/channel';
import { log } from './logger.js';

// 全局错误兜底：不让单次异常打死整个 bot（对照原项目 start.ts 行 60-67）
process.on('unhandledRejection', (reason) => {
  log.error('未处理 rejection: %s', reason);
});
process.on('uncaughtException', (err) => {
  log.error('未捕获异常: %s', (err as Error).message);
});

export async function main(): Promise<void> {
  // 1. 检测 copilot
  console.log('检查 copilot CLI...');
  if (!(await checkCopilotInstalled())) {
    console.error('\n✗ 未检测到 copilot CLI。请先安装并登录：');
    console.error('  curl -fsSL https://gh.io/copilot-install | bash');
    console.error('  copilot   # 按 /login 登录 GitHub（需 Copilot 订阅）\n');
    process.exit(1);
  }
  console.log('✓ copilot CLI 已就绪');

  // 2. 飞书凭证
  let creds = loadCredentials();
  if (!creds) {
    creds = await registerAppByQR();
    saveCredentials(creds);
  } else {
    log.info('使用已保存的飞书应用: %s', creds.appId);
  }

  // 3. 配置 + 通道
  const config = loadConfig(creds);
  const lark = new LarkBridge(creds);
  const session = new SessionStore(config.maxHistoryRounds);
  // debounce 合批队列：同 scope 600ms 内的消息合并成一次 copilot 调用
  let queue: MessageQueue<IncomingMessage>;
  queue = new MessageQueue<IncomingMessage>(600, (scope, batch) => {
    queue.block(scope);
    void runOne(batch, scope, { lark, session, queue, config, ownerOpenId: creds.creatorOpenId })
      .finally(() => queue.unblock(scope));
  });

  // 4. 卡片按钮回调（停止按钮）
  const onCardAction = async (evt: { value?: any }): Promise<void> => {
    const value = evt.value || {};
    if (value.cmd === 'stop' && value.scope) {
      const ok = session.abort(value.scope);
      log.info('卡片停止按钮: scope=%s ok=%s', value.scope, ok);
    }
  };

  // 5. 连接
  await lark.connect(
    (msg: IncomingMessage) => handleMessage(msg, { lark, session, queue, config, ownerOpenId: creds.creatorOpenId }),
    onCardAction,
    (evt: CommentEvent) => handleComment(evt, { lark, session, config, ownerOpenId: creds.creatorOpenId }),
  );

  // 6. keepalive 心跳（对照原项目 src/bot/keepalive.ts）
  const keepalive = startKeepalive({
    channel: (lark as any).channel,
    domain: creds.tenant === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
    forceReconnect: async () => {
      // MVP: 依赖 SDK 自动重连（reconnecting/reconnected 事件），这里只记录
      log.warn('keepalive 触发 forceReconnect，依赖 SDK 自动重连');
    },
  });

  // 7. 信号优雅关闭（对照原项目 start.ts 行 345-355）
  let stopping = false;
  const stop = async (sig: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`\n收到 ${sig}，正在关闭...`);
    keepalive.stop();
    // 中断所有运行中的任务
    for (const scope of session.runningScopes()) session.abort(scope);
    try { await lark.disconnect(); } catch (err) { log.error('disconnect 失败: %s', (err as Error).message); }
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  🤖 机器人已上线！在飞书里发消息即可。');
  console.log('     私聊直接发，群聊需 @机器人');
  console.log('     发 /help 看可用命令');
  console.log('═══════════════════════════════════════════════════\n');
}

interface HandleContext {
  lark: LarkBridge;
  session: SessionStore;
  queue: MessageQueue<IncomingMessage>;
  config: BridgeConfig;
  ownerOpenId?: string;
}

async function handleMessage(msg: IncomingMessage, ctx: HandleContext): Promise<void> {
  const { lark, session, queue, config, ownerOpenId } = ctx;
  const scope = scopeOf(msg);
  const text = extractText(msg);

  if (msg.chatType === 'group' && !isMentionedBot(msg)) return;
  if (!text) return;

  // 权限校验：创建者 + 管理员豁免
  if (config.allowedUsers.length > 0
    && msg.senderId !== ownerOpenId
    && !config.admins.includes(msg.senderId)
    && !config.allowedUsers.includes(msg.senderId)) {
    log.warn('用户 %s 无权限', msg.senderId);
    await lark.sendText(msg.chatId, '你没有使用此机器人的权限。');
    return;
  }

  // 群聊白名单：群不在 allowedChats 且非 owner/admin → 友好提示
  if (msg.chatType === 'group'
    && msg.senderId !== ownerOpenId
    && !config.admins.includes(msg.senderId)
    && config.allowedChats.length > 0
    && !config.allowedChats.includes(msg.chatId)) {
    await lark.sendText(msg.chatId, '当前群尚未加入响应列表，bot 不会处理消息。\nBot owner 可在本群发 /invite group 加入白名单。');
    return;
  }

  // 图片/文件提示（MVP 不支持媒体）
  if (msg.resources && msg.resources.length > 0) {
    await lark.sendText(msg.chatId, '⚠️ 暂不支持图片/文件，请发送文字消息。');
    return;
  }

  // 命令路由（bypass 队列，处理后丢弃积压消息）
  const handled = await handleCommand(text, { lark, session, queue, config, chatId: msg.chatId, scope, ownerOpenId });
  if (handled) {
    queue.cancel(scope);
    return;
  }

  // 入队 debounce 合批（对照原项目 PendingQueue）
  queue.push(scope, msg);
}

/** 合并批量消息：单条原样，多条加 [名字 (user|bot)]: 标注（对照原项目 channel.ts 行 1613-1625） */
function mergeMessages(batch: IncomingMessage[]): string {
  const texts = batch.map((m) => extractText(m)).filter(Boolean);
  if (batch.length === 1) return texts[0] ?? '';
  // 多条合并，每段加 sender 标注
  return batch
    .map((m, i) => {
      const name = m.senderName ?? m.senderId;
      const type = m.senderIsBot ? 'bot' : 'user';
      const t = texts[i] || '（无正文消息）';
      return `[${name} (${type})]: ${t}`;
    })
    .join('\n\n');
}

/** 处理云文档评论 @bot（对照原项目 comments.ts handleCommentMention） */
async function handleComment(evt: CommentEvent, ctx: Omit<HandleContext, 'queue'>): Promise<void> {
  if (!evt.mentionedBot) return;
  const { lark, session, config, ownerOpenId } = ctx;
  // 权限：owner + admins + allowedUsers
  if (config.allowedUsers.length > 0
    && evt.operator.openId !== ownerOpenId
    && !config.admins.includes(evt.operator.openId)
    && !config.allowedUsers.includes(evt.operator.openId)) return;

  // 拉评论内容（含 quote + replies）
  const fetched = await lark.fetchComment(evt.fileToken, evt.fileType, evt.commentId);
  if (!fetched) return;
  const replies = fetched.replies ?? [];
  const targetReply = evt.replyId ? replies.find((r: any) => r.reply_id === evt.replyId) : replies[replies.length - 1];
  const question = replyElementsToText(targetReply);
  if (!question) return;
  const quote: string = fetched.quote || '';

  log.info('评论 @bot: file=%s comment=%s q=%s', evt.fileToken.slice(-6), evt.commentId.slice(-6), question.slice(0, 40));

  // 跑 copilot（评论 scope 独立）
  const scope = `comment:${evt.fileToken}:${evt.commentId}`;
  const sessionId = session.sessionIdFor(scope);
  const cwd = session.cwdFor(scope) ?? config.copilotCwd;
  const prompt = `<comment_context>\n你被 @ 在一篇飞书文档的评论里。\n选中内容: ${quote}\n评论问题: ${question}\n</comment_context>\n\n${question}`;
  const result = await runCopilot({
    cwd,
    prompt,
    timeoutMs: config.copilotTimeout,
    extraArgs: config.copilotExtraArgs,
    sessionId,
  });
  if (result.sessionId) session.setSessionId(scope, result.sessionId);

  // 回复评论（截断 2000 字，对照原项目 REPLY_MAX_CHARS）
  const reply = (result.stdout || '(无回复)').slice(0, 2000);
  await lark.replyComment(evt.fileToken, evt.fileType, evt.commentId, reply, Boolean(fetched.isWhole));
}

/** 扁平化评论回复内容为纯文本（对照原项目 replyElementsToText） */
function replyElementsToText(reply: any): string {
  const elements = reply?.content?.elements ?? [];
  return elements
    .map((el: any) => (el.type === 'text_run' ? (el.text_run?.text ?? '') : el.type === 'docs_link' ? (el.docs_link?.url ?? '') : ''))
    .join('')
    .trim();
}

async function runOne(
  batch: IncomingMessage[],
  scope: string,
  ctx: HandleContext,
): Promise<void> {
  const { lark, session, config } = ctx;
  const msg = batch[0];
  const text = mergeMessages(batch);
  const ac = session.markRunning(scope);
  const chatId = msg.chatId;

  try {
    // per-scope 工作目录 + 超时（/cd /timeout 用）
    const cwd = session.cwdFor(scope) ?? config.copilotCwd;
    const scopeTimeout = session.idleTimeoutFor(scope);
    const timeoutMs = scopeTimeout === 0 ? 0
      : scopeTimeout !== undefined ? scopeTimeout * 60_000
      : config.copilotTimeout;

    // 话题群回复带 replyInThread，让回复落到正确话题（对照原项目 channel.ts 行 834-837）
    const sendOpts = msg.threadId
      ? { replyTo: msg.messageId, replyInThread: true }
      : { replyTo: msg.messageId };
    await lark.streamCard(chatId, thinkingCard(text, scope), async (update) => {
      let partial = '';
      const botOpenId = lark.botIdentity?.openId ?? '';
      const sessionId = session.sessionIdFor(scope);

      // 引用回复：拉取被引用消息内容注入 prompt（对照原项目 quote.ts）
      let quotedBlock = '';
      if (msg.replyToMessageId) {
        const quoted = await lark.fetchQuotedText(msg.replyToMessageId);
        if (quoted) {
          quotedBlock = `<quoted_messages>\n<quoted_message>${quoted}</quoted_message>\n</quoted_messages>\n\n`;
        }
      }

      // 系统提示：首次（无 sessionId）注入，copilot --resume 会保留首次上下文
      const systemPrefix = sessionId ? '' : buildSystemPrompt(botOpenId, lark.botIdentity?.name) + '\n\n';
      const ctxBlock = `<bridge_context>\n{"chatType":"${msg.chatType}","senderId":"${msg.senderId}","senderName":"${msg.senderName ?? ''}","botOpenId":"${botOpenId}","source":"im"}\n</bridge_context>\n\n`;
      // 空消息处理：只 @bot 的唤醒（对照原项目 channel.ts 行 1572-1577）
      const userText = text || '（对方发来一条没有正文的消息——通常是只 @ 了你的唤醒。请简短回应。）';
      // copilot --resume 有上下文，不拼历史；无 sessionId 时 fallback 拼 history
      const userPart = sessionId ? userText : session.buildPrompt(scope, userText);
      // 话题群首次进入拉上游消息（对照原项目 fetchTopicContext）
      let topicBlock = '';
      if (msg.threadId && !sessionId) {
        const topicMsgs = await lark.fetchTopicMessages(msg.threadId);
        if (topicMsgs.length > 0) {
          topicBlock = `<topic_context>\n${topicMsgs.map((m) => `${m.senderName}: ${m.content}`).join('\n')}\n</topic_context>\n\n`;
        }
      }
      const prompt = systemPrefix + ctxBlock + quotedBlock + topicBlock + userPart;

      const result = await runCopilot({
        cwd,
        prompt,
        timeoutMs: timeoutMs > 0 ? timeoutMs : config.copilotTimeout,
        extraArgs: config.copilotExtraArgs,
        abortSignal: ac.signal,
        sessionId,
        onChunk: (chunk) => {
          partial += chunk;
          void update(streamingCard(text, partial, scope));
        },
      });

      // 存 session-id 供下次 --resume
      if (result.sessionId) session.setSessionId(scope, result.sessionId);

      if (result.aborted) {
        await update(errorCard(text, '任务已被中断（/stop 或停止按钮）。'));
      } else if (result.timedOut) {
        await update(errorCard(text, `任务超时（超过 ${config.copilotTimeout / 1000}s）。`));
      } else if (result.exitCode !== 0) {
        const detail = result.stderr || result.stdout || `退出码 ${result.exitCode}`;
        await update(errorCard(text, `copilot 运行失败：\n${detail}`));
      } else {
        const reply = result.stdout || '(空回复)';
        await update(finalCard(text, reply));
        session.appendRound(scope, text, reply);
      }
    }, sendOpts);
  } catch (err) {
    log.error('流式回复失败: %s', (err as Error).message);
    try { await lark.sendCard(chatId, errorCard(text, (err as Error).message)); } catch { /* ignore */ }
  } finally {
    session.markIdle(scope);
  }
}
