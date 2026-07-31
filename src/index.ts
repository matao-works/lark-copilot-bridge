/**
 * 主入口：扫码即用 + 流式卡片 + 稳定性保障
 *
 * 个人自用优先：默认不锁聊天白名单；特权命令仅 owner/admin。
 */
import {
  loadCredentials,
  saveCredentials,
  loadConfig,
  tryResolveWorkspaceDir,
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
import { runCopilot, checkCopilotInstalled, type CopilotRunResult } from './copilot/adapter.js';
import { runCard } from './lark/card.js';
import { startKeepalive } from './keepalive.js';
import { buildSystemPrompt } from './bridge-prompt.js';
import { canUseBot } from './acl.js';
import { bridgeContextBlock, xmlBlock } from './prompt-util.js';
import { shouldRunSetup, runSetupWizard, printSetupRequiredHint } from './setup.js';
import type { CardActionEvent, CommentEvent } from '@larksuite/channel';
import { log } from './logger.js';

process.on('unhandledRejection', (reason) => {
  log.error('未处理 rejection: %s', reason);
});
process.on('uncaughtException', (err) => {
  log.error('未捕获异常: %s', (err as Error).message);
});

export async function main(): Promise<void> {
  console.log('');
  console.log('正在检查本机 GitHub Copilot…');
  if (!(await checkCopilotInstalled())) {
    console.error('');
    console.error('还不能启动：本机没有可用的 GitHub Copilot 命令行工具。');
    console.error('');
    console.error('请按顺序做这两步（需要有 Copilot 订阅）：');
    console.error('  1) 安装：');
    console.error('       curl -fsSL https://gh.io/copilot-install | bash');
    console.error('  2) 打开终端输入 copilot，按提示用 GitHub 账号登录');
    console.error('');
    console.error('做完后可先自检： lark-copilot-bridge doctor');
    console.error('');
    process.exit(1);
  }
  console.log('✓ Copilot 已就绪');

  let creds = loadCredentials();
  if (!creds) {
    console.log('');
    console.log('第一次使用：请用手机飞书扫描接下来的二维码，创建机器人。');
    console.log('（只需扫一次，以后会自动记住）');
    creds = await registerAppByQR();
    saveCredentials(creds);
  } else {
    log.info('使用已保存的飞书应用: %s', creds.appId);
  }

  if (shouldRunSetup()) {
    const result = await runSetupWizard(creds);
    if (!result && !tryResolveWorkspaceDir()) {
      printSetupRequiredHint();
      process.exit(1);
    }
  }

  let config: BridgeConfig;
  try {
    config = loadConfig(creds);
  } catch (err) {
    console.error('');
    console.error(`无法启动：${(err as Error).message}`);
    console.error('');
    console.error('请运行设置向导： lark-copilot-bridge setup');
    console.error('');
    process.exit(1);
  }

  const lark = new LarkBridge(creds);
  const session = new SessionStore(config.maxHistoryRounds);
  const ownerOpenId = creds.creatorOpenId;
  if (!ownerOpenId) {
    log.warn('未记录扫码账号：建议运行 lark-copilot-bridge logout 后重新扫码。');
  }

  let queue: MessageQueue<IncomingMessage>;
  queue = new MessageQueue<IncomingMessage>(600, (scope, batch) => {
    queue.block(scope);
    void runOne(batch, scope, { lark, session, queue, config, ownerOpenId })
      .finally(() => queue.unblock(scope));
  });

  const onCardAction = async (evt: CardActionEvent): Promise<void> => {
    const value = (evt.action?.value ?? {}) as { cmd?: string; scope?: string };
    if (value.cmd !== 'stop' || !value.scope) return;
    const senderId = evt.operator?.openId;
    if (!senderId) {
      log.warn('卡片停止被拒绝: 无 operator.openId');
      return;
    }
    if (!canUseBot(senderId, config, ownerOpenId)) {
      log.warn('卡片停止被拒绝: sender=%s', senderId);
      return;
    }
    // scope 应以该 chat 开头，避免乱停别的会话
    if (evt.chatId && !value.scope.startsWith(evt.chatId)) {
      log.warn('卡片停止 scope 与 chat 不匹配: scope=%s chat=%s', value.scope, evt.chatId);
      return;
    }
    const ok = session.abort(value.scope);
    log.info('卡片停止按钮: scope=%s ok=%s', value.scope, ok);
  };

  await lark.connect(
    (msg) => handleMessage(msg, { lark, session, queue, config, ownerOpenId }),
    onCardAction,
    (evt) => handleComment(evt, { lark, session, config, ownerOpenId }),
  );

  const keepalive = startKeepalive({
    getConnectionStatus: () => lark.getConnectionStatus(),
    forceReconnect: async () => {
      log.warn('keepalive 触发 reconnect');
      await lark.reconnect();
    },
  });

  let stopping = false;
  const stop = async (sig: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`\n收到 ${sig}，正在关闭...`);
    keepalive.stop();
    for (const scope of session.runningScopes()) session.abort(scope);
    try { await lark.disconnect(); } catch (err) { log.error('disconnect 失败: %s', (err as Error).message); }
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  printReadyBanner({
    botName: lark.botIdentity?.name,
    botOpenId: lark.botIdentity?.openId,
    cwd: config.copilotCwd,
    timeoutMs: config.copilotTimeout,
    allowedUsers: config.allowedUsers,
    ownerOpenId,
  });
}

function printReadyBanner(opts: {
  botName?: string;
  botOpenId?: string;
  cwd: string;
  timeoutMs: number;
  allowedUsers: string[];
  ownerOpenId?: string;
}): void {
  const name = opts.botName || '（请在飞书搜索刚创建的应用名）';
  const timeoutMin = opts.timeoutMs > 0 ? `${Math.round(opts.timeoutMs / 60_000)} 分钟` : '不限制';
  const who = opts.allowedUsers.length === 0
    ? '任何人（只要能找到这个机器人）— 有风险'
    : opts.ownerOpenId && opts.allowedUsers.length === 1 && opts.allowedUsers[0] === opts.ownerOpenId
      ? '仅你自己'
      : `已限制 ${opts.allowedUsers.length} 人`;

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  已就绪，可以去飞书聊天了');
  console.log('');
  console.log(`  机器人名称: ${name}`);
  console.log(`  它会改这里的文件: ${opts.cwd}`);
  console.log(`  单次任务最长: ${timeoutMin}`);
  console.log(`  谁能用: ${who}`);
  console.log('');
  console.log('  接下来请你：');
  console.log(`    1. 打开飞书，搜索「${opts.botName || '刚才扫码创建的机器人'}」`);
  console.log('    2. 点进去，直接发一句话，例如：你好');
  console.log('    3. 群聊里要用的话，必须 @ 它');
  console.log('');
  console.log('  常用：发 /help 看命令；想换项目文件夹可运行');
  console.log('        lark-copilot-bridge setup');
  console.log('');
  console.log('  ⚠ 请保持这个窗口开着。关掉后，飞书里的机器人会下线。');
  if (opts.allowedUsers.length === 0) {
    console.log('  ⚠ 当前不限制使用者。可再运行 setup 改成「仅我自己」。');
  }
  console.log('═══════════════════════════════════════════════════');
  console.log('');
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
  log.info(
    '收到消息: type=%s chat=%s mid=%s sender=%s textLen=%d mentionedBot=%s',
    msg.chatType, msg.chatId, msg.messageId, msg.senderId, text.length, msg.mentionedBot,
  );

  if (msg.chatType === 'group' && !isMentionedBot(msg)) {
    log.info('群聊未 @bot，忽略');
    return;
  }

  if (!canUseBot(msg.senderId, config, ownerOpenId)) {
    log.warn('用户 %s 无权限', msg.senderId);
    await lark.sendText(msg.chatId, '你没有使用此机器人的权限。', { replyTo: msg.messageId });
    return;
  }

  if (msg.chatType === 'group'
    && msg.senderId !== ownerOpenId
    && !config.admins.includes(msg.senderId)
    && config.allowedChats.length > 0
    && !config.allowedChats.includes(msg.chatId)) {
    await lark.sendText(
      msg.chatId,
      '当前群尚未加入响应列表。\nBot owner 可在本群发 /invite group 加入白名单。',
      { replyTo: msg.messageId, ...(msg.threadId ? { replyInThread: true } : {}) },
    );
    return;
  }

  if (msg.resources && msg.resources.length > 0) {
    await lark.sendText(msg.chatId, '⚠️ 暂不支持图片/文件，请发送文字消息。', { replyTo: msg.messageId });
    return;
  }

  const cmdResult = await handleCommand(text, {
    lark, session, queue, config,
    chatId: msg.chatId,
    scope,
    messageId: msg.messageId,
    threadId: msg.threadId,
    senderId: msg.senderId,
    ownerOpenId,
  });
  if (cmdResult.handled) {
    queue.cancel(scope);
    return;
  }

  queue.push(scope, msg);
  log.info('已入队: scope=%s pending=%d', scope, queue.pendingCount(scope));
}

function mergeMessages(batch: IncomingMessage[]): string {
  const texts = batch.map((m) => extractText(m)).filter(Boolean);
  if (batch.length === 1) return texts[0] ?? '';
  return batch
    .map((m, i) => {
      const name = m.senderName ?? m.senderId;
      const type = m.senderIsBot ? 'bot' : 'user';
      const t = texts[i] || '（无正文消息）';
      return `[${name} (${type})]: ${t}`;
    })
    .join('\n\n');
}

async function handleComment(evt: CommentEvent, ctx: Omit<HandleContext, 'queue'>): Promise<void> {
  if (!evt.mentionedBot) return;
  const { lark, session, config, ownerOpenId } = ctx;
  if (!canUseBot(evt.operator.openId, config, ownerOpenId)) return;

  const fetched = await lark.fetchComment(evt.fileToken, evt.fileType, evt.commentId);
  if (!fetched) return;
  const replies = fetched.replies ?? [];
  const targetReply = evt.replyId
    ? replies.find((r: { reply_id?: string }) => r.reply_id === evt.replyId)
    : replies[replies.length - 1];
  const question = replyElementsToText(targetReply);
  if (!question) return;
  const quote: string = fetched.quote || '';

  log.info('评论 @bot: file=%s comment=%s qLen=%d', evt.fileToken.slice(-6), evt.commentId.slice(-6), question.length);

  const scope = `comment:${evt.fileToken}:${evt.commentId}`;
  const ac = session.tryMarkRunning(scope);
  if (!ac) {
    log.info('评论 scope 忙，跳过');
    return;
  }
  try {
    const sessionId = session.sessionIdFor(scope);
    const cwd = session.cwdFor(scope) ?? config.copilotCwd;
    const prompt = xmlBlock('comment_context', `选中内容: ${quote}\n评论问题: ${question}`) + question;
    const result = await runCopilot({
      cwd,
      prompt,
      timeoutMs: config.copilotTimeout,
      extraArgs: config.copilotExtraArgs,
      sessionId,
      abortSignal: ac.signal,
    });
    if (result.sessionId) session.setSessionId(scope, result.sessionId);
    if (result.aborted) return;
    const reply = (result.stdout || '(无回复)').slice(0, 2000);
    await lark.replyComment(evt.fileToken, evt.fileType, evt.commentId, reply, Boolean(fetched.isWhole));
  } finally {
    session.markIdle(scope);
  }
}

function replyElementsToText(reply: unknown): string {
  const elements = (reply as { content?: { elements?: Array<{ type?: string; text_run?: { text?: string }; docs_link?: { url?: string } }> } })?.content?.elements ?? [];
  return elements
    .map((el) => (el.type === 'text_run' ? (el.text_run?.text ?? '') : el.type === 'docs_link' ? (el.docs_link?.url ?? '') : ''))
    .join('')
    .trim();
}

async function runOne(
  batch: IncomingMessage[],
  scope: string,
  ctx: HandleContext,
): Promise<void> {
  const { lark, session, config } = ctx;
  const firstMsg = batch[0];
  const lastMsg = batch[batch.length - 1] ?? firstMsg;
  const text = mergeMessages(batch);
  const ac = session.markRunning(scope);
  const chatId = lastMsg.chatId;

  try {
    const cwd = session.cwdFor(scope) ?? config.copilotCwd;
    const scopeTimeout = session.idleTimeoutFor(scope);
    // 0 = 关闭超时；undefined = 用全局默认
    const timeoutMs = scopeTimeout === 0
      ? 0
      : scopeTimeout !== undefined
        ? scopeTimeout * 60_000
        : config.copilotTimeout;

    log.info('开始处理: scope=%s chat=%s cwd=%s mid=%s batch=%d timeoutMs=%d', scope, chatId, cwd, lastMsg.messageId, batch.length, timeoutMs);

    const botOpenId = lark.botIdentity?.openId ?? '';
    const sessionId = session.sessionIdFor(scope);

    let quotedBlock = '';
    if (lastMsg.replyToMessageId) {
      const quoted = await lark.fetchQuotedText(lastMsg.replyToMessageId);
      if (quoted) quotedBlock = xmlBlock('quoted_message', quoted);
    }

    const systemPrefix = sessionId ? '' : buildSystemPrompt(botOpenId, lark.botIdentity?.name) + '\n\n';
    const ctxBlock = bridgeContextBlock({
      chatType: lastMsg.chatType,
      senderId: lastMsg.senderId,
      senderName: lastMsg.senderName ?? '',
      botOpenId,
      source: 'im',
    });
    const userText = text || '（对方发来一条没有正文的消息——通常是只 @ 了你的唤醒。请简短回应。）';
    const userPart = sessionId ? userText : session.buildPrompt(scope, userText);
    let topicBlock = '';
    if (lastMsg.threadId && !sessionId) {
      const topicMsgs = await lark.fetchTopicMessages(lastMsg.threadId);
      if (topicMsgs.length > 0) {
        topicBlock = xmlBlock('topic_context', topicMsgs.map((m) => `${m.senderName}: ${m.content}`).join('\n'));
      }
    }
    const prompt = systemPrefix + ctxBlock + quotedBlock + topicBlock + userPart;
    log.info('调用 copilot: promptLen=%d session=%s', prompt.length, sessionId ?? '(new)');

    const sendOpts = {
      replyTo: lastMsg.messageId,
      ...(lastMsg.threadId ? { replyInThread: true as const } : {}),
    };

    let partial = '';
    let updateFn: ((card: object) => Promise<void>) | null = null;
    let cardClosed = false;
    let updateChain: Promise<void> = Promise.resolve();

    const agentDone = runCopilot({
      cwd,
      prompt,
      timeoutMs,
      extraArgs: config.copilotExtraArgs,
      abortSignal: ac.signal,
      sessionId,
      onChunk: (chunk) => {
        partial += chunk;
        if (cardClosed || !updateFn) return;
        const snapshot = partial;
        const doUpdate = updateFn;
        updateChain = updateChain
          .then(() => {
            if (cardClosed) return;
            return doUpdate(runCard({ scope, phase: 'streaming', content: snapshot }));
          })
          .catch((err) => {
            log.warn('流式卡片更新失败: %s', (err as Error).message);
          });
      },
    });

    const terminalCard = (result: CopilotRunResult): object => {
      if (result.aborted) return runCard({ scope, phase: 'interrupted', content: partial });
      if (result.timedOut) {
        return runCard({
          scope,
          phase: 'error',
          errorMsg: timeoutMs > 0 ? `任务超时（超过 ${timeoutMs / 1000}s）` : '任务超时',
        });
      }
      if (result.exitCode !== 0) {
        const detail = result.stderr || result.stdout || `退出码 ${result.exitCode}`;
        return runCard({
          scope,
          phase: 'error',
          errorMsg: `copilot 运行失败：${detail.slice(0, 1500)}`,
        });
      }
      return runCard({ scope, phase: 'done', content: result.stdout || '' });
    };

    let streamMessageId: string | undefined;
    let deliveredViaStream = false;

    try {
      streamMessageId = await lark.streamCard(
        chatId,
        runCard({ scope, phase: 'thinking' }),
        async (update) => {
          updateFn = update;
          if (partial) {
            await update(runCard({ scope, phase: 'streaming', content: partial }));
          }
          const result = await agentDone;
          await updateChain.catch(() => undefined);
          if (result.sessionId) session.setSessionId(scope, result.sessionId);
          cardClosed = true;
          await update(terminalCard(result));
          if (result.exitCode === 0 && result.stdout) {
            session.appendRound(scope, text, result.stdout);
          }
          deliveredViaStream = true;
        },
        sendOpts,
      );
    } catch (streamErr) {
      cardClosed = true;
      log.error('streamCard 失败: %s', (streamErr as Error).message);
    }

    const result = await agentDone;
    if (result.sessionId) session.setSessionId(scope, result.sessionId);

    const cleanEmpty = !result.aborted && !result.timedOut && result.exitCode === 0 && !(result.stdout || '').trim();
    if (deliveredViaStream && cleanEmpty && streamMessageId) {
      try {
        await lark.recallMessage(streamMessageId);
        log.info('空回复已撤回 mid=%s', streamMessageId);
      } catch (err) {
        log.warn('撤回空回复失败: %s', (err as Error).message);
      }
      return;
    }

    if (!deliveredViaStream) {
      // 若占位卡已发出，先撤回再发终态，避免双气泡
      if (streamMessageId) {
        try { await lark.recallMessage(streamMessageId); } catch { /* ignore */ }
      }
      try {
        await lark.sendCard(chatId, terminalCard(result), sendOpts);
        if (result.exitCode === 0 && result.stdout) {
          session.appendRound(scope, text, result.stdout);
        }
        log.info('静态卡片回退已发送 exit=%s', result.exitCode);
      } catch (cardErr) {
        log.error('静态卡片也失败，纯文本兜底: %s', (cardErr as Error).message);
        const body = result.aborted
          ? '任务已被中断。'
          : result.timedOut
            ? (timeoutMs > 0 ? `任务超时（超过 ${timeoutMs / 1000}s）。` : '任务超时。')
            : result.exitCode !== 0
              ? `copilot 失败：${(result.stderr || result.stdout || `exit ${result.exitCode}`).slice(0, 1500)}`
              : (result.stdout || '(空回复)');
        await lark.sendText(chatId, body.slice(0, 3500), sendOpts);
      }
    } else {
      log.info('流式卡片完成 exit=%s outLen=%d', result.exitCode, (result.stdout || '').length);
    }
  } catch (err) {
    const detail = (err as Error).message || String(err);
    log.error('处理失败: chat=%s %s', chatId, detail);
    try {
      await lark.sendText(chatId, `⚠️ 处理失败：${detail}`.slice(0, 2000), {
        replyTo: lastMsg.messageId,
        ...(lastMsg.threadId ? { replyInThread: true } : {}),
      });
    } catch (textErr) {
      log.error('纯文本回退也失败: %s', (textErr as Error).message);
    }
  } finally {
    session.markIdle(scope);
  }
}
