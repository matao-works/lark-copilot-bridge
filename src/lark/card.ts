/**
 * 飞书卡片构建
 *
 * 对照原项目 src/card/run-renderer.ts：原项目用 RunState reducer 维护复杂状态机，
 * 流式卡片带"停止"按钮（点击触发 cardAction → ActiveRuns.interrupt）。
 * 我们简化：thinking/streaming 卡片带停止按钮，final/error 终态无按钮。
 */

/** 思考中卡片：copilot 刚启动时发（带停止按钮） */
export function thinkingCard(userText: string, scope: string): object {
  return {
    config: { streaming_mode: true },
    header: cardHeader('⏳ Copilot 正在思考'),
    elements: [
      quoteBlock(userText),
      { tag: 'div', text: { tag: 'lark_md', content: '*处理中，请稍候…*' } },
      stopButton(scope),
    ],
  };
}

/** 流式更新卡片：显示 copilot 已输出的部分文本（带停止按钮） */
export function streamingCard(userText: string, partial: string, scope: string): object {
  const body = partial || '*处理中，请稍候…*';
  return {
    config: { streaming_mode: true },
    header: cardHeader('⏳ Copilot 正在思考'),
    elements: [
      quoteBlock(userText),
      { tag: 'div', text: { tag: 'lark_md', content: body } },
      stopButton(scope),
    ],
  };
}

/** 最终回复卡片（终态，无按钮） */
export function finalCard(userText: string, reply: string): object {
  return {
    config: { streaming_mode: false },
    header: cardHeader('✅ Copilot 回复'),
    elements: [quoteBlock(userText), { tag: 'div', text: { tag: 'lark_md', content: reply } }],
  };
}

/** 错误卡片（终态，无按钮） */
export function errorCard(userText: string, errorMsg: string): object {
  return {
    config: { streaming_mode: false },
    header: cardHeader('⚠️ 处理失败'),
    elements: [
      quoteBlock(userText),
      { tag: 'div', text: { tag: 'lark_md', content: `\`\`\`\n${errorMsg}\n\`\`\`` } },
    ],
  };
}

/** 纯信息卡片（帮助/状态等） */
export function infoCard(title: string, body: string): object {
  return {
    header: cardHeader(title),
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: body } }],
  };
}

/** 停止按钮：点击触发 cardAction，value 带 cmd=stop + scope */
function stopButton(scope: string): object {
  return {
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '⏹ 停止' },
        type: 'danger',
        value: { cmd: 'stop', scope },
      },
    ],
  };
}

function cardHeader(title: string): object {
  return { title: { tag: 'plain_text', content: title } };
}

function quoteBlock(text: string): object {
  const safe = escapeMd(text).slice(0, 500);
  return { tag: 'div', text: { tag: 'lark_md', content: `> ${safe}` } };
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}
