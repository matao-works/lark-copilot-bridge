/**
 * Copilot CLI `--output-format json` → AgentEvent
 */
import type { AgentEvent } from '../agent/types.js';
import { log } from '../logger.js';

interface JsonlLine {
  type?: string;
  id?: string;
  data?: Record<string, unknown>;
}

/**
 * 将一行 JSONL 转为 0..N 个 AgentEvent。未知类型返回空数组。
 */
export function translateCopilotJsonlLine(raw: string): AgentEvent[] {
  const line = raw.trim();
  if (!line) return [];
  let obj: JsonlLine;
  try {
    obj = JSON.parse(line) as JsonlLine;
  } catch {
    log.debug('jsonl 非 JSON，忽略: %s', line.slice(0, 80));
    return [];
  }
  const type = obj.type ?? '';
  const data = (obj.data ?? {}) as Record<string, unknown>;

  switch (type) {
    case 'session.start': {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      return sessionId ? [{ type: 'system', sessionId }] : [];
    }

    case 'assistant.message_delta': {
      const delta =
        (typeof data.delta === 'string' && data.delta)
        || (typeof data.content === 'string' && data.content)
        || '';
      return delta ? [{ type: 'text', delta }] : [];
    }

    case 'assistant.thinking_delta':
    case 'assistant.reasoning_delta': {
      const delta =
        (typeof data.delta === 'string' && data.delta)
        || (typeof data.content === 'string' && data.content)
        || '';
      return delta ? [{ type: 'thinking', delta }] : [];
    }

    case 'assistant.message': {
      const content = typeof data.content === 'string' ? data.content : '';
      if (!content.trim()) return [];
      const phase = typeof data.phase === 'string' ? data.phase : '';
      if (phase === 'final_answer') {
        return [
          { type: 'text_replace', content },
          { type: 'final_text', content },
        ];
      }
      // commentary / 其它：整段替换当前流式正文，避免重复追加
      return [{ type: 'text_replace', content }];
    }

    case 'tool.execution_start': {
      const id =
        (typeof data.toolCallId === 'string' && data.toolCallId)
        || (typeof obj.id === 'string' && obj.id)
        || '';
      if (!id) return [];
      const name =
        (typeof data.toolName === 'string' && data.toolName)
        || (typeof data.mcpToolName === 'string' && data.mcpToolName)
        || 'tool';
      const input = data.arguments ?? {};
      return [{ type: 'tool_use', id, name, input }];
    }

    case 'tool.execution_complete': {
      const id =
        (typeof data.toolCallId === 'string' && data.toolCallId)
        || (typeof obj.id === 'string' && obj.id)
        || '';
      if (!id) return [];
      const success = data.success !== false;
      const output = extractToolOutput(data.result);
      return [{ type: 'tool_result', id, output, isError: !success }];
    }

    case 'permission.requested': {
      return [{ type: 'awaiting_permission', active: true }];
    }

    case 'permission.completed': {
      return [{ type: 'awaiting_permission', active: false }];
    }

    default:
      return [];
  }
}

function extractToolOutput(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') {
    return unwrapOutputTextJson(result);
  }
  if (typeof result !== 'object') return String(result);
  const rec = result as Record<string, unknown>;
  if (typeof rec.content === 'string') {
    return unwrapOutputTextJson(rec.content);
  }
  if (typeof rec.detailedContent === 'string') {
    return unwrapOutputTextJson(rec.detailedContent);
  }
  if (typeof rec.text === 'string') return rec.text;
  try {
    return JSON.stringify(result, null, 0).slice(0, 4000);
  } catch {
    return '';
  }
}

/** Copilot 常把 output_text 再 JSON 包一层 */
function unwrapOutputTextJson(s: string): string {
  const trimmed = s.trim();
  if (!trimmed.startsWith('{')) return s;
  try {
    const o = JSON.parse(trimmed) as { type?: string; text?: { value?: string } | string };
    if (o.type === 'output_text') {
      if (typeof o.text === 'string') return o.text;
      if (o.text && typeof o.text.value === 'string') return o.text.value;
    }
  } catch { /* keep raw */ }
  return s;
}

/** 行缓冲：把 chunk 拼成完整行再 translate */
export class JsonlLineBuffer {
  private buf = '';

  push(chunk: string): AgentEvent[] {
    this.buf += chunk;
    const events: AgentEvent[] = [];
    for (;;) {
      const nl = this.buf.indexOf('\n');
      if (nl < 0) break;
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      events.push(...translateCopilotJsonlLine(line));
    }
    return events;
  }

  /** 进程结束时冲刷最后一行（无换行） */
  flush(): AgentEvent[] {
    if (!this.buf.trim()) {
      this.buf = '';
      return [];
    }
    const line = this.buf;
    this.buf = '';
    return translateCopilotJsonlLine(line);
  }
}
