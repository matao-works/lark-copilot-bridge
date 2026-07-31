/**
 * 飞书部分租户会因卡片里的邮箱触发 EMAIL_ADDRESS 拒审。
 * 对流式/静态卡片 JSON 做浅层脱敏（对齐上游 deepMaskEmails 思路，实现从简）。
 */
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function maskEmailsInText(s: string): string {
  return s.replace(EMAIL_RE, '[email]');
}

export function deepMaskEmails<T>(value: T): T {
  if (typeof value === 'string') return maskEmailsInText(value) as T;
  if (Array.isArray(value)) return value.map((v) => deepMaskEmails(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepMaskEmails(v);
    }
    return out as T;
  }
  return value;
}
