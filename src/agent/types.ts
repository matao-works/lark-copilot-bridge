/**
 * 统一 agent 事件（对齐上游 AgentEvent 精简版）
 */
export type TerminationReason = 'completed' | 'interrupted' | 'timeout' | 'error';

export type AgentEvent =
  | { type: 'text'; delta: string }
  /** 用完整正文替换当前流式文本块（Copilot 常一次吐整段） */
  | { type: 'text_replace'; content: string }
  | { type: 'final_text'; content: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError?: boolean }
  | { type: 'system'; sessionId?: string; message?: string }
  /** 等待权限等临时状态（不进 reasoning） */
  | { type: 'awaiting_permission'; active: boolean }
  | { type: 'done'; terminationReason?: TerminationReason }
  | { type: 'error'; message: string; terminationReason?: TerminationReason };
