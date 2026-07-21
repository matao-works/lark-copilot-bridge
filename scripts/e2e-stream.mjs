/**
 * E2E: connect WS + streamCard + text, same path as the bot.
 * Bridge must be stopped first (single WS client per app).
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createLarkChannel } from '@larksuite/channel';

const LOG = '/tmp/lark-bridge-e2e.log';
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.map(String).join(' ')}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
};

const cfg = JSON.parse(readFileSync(resolve(homedir(), '.lark-copilot-bridge/config.json'), 'utf8'));
const openId = cfg.creatorOpenId;
const chatId = 'oc_66321f2aa01dc9617b20533acaf33506'; // from earlier probe

const thinking = {
  schema: '2.0',
  config: { streaming_mode: true, summary: { content: '思考中' } },
  header: { title: { tag: 'plain_text', content: '⏳ E2E thinking' } },
  body: {
    elements: [
      { tag: 'markdown', content: '> e2e' },
      { tag: 'markdown', content: '*处理中*' },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '⏹ 停止' },
        type: 'danger',
        behaviors: [{ type: 'callback', value: { cmd: 'stop', scope: 'e2e' } }],
      },
    ],
  },
};

const final = {
  schema: '2.0',
  config: { streaming_mode: false, summary: { content: 'done' } },
  header: { title: { tag: 'plain_text', content: '✅ E2E done' } },
  body: { elements: [{ tag: 'markdown', content: 'e2e stream **ok** ' + new Date().toISOString() }] },
};

const channel = createLarkChannel({
  appId: cfg.appId,
  appSecret: cfg.appSecret,
  domain: 'https://open.feishu.cn',
  source: 'lark-copilot-bridge-e2e',
  policy: { dmMode: 'open', requireMention: false },
  safety: { chatQueue: { enabled: false } },
  outbound: { streamThrottleMs: 400 },
  respectProxyEnv: true,
  httpTimeoutMs: 30_000,
  handshakeTimeoutMs: 8_000,
});

let gotMsg = null;

channel.on({
  message: async (msg) => {
    log('INBOUND', JSON.stringify({
      chatType: msg.chatType,
      chatId: msg.chatId,
      senderId: msg.senderId,
      messageId: msg.messageId,
      content: msg.content,
      mentionedBot: msg.mentionedBot,
      senderIsBot: msg.senderIsBot,
    }));
    gotMsg = msg;
    // immediate ack like we want the bot to do
    try {
      const r = await channel.send(msg.chatId, { text: `E2E ack: got [${msg.content}]` });
      log('ACK ok', r?.messageId);
    } catch (e) {
      log('ACK FAIL', e?.message || e);
    }
    // stream reply with replyTo — exact bot path
    try {
      await channel.stream(
        msg.chatId,
        {
          card: {
            initial: thinking,
            producer: async (ctrl) => {
              log('producer ctrl keys', Object.getOwnPropertyNames(Object.getPrototypeOf(ctrl)).join(','));
              log('typeof update', typeof ctrl.update);
              await new Promise((r) => setTimeout(r, 300));
              await ctrl.update(final);
              log('update done');
            },
          },
        },
        { replyTo: msg.messageId },
      );
      log('streamCard ok');
    } catch (e) {
      log('streamCard FAIL', e?.message || e, e?.stack?.split('\n')[0]);
      try {
        await channel.send(msg.chatId, { text: `E2E stream fail: ${e?.message}` });
      } catch (_) {}
    }
  },
  error: (e) => log('channel error', e?.message || e),
});

log('connecting...');
await channel.connect();
log('connected. bot=', JSON.stringify(channel.botIdentity ?? (channel).botIdentity));

// proactive outbound tests
try {
  const t = await channel.send(openId, { text: 'E2E proactive text ' + Date.now() });
  log('proactive text ok', t?.messageId);
} catch (e) {
  log('proactive text FAIL', e?.message || e);
}

try {
  await channel.stream(chatId, {
    card: {
      initial: thinking,
      producer: async (ctrl) => {
        await ctrl.update(final);
      },
    },
  });
  log('proactive stream to chatId ok');
} catch (e) {
  log('proactive stream FAIL', e?.message || e);
}

log('Waiting 60s for you to send a Feishu DM to the bot...');
await new Promise((r) => setTimeout(r, 60_000));
log('done. gotMsg=', gotMsg ? 'yes' : 'no');
try {
  await channel.disconnect?.();
} catch (_) {}
process.exit(0);
