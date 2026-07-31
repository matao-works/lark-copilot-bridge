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
import { renderCard } from './lark/card.js';
import {
  initialState,
  reduce,
  markInterrupted,
  markWallTimeout,
  finalizeIfRunning,
  answerText,
  hasVisibleCardContent,
  type RunState,
} from './card/run-state.js';
import { startKeepalive } from './keepalive.js';
import { buildSystemPrompt } from './bridge-prompt.js';
import { canUseBot } from './acl.js';
import { bridgeContextBlock, xmlBlock } from './prompt-util.js';
import { shouldRunSetup, runSetupWizard, printSetupRequiredHint } from './setup.js';
import type { CardActionEvent, CommentEvent } from '@larksuite/channel';
import { log } from './logger.js';
import { registerProcess, markConnected, unregisterProcess } from './daemon/registry.js';
import {
  MediaCache,
  mediaBatchDir,
  formatAttachmentsForPrompt,
  formatSkippedSummary,
  gcMediaCache,
  isDownloadableResource,
  type ResolvedAttachment,
} from './media/cache.js';
import { stripAttachmentRefs, emptyTextWithAttachmentsFallback } from './media/strip.js';

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
    // scope 须等于 chatId，或为 chatId:threadId，避免前缀误匹配
    if (!evt.chatId) {
      log.warn('卡片停止被拒绝: 无 chatId');
      return;
    }
    if (!(value.scope === evt.chatId || value.scope.startsWith(`${evt.chatId}:`))) {
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

  registerProcess(creds.appId);
  markConnected(process.pid, lark.botIdentity?.name);

  void gcMediaCache().catch((err) => {
    log.warn('附件缓存 GC 失败: %s', (err as Error).message);
  });

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
    unregisterProcess();
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
  console.log('    4. 也可直接发图片或文件');
  console.log('');
  console.log('  常用：发 /help 看命令；想换项目文件夹可运行');
  console.log('        lark-copilot-bridge setup');
  console.log('');
  console.log('  想关掉窗口仍保持在线？另开终端运行：');
  console.log('        lark-copilot-bridge start');
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

  const plainCmd = stripAttachmentRefs(text);
  const hasDownloadable = (msg.resources ?? []).some(isDownloadableResource);
  const cmdResult = await handleCommand(plainCmd || text, {
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
    if (hasDownloadable) {
      await lark.sendText(
        msg.chatId,
        '命令已执行；本条消息里的附件已忽略。若要处理附件，请单独发送图片/文件（不要带 / 命令）。',
        { replyTo: msg.messageId, ...(msg.threadId ? { replyInThread: true } : {}) },
      ).catch(() => undefined);
    }
    return;
  }

  queue.push(scope, msg);
  log.info('已入队: scope=%s pending=%d', scope, queue.pendingCount(scope));
}

function messagePlainText(msg: IncomingMessage): string {
  return stripAttachmentRefs(extractText(msg));
}

function mergeMessages(batch: IncomingMessage[]): string {
  const texts = batch.map((m) => messagePlainText(m));
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

function collectResourceItems(batch: IncomingMessage[]): Array<{
  messageId: string;
  resource: IncomingMessage['resources'][number];
}> {
  const items: Array<{ messageId: string; resource: IncomingMessage['resources'][number] }> = [];
  for (const msg of batch) {
    for (const r of msg.resources ?? []) {
      items.push({ messageId: msg.messageId, resource: r });
    }
  }
  return items;
}

function sendOptsFor(msg: IncomingMessage): { replyTo: string; replyInThread?: boolean } {
  return {
    replyTo: msg.messageId,
    ...(msg.threadId ? { replyInThread: true as const } : {}),
  };
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
  const runGen = session.generationFor(scope);
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
    if (!result.aborted && result.sessionId) session.setSessionId(scope, result.sessionId, runGen);
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
  const runGen = session.generationFor(scope);
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

    const batchMediaDir = mediaBatchDir(lastMsg.messageId);
    const media = new MediaCache(lark, batchMediaDir);
    const resourceItems = collectResourceItems(batch);
    const {
      accepted: attachments,
      skipped: mediaSkipped,
      downloadableCount,
    } = await media.resolve(resourceItems);

    const sendOpts = sendOptsFor(lastMsg);

    let plain = text.trim();
    if (!plain && attachments.length > 0) {
      plain = emptyTextWithAttachmentsFallback();
    }

    // 可下载附件全失败 → 失败闭合，避免伪装成「只 @ 唤醒」
    if (downloadableCount > 0 && attachments.length === 0) {
      const detail = formatSkippedSummary(mediaSkipped)
        || '未能下载附件（可能已过期或权限不足）';
      await lark.sendText(chatId, detail, sendOpts);
      return;
    }
    // 仅不支持类型且无正文
    if (resourceItems.length > 0 && attachments.length === 0 && !plain) {
      const detail = formatSkippedSummary(mediaSkipped)
        || '暂不支持这类附件';
      await lark.sendText(chatId, detail, sendOpts);
      return;
    }
    if (mediaSkipped.length > 0) {
      log.warn('附件部分跳过: %s', mediaSkipped.join('; '));
      await lark.sendText(
        chatId,
        formatSkippedSummary(mediaSkipped),
        sendOpts,
      ).catch(() => undefined);
    }

    const userText = plain || '（对方发来一条没有正文的消息——通常是只 @ 了你的唤醒。请简短回应。）';
    const historyUserText = userText;
    const userPart = sessionId ? userText : session.buildPrompt(scope, userText);
    const attachBlock = formatAttachmentsForPrompt(attachments);
    let topicBlock = '';
    if (lastMsg.threadId && !sessionId) {
      const topicMsgs = await lark.fetchTopicMessages(lastMsg.threadId);
      if (topicMsgs.length > 0) {
        topicBlock = xmlBlock('topic_context', topicMsgs.map((m) => `${m.senderName}: ${m.content}`).join('\n'));
      }
    }
    const prompt = systemPrefix + ctxBlock + quotedBlock + topicBlock + attachBlock + userPart;
    log.info(
      '调用 copilot: promptLen=%d session=%s attachments=%d',
      prompt.length,
      sessionId ?? '(new)',
      attachments.length,
    );

    let state: RunState = initialState();
    let updateFn: ((card: object) => Promise<void>) | null = null;
    let cardClosed = false;
    let updateChain: Promise<void> = Promise.resolve();

    const scheduleCardUpdate = (): void => {
      if (cardClosed || !updateFn) return;
      const snapshot = state;
      const doUpdate = updateFn;
      updateChain = updateChain
        .then(() => {
          if (cardClosed) return;
          return doUpdate(renderCard(snapshot, { scope }));
        })
        .catch((err) => {
          log.warn('流式卡片更新失败: %s', (err as Error).message);
        });
    };

    const agentDone = runCopilot({
      cwd,
      prompt,
      timeoutMs,
      extraArgs: config.copilotExtraArgs,
      abortSignal: ac.signal,
      sessionId,
      attachments: attachments.map((a: ResolvedAttachment) => a.absPath),
      // 有附件时仅放行本批次媒体目录，供 Copilot 读本地文件
      ...(attachments.length > 0 ? { addDirs: [batchMediaDir] } : {}),
      onEvent: (evt) => {
        state = reduce(state, evt);
        scheduleCardUpdate();
      },
    });

    const applyTerminalOverrides = (result: CopilotRunResult): void => {
      if (result.aborted) {
        if (state.terminal === 'running') state = markInterrupted(state);
        return;
      }
      if (result.timedOut) {
        if (state.terminal === 'running' || state.terminal === 'wall_timeout') {
          const sec = timeoutMs > 0 ? Math.round(timeoutMs / 1000) : 0;
          state = markWallTimeout(
            state,
            sec,
            sec > 0 ? `任务超时（超过 ${sec}s）` : '任务超时',
          );
        }
        return;
      }
      if (result.exitCode !== 0 && state.terminal !== 'error' && state.terminal !== 'interrupted') {
        const detail = (result.stderr || '').trim() || `退出码 ${result.exitCode}`;
        state = reduce(state, {
          type: 'error',
          message: `copilot 运行失败：${detail.slice(0, 1500)}`,
          terminationReason: 'error',
        });
        return;
      }
      if (state.terminal === 'running') {
        state = finalizeIfRunning(state);
      }
    };

    let streamMessageId: string | undefined;
    let deliveredViaStream = false;
    let terminalApplied = false;

    const settleTerminal = (result: CopilotRunResult): void => {
      if (terminalApplied) return;
      terminalApplied = true;
      applyTerminalOverrides(result);
    };

    try {
      streamMessageId = await lark.streamCard(
        chatId,
        renderCard(initialState(), { scope }),
        async (update) => {
          updateFn = update;
          await update(renderCard(state, { scope }));
          const result = await agentDone;
          await updateChain.catch(() => undefined);
          settleTerminal(result);
          // 先标记已通过流式交付，避免后续 update 抛错时再走静态卡双气泡
          deliveredViaStream = true;
          if (!result.aborted) {
            const sid = result.sessionId || state.sessionId;
            if (sid) session.setSessionId(scope, sid, runGen);
          }
          cardClosed = true;
          await update(renderCard(state, { scope }));
          const answer = (result.stdout || answerText(state)).trim();
          if (!result.aborted && result.exitCode === 0 && answer) {
            session.appendRound(scope, historyUserText, answer, runGen);
          }
        },
        sendOpts,
      );
    } catch (streamErr) {
      cardClosed = true;
      log.error('streamCard 失败: %s', (streamErr as Error).message);
    }

    const result = await agentDone;
    settleTerminal(result);
    // 流式路径已写过 session；此处再写会与中间的 /new|/cd|/ws use 竞态
    if (!deliveredViaStream && !result.aborted) {
      const sid = result.sessionId || state.sessionId;
      if (sid) session.setSessionId(scope, sid, runGen);
    }
    const answer = (result.stdout || answerText(state)).trim();

    const cleanEmpty = !result.aborted && !result.timedOut && result.exitCode === 0
      && !answer
      && !hasVisibleCardContent(state);
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
      if (streamMessageId) {
        try { await lark.recallMessage(streamMessageId); } catch { /* ignore */ }
      }
      try {
        await lark.sendCard(chatId, renderCard(state, { scope }), sendOpts);
        if (!result.aborted && result.exitCode === 0 && answer) {
          session.appendRound(scope, historyUserText, answer, runGen);
        }
        log.info('静态卡片回退已发送 exit=%s', result.exitCode);
      } catch (cardErr) {
        log.error('静态卡片也失败，纯文本兜底: %s', (cardErr as Error).message);
        const failDetail = (result.stderr || '').trim() || `exit ${result.exitCode}`;
        const body = result.aborted
          ? '任务已被中断。'
          : result.timedOut
            ? (timeoutMs > 0 ? `任务超时（超过 ${timeoutMs / 1000}s）。` : '任务超时。')
            : result.exitCode !== 0
              ? `copilot 失败：${failDetail.slice(0, 1500)}`
              : (answer || '(空回复)');
        await lark.sendText(chatId, body.slice(0, 3500), sendOpts);
      }
    } else {
      log.info('流式卡片完成 exit=%s mode=%s outLen=%d', result.exitCode, result.outputMode, answer.length);
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
