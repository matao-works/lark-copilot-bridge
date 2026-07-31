/**
 * 工具块文案（对齐上游 src/card/tool-render.ts，含 Copilot 工具名）
 */
import type { ToolEntry } from './run-state.js';

const HEADER_SUMMARY_MAX = 80;
const BODY_FIELD_MAX = 600;
const OUTPUT_MAX = 1200;
const BODY_TOTAL_MAX = 2500;

export function toolHeaderText(tool: ToolEntry): string {
  const icon = tool.status === 'done' ? '✅' : tool.status === 'error' ? '❌' : '⏳';
  const summary = summarizeInput(tool.name, tool.input);
  return summary ? `${icon} **${tool.name}** — ${summary}` : `${icon} **${tool.name}**`;
}

export function toolBodyMd(tool: ToolEntry): string {
  const parts: string[] = [];
  const inputMd = renderInput(tool);
  if (inputMd) parts.push(inputMd);

  if (tool.output) {
    const truncated = truncate(tool.output, OUTPUT_MAX);
    if (tool.status === 'error') {
      parts.push(`**Error**\n\`\`\`\n${truncated}\n\`\`\``);
    } else {
      parts.push(`**Output**\n\`\`\`\n${truncated}\n\`\`\``);
    }
  } else if (tool.status === 'running') {
    parts.push('_运行中…_');
  }

  const body = parts.join('\n\n');
  if (body.length <= BODY_TOTAL_MAX) return body;
  return `${body.slice(0, BODY_TOTAL_MAX)}…\n\n_（已截断）_`;
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const rec = input as Record<string, unknown>;
  const pick = (key: string, max = HEADER_SUMMARY_MAX): string => {
    const v = rec[key];
    if (typeof v !== 'string') return '';
    const oneLine = v.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
  };
  const n = name.toLowerCase();
  if (n === 'bash' || n === 'shell' || n === 'run_terminal_cmd') return pick('command') || pick('cmd');
  if (n === 'read' || n === 'read_file' || n === 'edit' || n === 'write' || n === 'write_file') {
    return shortenPath(pick('file_path') || pick('path') || pick('filePath'));
  }
  if (n === 'grep' || n === 'search') {
    const pat = pick('pattern', 40) || pick('query', 40);
    const path = pick('path', 30);
    return path ? `${pat} in ${shortenPath(path)}` : pat;
  }
  if (n === 'glob') return pick('pattern') || pick('glob');
  if (n === 'webfetch' || n === 'web_fetch') return pick('url');
  if (n === 'websearch' || n === 'web_search') return pick('query', 60);
  return pick('command') || pick('file_path') || pick('path') || pick('query') || pick('url');
}

function renderInput(tool: ToolEntry): string {
  const input = tool.input;
  if (!input || typeof input !== 'object') return '';
  const rec = input as Record<string, unknown>;
  const str = (k: string): string => (typeof rec[k] === 'string' ? (rec[k] as string) : '');
  const n = tool.name.toLowerCase();

  if (n === 'bash' || n === 'shell' || n === 'run_terminal_cmd') {
    const cmd = str('command') || str('cmd');
    return cmd ? `**Command**\n\`\`\`bash\n${truncate(cmd, BODY_FIELD_MAX)}\n\`\`\`` : '';
  }
  if (n === 'read' || n === 'read_file' || n === 'edit' || n === 'write' || n === 'write_file') {
    const fp = str('file_path') || str('path') || str('filePath');
    return fp ? `**File** \`${fp}\`` : '';
  }
  if (n === 'web_fetch' || n === 'webfetch') {
    return str('url') ? `**URL** ${str('url')}` : '';
  }
  if (n === 'web_search' || n === 'websearch') {
    return str('query') ? `**Query** \`${truncate(str('query'), BODY_FIELD_MAX)}\`` : '';
  }
  if (n === 'grep' || n === 'search') {
    const lines: string[] = [];
    if (str('pattern') || str('query')) lines.push(`**Pattern** \`${str('pattern') || str('query')}\``);
    if (str('path')) lines.push(`**Path** \`${str('path')}\``);
    return lines.join('\n');
  }
  return '';
}

function shortenPath(p: string): string {
  return p;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
