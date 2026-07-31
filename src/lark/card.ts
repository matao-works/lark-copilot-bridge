/**
 * 飞书卡片
 *
 * UX 原则：
 * - schema 2.0 + body.elements，无顶层 header（避免「✅ Copilot 回复」噪音）
 * - 已用 replyTo 挂在用户消息下，卡片内不再重复引用用户原文
 * - running：正文 + 底部状态 + 停止按钮；终态：只留正文/错误
 */

export type RunPhase = 'thinking' | 'streaming' | 'done' | 'error' | 'interrupted';

/** 思考中 / 流式中 / 终态 — 统一入口 */
export function runCard(opts: {
  scope: string;
  phase: RunPhase;
  /** 流式或最终正文 */
  content?: string;
  /** phase=error 时的错误信息 */
  errorMsg?: string;
}): object {
  const elements: object[] = [];
  const running = opts.phase === 'thinking' || opts.phase === 'streaming';

  if (opts.phase === 'thinking') {
    elements.push(noteMd('_正在思考…_'));
  } else if (opts.phase === 'streaming') {
    const body = (opts.content || '').trim();
    elements.push(markdown(body || '_正在输出…_'));
  } else if (opts.phase === 'interrupted') {
    if (opts.content?.trim()) elements.push(markdown(opts.content));
    elements.push(noteMd('_⏹ 已被中断_'));
  } else if (opts.phase === 'error') {
    elements.push(noteMd(`⚠️ ${opts.errorMsg || '处理失败'}`));
  } else {
    // done
    const body = (opts.content || '').trim();
    elements.push(markdown(body || '_（未返回内容）_'));
  }

  if (running) {
    elements.push(footerStatus(opts.phase === 'thinking' ? 'thinking' : 'streaming'));
    elements.push(stopButton(opts.scope));
  }

  return {
    schema: '2.0',
    config: {
      streaming_mode: running,
      summary: { content: summaryText(opts.phase) },
    },
    body: { elements },
  };
}

/** @deprecated 用 runCard；保留薄包装方便调用点迁移 */
export function thinkingCard(_userText: string, scope: string): object {
  return runCard({ scope, phase: 'thinking' });
}

export function streamingCard(_userText: string, partial: string, scope: string): object {
  return runCard({ scope, phase: 'streaming', content: partial });
}

export function finalCard(_userText: string, reply: string): object {
  return runCard({ scope: '', phase: 'done', content: reply });
}

export function errorCard(_userText: string, errorMsg: string): object {
  return runCard({ scope: '', phase: 'error', errorMsg });
}

/** 纯信息卡片（帮助/状态等命令回执） */
export function infoCard(title: string, body: string): object {
  return {
    schema: '2.0',
    config: {
      streaming_mode: false,
      summary: { content: title },
    },
    body: {
      elements: [
        markdown(`**${title}**`),
        markdown(body),
      ],
    },
  };
}

function stopButton(scope: string): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: '⏹ 终止' },
    type: 'danger',
    behaviors: [{ type: 'callback', value: { cmd: 'stop', scope } }],
  };
}

function footerStatus(kind: 'thinking' | 'streaming'): object {
  return noteMd(kind === 'thinking' ? '🧠 正在思考' : '✍️ 正在输出');
}

function summaryText(phase: RunPhase): string {
  if (phase === 'interrupted') return '已中断';
  if (phase === 'error') return '出错';
  if (phase === 'done') return '已完成';
  if (phase === 'streaming') return '正在输出';
  return '思考中';
}

function markdown(content: string): object {
  return { tag: 'markdown', content };
}

function noteMd(content: string): object {
  return { tag: 'markdown', content, text_size: 'notation' };
}
