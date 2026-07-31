/**
 * 剥掉消息正文里的附件占位（SDK 规范化后的 markdown / XML）
 */
const MD_IMAGE_RE = /!\[[^\]]*]\([^)]+\)/g;
const XML_MEDIA_RE = /<(?:file|image|media|audio|video|sticker)\b[^>]*\/?>/gi;

export function stripAttachmentRefs(text: string): string {
  return text
    .replace(MD_IMAGE_RE, '')
    .replace(XML_MEDIA_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 无正文但有附件时的默认提示 */
export function emptyTextWithAttachmentsFallback(): string {
  return '请看附件。';
}
