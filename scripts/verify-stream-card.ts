/**
 * 轻量验收：jsonl → reduce → 终态正文 / 超时 / 权限 / 撤回条件
 * 运行：npx tsx scripts/verify-stream-card.ts
 */
import { translateCopilotJsonlLine } from '../src/copilot/jsonl.js';
import {
  initialState,
  reduce,
  answerText,
  finalizeIfRunning,
  markWallTimeout,
  hasVisibleCardContent,
} from '../src/card/run-state.js';
import { renderCard } from '../src/lark/card.js';
import { maskEmailsInText } from '../src/lark/mask-email.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

let s = initialState();
const events = [
  ...translateCopilotJsonlLine(JSON.stringify({ type: 'session.start', data: { sessionId: 'abc' } })),
  ...translateCopilotJsonlLine(JSON.stringify({
    type: 'assistant.message',
    data: { content: '先说明一下计划…', phase: 'commentary' },
  })),
  ...translateCopilotJsonlLine(JSON.stringify({
    type: 'tool.execution_start',
    data: { toolCallId: 't1', toolName: 'Read', arguments: { file_path: '/tmp/a.ts' } },
  })),
  ...translateCopilotJsonlLine(JSON.stringify({
    type: 'tool.execution_complete',
    data: {
      toolCallId: 't1',
      success: true,
      result: { content: JSON.stringify({ type: 'output_text', text: { value: 'file body' } }) },
    },
  })),
  ...translateCopilotJsonlLine(JSON.stringify({
    type: 'assistant.message',
    data: { content: '文件里是 file body。', phase: 'final_answer' },
  })),
];

for (const e of events) s = reduce(s, e);
s = finalizeIfRunning(s);

assert(s.sessionId === 'abc', 'sessionId');
assert(s.terminal === 'done', 'terminal done');
assert(answerText(s) === '文件里是 file body。', 'answer text');
assert(s.blocks.filter((b) => b.kind === 'text').length === 1, 'only one final text block');
assert(!(s.blocks.some((b) => b.kind === 'text' && b.content.includes('计划'))), 'commentary stripped');
assert(s.blocks.some((b) => b.kind === 'tool' && b.tool.status === 'done'), 'tool done');
// 工具仍在正文前（时间线：tool → answer）
assert(s.blocks[0]?.kind === 'tool', 'tool before answer chronologically');

const card = renderCard(s, { scope: 'oc_x' }) as {
  config: { streaming_mode: boolean; summary: { content: string } };
  body: { elements: unknown[] };
};
assert(card.config.streaming_mode === false, 'streaming off when done');
assert(card.config.summary.content === '已完成', 'summary');

// 有工具无正文：不应视为「可撤回空卡」
let toolsOnly = initialState();
toolsOnly = reduce(toolsOnly, {
  type: 'tool_use', id: 'x', name: 'Read', input: { file_path: '/a' },
});
toolsOnly = reduce(toolsOnly, {
  type: 'tool_result', id: 'x', output: 'ok', isError: false,
});
toolsOnly = finalizeIfRunning(toolsOnly);
assert(hasVisibleCardContent(toolsOnly), 'tools-only still visible');
assert(!answerText(toolsOnly), 'tools-only no answer text');

const timed = markWallTimeout(initialState(), 300, '任务超时（超过 300s）');
const timedCard = renderCard(timed, { scope: 'oc_x' }) as {
  body: { elements: Array<{ content?: string }> };
  config: { summary: { content: string } };
};
assert(timedCard.config.summary.content === '已超时', 'wall timeout summary');
assert(JSON.stringify(timedCard).includes('超过 300s'), 'wall timeout message visible');

// 权限提示不进 reasoning
let perm = initialState();
for (const e of translateCopilotJsonlLine(JSON.stringify({ type: 'permission.requested', data: {} }))) {
  perm = reduce(perm, e);
}
assert(perm.footer === 'awaiting_permission', 'permission footer');
assert(perm.statusNote?.includes('权限'), 'permission statusNote');
assert(!perm.reasoning.content, 'permission not in reasoning');
const permCard = JSON.stringify(renderCard(perm, { scope: 'x' }));
assert(permCard.includes('等待'), 'permission visible on card');
perm = finalizeIfRunning(perm);
assert(!perm.statusNote, 'statusNote cleared on done');

assert(maskEmailsInText('联系 a@b.com') === '联系 [email]', 'email fully masked');
assert(!JSON.stringify(renderCard({
  ...initialState(),
  terminal: 'done',
  footer: null,
  blocks: [{ kind: 'text', content: 'mail user@example.com', streaming: false }],
}, { scope: 'x' })).includes('user@example.com'), 'card masks email');

console.log('✓ verify-stream-card passed');
