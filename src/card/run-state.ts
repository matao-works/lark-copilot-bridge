/**
 * RunState 归约（对齐上游 src/card/run-state.ts）
 */
import type { AgentEvent } from '../agent/types.js';

export type ToolStatus = 'running' | 'done' | 'error';

export interface ToolEntry {
  id: string;
  name: string;
  input: unknown;
  status: ToolStatus;
  output?: string;
}

export type Block =
  | { kind: 'text'; content: string; streaming: boolean }
  | { kind: 'tool'; tool: ToolEntry };

export type FooterStatus = 'thinking' | 'tool_running' | 'streaming' | 'awaiting_permission' | null;
/** wall_timeout = 总时长到点；idle_timeout = 无输出看门狗（预留） */
export type Terminal = 'running' | 'done' | 'interrupted' | 'error' | 'wall_timeout' | 'idle_timeout';

export interface RunState {
  blocks: Block[];
  finalText?: string;
  reasoning: { content: string; active: boolean };
  footer: FooterStatus;
  terminal: Terminal;
  errorMsg?: string;
  idleTimeoutMinutes?: number;
  /** 墙钟超时秒数（展示用） */
  wallTimeoutSeconds?: number;
  /** 运行中临时提示（如等待权限），终态清除 */
  statusNote?: string;
  sessionId?: string;
}

export function initialState(): RunState {
  return {
    blocks: [],
    reasoning: { content: '', active: false },
    footer: 'thinking',
    terminal: 'running',
  };
}

function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.kind === 'text' && b.streaming ? { ...b, streaming: false } : b,
  );
}

/** 是否值得保留在飞书里（避免空答案误撤回工具过程） */
export function hasVisibleCardContent(state: RunState): boolean {
  if (answerText(state)) return true;
  if (state.blocks.some((b) => b.kind === 'tool')) return true;
  if (state.reasoning.content.trim()) return true;
  return false;
}

export function reduce(state: RunState, evt: AgentEvent): RunState {
  // 终态后忽略内容事件，避免污染
  if (state.terminal !== 'running'
    && evt.type !== 'system'
    && evt.type !== 'done'
    && evt.type !== 'error') {
    return state;
  }

  switch (evt.type) {
    case 'text': {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.kind === 'text' && last.streaming) {
        const next: Block = { ...last, content: last.content + evt.delta };
        return {
          ...state,
          blocks: [...state.blocks.slice(0, -1), next],
          reasoning: { ...state.reasoning, active: false },
          footer: 'streaming',
          statusNote: undefined,
        };
      }
      return {
        ...state,
        blocks: [...state.blocks, { kind: 'text', content: evt.delta, streaming: true }],
        reasoning: { ...state.reasoning, active: false },
        footer: 'streaming',
        statusNote: undefined,
      };
    }

    case 'text_replace': {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.kind === 'text' && last.streaming) {
        return {
          ...state,
          blocks: [...state.blocks.slice(0, -1), { ...last, content: evt.content }],
          reasoning: { ...state.reasoning, active: false },
          footer: 'streaming',
          statusNote: undefined,
        };
      }
      return {
        ...state,
        blocks: [...state.blocks, { kind: 'text', content: evt.content, streaming: true }],
        reasoning: { ...state.reasoning, active: false },
        footer: 'streaming',
        statusNote: undefined,
      };
    }

    case 'final_text':
      return { ...state, finalText: evt.content };

    case 'thinking':
      return {
        ...state,
        reasoning: { content: state.reasoning.content + evt.delta, active: true },
        footer: 'thinking',
        statusNote: undefined,
      };

    case 'awaiting_permission':
      if (evt.active) {
        return {
          ...state,
          footer: 'awaiting_permission',
          statusNote: '等待工具权限确认…',
        };
      }
      return {
        ...state,
        footer: state.footer === 'awaiting_permission' ? 'thinking' : state.footer,
        statusNote: undefined,
      };

    case 'tool_use': {
      const tool: ToolEntry = {
        id: evt.id,
        name: evt.name,
        input: evt.input,
        status: 'running',
      };
      return {
        ...state,
        blocks: [...closeStreamingText(state.blocks), { kind: 'tool', tool }],
        reasoning: { ...state.reasoning, active: false },
        footer: 'tool_running',
        statusNote: undefined,
      };
    }

    case 'tool_result': {
      const blocks = state.blocks.map((b) => {
        if (b.kind !== 'tool' || b.tool.id !== evt.id) return b;
        return {
          ...b,
          tool: {
            ...b.tool,
            status: evt.isError ? ('error' as const) : ('done' as const),
            output: evt.output,
          },
        };
      });
      return { ...state, blocks };
    }

    case 'system':
      return {
        ...state,
        ...(evt.sessionId ? { sessionId: evt.sessionId } : {}),
      };

    case 'error': {
      // timeout 不在这里落终态：由 markWallTimeout 统一写文案与秒数
      if (evt.terminationReason === 'timeout') {
        return state;
      }
      const terminal =
        evt.terminationReason === 'interrupted' ? 'interrupted' : 'error';
      return sealTerminal(state, terminal, {
        errorMsg: evt.message || state.errorMsg,
        collapseText: terminal === 'error',
      });
    }

    case 'done': {
      const terminal =
        evt.terminationReason === 'interrupted'
          ? 'interrupted'
          : evt.terminationReason === 'timeout'
            ? 'wall_timeout'
            : 'done';
      return sealTerminal(state, terminal, {
        collapseText: terminal === 'done' || terminal === 'wall_timeout',
      });
    }

    default:
      return state;
  }
}

function sealTerminal(
  state: RunState,
  terminal: Terminal,
  opts: { errorMsg?: string; collapseText: boolean },
): RunState {
  let blocks = closeStreamingText(state.blocks);
  if (opts.collapseText) {
    blocks = finalizeTextBlocks(blocks, state.finalText);
  } else if (state.finalText?.trim()) {
    const hasText = blocks.some((b) => b.kind === 'text' && b.content.trim());
    if (!hasText) {
      blocks = [...blocks, { kind: 'text', content: state.finalText, streaming: false }];
    }
  }
  return {
    ...state,
    blocks,
    reasoning: { ...state.reasoning, active: false },
    terminal,
    footer: null,
    statusNote: undefined,
    ...(opts.errorMsg !== undefined ? { errorMsg: opts.errorMsg } : {}),
  };
}

export function markInterrupted(state: RunState): RunState {
  if (state.terminal === 'interrupted') return state;
  return sealTerminal(state, 'interrupted', { collapseText: false });
}

/** 墙钟超时（单次任务总时长） */
export function markWallTimeout(state: RunState, seconds: number, message?: string): RunState {
  const msg = message ?? (seconds > 0 ? `任务超时（超过 ${seconds}s）` : '任务超时');
  const next = sealTerminal(state, 'wall_timeout', { errorMsg: msg, collapseText: true });
  return {
    ...next,
    wallTimeoutSeconds: seconds > 0 ? seconds : undefined,
  };
}

export function markIdleTimeout(state: RunState, minutes: number): RunState {
  const next = sealTerminal(state, 'idle_timeout', { collapseText: true });
  return {
    ...next,
    idleTimeoutMinutes: minutes,
  };
}

export function finalizeIfRunning(state: RunState): RunState {
  if (state.terminal !== 'running') return state;
  return reduce(state, { type: 'done', terminationReason: 'completed' });
}

/**
 * 终态去掉过程正文，保留工具时间线；最终答案落在「原最后一段正文」位置。
 */
function finalizeTextBlocks(blocks: Block[], finalText?: string): Block[] {
  let lastTextIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && b.kind === 'text' && b.content.trim()) lastTextIdx = i;
  }
  const answer = (finalText ?? '').trim()
    || (lastTextIdx >= 0 ? (blocks[lastTextIdx] as Extract<Block, { kind: 'text' }>).content.trim() : '')
    || '';

  const out: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === 'tool') {
      out.push(b);
      continue;
    }
    if (i === lastTextIdx) {
      if (answer) out.push({ kind: 'text', content: answer, streaming: false });
    }
  }
  if (lastTextIdx < 0 && answer) {
    out.push({ kind: 'text', content: answer, streaming: false });
  }
  return out;
}

export function answerText(state: RunState): string {
  if (state.finalText?.trim()) return state.finalText.trim();
  const texts = state.blocks
    .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.content.trim())
    .filter(Boolean);
  return (texts[texts.length - 1] ?? '').trim();
}
