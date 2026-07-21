/**
 * Probe outbound Feishu API without WS (won't kick the running bridge).
 * node scripts/probe-send.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const cfg = JSON.parse(readFileSync(resolve(homedir(), '.lark-copilot-bridge/config.json'), 'utf8'));
const domain = cfg.tenant === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
const openId = cfg.creatorOpenId;

console.log({ appId: cfg.appId, tenant: cfg.tenant, openId, domain });

async function api(method, path, body, token) {
  const res = await fetch(`${domain}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { http: res.status, json };
}

const tok = await api('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
  app_id: cfg.appId,
  app_secret: cfg.appSecret,
});
console.log('token:', tok.http, tok.json.code, tok.json.msg, tok.json.tenant_access_token ? 'got_token' : '');
if (tok.json.code !== 0) process.exit(1);
const token = tok.json.tenant_access_token;

async function send(name, receiveIdType, receiveId, msgType, content) {
  const t0 = Date.now();
  const r = await api(
    'POST',
    `/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
    { receive_id: receiveId, msg_type: msgType, content: JSON.stringify(content) },
    token,
  );
  console.log(
    `${r.json.code === 0 ? '✓' : '✗'} ${name} (${Date.now() - t0}ms)`,
    'code=', r.json.code,
    'msg=', r.json.msg,
    r.json.data?.message_id ? `mid=${r.json.data.message_id}` : '',
    r.json.error ? JSON.stringify(r.json.error).slice(0, 300) : '',
  );
  return r;
}

// 1) plain text to open_id
await send('text→open_id', 'open_id', openId, 'text', { text: `[probe] ${new Date().toISOString()}` });

// 2) v1 card
await send('v1card→open_id', 'open_id', openId, 'interactive', {
  config: { wide_screen_mode: true },
  header: { title: { tag: 'plain_text', content: 'probe v1' } },
  elements: [{ tag: 'div', text: { tag: 'plain_text', content: 'hello v1' } }],
});

// 3) v2 card (no streaming)
await send('v2card→open_id', 'open_id', openId, 'interactive', {
  schema: '2.0',
  config: { streaming_mode: false },
  header: { title: { tag: 'plain_text', content: 'probe v2' } },
  body: { elements: [{ tag: 'markdown', content: 'hello **v2**' }] },
});

// 4) v2 streaming_mode true (like thinking card)
await send('v2stream→open_id', 'open_id', openId, 'interactive', {
  schema: '2.0',
  config: { streaming_mode: true, summary: { content: '思考中' } },
  header: { title: { tag: 'plain_text', content: '⏳ probe stream' } },
  body: {
    elements: [
      { tag: 'markdown', content: '> hi' },
      { tag: 'markdown', content: '*处理中*' },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '⏹ 停止' },
        type: 'danger',
        behaviors: [{ type: 'callback', value: { cmd: 'stop', scope: 'probe' } }],
      },
    ],
  },
});

console.log('\nCheck Feishu bot DM for probe messages.');
