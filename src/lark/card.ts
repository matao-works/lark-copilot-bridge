/**
 * 飞书流式运行卡片（对齐上游 run-renderer）
 *
 * - schema 2.0 + body.elements
 * - 思考面板 / 工具块 / 正文 / 终态 note
 * - running：footer + 终止按钮
 */
import type { FooterStatus, RunState, ToolEntry } from '../card/run-state.js';
import { toolBodyMd, toolHeaderText } from '../card/tool-render.js';
import { deepMaskEmails } from './mask-email.js';

const REASONING_MAX = 1500;
const COLLAPSE_TOOL_THRESHOLD = 3;

export interface RenderCardOptions {
  /** 终止按钮携带的 scope */
  scope: string;
}

export function renderCard(state: RunState, options: RenderCardOptions): object {
  const elements: object[] = [];

  if (state.reasoning.content) {
    elements.push(reasoningPanel(state.reasoning.content, state.reasoning.active));
  }

  for (const group of groupBlocks(state.blocks)) {
    if (group.kind === 'text') {
      if (group.content.trim()) elements.push(markdown(group.content));
    } else {
      elements.push(...renderToolGroup(group.tools, state.terminal !== 'running'));
    }
  }

  if (
    state.terminal === 'running'
    && elements.length === 0
    && state.footer === 'thinking'
    && !state.reasoning.content
    && !state.statusNote
  ) {
    elements.push(noteMd('_正在思考…_'));
  }

  if (state.terminal === 'running' && state.statusNote) {
    elements.push(noteMd(`_${state.statusNote}_`));
  }

  if (state.terminal === 'interrupted') {
    elements.push(noteMd('_⏹ 已被中断_'));
  } else if (state.terminal === 'wall_timeout') {
    const sec = state.wallTimeoutSeconds;
    const msg = state.errorMsg
      || (sec && sec > 0 ? `任务超时（超过 ${sec}s）` : '任务超时');
    elements.push(noteMd(`_⏱ ${msg}_`));
  } else if (state.terminal === 'idle_timeout') {
    const mins = state.idleTimeoutMinutes ?? 0;
    elements.push(noteMd(mins > 0 ? `_⏱ ${mins} 分钟无输出，已自动终止_` : '_⏱ 无输出，已自动终止_'));
  } else if (state.terminal === 'error' && state.errorMsg) {
    elements.push(noteMd(`⚠️ ${state.errorMsg}`));
  } else if (state.terminal === 'done' && elements.length === 0) {
    elements.push(noteMd('_（未返回内容）_'));
  }

  if (state.terminal === 'running') {
    if (state.footer) elements.push(footerStatus(state.footer));
    elements.push(stopButton(options.scope));
  }

  return deepMaskEmails({
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: summaryText(state) },
    },
    body: { elements },
  });
}

/** 纯信息卡片（帮助/状态等命令回执） */
export function infoCard(title: string, body: string): object {
  return deepMaskEmails({
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
  });
}

/** @deprecated 迁移期薄包装；新代码用 renderCard(state) */
export type RunPhase = 'thinking' | 'streaming' | 'done' | 'error' | 'interrupted';

export function runCard(opts: {
  scope: string;
  phase: RunPhase;
  content?: string;
  errorMsg?: string;
}): object {
  const state: RunState = {
    blocks: opts.content?.trim()
      ? [{ kind: 'text', content: opts.content, streaming: opts.phase === 'streaming' }]
      : [],
    reasoning: { content: '', active: false },
    footer: opts.phase === 'thinking' ? 'thinking' : opts.phase === 'streaming' ? 'streaming' : null,
    terminal:
      opts.phase === 'thinking' || opts.phase === 'streaming'
        ? 'running'
        : opts.phase === 'interrupted'
          ? 'interrupted'
          : opts.phase === 'error'
            ? 'error'
            : 'done',
    errorMsg: opts.errorMsg,
  };
  if (opts.phase === 'thinking' && state.blocks.length === 0) {
    // 仅思考占位
  }
  return renderCard(state, { scope: opts.scope });
}

interface ToolGroup { kind: 'tools'; tools: ToolEntry[] }
interface TextGroup { kind: 'text'; content: string }
type Group = ToolGroup | TextGroup;

function* groupBlocks(blocks: RunState['blocks']): Generator<Group> {
  let toolBuf: ToolEntry[] = [];
  for (const b of blocks) {
    if (b.kind === 'tool') {
      toolBuf.push(b.tool);
    } else {
      if (toolBuf.length > 0) {
        yield { kind: 'tools', tools: toolBuf };
        toolBuf = [];
      }
      yield { kind: 'text', content: b.content };
    }
  }
  if (toolBuf.length > 0) yield { kind: 'tools', tools: toolBuf };
}

function renderToolGroup(tools: ToolEntry[], finalized: boolean): object[] {
  if (tools.length === 0) return [];
  if (tools.length < COLLAPSE_TOOL_THRESHOLD) {
    if (finalized) {
      return tools.map((t) => toolPanel(t, false));
    }
    // running：只展开最新一个，方便看当前在干什么
    return tools.map((t, i) => toolPanel(t, i === tools.length - 1));
  }
  if (finalized) {
    return [collapsedToolSummary(tools, true)];
  }
  const prior = tools.slice(0, -1);
  const latest = tools[tools.length - 1];
  const out: object[] = [];
  if (prior.length > 0) out.push(collapsedToolSummary(prior, false));
  if (latest) out.push(toolPanel(latest, true));
  return out;
}

function reasoningPanel(content: string, active: boolean): object {
  const title = active ? '🧠 **思考中**' : '🧠 **思考完成，点击查看**';
  return collapsiblePanel({
    title,
    expanded: active,
    border: 'grey',
    body: truncate(content, REASONING_MAX),
  });
}

function toolPanel(tool: ToolEntry, expanded: boolean): object {
  return collapsiblePanel({
    title: toolHeaderText(tool),
    expanded,
    border: tool.status === 'error' ? 'red' : 'grey',
    body: toolBodyMd(tool) || '_无输出_',
  });
}

function collapsedToolSummary(tools: ToolEntry[], finalized: boolean): object {
  const suffix = finalized ? '（已结束）' : '';
  const title = `☕ **${tools.length} 个工具调用${suffix}**`;
  const headerList = tools.map((t) => `- ${toolHeaderText(t)}`).join('\n');
  return {
    tag: 'collapsible_panel',
    expanded: false,
    header: panelHeader(title),
    border: { color: 'blue', corner_radius: '5px' },
    vertical_spacing: '8px',
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: headerList, text_size: 'notation' }],
  };
}

function collapsiblePanel(opts: {
  title: string;
  expanded: boolean;
  border: 'grey' | 'red' | 'blue';
  body: string;
}): object {
  return {
    tag: 'collapsible_panel',
    expanded: opts.expanded,
    header: panelHeader(opts.title),
    border: { color: opts.border, corner_radius: '5px' },
    vertical_spacing: '8px',
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: opts.body, text_size: 'notation' }],
  };
}

function panelHeader(titleMd: string): object {
  return {
    title: { tag: 'markdown', content: titleMd },
    vertical_align: 'center',
    icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
    icon_position: 'follow_text',
    icon_expanded_angle: -180,
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

function footerStatus(status: Exclude<FooterStatus, null>): object {
  const text =
    status === 'thinking'
      ? '🧠 正在思考'
      : status === 'tool_running'
        ? '🧰 正在调用工具'
        : status === 'awaiting_permission'
          ? '🔐 等待权限确认'
          : '✍️ 正在输出';
  return noteMd(text);
}

function summaryText(state: RunState): string {
  if (state.terminal === 'interrupted') return '已中断';
  if (state.terminal === 'wall_timeout') return '已超时';
  if (state.terminal === 'idle_timeout') return '无输出超时';
  if (state.terminal === 'error') return '出错';
  if (state.terminal === 'done') return '已完成';
  if (state.footer === 'awaiting_permission') return '等待权限';
  if (state.footer === 'tool_running') return '正在调用工具';
  if (state.footer === 'streaming') return '正在输出';
  return '思考中';
}

function markdown(content: string): object {
  return { tag: 'markdown', content };
}

function noteMd(content: string): object {
  return { tag: 'markdown', content, text_size: 'notation' };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
