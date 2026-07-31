/**
 * Prompt 组装辅助：上下文用 JSON；用户正文包进标签并转义尖括号，降低注入破框风险。
 */

export function bridgeContextBlock(fields: Record<string, string>): string {
  return `<bridge_context>\n${JSON.stringify(fields)}\n</bridge_context>\n\n`;
}

export function xmlBlock(tag: string, body: string): string {
  return `<${tag}>\n${escapeXmlText(body)}\n</${tag}>\n\n`;
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
