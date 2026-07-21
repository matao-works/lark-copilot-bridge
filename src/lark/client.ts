/**
 * 飞书通信层（基于 @larksuite/channel）
 *
 * 这是对照原项目 src/bot/wizard.ts + src/bot/channel.ts 重写的版本，
 * 终于用对了依赖：
 *   - registerApp()      — 扫码创建飞书应用（终端二维码），凭证自动返回
 *   - createLarkChannel() — WS 长连接 + 消息收发 + 流式卡片，SDK 搞定重连/心跳/去重
 *
 * 之前两次都跑偏了：
 *   1. 用 node-sdk 的 WSClient + 让用户手动建应用 ❌
 *   2. 用 lark-cli event consume + config init --new ❌（lark-cli 不能建应用，只能绑定）
 * 原项目用的是 @larksuite/channel 这个更高层的包，registerApp 才是扫码建应用的正确入口。
 */
import {
  createLarkChannel,
  registerApp,
  type LarkChannel,
  type NormalizedMessage,
  type CardStreamController,
  type CardActionEvent,
  type CommentEvent,
} from '@larksuite/channel';
import qrcode from 'qrcode-terminal';
import { log } from '../logger.js';
import type { AppCredentials, SendOpts } from '../types.js';

export type { AppCredentials, SendOpts } from '../types.js';

/**
 * 扫码创建飞书应用（首次启动用）。
 * 对照原项目 src/bot/wizard.ts 的 runRegistrationWizard。
 */
export async function registerAppByQR(): Promise<AppCredentials> {
  console.log('\n未检测到飞书应用配置，进入扫码创建向导。\n');

  const result = await registerApp({
    source: 'lark-copilot-bridge',
    onQRCodeReady: (info: { url: string; expireIn: number }) => {
      console.log('请用飞书 App 扫描以下二维码完成应用创建：\n');
      qrcode.generate(info.url, { small: true });
      const mins = Math.max(1, Math.round(info.expireIn / 60));
      console.log(`\n二维码有效期：约 ${mins} 分钟`);
      console.log(`也可以直接在浏览器打开：${info.url}\n`);
    },
    onStatusChange: (info: { status: string }) => {
      if (info.status === 'domain_switched') {
        console.log('识别到国际版租户，已切换到 larksuite.com 域名。');
      } else if (info.status === 'slow_down') {
        console.log('轮询速度过快，已自动降速。');
      }
    },
  });

  const tenant: 'feishu' | 'lark' = (result as any).user_info?.tenant_brand === 'lark' ? 'lark' : 'feishu';
  const creatorOpenId: string | undefined = (result as any).user_info?.open_id;

  console.log('\n✓ 应用创建成功');
  console.log(`  App ID:  ${result.client_id}`);
  console.log(`  Tenant:  ${tenant}`);
  if (creatorOpenId) {
    console.log(`  Creator: ${creatorOpenId} (应用 owner，自动豁免访问控制)`);
  }
  console.log('');

  return {
    appId: result.client_id,
    appSecret: result.client_secret,
    tenant,
    creatorOpenId,
  };
}

/** 从飞书消息标准化出的消息（直接用 SDK 的 NormalizedMessage） */
export type IncomingMessage = NormalizedMessage;

export type MessageHandler = (msg: IncomingMessage) => void | Promise<void>;

export class LarkBridge {
  private channel: LarkChannel;

  constructor(private creds: AppCredentials) {
    this.channel = createLarkChannel({
      appId: creds.appId,
      appSecret: creds.appSecret,
      domain:
        creds.tenant === 'lark'
          ? 'https://open.larksuite.com'
          : 'https://open.feishu.cn',
      source: 'lark-copilot-bridge',
      // 群聊需要 @bot 才响应；私聊全响应
      policy: { dmMode: 'open', requireMention: false, respondToMentionAll: false },
      // 关掉 SDK 自带队列，我们自己用 MessageQueue 串行
      safety: { chatQueue: { enabled: false } },
      includeRawEvent: true,
      outbound: { streamThrottleMs: 400 },
      wsConfig: { pingTimeout: 3 },
      handshakeTimeoutMs: 8_000,
      httpTimeoutMs: 30_000,
      respectProxyEnv: true,
    } as any);
  }

  /**
   * 连接并注册消息处理器 + 卡片按钮回调。
   * onCardAction: 用户点卡片按钮时触发（如"停止"按钮），evt.action.value 里带 cmd 和 scope。
   */
  connect(
    onMessage: MessageHandler,
    onCardAction?: (evt: CardActionEvent) => void | Promise<void>,
    onComment?: (evt: CommentEvent) => void | Promise<void>,
  ): Promise<void> {
    let consecutiveReconnects = 0;
    this.channel.on({
      message: async (msg: NormalizedMessage) => {
        if (msg.senderIsBot) return;
        await onMessage(msg);
      },
      cardAction: async (evt: CardActionEvent) => {
        try { await onCardAction?.(evt); }
        catch (err) { log.error('cardAction 处理失败: %s', (err as Error).message); }
      },
      comment: async (evt: CommentEvent) => {
        try { await onComment?.(evt); }
        catch (err) { log.error('comment 处理失败: %s', (err as Error).message); }
      },
      reconnecting: () => {
        consecutiveReconnects++;
        log.warn('飞书通道重连中 (%d)...', consecutiveReconnects);
      },
      reconnected: () => {
        consecutiveReconnects = 0;
        log.info('飞书通道已重连');
      },
      error: (err: unknown) => {
        log.error('飞书通道错误: %s', (err as Error)?.message ?? err);
      },
    } as any);
    return this.channel.connect();
  }

  /** 连接状态（keepalive 用） */
  getConnectionStatus(): { state: string } | undefined {
    return (this.channel as { getConnectionStatus?: () => { state: string } }).getConnectionStatus?.();
  }

  /** 机器人身份（openId + name） */
  get botIdentity(): { openId: string; name?: string } | undefined {
    const id = (this.channel as { botIdentity?: { openId: string; name?: string } }).botIdentity;
    return id ? { openId: id.openId, name: id.name } : undefined;
  }

  /** 发送选项（对照原项目 commandReplyOptions / sendOpts） */
  // keep type export near top after imports — actually add before class

  /** 发送纯文本消息 */
  async sendText(chatId: string, text: string, opts?: SendOpts): Promise<string> {
    const result = await this.channel.send(chatId, { text }, opts);
    return (result as { messageId: string }).messageId;
  }

  /** 拉取被引用消息的文本内容（引用回复用） */
  async fetchQuotedText(messageId: string): Promise<string | undefined> {
    try {
      const msg = await (this.channel as any).fetchMessage(messageId);
      return msg?.content;
    } catch (err) {
      log.warn('拉取引用消息失败: %s', (err as Error).message);
      return undefined;
    }
  }

  /** 拉取话题上游消息（首次进入话题时给 copilot 上下文，对照原项目 fetchTopicContext） */
  async fetchTopicMessages(threadId: string, maxMessages = 20): Promise<{ senderName: string; content: string }[]> {
    try {
      const res = await (this.channel as any).rawClient.im.v1.message.list({
        params: {
          container_id_type: 'thread',
          container_id: threadId,
          sort_type: 'ByCreateTimeAsc',
          page_size: 50,
        },
      });
      const items = res?.data?.items ?? res?.data?.messages ?? [];
      return items.slice(0, maxMessages).map((it: any) => ({
        senderName: it.sender?.id ?? '?',
        content: it.body?.content ?? '',
      }));
    } catch (err) {
      log.warn('拉取话题上游失败: %s', (err as Error).message);
      return [];
    }
  }

  /** 暴露 rawClient（评论 API 用） */
  get rawClient(): any {
    return (this.channel as any).rawClient;
  }

  /** 拉取评论内容（含 quote + replies，对照原项目 comments.ts fetchCommentContext） */
  async fetchComment(fileToken: string, fileType: string, commentId: string): Promise<any> {
    try {
      return await (this.channel as any).comments.fetch({ fileToken, fileType }, commentId);
    } catch (err) {
      log.warn('拉取评论失败: %s', (err as Error).message);
      return null;
    }
  }

  /** 回复评论（对照原项目 comments.ts postCommentReply） */
  async replyComment(fileToken: string, fileType: string, commentId: string, text: string, isWhole = false): Promise<void> {
    try {
      await (this.channel as any).comments.reply({ fileToken, fileType }, commentId, text, { topLevel: isWhole });
    } catch (err) {
      log.warn('回复评论失败: %s', (err as Error).message);
    }
  }

  /** 发送一张静态卡片（帮助/状态等） */
  async sendCard(chatId: string, card: object, opts?: SendOpts): Promise<string> {
    const result = await this.channel.send(chatId, { card }, opts);
    return (result as { messageId: string }).messageId;
  }

  /** keepalive 用：断开并重连 WS */
  async reconnect(): Promise<void> {
    const ch = this.channel as unknown as {
      forceReconnect?: () => Promise<void>;
      disconnect?: () => Promise<void>;
      connect: () => Promise<void>;
    };
    if (typeof ch.forceReconnect === 'function') {
      await ch.forceReconnect();
      return;
    }
    try { await ch.disconnect?.(); } catch { /* ignore */ }
    await ch.connect();
  }

  /** 撤回消息（空流式回复时用，对照原项目 recallIfEmptyStreamedReply） */
  async recallMessage(messageId: string): Promise<void> {
    await this.channel.recallMessage(messageId);
  }

  /**
   * 流式卡片回复：先发 initialCard，然后 producer 里用 ctrl.update 增量更新。
   * 对照原项目 channel.stream({ card: { initial, producer } })。
   * 返回 stream 消息 id，供空回复撤回。
   */
  async streamCard(
    chatId: string,
    initialCard: object,
    producer: (update: (nextCard: object) => Promise<void>) => Promise<void>,
    opts?: { replyTo?: string; replyInThread?: boolean },
  ): Promise<string | undefined> {
    const result = await this.channel.stream(chatId, {
      card: {
        initial: initialCard,
        producer: async (ctrl: CardStreamController) => {
          // SDK 内部把 Impl 传给 producer；兼容万一拿到的是只带 run() 的包装对象
          const anyCtrl = ctrl as any;
          const doUpdate = typeof anyCtrl.update === 'function'
            ? (next: object) => anyCtrl.update(next)
            : typeof anyCtrl.impl?.update === 'function'
              ? (next: object) => anyCtrl.impl.update(next)
              : null;
          if (!doUpdate) {
            throw new Error('CardStreamController.update 不可用');
          }
          await producer(doUpdate);
        },
      },
    } as any, opts as any);
    return (result as any)?.messageId as string | undefined;
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    await (this.channel as any).disconnect?.();
  }
}

/**
 * 从 NormalizedMessage 提取纯文本（去掉 @占位符）。
 * SDK 的 content 已规范化，但群里 @bot 会带 @_user_N 占位符。
 */
export function extractText(msg: NormalizedMessage): string {
  let text = msg.content || '';
  const mentions = msg.mentions || [];
  for (const m of mentions) {
    if (m.key) {
      // @bot 的 mention 整体删掉；@其他人 保留 @名字
      const replacement = m.isBot ? '' : `@${m.name || m.openId || ''} `;
      text = text.split(m.key).join(replacement);
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** 判断群聊消息是否 @了机器人（SDK 已提供 mentionedBot 字段） */
export function isMentionedBot(msg: NormalizedMessage): boolean {
  return msg.mentionedBot === true;
}

/** 会话 scope：话题用 chatId:threadId，其余用 chatId */
export function scopeOf(msg: NormalizedMessage): string {
  return msg.threadId ? `${msg.chatId}:${msg.threadId}` : msg.chatId;
}
